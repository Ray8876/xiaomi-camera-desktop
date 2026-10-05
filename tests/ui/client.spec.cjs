const {test, expect} = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let server, origin;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'app.js', 'style.css', 'player.js', 'video-rtc.js', 'logo.svg'].includes(name)) {res.writeHead(404); res.end(); return;}
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    fs.createReadStream(path.join(__dirname, '../../ui', name)).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server.close());
async function fixture(page, loggedIn = true) {
  await page.addInitScript(({loggedIn}) => {
    const cameras = Array.from({length: 16}, (_, i) => ({alias: 'cam_' + i.toString(16).padStart(16, '0'), name: ['客厅', '门口', '书房', '阳台'][i % 4] + ' ' + (i + 1)}));
    const profile = {settings: {layout: 4, slots: loggedIn ? cameras.map(c => ({alias: c.alias, muted: true, quality: 'auto'})) : [], region: 'cn', autoStart: false, fullscreenOnStart: false, rememberAudio: true, quality: 'auto', fit: 'contain'}, cameras: loggedIn ? cameras : [], loggedIn, version: '0.1.0', platform: 'darwin'};
    window.fixtureCalls = []; window.fixtureProfile = profile;
    window.mi = {onEngine() {}, async invoke(action, payload) {
      window.fixtureCalls.push({action, payload});
      if (action === 'profile' || action === 'discover') return structuredClone(profile);
      if (action === 'settings') {profile.settings = structuredClone(payload); return {settings: structuredClone(profile.settings)};}
      if (action === 'login') {
        if (payload.username) return {challenge: {hint: '输入发送至手机的验证码'}};
        if (payload.verify === '123456') {profile.loggedIn = true; profile.cameras = cameras; profile.settings.slots = cameras.map(c => ({alias: c.alias, muted: true, quality: 'auto'})); return structuredClone(profile);}
        return {error: '验证码错误'};
      }
      if (action === 'logout') {profile.loggedIn = false; profile.cameras = []; profile.settings.slots = []; return structuredClone(profile);}
      return {};
    }};
  }, {loggedIn});
  await page.goto(origin);
}
test('login challenge, password clearing and automatic camera wall', async ({page}) => {
  await fixture(page, false); await expect(page.locator('#login')).toBeVisible();
  await page.screenshot({path: 'test-results/login-preview.png'});
  await page.getByPlaceholder('手机号 / 邮箱 / 小米 ID').fill('fixture-user');
  await page.getByPlaceholder('请输入密码').fill('fixture-password');
  await page.locator('#login-submit').click(); await expect(page.locator('#challenge')).toBeVisible();
  await expect(page.locator('[name=password]')).toHaveValue('');
  await page.locator('#challenge-code').fill('123456'); await page.locator('#login-submit').click();
  await expect(page.locator('#dashboard')).toBeVisible(); await expect(page.locator('.camera-tile')).toHaveCount(4);
});
test('16-slot cap, preserved selections and repeated independent audio toggles', async ({page}) => {
  await fixture(page); await expect(page.locator('.camera-tile')).toHaveCount(4);
  await page.locator('#layouts button[data-layout="16"]').click(); await expect(page.locator('.camera-tile')).toHaveCount(16);
  await page.screenshot({path: 'test-results/wall-16-preview.png'});
  const first = page.locator('.camera-tile').first();
  await first.getByRole('button', {name: '打开声音', exact: true}).click();
  await expect(first.getByRole('button', {name: '关闭声音', exact: true})).toBeVisible();
  await first.getByRole('button', {name: '关闭声音', exact: true}).click();
  await first.getByRole('button', {name: '打开声音', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.fixtureProfile.settings.slots[0].muted)).toBe(false);
  await expect(page.locator('.camera-tile').nth(1).getByRole('button', {name: '打开声音', exact: true})).toBeVisible();
  await page.locator('#layouts button[data-layout="4"]').click();
  await expect.poll(() => page.evaluate(() => window.fixtureProfile.settings.slots[15].alias)).toBe('cam_000000000000000f');
  await page.screenshot({path: 'test-results/wall-preview.png'});
});
test('settings, camera selection, diagnostics and explicit logout', async ({page}) => {
  await fixture(page); await page.locator('#choose-cameras').click();
  await page.locator('.slot-camera').first().selectOption('cam_0000000000000004');
  await page.locator('#cameras-save').click();
  await expect.poll(() => page.evaluate(() => window.fixtureProfile.settings.slots[0].alias)).toBe('cam_0000000000000004');
  await page.locator('#settings-open').click(); await page.locator('#auto-start').check(); await page.locator('#auto-fullscreen').check();
  await page.locator('#remember-audio').uncheck(); await page.screenshot({path: 'test-results/settings-preview.png'});
  await page.locator('#settings-save').click();
  await expect.poll(() => page.evaluate(() => window.fixtureProfile.settings.autoStart)).toBe(true);
  await page.locator('#settings-open').click(); await page.locator('#export-logs').click();
  await expect.poll(() => page.evaluate(() => window.fixtureCalls.some(c => c.action === 'logs'))).toBe(true);
  await page.locator('#logout').click(); await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-logout').click(); await expect(page.locator('#login')).toBeVisible(); await expect(page.locator('mi-player')).toHaveCount(0);
});
test('all layouts fit viewport and camera names are rendered as text', async ({page}) => {
  await fixture(page); await page.setViewportSize({width: 1000, height: 650});
  for (const n of [1, 2, 4, 6, 9, 12, 16]) {
    await page.locator(`#layouts button[data-layout="${n}"]`).click(); await expect(page.locator('.camera-tile')).toHaveCount(n);
    await expect.poll(async () => {const box = await page.locator('.camera-tile').last().boundingBox(); return box ? box.y + box.height : Infinity;}).toBeLessThanOrEqual(650);
  }
});
test('unreachable stream retries without clearing login or camera selection', async ({page}) => {
  await fixture(page);
  await expect(page.locator('.camera-tile')).toHaveCount(4);
  await page.evaluate(() => {
    const player = document.querySelector('mi-player');
    const socket = new EventTarget(); socket.send = () => {}; socket.close = () => {};
    player.ws = socket;
    player.onopen();
    socket.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({type: 'error', value: 'read udp: i/o timeout'})}));
  });
  await expect(page.locator('.camera-tile').first().locator('.tile-status')).toContainText('连接中断');
  await expect.poll(() => page.evaluate(() => window.fixtureCalls.some(c => c.action === 'player-event' && c.payload.event === 'reconnecting'))).toBe(true);
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#login')).toBeHidden();
  expect(await page.evaluate(() => window.fixtureProfile.settings.slots[0].alias)).toBe('cam_0000000000000000');
  expect(await page.evaluate(() => document.querySelector('mi-player').usingCompatible)).toBeFalsy();
});
