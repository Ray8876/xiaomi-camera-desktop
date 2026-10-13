import './player.js';
const $ = id => document.getElementById(id);
const layouts = [1, 2, 4, 6, 9, 12, 16];
const qualityNames = {auto: '自动', hd: '高清', sd: '流畅', compatible: '兼容'};
let profile, settings, challenge = null, toastTimer, saveQueue = Promise.resolve(), saveRevision = 0;
let refreshBusy = false, spotlight = null, fullscreenTimer, cursorTimer;
const tileControlTimers = new WeakMap();
const api = async (action, payload) => {
  const result = await window.mi.invoke(action, payload);
  if (result?.error) throw new Error(result.error);
  return result;
};
function toast(message) {$('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3000);}
function banner(message) {$('banner').querySelector('span').textContent = message; $('banner').hidden = !message;}
function ensureSlots() {
  while (settings.slots.length < 16) settings.slots.push({alias: null, muted: true, quality: settings.quality});
}
function save() {
  const revision = ++saveRevision, snapshot = structuredClone(settings);
  const task = saveQueue.then(async () => {
    const result = await api('settings', snapshot);
    // Preserve slot objects so repeated audio clicks update the active state.
    return result;
  });
  saveQueue = task.catch(error => {banner(error.message);}); return task;
}
function adopt(next) {profile = next; settings = next.settings; ensureSlots();}
function showProfile() {
  const loggedIn = profile.loggedIn;
  $('login').hidden = loggedIn; $('dashboard').hidden = !loggedIn;
  if (loggedIn) {
    $('camera-count').textContent = profile.cameras.length;
    $('dashboard-subtitle').textContent = profile.cameras.length ? '上次的画面已为你准备好' : '刷新设备，开始安排你的视野';
    renderWall();
  } else {
    disposePlayers(); $('wall').replaceChildren(); $('login-region').value = settings.region;
  }
}
function disposePlayers() {document.querySelectorAll('.camera-tile').forEach(tile => clearTimeout(tileControlTimers.get(tile))); document.querySelectorAll('mi-player').forEach(player => player.dispose());}
function select(options, current, label) {
  const el = document.createElement('select'); el.setAttribute('aria-label', label);
  for (const [value, name] of options) {const o = document.createElement('option'); o.value = value; o.textContent = name; el.append(o);}
  el.value = current; return el;
}
function button(text, title, callback) {
  const b = document.createElement('button'); b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', callback); return b;
}
function renderWall() {
  spotlight = null; disposePlayers(); $('wall').replaceChildren();
  const cols = settings.layout === 1 ? 1 : settings.layout === 2 || settings.layout === 4 ? 2 : settings.layout <= 9 ? 3 : 4;
  const rows = settings.layout === 6 ? 3 : Math.ceil(settings.layout / cols);
  $('wall').dataset.layout = String(settings.layout);
  $('wall').style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  $('wall').style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  document.querySelectorAll('button[data-layout]').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.layout) === settings.layout));
  for (let i = 0; i < settings.layout; i++) renderTile(i);
  $('wall-status').textContent = `${settings.layout} 格画面 · 双击画面放大 · 状态自动保存`;
}
function renderTile(index) {
  const existing = $('wall').querySelector(`[data-slot="${index}"]`);
  const slot = settings.slots[index], camera = profile.cameras.find(c => c.alias === slot.alias);
  const tile = document.createElement('article'); tile.className = 'camera-tile'; tile.dataset.slot = index;
  tile.addEventListener('pointermove', () => revealTileControls(tile));
  tile.addEventListener('pointerleave', () => {clearTimeout(tileControlTimers.get(tile)); tile.classList.remove('controls-visible');});
  const stage = document.createElement('div'); stage.className = 'tile-stage'; tile.append(stage);
  if (camera) {
    const player = document.createElement('mi-player'); player.slotIndex = index; player.wantedMuted = slot.muted; player.fit = settings.fit;
    const suffix = slot.quality === 'hd' ? '_hd' : slot.quality === 'sd' ? '_sd' : '';
    player.compatibleSource = camera.alias + suffix + '_compatible';
    player.usingCompatible = slot.quality === 'compatible';
    player.src = '/api/ws?src=' + encodeURIComponent(player.usingCompatible ? player.compatibleSource : camera.alias + suffix);
    const head = document.createElement('div'); head.className = 'tile-head';
    const live = document.createElement('span'); live.className = 'live'; live.textContent = '连接中';
    const number = document.createElement('span'); number.className = 'tile-number'; number.textContent = String(index + 1).padStart(2, '0');
    head.append(live, number);
    const status = document.createElement('div'); status.className = 'tile-status'; status.textContent = '正在连接…';
    player.addEventListener('player-status', ev => {status.textContent = ev.detail; status.hidden = !ev.detail;});
    player.addEventListener('player-live', ev => {live.replaceChildren(); if (ev.detail) live.append(document.createElement('i')); live.append(document.createTextNode(ev.detail ? 'LIVE' : '连接中'));});
    stage.append(player, head, status); stage.addEventListener('dblclick', () => magnify(tile));
    const footer = document.createElement('div'); footer.className = 'tile-footer';
    const name = document.createElement('span'); name.className = 'tile-name'; name.textContent = camera.name; name.title = camera.name;
    const quality = select(Object.entries(qualityNames), slot.quality, `${camera.name}清晰度`);
    quality.addEventListener('change', () => {slot.quality = quality.value; save(); renderTile(index);});
    const audio = button(slot.muted ? '♪̸' : '♪', slot.muted ? '打开声音' : '关闭声音', () => {
      slot.muted = !slot.muted; player.mute(slot.muted); audio.textContent = slot.muted ? '♪̸' : '♪'; audio.classList.toggle('audio-on', !slot.muted); audio.title = slot.muted ? '打开声音' : '关闭声音'; audio.setAttribute('aria-label', audio.title); save();
    }); audio.classList.toggle('audio-on', !slot.muted);
    footer.append(name, quality, audio, button('↻', '重新连接', () => player.retry()), button('⛶', '放大画面', () => magnify(tile))); tile.append(footer);
  } else {
    const empty = document.createElement('div'); empty.className = 'tile-empty';
    const glyph = document.createElement('span'); glyph.className = 'empty-glyph'; glyph.textContent = '⊞';
    const text = document.createElement('p'); text.textContent = slot.alias ? '摄像头暂未发现，可刷新设备或重新选择' : `第 ${index + 1} 格 · 选择一台摄像头`;
    const add = button('选择摄像头', '选择摄像头', () => openCameraEditor(index)); add.className = 'secondary'; empty.append(glyph, text, add); stage.append(empty);
  }
  if (existing) {
    if (spotlight === existing) {tile.classList.add('spotlight'); spotlight = tile;}
    clearTimeout(tileControlTimers.get(existing)); existing.querySelector('mi-player')?.dispose(); existing.replaceWith(tile);}
  else $('wall').append(tile);
}
function revealTileControls(tile) {
  tile.classList.add('controls-visible'); clearTimeout(tileControlTimers.get(tile));
  tileControlTimers.set(tile, setTimeout(() => tile.classList.remove('controls-visible'), 2400));
}
function setFullscreen(active) {
  document.body.classList.toggle('pure-fullscreen', active);
  if (!active) {
    clearTimeout(fullscreenTimer); clearTimeout(cursorTimer);
    document.body.classList.remove('fullscreen-controls-visible', 'cursor-active');
  }
}
async function toggleFullscreen(payload) {
  try {const result = await api('fullscreen', payload); setFullscreen(result.fullscreen === true);} catch (error) {toast(error.message);}
}
document.addEventListener('pointermove', ev => {
  if (!document.body.classList.contains('pure-fullscreen')) return;
  document.body.classList.add('cursor-active'); clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.remove('cursor-active'), 2400);
  if (ev.clientY <= 48 || ev.target.closest('#fullscreen-controls')) {
    document.body.classList.add('fullscreen-controls-visible'); clearTimeout(fullscreenTimer);
    fullscreenTimer = setTimeout(() => document.body.classList.remove('fullscreen-controls-visible'), 2400);
  }
});
function magnify(tile) {
  if (spotlight === tile) {tile.classList.remove('spotlight'); spotlight = null; return;}
  spotlight?.classList.remove('spotlight'); spotlight = tile; tile.classList.add('spotlight');
}
function openCameraEditor(focusIndex = 0) {
  $('slot-editor').replaceChildren();
  for (let i = 0; i < settings.layout; i++) {
    const row = document.createElement('div'); row.className = 'slot-row';
    const num = document.createElement('span'); num.textContent = String(i + 1).padStart(2, '0');
    const cameraSelect = select([['', '留空'], ...profile.cameras.map(c => [c.alias, c.name])], settings.slots[i].alias || '', `第 ${i + 1} 格摄像头`);
    cameraSelect.dataset.slot = i; cameraSelect.className = 'slot-camera';
    const quality = select(Object.entries(qualityNames), settings.slots[i].quality, `第 ${i + 1} 格清晰度`); quality.className = 'slot-quality';
    row.append(num, cameraSelect, quality); $('slot-editor').append(row);
  }
  $('cameras-dialog').showModal(); $('slot-editor').querySelector(`[data-slot="${focusIndex}"]`)?.focus();
}
async function refresh() {
  if (refreshBusy) return; refreshBusy = true; $('refresh').disabled = true; $('refresh').textContent = '刷新中…';
  try {
    await saveQueue; const next = await api('discover');
    const changed = JSON.stringify(profile.cameras) !== JSON.stringify(next.cameras);
    if (changed || $('dashboard').hidden) {adopt(next); showProfile();}
    banner(''); toast(next.cameras.length ? '设备已更新' : '当前地区没有发现摄像头，可在设置中检查地区');
  } catch (error) {banner(error.message);} finally {refreshBusy = false; $('refresh').disabled = false; $('refresh').textContent = '↻ 刷新设备';}
}
function resetLogin() {
  challenge = null; $('credentials').hidden = false; $('challenge').hidden = true;
  $('login-form').elements.username.required = true; $('login-form').elements.password.required = true; $('challenge-code').required = false; $('challenge-code').value = ''; $('login-error').hidden = true;
}
$('login-form').addEventListener('submit', async ev => {
  ev.preventDefault(); $('login-submit').disabled = true; $('login-error').hidden = true;
  const form = ev.target;
  try {
    settings.region = $('login-region').value; await save();
    const payload = challenge ? {[challenge.captcha ? 'captcha' : 'verify']: $('challenge-code').value.trim()} : {username: form.elements.username.value.trim(), password: form.elements.password.value};
    const result = await api('login', payload); form.elements.password.value = '';
    if (result.challenge) {
      challenge = result.challenge; $('credentials').hidden = true; $('challenge').hidden = false;
      form.elements.username.required = false; form.elements.password.required = false; $('challenge-code').required = true;
      $('captcha-image').hidden = !challenge.captcha; if (challenge.captcha) $('captcha-image').src = 'data:image/jpeg;base64,' + challenge.captcha;
      $('challenge-hint').textContent = challenge.captcha ? '输入图片中的字符，继续登录。' : challenge.hint;
      $('challenge-code').value = ''; $('challenge-code').focus();
    } else {adopt(result); resetLogin(); showProfile(); await refresh();}
  } catch (error) {$('login-error').textContent = error.message; $('login-error').hidden = false;} finally {$('login-submit').disabled = false;}
});
$('back-login').onclick = resetLogin;
$('show-password').onclick = () => {const input = $('login-form').elements.password; input.type = input.type === 'password' ? 'text' : 'password'; $('show-password').textContent = input.type === 'password' ? '显示' : '隐藏';};
$('import-login').onclick = async () => {
  try {const result = await api('import'); if (!result.canceled) {adopt(result); showProfile(); await refresh();}} catch(error) {$('login-error').textContent = error.message; $('login-error').hidden = false;}
};
for (const layout of layouts) {
  for (const id of ['layouts', 'fullscreen-layouts']) {
    const b = button(String(layout), `${layout} 格画面`, () => {settings.layout = layout; save(); renderWall();}); b.dataset.layout = layout; $(id).append(b);
  }
}
$('refresh').onclick = refresh;
$('banner-close').onclick = () => banner('');
$('fullscreen').onclick = () => toggleFullscreen();
$('exit-fullscreen').onclick = () => toggleFullscreen({exit: true});
$('fullscreen-cameras').onclick = () => $('choose-cameras').click();
$('fullscreen-settings').onclick = () => $('settings-open').click();
$('fullscreen-mute').onclick = () => $('mute-all').click();
$('choose-cameras').onclick = () => openCameraEditor();
$('fill-slots').onclick = () => {
  for (let i = 0; i < settings.layout; i++) settings.slots[i] = {...settings.slots[i], alias: profile.cameras[i]?.alias || null, muted: true};
  save(); renderWall(); toast('已按设备顺序填入画面');
};
$('mute-all').onclick = () => {
  settings.slots.forEach(s => s.muted = true); document.querySelectorAll('mi-player').forEach(p => p.mute(true));
  document.querySelectorAll('.tile-footer button.audio-on').forEach(b => {b.classList.remove('audio-on'); b.textContent = '♪̸'; b.title = '打开声音'; b.setAttribute('aria-label', '打开声音');});
  save(); toast('所有画面已静音');
};
$('cameras-save').onclick = () => {
  $('slot-editor').querySelectorAll('.slot-row').forEach((row, i) => {
    const alias = row.querySelector('.slot-camera').value || null;
    settings.slots[i] = {alias, muted: alias === settings.slots[i].alias ? settings.slots[i].muted : true, quality: row.querySelector('.slot-quality').value};
  }); save(); $('cameras-dialog').close(); renderWall(); toast('画面已保存');
};
$('settings-open').onclick = () => {
  $('auto-start').checked = settings.autoStart; $('auto-fullscreen').checked = settings.fullscreenOnStart; $('remember-audio').checked = settings.rememberAudio;
  $('fit').value = settings.fit; $('default-quality').value = settings.quality; $('settings-region').value = settings.region;
  $('about').textContent = `Mi Camera Desktop ${profile.version} · ${profile.platform === 'darwin' ? 'macOS' : 'Windows'} · 基于 go2rtc`;
  $('settings-dialog').showModal();
};
$('settings-save').onclick = async () => {
  const oldRegion = settings.region;
  Object.assign(settings, {autoStart: $('auto-start').checked, fullscreenOnStart: $('auto-fullscreen').checked, rememberAudio: $('remember-audio').checked, fit: $('fit').value, quality: $('default-quality').value, region: $('settings-region').value});
  try {await save(); $('settings-dialog').close(); renderWall(); toast('设置已保存'); if (oldRegion !== settings.region) await refresh();} catch(error) {toast(error.message);}
};
$('logout').onclick = () => $('confirm-dialog').showModal();
$('confirm-logout').onclick = async () => {
  try {const next = await api('logout'); document.querySelectorAll('dialog[open]').forEach(d => d.close()); adopt(next); resetLogin(); showProfile(); toast('已退出登录');} catch(error) {toast(error.message);}
};
async function exportLogs() {try {const result = await api('logs'); if (result.ok) toast('诊断日志已导出');} catch(error) {toast(error.message);}}
$('export-logs').onclick = exportLogs; $('login-logs').onclick = exportLogs;
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());
document.addEventListener('keydown', ev => {
  if (ev.key === 'F11') {ev.preventDefault(); toggleFullscreen();}
  if (ev.key === 'Escape' && spotlight) {spotlight.classList.remove('spotlight'); spotlight = null;}
  else if (ev.key === 'Escape' && !document.querySelector('dialog[open]')) toggleFullscreen({exit: true});
});
window.mi.onEngine(status => {if (status === 'failed') banner('播放引擎无法恢复，请重启客户端并导出日志。'); else {banner('播放引擎已恢复，正在重新连接画面。'); renderWall();}});
window.mi.onFullscreen?.(setFullscreen);
try {adopt(await api('profile')); setFullscreen(profile.fullscreen === true); showProfile(); if (profile.loggedIn) setTimeout(refresh, 1000);} catch(error) {toast(error.message); $('login').hidden = false;}
