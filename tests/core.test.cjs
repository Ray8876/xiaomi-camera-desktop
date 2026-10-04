const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {normalize, aliasFor, atomicWrite} = require('../desktop/state.cjs');
const {Logs} = require('../desktop/logs.cjs');
test('state caps slots at sixteen, defaults audio to muted and rejects malformed aliases', () => {
  const state = normalize({layout: 99, slots: Array.from({length: 20}, () => ({alias: 'not-a-camera'}))});
  assert.equal(state.layout, 4); assert.equal(state.slots.length, 16);
  assert.ok(state.slots.every(s => s.muted && s.alias === null));
  assert.equal(normalize({slots: [{alias: 'cam_0123456789abcdef', muted: false}]}).slots[0].muted, false);
});
test('camera aliases survive address changes and differ between accounts and regions', () => {
  const first = aliasFor('xiaomi://100:cn@192.0.2.1?did=123&model=test.camera.test');
  assert.equal(first, aliasFor('xiaomi://100:cn@192.0.2.99?did=123&model=test.camera.test'));
  assert.notEqual(first, aliasFor('xiaomi://101:cn@192.0.2.1?did=123'));
  assert.notEqual(first, aliasFor('xiaomi://100:us@192.0.2.1?did=123'));
  assert.throws(() => aliasFor('https://example.com?did=123'));
});
test('30-day log retention keeps exact date boundary and unrelated files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-logs-'));
  try {
    for (const file of ['2026-09-05.jsonl', '2026-09-06.jsonl', '2026-10-05.jsonl', 'keep.txt']) fs.writeFileSync(path.join(dir, file), '');
    const logs = new Logs(dir, () => new Date('2026-10-05T12:00:00Z'));
    assert.equal(fs.existsSync(path.join(dir, '2026-09-05.jsonl')), false);
    assert.equal(fs.existsSync(path.join(dir, '2026-09-06.jsonl')), true);
    assert.equal(fs.existsSync(path.join(dir, 'keep.txt')), true);
    logs.addSecrets(['SecretCameraName', 'a"b\\c-secret']);
    logs.write('error', 'test', {password: 'hidden', message: 'SecretCameraName xiaomi://100:cn@192.0.2.1?did=12345678&token=xyz a"b\\c-secret', mac: 'aa:bb:cc:dd:ee:ff'});
    const data = fs.readFileSync(path.join(dir, '2026-10-05.jsonl'), 'utf8');
    assert.ok(!/SecretCameraName|hidden|192\.0|12345678|xyz|aa:bb/.test(data));
    assert.equal(JSON.parse(data).time, '2026-10-05T12:00:00.000Z');
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
test('diagnostic ZIP includes sanitized logs without session/config files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-export-'));
  try {
    const logs = new Logs(path.join(dir, 'logs')); logs.write('info', 'started', {password: 'my-secret'});
    const target = path.join(dir, 'diagnostic.zip'); await logs.export(target, {version: 'test', cameraCount: 2});
    const AdmZip = require('adm-zip'); const zip = new AdmZip(target);
    assert.ok(zip.getEntries().every(e => !/session|\.yaml|settings/.test(e.entryName)));
    assert.ok(zip.getEntries().every(e => !zip.readAsText(e).includes('my-secret')));
    assert.equal(JSON.parse(zip.readAsText('diagnostics.json')).cameraCount, 2);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
