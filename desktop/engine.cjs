const {spawn, execFile} = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const YAML = require('yaml');
const {atomicWrite} = require('./state.cjs');
const delay = ms => new Promise(r => setTimeout(r, ms));
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {const port = server.address().port; server.close(() => resolve(port));});
  });
}
class Engine {
  constructor({dir, vaultPath, safeStorage, logs, onRestart, startupTimeout = 10000, stabilityWindow = 60000}) {
    Object.assign(this, {dir, vaultPath, safeStorage, logs, onRestart, startupTimeout, stabilityWindow});
    this.saved = {}; this.child = null; this.stopped = true; this.restarts = 0; this.sessionRevision = 0;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密服务不可用，无法安全保存登录。');
    if (fs.existsSync(vaultPath)) {
      try {this.saved = YAML.parse(safeStorage.decryptString(fs.readFileSync(vaultPath))) || {};}
      catch {const error = new Error('登录缓存无法解密。请使用原系统账户打开或备份缓存后重新登录。'); error.code = 'SESSION_CACHE_UNREADABLE'; throw error;}
    }
  }
  persist(encoded) {
    const config = YAML.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    // Only session data is durable; credentials and dynamic engine ports are not.
    this.saved = {xiaomi: config.xiaomi || {}, streams: config.streams || {}};
    this.registerSecrets(this.saved);
    atomicWrite(this.vaultPath, this.safeStorage.encryptString(YAML.stringify(this.saved)));
    this.persistenceError = false; this.sessionRevision++;
  }
  async awaitPersist(previous) {
    for (let i = 0; i < 100; i++) {
      if (this.sessionRevision > previous) return;
      if (this.persistenceError) throw new Error('登录缓存保存失败，请导出日志。');
      await delay(20);
    }
    throw new Error('登录缓存保存超时，请重试。');
  }
  registerSecrets(config) {
    const values = [];
    for (const [user, token] of Object.entries(config.xiaomi || {})) values.push(user, token);
    for (const sources of Object.values(config.streams || {})) for (const source of [].concat(sources)) {
      values.push(source);
      try {const u = new URL(source); values.push(u.username, u.hostname, ...u.searchParams.values());} catch {}
    }
    this.logs.addSecrets(values);
  }
  async start() {
    this.stopped = false; this.registerSecrets(this.saved);
    this.port = await freePort(); this.password = crypto.randomBytes(32).toString('hex');
    this.base = `http://127.0.0.1:${this.port}`;
    this.authorization = 'Basic ' + Buffer.from('desktop:' + this.password).toString('base64');
    const config = {...this.saved,
      app: {modules: ['api', 'ws', 'http', 'rtsp', 'webrtc', 'mp4', 'ffmpeg', 'exec', 'xiaomi']},
      api: {listen: `127.0.0.1:${this.port}`, username: 'desktop', password: this.password, local_auth: true, allow_paths: ['/api', '/api/ws', '/api/xiaomi', '/api/streams', '/api/stream.mp4', '/api/webrtc']},
      rtsp: {listen: '127.0.0.1:0'}, webrtc: {listen: '127.0.0.1:0', ice_servers: []},
      ffmpeg: {bin: path.join(this.dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')},
      log: {level: 'info', format: 'json', output: 'stdout', time: '2006-01-02T15:04:05.000Z07:00'}
    };
    const child = spawn(path.join(this.dir, process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc'), [], {
      windowsHide: true, detached: process.platform !== 'win32', cwd: this.dir, env: {...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', MI_DESKTOP_CONFIG_STDIN: '1'}, stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    let pending = '';
    child.stdout.on('data', bytes => {
      pending += bytes.toString('utf8');
      let idx;
      while ((idx = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, idx).trim(); pending = pending.slice(idx + 1);
        if (line.startsWith('MI_SESSION:')) {
          try {this.persist(line.slice(11));} catch {this.persistenceError = true; this.logs.write('error', 'session_save_failed');}
        } else this.logLine(line);
      }
      if (pending.length > 8 * 1024 * 1024) {pending = ''; this.logs.write('error', 'engine_output_overflow');}
    });
    let stderr = '';
    child.stderr.on('data', bytes => {
      stderr += bytes.toString('utf8'); let idx;
      while ((idx = stderr.indexOf('\n')) !== -1) {this.logLine(stderr.slice(0, idx)); stderr = stderr.slice(idx + 1);}
      if (stderr.length > 65536) stderr = '';
    });
    let spawnFailed = false;
    child.on('error', () => {spawnFailed = true; if (this.child === child) this.child = null; this.logs.write('error', 'engine_spawn_failed');});
    child.stdin.on('error', () => this.logs.write('warn', 'engine_config_pipe_closed'));
    child.on('exit', (code, signal) => {
      clearTimeout(this.stableTimer);
      if (this.child === child) this.child = null;
      this.logs.write(this.stopped ? 'info' : 'error', 'engine_exit', {code, signal});
      if (!this.stopped && this.restarts++ < 5) {
        this.retryTimer = setTimeout(() => {
          if (!this.stopped) this.start().then(() => this.onRestart?.()).catch(() => this.onRestart?.('failed'));
        }, Math.min(1000 * 2 ** this.restarts, 30000));
      } else if (!this.stopped) this.onRestart?.('failed');
    });
    child.stdin.end(YAML.stringify(config));
    const deadline = Date.now() + this.startupTimeout;
    while (Date.now() < deadline) {
      if (spawnFailed || this.child !== child || this.stopped) throw new Error('播放引擎启动失败，请导出日志。');
      try {const response = await this.request('/api', {timeout: Math.min(500, Math.max(1, deadline - Date.now()))});
        if (response.ok) {
          // Limit rapid crash loops, while allowing recovery after stable use.
          this.stableTimer = setTimeout(() => {if (this.child === child) this.restarts = 0;}, this.stabilityWindow);
          this.stableTimer.unref();
          this.logs.write('info', 'engine_ready'); return;
        }
      } catch {}
      await delay(Math.min(100, Math.max(0, deadline - Date.now())));
    }
    await this.stop();
    throw new Error('播放引擎启动超时，请导出日志。');
  }
  logLine(line) {
    if (!line) return;
    try {
      const data = JSON.parse(line);
      this.logs.write(data.level || 'info', 'engine', Object.fromEntries(['module', 'message', 'error', 'model', 'codec', 'sequence', 'source_payload_len', 'avcc_payload_len'].filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])));
    } catch {this.logs.write('error', 'engine_stderr', {message: line});}
  }
  request(route, {timeout = 45000, ...options} = {}) {
    return fetch(this.base + route, {...options, headers: {...options.headers, Authorization: this.authorization}, signal: options.signal || AbortSignal.timeout(timeout)});
  }
  async stop() {
    this.stopped = true; clearTimeout(this.retryTimer); clearTimeout(this.stableTimer);
    const child = this.child;
    if (!child) return;
    await new Promise(resolve => {
      const timeout = setTimeout(() => {child.kill('SIGKILL'); resolve();}, 3000);
      child.once('exit', () => {clearTimeout(timeout); resolve();});
      if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true}, () => {});
      else {try {process.kill(-child.pid, 'SIGTERM');} catch {child.kill();}}
    });
  }
  async clear() {await this.stop(); this.saved = {}; fs.rmSync(this.vaultPath, {force: true}); await this.start();}
}
module.exports = {Engine, freePort};
