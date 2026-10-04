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
  const engine = new Engine({dir, vaultPath: path.join(data, 'session.enc'), safeStorage: cipher, logs});
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
    assert.ok(!fs.readdirSync(data).some(name => /yaml|config/.test(name)));
    const restored = new Engine({dir, vaultPath: engine.vaultPath, safeStorage: cipher, logs});
    assert.deepEqual(restored.saved, engine.saved);
    await engine.stop(); assert.equal(engine.child, null);
  } finally {await engine.stop(); fs.rmSync(data, {recursive: true, force: true});}
});
