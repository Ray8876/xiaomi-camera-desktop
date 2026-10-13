const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {Engine} = require('../desktop/engine.cjs');
const {Logs} = require('../desktop/logs.cjs');
const key = crypto.randomBytes(32);
const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: text => {const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([c.update(text), c.final()]); return Buffer.concat([iv, c.getAuthTag(), body]);},
  decryptString: bytes => {const c = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); c.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([c.update(bytes.subarray(28)), c.final()]).toString();}
};
const dir = path.join(__dirname, '..', 'resources', `${process.platform}-${process.arch}`);
test('real engine uses stdin config, authenticated API, encrypted persistent session and clean shutdown', {skip: !fs.existsSync(path.join(dir, process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc'))}, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-engine-'));
  const logs = new Logs(path.join(data, 'logs'));
  const engine = new Engine({dir, vaultPath: path.join(data, 'session.enc'), safeStorage: cipher, logs, stabilityWindow: 50});
  engine.restarts = 4;
  try {
    await engine.start();
    assert.equal((await fetch(engine.base + '/api')).status, 401);
    assert.equal((await engine.request('/api/config')).status, 404);
    assert.equal((await engine.request('/api')).status, 200);
    const params = new URLSearchParams({name: 'cam_0123456789abcdef', src: 'rtsp://example.invalid/test'});
    assert.equal((await engine.request('/api/streams?' + params, {method: 'PUT'})).status, 200);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(fs.existsSync(engine.vaultPath));
    assert.ok(!fs.readFileSync(engine.vaultPath).includes(Buffer.from('example.invalid')));
    assert.ok(engine.saved.streams.cam_0123456789abcdef);
    assert.equal(engine.restarts, 0, 'Recovery budget resets after stable running');
    assert.ok(!fs.readdirSync(data).some(name => /yaml|config/.test(name)));
    const restored = new Engine({dir, vaultPath: engine.vaultPath, safeStorage: cipher, logs});
    assert.deepEqual(restored.saved, engine.saved);
    await engine.stop(); assert.equal(engine.child, null);
  } finally {await engine.stop(); fs.rmSync(data, {recursive: true, force: true});}
});
test('unreadable vault returns a recovery-specific error without changing original bytes', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-bad-vault-'));
  try {
    const vaultPath = path.join(data, 'session.enc'); fs.writeFileSync(vaultPath, 'broken-encrypted-data');
    assert.throws(() => new Engine({dir, vaultPath, safeStorage: cipher, logs: new Logs(path.join(data, 'logs'))}), {code: 'SESSION_CACHE_UNREADABLE'});
    assert.equal(fs.readFileSync(vaultPath, 'utf8'), 'broken-encrypted-data');
  } finally {fs.rmSync(data, {recursive: true, force: true});}
});
test('missing engine executable fails promptly without unhandled stdin errors', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-missing-engine-'));
  const engine = new Engine({dir: data, vaultPath: path.join(data, 'session.enc'), safeStorage: cipher, logs: new Logs(path.join(data, 'logs'))});
  try {
    const start = Date.now(); await assert.rejects(engine.start(), /启动失败/);
    assert.ok(Date.now() - start < 2000); assert.equal(engine.child, null);
  } finally {await engine.stop(); fs.rmSync(data, {recursive: true, force: true});}
});
test('readiness deadline bounds a stalled HTTP probe and stops the spawned engine', {skip: !fs.existsSync(path.join(dir, process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc'))}, async () => {
  const http = require('node:http'); const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-stalled-start-'));
  const engine = new Engine({dir, startupTimeout: 300, vaultPath: path.join(data, 'session.enc'), safeStorage: cipher, logs: new Logs(path.join(data, 'logs'))});
  const probes = [];
  engine.request = (_route, {timeout}) => {probes.push(timeout); return fetch(`http://127.0.0.1:${server.address().port}`, {signal: AbortSignal.timeout(timeout)});};
  try {
    const start = Date.now(); await assert.rejects(engine.start(), /启动超时/);
    assert.ok(Date.now() - start < 4000); assert.ok(probes.every(timeout => timeout <= 300));
    assert.equal(engine.child, null); assert.equal(engine.stopped, true);
  } finally {await engine.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(data, {recursive: true, force: true});}
});
test('engine diagnostics retain malformed packet details while excluding device addresses', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-packet-log-'));
  try {
    const logs = new Logs(path.join(data, 'logs'));
    const engine = new Engine({dir, vaultPath: path.join(data, 'session.enc'), safeStorage: cipher, logs});
    engine.logLine(JSON.stringify({level: 'warn', module: 'xiaomi', message: 'drop malformed video packet', camera_ip: '192.0.2.1', codec: 'H265', sequence: 23, source_payload_len: 3, avcc_payload_len: 0}));
    const row = JSON.parse(fs.readFileSync(path.join(logs.dir, fs.readdirSync(logs.dir)[0]), 'utf8'));
    assert.equal(row.detail.codec, 'H265'); assert.equal(row.detail.sequence, 23);
    assert.equal(row.detail.avcc_payload_len, 0); assert.equal(row.detail.camera_ip, undefined);
  } finally {fs.rmSync(data, {recursive: true, force: true});}
});
