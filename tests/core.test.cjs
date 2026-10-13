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
    for (let i = 0; i < 500; i++) logs.write('info', 'reconnecting', {slot: i % 16, message: 'connection retry diagnostic'});
    const target = path.join(dir, 'diagnostic.zip'); await logs.export(target, {version: 'test', cameraCount: 2});
    const AdmZip = require('adm-zip'); const zip = new AdmZip(target);
    assert.ok(zip.getEntries().every(e => !/session|\.yaml|settings/.test(e.entryName)));
    assert.ok(zip.getEntries().every(e => !zip.readAsText(e).includes('my-secret')));
    assert.equal(JSON.parse(zip.readAsText('diagnostics.json')).cameraCount, 2);
    const entry = zip.getEntries().find(e => e.entryName.endsWith('.jsonl'));
    const rows = zip.readAsText(entry).trim().split('\n').map(row => JSON.parse(row));
    assert.equal(rows.length, 501, 'Export must retain the complete daily log beyond 32 KiB');
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
test('named Xiaomi quality preserves model-specific HD and legacy SD behavior', () => {
  const {sourceForQuality} = require('../desktop/state.cjs');
  const source = 'xiaomi://100:cn@192.0.2.1?did=123&model=chuangmi.camera.046c04&subtype=3';
  assert.equal(new URL(sourceForQuality(source, 'hd')).searchParams.get('subtype'), 'hd');
  assert.equal(new URL(sourceForQuality(source, 'sd')).searchParams.get('subtype'), 'sd');
  assert.equal(new URL(sourceForQuality(source, 'auto')).searchParams.get('subtype'), '3');
});
test('unreadable session recovery preserves encrypted evidence and user settings', () => {
  const {backupUnreadableSession} = require('../desktop/session.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-recovery-'));
  try {
    fs.writeFileSync(path.join(dir, 'session.enc'), Buffer.from([0, 1, 2, 3]));
    fs.writeFileSync(path.join(dir, 'camera-names.enc'), Buffer.from([4, 5, 6]));
    fs.writeFileSync(path.join(dir, 'settings.json'), 'saved-layout');
    const backups = backupUnreadableSession(dir);
    assert.equal(backups.length, 2);
    assert.deepEqual(fs.readFileSync(backups[0]), Buffer.from([0, 1, 2, 3]));
    assert.deepEqual(fs.readFileSync(backups[1]), Buffer.from([4, 5, 6]));
    assert.equal(fs.existsSync(path.join(dir, 'session.enc')), false);
    assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), 'saved-layout');
    assert.ok(backups.every(file => file.endsWith('.enc')));
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
test('daily logging cap is enforced before appending a whole diagnostic row', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-cap-'));
  try {
    const logs = new Logs(dir, () => new Date('2026-10-13T12:00:00Z'));
    const file = path.join(dir, '2026-10-13.jsonl');
    fs.writeFileSync(file, Buffer.alloc(10 * 1024 * 1024 - 20));
    logs.write('warn', 'retrying', {slot: 0});
    assert.equal(fs.statSync(file).size, 10 * 1024 * 1024 - 20);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
test('diagnostic export recovers from write failure and serializes repeated exports', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-export-failure-'));
  try {
    const logs = new Logs(path.join(dir, 'logs')); logs.write('warn', 'transport_timeout', {slot: 2});
    await assert.rejects(logs.export(path.join(dir, 'absent', 'report.zip'), {}));
    const target = path.join(dir, 'report.zip');
    await Promise.all([logs.export(target, {version: 'first'}), logs.export(target, {version: 'second'})]);
    const zip = new (require('adm-zip'))(target);
    assert.equal(JSON.parse(zip.readAsText('diagnostics.json')).version, 'second');
    assert.equal(fs.existsSync(target + '.tmp'), false);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
test('export keeps numeric packet sequence valid and redacts escaped legacy strings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-export-structured-'));
  try {
    const logs = new Logs(path.join(dir, 'logs'));
    logs.addSecrets(['name"with\\escape']);
    logs.write('warn', 'packet', {sequence: 12345678, source_payload_len: 42});
    const file = path.join(logs.dir, fs.readdirSync(logs.dir)[0]);
    fs.appendFileSync(file, JSON.stringify({detail: {message: 'name"with\\escape', token: 'legacy-token'}}) + '\n');
    const target = path.join(dir, 'log.zip');
    await logs.export(target, {numericDiagnostic: 12345678});
    const zip = new (require('adm-zip'))(target);
    const rows = zip.readAsText(zip.getEntries().find(e => e.entryName.endsWith('.jsonl'))).trim().split('\n').map(row => JSON.parse(row));
    assert.equal(rows[0].detail.sequence, 12345678);
    assert.equal(rows[1].detail.message, '[redacted]');
    assert.equal(rows[1].detail.token, '[redacted]');
    assert.equal(JSON.parse(zip.readAsText('diagnostics.json')).numericDiagnostic, 12345678);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});
