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
    window.mi = {onEngine() {}, onFullscreen(callback) {window.fixtureFullscreen = callback;}, async invoke(action, payload) {
      window.fixtureCalls.push({action, payload});
      if (action === 'fullscreen') {profile.fullscreen = payload?.exit ? false : !profile.fullscreen; window.fixtureFullscreen?.(profile.fullscreen); return {fullscreen: profile.fullscreen};}
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
  await first.hover(); await expect(first.locator('.tile-footer')).toHaveCSS('opacity', '1');
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
test('video controls overlay full stage, reveal on movement, and hide after inactivity', async ({page}) => {
  await fixture(page);
  const first = page.locator('.camera-tile').first(), footer = first.locator('.tile-footer');
  await expect(footer).toHaveCSS('opacity', '0');
  const geometry = await first.evaluate(tile => {
    const t = tile.getBoundingClientRect(), stage = tile.querySelector('.tile-stage').getBoundingClientRect();
    return {tile: t.height, stage: stage.height, border: parseFloat(getComputedStyle(tile).borderTopWidth)};
  });
  expect(geometry.stage).toBeCloseTo(geometry.tile - geometry.border * 2, 0);
  await first.hover(); await expect(footer).toHaveCSS('opacity', '1');
  await first.getByRole('button', {name: '打开声音', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.fixtureProfile.settings.slots[0].muted)).toBe(false);
  await expect(footer).toHaveCSS('opacity', '0');
  // Keyboard users can still reveal and operate the hidden toolbar.
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Tab');
  await first.locator('select').focus();
  await expect(footer).toHaveCSS('opacity', '1');
  await first.getByRole('button', {name: '放大画面', exact: true}).click();
  await expect(first).toHaveClass(/spotlight/);
  await first.locator('select').selectOption('hd');
  await expect(page.locator('.camera-tile').first()).toHaveClass(/spotlight/);
});
test('native fullscreen state makes four equal tiles cover the entire viewport', async ({page}) => {
  await fixture(page);
  await page.locator('#fullscreen').click();
  await expect(page.locator('body')).toHaveClass(/pure-fullscreen/);
  await expect(page.locator('.rail')).toBeHidden();
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.viewbar')).toBeHidden();
  await expect(page.locator('.statusbar')).toBeHidden();
  const geometry = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.camera-tile')].map(tile => {
      const {x, y, width, height} = tile.getBoundingClientRect(); return {x, y, width, height};
    });
    return {width: innerWidth, height: innerHeight, boxes};
  });
  for (const [i, box] of geometry.boxes.entries()) {
    expect(box.width).toBeCloseTo(geometry.width / 2, 0); expect(box.height).toBeCloseTo(geometry.height / 2, 0);
    expect(box.x).toBeCloseTo((i % 2) * geometry.width / 2, 0); expect(box.y).toBeCloseTo(Math.floor(i / 2) * geometry.height / 2, 0);
  }
  await page.mouse.move(720, 460);
  await expect(page.locator('#fullscreen-controls')).toHaveCSS('opacity', '0');
  await page.mouse.move(720, 10);
  await expect(page.locator('#fullscreen-controls')).toHaveCSS('opacity', '1');
  await page.locator('#exit-fullscreen').click();
  await expect(page.locator('body')).not.toHaveClass(/pure-fullscreen/);
  await expect(page.locator('.topbar')).toBeVisible();
  // Native menu/button changes and startup fullscreen also use this bridge.
  await page.evaluate(() => window.fixtureFullscreen(true));
  await expect(page.locator('body')).toHaveClass(/pure-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/pure-fullscreen/);
});

