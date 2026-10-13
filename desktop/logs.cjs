const fs = require('node:fs');
const path = require('node:path');
class Logs {
  constructor(dir, clock = () => new Date()) {
    this.dir = dir; this.clock = clock; this.secrets = new Set(); this.lastCleanup = 0;
    fs.mkdirSync(dir, {recursive: true, mode: 0o700}); this.cleanup();
  }
  addSecrets(values) {
    for (const value of values) if (typeof value === 'string' && value.length >= 3) this.secrets.add(value);
  }
  redact(text, limit = 32000) {
    let s = String(text).slice(0, limit);
    for (const value of [...this.secrets].sort((a, b) => b.length - a.length)) s = s.split(value).join('[redacted]');
    return s.replace(/(?:https?|rtsp|xiaomi|wss?):\/\/[^\s"'<>]+/gi, '[url]')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
      .replace(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, '[mac]')
      .replace(/\b\d{7,}\b/g, '[id]')
      .replace(/((?:password|token|secret|ssecurity|sign|did|uid|username|authorization|cookie|client_private)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
      .replace(/(?:[A-Z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s]+/gi, '[user]');
  }
  sanitize(value) {
    if (typeof value === 'string') return this.redact(value);
    if (Array.isArray(value)) return value.map(item => this.sanitize(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /password|token|secret|cookie|authorization|ssecurity|client_private|^did$|^uid$/i.test(k) ? '[redacted]' : this.sanitize(v)]));
    return value;
  }
  write(level, event, detail = {}) {
    const now = this.clock();
    if (now.getTime() - this.lastCleanup > 3600000) this.cleanup();
    const day = now.toISOString().slice(0, 10);
    const file = path.join(this.dir, `${day}.jsonl`);
    // Bound disk growth even with repeated transport failures (10 MiB per UTC day).
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    const cap = 10 * 1024 * 1024;
    if (size >= cap) return;
    const row = {time: now.toISOString(), level, event, detail: this.sanitize(detail)};
    const line = JSON.stringify(row) + '\n';
    if (size + Buffer.byteLength(line) > cap) return;
    fs.appendFileSync(file, line, {mode: 0o600});
  }
  cleanup() {
    const now = this.clock(); this.lastCleanup = now.getTime();
    const oldest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 29 * 86400000).toISOString().slice(0, 10);
    for (const name of fs.readdirSync(this.dir)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(0, 10) < oldest) fs.unlinkSync(path.join(this.dir, name));
  }
  export(target, diagnostics) {
    const task = (this.exportQueue || Promise.resolve()).then(() => this.exportNow(target, diagnostics));
    this.exportQueue = task.catch(() => {});
    return task;
  }
  async exportNow(target, diagnostics) {
    const archiver = require('archiver'); this.cleanup();
    const output = fs.createWriteStream(`${target}.tmp`, {mode: 0o600});
    const zip = archiver('zip', {zlib: {level: 6}});
    const done = new Promise((resolve, reject) => {output.on('close', resolve); output.on('error', reject); zip.on('error', reject);});
    try {
      zip.pipe(output);
      zip.append(JSON.stringify(this.sanitize(diagnostics), null, 2), {name: 'diagnostics.json'});
      zip.append('时间为 UTC ISO 8601。此包不含登录会话、密码、配置、设备地址或设备名称。\n', {name: 'README.txt'});
      for (const name of fs.readdirSync(this.dir)) {
        if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
        const lines = fs.readFileSync(path.join(this.dir, name), 'utf8').split('\n').filter(Boolean).map(line => {
          try {return JSON.stringify(this.sanitize(JSON.parse(line)));}
          catch {return JSON.stringify({event: 'legacy_log_line', detail: {message: this.redact(line)}});}
        });
        zip.append(lines.join('\n') + '\n', {name: `logs/${name}`});
      }
      await Promise.all([zip.finalize(), done]);
      fs.renameSync(`${target}.tmp`, target);
    } finally {
      zip.abort(); output.destroy();
      await new Promise(resolve => {if (output.closed) resolve(); else output.once('close', resolve);});
      fs.rmSync(`${target}.tmp`, {force: true});
    }
  }
}
module.exports = {Logs};
