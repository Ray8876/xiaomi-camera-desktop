const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = path.join(__dirname, '..', 'dist');
const entries = fs.readdirSync(dir).filter(name => /\.(exe|dmg|zip)$/.test(name));
if (!entries.length) throw new Error('No installer artifacts');
const lines = entries.map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex')}  ${name}`);
fs.writeFileSync(path.join(dir, `SHA256SUMS-${process.env.TARGET_PLATFORM || process.platform}-${process.env.TARGET_ARCH || process.arch}.txt`), lines.join('\n') + '\n');
