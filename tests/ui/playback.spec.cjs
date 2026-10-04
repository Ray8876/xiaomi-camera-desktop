const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {Engine} = require('../../desktop/engine.cjs');
const {Logs} = require('../../desktop/logs.cjs');
const {createGateway} = require('../../desktop/gateway.cjs');
const engineDir = path.join(__dirname, '../../resources', `${process.platform}-${process.arch}`);
const ffmpeg = path.join(engineDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
test('real bundled engine decodes sixteen synthetic videos and compatible audio/video', async ({page, context}) => {
  test.setTimeout(90000);
  test.skip(!fs.existsSync(ffmpeg), 'Build the platform FFmpeg first');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-playback-'));
  const fixture = path.join(dir, 'synthetic.mkv');
  // Conventional app installation paths contain spaces on both Windows and Mac.
  const installedDir = path.join(dir, 'Installed Client'); fs.mkdirSync(installedDir);
  for (const name of [process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg']) {
    fs.copyFileSync(path.join(engineDir, name), path.join(installedDir, name)); fs.chmodSync(path.join(installedDir, name), 0o755);
  }
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '15', '-c:a', 'libopus', '-y', fixture], {encoding: 'utf8'});
  expect(result.status, result.stderr).toBe(0);
  // An isolated test vault; this fake cipher is never used by the application.
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(16);
  const safeStorage = {isEncryptionAvailable: () => true, encryptString: text => {const c = crypto.createCipheriv('aes-256-ctr', key, iv); return Buffer.concat([c.update(text), c.final()]);}};
  const engine = new Engine({dir: installedDir, vaultPath: path.join(dir, 'test.enc'), safeStorage, logs: new Logs(path.join(dir, 'logs'))});
  let gateway;
  page.on('console', async message => {
    if (message.type() === 'error' && message.text().includes('[VideoRTC]')) console.log('DECODE_DIAGNOSTICS', await message.args()[1]?.jsonValue().catch(() => null));
  });
  try {
    await engine.start();
    const cameras = Array.from({length: 16}, (_, i) => ({alias: 'cam_' + i.toString(16).padStart(16, '0'), name: '测试画面 ' + (i + 1)}));
    for (const camera of cameras) {
      const revision = engine.sessionRevision;
      // Distinct inputs avoid go2rtc's FFmpeg rendezvous hash collision.
      const input = path.join(dir, camera.alias + '.mkv'); fs.copyFileSync(fixture, input);
      const response = await engine.request('/api/streams?' + new URLSearchParams({name: camera.alias, src: `ffmpeg:${input.replaceAll('\\', '/')}#video=copy#audio=copy`}), {method: 'PUT'});
      expect(response.status).toBe(200); await engine.awaitPersist(revision);
    }
    const revision = engine.sessionRevision;
    await engine.request('/api/streams?' + new URLSearchParams({name: cameras[0].alias + '_compatible', src: `ffmpeg:${cameras[0].alias}#video=h264#audio=opus`}), {method: 'PUT'});
    await engine.awaitPersist(revision);
    gateway = await createGateway({uiDir: path.join(__dirname, '../../ui'), engine, logs: engine.logs, allowedSource: src => Object.hasOwn(engine.saved.streams, src)});
    await context.addCookies([{url: gateway.origin, name: 'mi_session', value: gateway.token, httpOnly: true, sameSite: 'Strict'}]);
    await page.addInitScript(({cameras}) => {
      const profile = {settings: {layout: 16, slots: cameras.map(c => ({alias: c.alias, quality: 'auto', muted: true})), quality: 'auto', fit: 'contain', region: 'cn', autoStart: false, fullscreenOnStart: false, rememberAudio: true}, cameras, loggedIn: true, version: 'test', platform: 'test'};
      window.mi = {onEngine() {}, async invoke(action, payload) {
        if (action === 'profile' || action === 'discover') return structuredClone(profile);
        if (action === 'settings') {profile.settings = structuredClone(payload); return {settings: structuredClone(profile.settings)};}
        return {};
      }};
    }, {cameras});
    await page.goto(gateway.origin);
    await expect(page.locator('video')).toHaveCount(16);
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('video')].filter(v => v.videoWidth === 320 && v.getVideoPlaybackQuality().totalVideoFrames >= 3).length), {timeout: 45000}).toBe(16);
    expect(await page.evaluate(() => [...document.querySelectorAll('video')].every(v => v.muted))).toBe(true);
    await page.screenshot({path: 'test-results/real-synthetic-16.png'});
    await page.locator('#layouts button[data-layout="1"]').click();
    await page.locator('.tile-footer select').selectOption('compatible');
    await expect.poll(() => page.locator('video').evaluate(v => v.getVideoPlaybackQuality().totalVideoFrames), {timeout: 30000}).toBeGreaterThan(3);
    await page.locator('.tile-footer').getByRole('button', {name: '打开声音', exact: true}).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.muted)).toBe(false);
    await page.locator('.tile-footer').getByRole('button', {name: '重新连接', exact: true}).click();
    await expect.poll(() => page.locator('video').evaluate(v => v.readyState >= 2 && v.getVideoPlaybackQuality().totalVideoFrames > 3), {timeout: 15000}).toBe(true);
    await page.screenshot({path: 'test-results/real-compatible.png'});
  } catch(error) {
    console.log('VIDEO_DIAGNOSTICS', await page.evaluate(() => [...document.querySelectorAll('mi-player')].map(p => ({slot: p.slot, frames: p.video?.getVideoPlaybackQuality().totalVideoFrames, error: p.video?.error?.code, compatible: p.usingCompatible, status: p.wsState, pc: p.pcState, source: p.wsURL}))).catch(() => []));
    fs.mkdirSync('test-results/synthetic-logs', {recursive: true});
    fs.cpSync(path.join(dir, 'logs'), 'test-results/synthetic-logs', {recursive: true}); throw error;
  } finally {await page.close(); gateway?.close(); await engine.stop(); fs.rmSync(dir, {recursive: true, force: true});}
});