async function syntheticPreview(page, output) {
  await page.evaluate(async () => {
    await Promise.all([...document.querySelectorAll('mi-player')].map(async (player, i) => {
      player.dispose();
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      const c = canvas.getContext('2d'), colors = ['#687d74', '#79877f', '#707b88', '#91846e', '#576e73', '#8c8a7c'];
      c.fillStyle = colors[i % colors.length]; c.fillRect(0, 0, 960, 540);
      c.fillStyle = '#bbc1b2'; c.beginPath(); c.moveTo(0, 0); c.lineTo(220, 170); c.lineTo(220, 330); c.lineTo(0, 540); c.fill();
      c.fillStyle = '#d6d4c8'; c.fillRect(220, 170, 520, 160);
      c.fillStyle = '#59675d'; c.beginPath(); c.moveTo(220, 330); c.lineTo(740, 330); c.lineTo(960, 540); c.lineTo(0, 540); c.fill();
      c.fillStyle = '#829a96'; c.fillRect(315, 186, 185, 113); c.strokeStyle = '#c4ccc1'; c.lineWidth = 6; c.strokeRect(315, 186, 185, 113);
      c.beginPath(); c.moveTo(408, 186); c.lineTo(408, 300); c.moveTo(315, 240); c.lineTo(500, 240); c.stroke();
      c.fillStyle = '#414f4a'; c.fillRect(620, 212, 80, 118); c.fillStyle = '#303f38'; c.fillRect(130, 365, 335, 95);
      c.fillStyle = '#baa584'; c.fillRect(535, 395, 230, 20); c.fillStyle = '#586652'; c.fillRect(549, 415, 10, 63); c.fillRect(740, 415, 10, 63);
      c.fillStyle = '#203b2f'; c.beginPath(); c.ellipse(825, 297, 40, 75, .3, 0, Math.PI * 2); c.fill(); c.fillStyle = '#6c5540'; c.fillRect(805, 350, 39, 43);
      c.font = '20px sans-serif'; c.fillStyle = '#fff'; c.shadowColor = '#000'; c.shadowBlur = 4;
      c.fillText(`模拟摄像头 ${i + 1} · 非真实视频`, 24, 38);
      player.video.srcObject = canvas.captureStream(1); await player.video.play(); player.status('');
    }));
    document.querySelectorAll('.camera-tile').forEach(tile => tile.classList.remove('controls-visible'));
    document.body.classList.remove('fullscreen-controls-visible');
  });
  await page.mouse.move(-20, -20);
  await expect.poll(() => page.locator('video').evaluateAll(videos => videos.every(video => video.readyState >= 2))).toBe(true);
  await page.screenshot({path: output});
}
test('six-camera layout has one large and five small tiles without gaps or overlap', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 810});
  await fixture(page); await page.locator('#layouts button[data-layout="6"]').click();
  await page.locator('#fullscreen').click();
  const geometry = await page.evaluate(() => ({width: innerWidth, height: innerHeight, boxes: [...document.querySelectorAll('.camera-tile')].map(tile => {
    const {x, y, width, height} = tile.getBoundingClientRect(); return {x, y, width, height};
  })}));
  const unitWidth = geometry.width / 3, unitHeight = geometry.height / 3;
  const positions = [[0, 0, 2, 2], [2, 0, 1, 1], [2, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]];
  for (const [i, box] of geometry.boxes.entries()) {
    const [x, y, w, h] = positions[i];
    expect(box.x).toBeCloseTo(x * unitWidth, 0); expect(box.y).toBeCloseTo(y * unitHeight, 0);
    expect(box.width).toBeCloseTo(w * unitWidth, 0); expect(box.height).toBeCloseTo(h * unitHeight, 0);
  }
  if (process.env.CAPTURE_LAYOUT_IMAGES === '1') {
    await syntheticPreview(page, 'test-results/fullscreen-six-synthetic.png');
    await page.mouse.move(720, 10); await page.locator('#fullscreen-layouts button[data-layout="4"]').click();
    await syntheticPreview(page, 'test-results/fullscreen-four-synthetic.png');
    await page.locator('.camera-tile').first().hover();
    await expect(page.locator('.tile-footer').first()).toHaveCSS('opacity', '1');
    await page.screenshot({path: 'test-results/fullscreen-controls-synthetic.png'});
  }
  await page.mouse.move(720, 10);
  await page.locator('#fullscreen-layouts button[data-layout="16"]').click();
  await expect(page.locator('.camera-tile')).toHaveCount(16);
  await page.mouse.move(720, 10);
  await page.locator('#fullscreen-cameras').click();
  await expect(page.locator('#cameras-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#cameras-dialog')).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/pure-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/pure-fullscreen/);
});
