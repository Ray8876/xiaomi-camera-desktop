const {app, BrowserWindow, ipcMain, safeStorage, dialog, shell, session, Menu} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const {Logs} = require('./logs.cjs');
const {Engine} = require('./engine.cjs');
const {normalize, atomicWrite, aliasFor, sourceForQuality} = require('./state.cjs');
const {createGateway} = require('./gateway.cjs');
const {backupUnreadableSession} = require('./session.cjs');
const isSmoke = process.argv.includes('--smoke-test');
if (isSmoke) app.setPath('userData', path.join(app.getPath('temp'), 'mi-camera-smoke-' + process.pid));
app.setName('Mi Camera Desktop');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
let win, engine, gateway, logs, state, stateFile, cameras = [], closing = false, serial = Promise.resolve();
if (!app.requestSingleInstanceLock()) {app.quit();} else {
  app.on('second-instance', () => {if (win) {if (win.isMinimized()) win.restore(); win.show(); win.focus();}});
  app.whenReady().then(boot).catch(async error => {
    logs?.write('error', 'startup_failed', {message: error.message});
    if (isSmoke) {console.error('SMOKE_FAIL'); app.exit(1); return;}
    await dialog.showMessageBox({type: 'error', title: '无法启动', message: error.message, detail: '可在应用数据目录的 logs 文件夹查看日志。'});
    app.quit();
  });
}
function writeState(next) {
  state = normalize(next);
  const durable = {...state, slots: state.slots.map(slot => ({...slot, muted: state.rememberAudio ? slot.muted : true}))};
  atomicWrite(stateFile, JSON.stringify(durable, null, 2)); return state;
}
function cachedCameras() {
  const items = [];
  for (const [alias, sources] of Object.entries(engine.saved.streams || {})) {
    if (!/^cam_[a-f0-9]{16}$/.test(alias)) continue;
    const source = [].concat(sources)[0];
    items.push({alias, name: `摄像头 ${items.length + 1}`, source});
  }
  const names = engine.savedNames || {};
  return items.map(item => ({...item, name: names[item.alias] || item.name}));
}
function publicProfile() {return {settings: state, cameras: cameras.map(({alias, name}) => ({alias, name})), loggedIn: Object.keys(engine.saved.xiaomi || {}).length > 0, version: app.getVersion(), platform: process.platform};}
async function ensureVariants(camera) {
  for (const quality of ['', '_hd', '_sd']) {
    const source = sourceForQuality(camera.source, quality.slice(1)), alias = camera.alias + quality;
    await putStream(alias, source);
    await putStream(alias + '_compatible', `ffmpeg:${alias}#video=h264#audio=opus`);
  }
}
async function putStream(alias, source) {
  const old = [].concat(engine.saved.streams?.[alias] || [])[0];
  if (old === source) return;
  const params = new URLSearchParams({name: alias, src: source});
  const revision = engine.sessionRevision;
  const r = await engine.request('/api/streams?' + params, {method: 'PUT'});
  if (!r.ok) throw new Error('摄像头配置失败，请重试或导出日志。');
  await engine.awaitPersist(revision);
}
async function discover() {
  const users = Object.keys(engine.saved.xiaomi || {});
  if (!users.length) return publicProfile();
  const next = [];
  for (const user of users) {
    const r = await engine.request('/api/xiaomi?' + new URLSearchParams({id: user, region: state.region}));
    if (r.status === 404) continue;
    if (!r.ok) {
      logs.write('warn', 'discovery_failed', {status: r.status});
      throw new Error('设备刷新失败。请检查网络、地区或重新登录；已保存的画面仍可使用。');
    }
    const data = await r.json();
    for (const item of data.sources || []) {
      const alias = aliasFor(item.url);
      if (!next.some(c => c.alias === alias)) next.push({alias, name: item.name || `摄像头 ${next.length + 1}`, source: item.url});
    }
  }
  logs.addSecrets(next.flatMap(c => [c.name, c.source]));
  for (const camera of next) await ensureVariants(camera);
  cameras = next;
  saveNames();
  if (!state.slots.some(s => s.alias)) writeState({...state, slots: next.slice(0, 16).map(c => ({alias: c.alias, muted: true, quality: state.quality}))});
  logs.write('info', 'discovery_completed', {cameras: next.length}); return publicProfile();
}
function saveNames() {
  engine.savedNames = Object.fromEntries(cameras.map(c => [c.alias, c.name]));
  atomicWrite(path.join(app.getPath('userData'), 'camera-names.enc'), safeStorage.encryptString(JSON.stringify(engine.savedNames)));
}
async function boot() {
  Menu.setApplicationMenu(null);
  const dir = app.getPath('userData'); fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  logs = new Logs(path.join(dir, 'logs'));
  setInterval(() => logs.cleanup(), 3600000).unref();
  stateFile = path.join(dir, 'settings.json');
  try {state = normalize(JSON.parse(fs.readFileSync(stateFile, 'utf8')));} catch {state = normalize();}
  const engineDir = app.isPackaged ? path.join(process.resourcesPath, 'engine') : path.join(__dirname, '..', 'resources', `${process.platform}-${process.arch}`);
  const engineOptions = {dir: engineDir, vaultPath: path.join(dir, 'session.enc'), safeStorage, logs, onRestart: status => win?.webContents.send('engine-status', status || 'restarted')};
  try {engine = new Engine(engineOptions);} catch (error) {
    if (error.code !== 'SESSION_CACHE_UNREADABLE' || isSmoke) throw error;
    const choice = await dialog.showMessageBox({type: 'warning', title: '登录缓存无法读取',
      message: '登录缓存无法解密，可能已损坏或来自其他系统账户。',
      detail: '你可以退出后使用原系统账户打开，或备份加密缓存后重新登录。重新登录会保留布局和声音设置。',
      buttons: ['退出', '备份缓存并重新登录'], defaultId: 0, cancelId: 0});
    if (choice.response !== 1) {app.quit(); return;}
    backupUnreadableSession(dir);
    logs.write('warn', 'session_cache_backed_up');
    engine = new Engine(engineOptions);
  }
  const namesFile = path.join(dir, 'camera-names.enc');
  if (fs.existsSync(namesFile)) try {engine.savedNames = JSON.parse(safeStorage.decryptString(fs.readFileSync(namesFile)));} catch {logs.write('warn', 'camera_names_unavailable');}
  cameras = cachedCameras(); logs.addSecrets(cameras.map(c => c.name));
  await engine.start();
  gateway = await createGateway({uiDir: path.join(__dirname, '..', 'ui'), engine, logs, allowedSource: source => Object.hasOwn(engine.saved.streams || {}, source)});
  const browserSession = session.fromPartition('mi-desktop');
  await browserSession.setProxy({mode: 'direct'});
  await browserSession.cookies.set({url: gateway.origin, name: 'mi_session', value: gateway.token, httpOnly: true, sameSite: 'strict'});
  browserSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({width: 1440, height: 920, minWidth: 900, minHeight: 620, show: !isSmoke, backgroundColor: '#0c1119', title: 'Mi Camera Desktop', icon: path.join(__dirname, '..', 'ui', 'logo.svg'), webPreferences: {preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'mi-desktop', backgroundThrottling: false}});
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', (ev, url) => {if (url !== gateway.origin + '/') ev.preventDefault();});
  win.webContents.on('render-process-gone', (_ev, info) => logs.write('error', 'renderer_gone', {reason: info.reason}));
  win.on('close', () => logs.write('info', 'window_closed'));
  ipcMain.handle('mi', (event, action, payload) => {
    if (event.sender !== win.webContents || event.senderFrame.url !== gateway.origin + '/') throw new Error('Unauthorized caller');
    const immediate = ['profile', 'settings', 'fullscreen', 'player-event', 'logs'].includes(action);
    const job = immediate ? handle(action, payload) : serial.then(() => handle(action, payload));
    if (!immediate) serial = job.catch(() => {});
    return job.catch(err => {logs.write('warn', 'operation_failed', {action, message: err.message}); return {error: err.message};});
  });
  await win.loadURL(gateway.origin + '/');
  if (state.fullscreenOnStart && !isSmoke) win.setFullScreen(true);
  logs.write('info', 'app_started', {version: app.getVersion(), platform: process.platform, arch: process.arch});
  if (isSmoke) {
    const result = await win.webContents.executeJavaScript(`(async () => {const p = await window.mi.invoke('profile'); return {title: document.title, login: !!document.querySelector('#login'), layout: p.settings.layout, bridge: !!window.mi, nodeHidden: typeof window.require === 'undefined'};})()`);
    console.log('SMOKE_RESULT ' + JSON.stringify(result));
    if (!result.nodeHidden || result.layout !== 4 || !result.login) {app.exit(1); return;}
    app.quit();
  }
}
async function handle(action, payload) {
  switch (action) {
    case 'profile': return publicProfile();
    case 'discover': return discover();
    case 'login': {
      if (!payload || typeof payload !== 'object') throw new Error('请输入登录信息。');
      const fields = ['username', 'password', 'captcha', 'verify'];
      const form = new URLSearchParams();
      for (const key of fields) if (typeof payload[key] === 'string' && payload[key].length < 1024) form.set(key, payload[key]);
      logs.addSecrets(fields.map(key => payload[key]));
      if (!form.size) throw new Error('请输入登录信息。');
      const revision = engine.sessionRevision;
      const r = await engine.request('/api/xiaomi', {method: 'POST', body: form});
      if (r.status === 401) {
        const data = await r.json();
        return {challenge: {captcha: data.captcha, hint: data.verify_phone || data.verify_email || '请输入小米发送的验证码'}};
      }
      if (!r.ok) {logs.write('warn', 'login_failed', {status: r.status}); throw new Error('登录失败，请检查账号、密码或验证码后重试。');}
      await engine.awaitPersist(revision);
      if (engine.persistenceError) throw new Error('登录成功，但缓存保存失败。请导出日志后重试。');
      logs.write('info', 'login_succeeded'); return publicProfile();
    }
    case 'settings': {
      const next = normalize({...state, ...payload});
      if (next.autoStart !== state.autoStart && app.isPackaged) app.setLoginItemSettings({openAtLogin: next.autoStart, openAsHidden: false});
      const previousRegion = state.region;
      writeState(next); logs.write('info', 'settings_saved', {layout: state.layout, autoStart: state.autoStart, fullscreenOnStart: state.fullscreenOnStart});
      return {settings: state, regionChanged: previousRegion !== state.region};
    }
    case 'fullscreen': win.setFullScreen(payload?.exit ? false : !win.isFullScreen()); return {fullscreen: win.isFullScreen()};
    case 'logout': {
      await engine.clear(); cameras = []; engine.savedNames = {};
      fs.rmSync(path.join(app.getPath('userData'), 'camera-names.enc'), {force: true});
      writeState({...state, slots: []}); logs.write('info', 'logout'); return publicProfile();
    }
    case 'import': {
      const result = await dialog.showOpenDialog(win, {title: '导入现有 go2rtc 登录', properties: ['openFile'], filters: [{name: 'go2rtc 配置', extensions: ['yaml', 'yml']}]});
      if (result.canceled) return {canceled: true};
      const stat = fs.statSync(result.filePaths[0]); if (stat.size > 4 * 1024 * 1024) throw new Error('配置文件过大。');
      let config;
      try {config = YAML.parse(fs.readFileSync(result.filePaths[0], 'utf8'));} catch {throw new Error('无法读取配置文件，请选择有效的 go2rtc YAML 配置。');}
      const xiaomi = config?.xiaomi;
      if (!xiaomi || Object.values(xiaomi).some(t => typeof t !== 'string')) throw new Error('没有找到可用的小米登录缓存。');
      await engine.stop(); engine.saved = {xiaomi, streams: {}};
      atomicWrite(engine.vaultPath, safeStorage.encryptString(YAML.stringify(engine.saved)));
      cameras = []; writeState({...state, slots: []});
      await engine.start(); logs.write('info', 'session_imported'); return publicProfile();
    }
    case 'logs': {
      const result = await dialog.showSaveDialog(win, {title: '导出诊断日志', defaultPath: `Mi-Camera-Logs-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{name: '诊断包', extensions: ['zip']}]});
      if (result.canceled) return {canceled: true};
      await logs.export(result.filePath, {version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch, cameraCount: cameras.length, layout: state.layout, quality: state.quality, engineRunning: !!engine.child, retentionDays: 30});
      shell.showItemInFolder(result.filePath); return {ok: true};
    }
    case 'player-event': {
      const events = ['connected', 'reconnecting', 'decode_error', 'stream_error', 'video_codec_unavailable', 'playing', 'stalled', 'muted', 'unmuted'];
      if (events.includes(payload?.event)) logs.write('info', 'player_' + payload.event, {slot: Number.isInteger(payload.slot) ? payload.slot : -1, code: Number.isInteger(payload.code) ? payload.code : undefined});
      return {};
    }
    default: throw new Error('Unknown action');
  }
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (closing) return; event.preventDefault(); closing = true;
  engine?.stop().finally(() => {gateway?.close(); logs?.write('info', 'app_stopped'); app.quit();});
  if (!engine) app.quit();
});
