const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hashes = {
  'win32-x64': '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
  'darwin-arm64': 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
  'darwin-x64': 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894'
};
(async () => {
  const platform = process.env.TARGET_PLATFORM || process.platform;
  if (platform === 'darwin') {require('./build-ffmpeg-mac.cjs'); return;}
  const key = `${platform}-${process.env.TARGET_ARCH || process.arch}`;
  if (!hashes[key]) throw new Error('Unsupported FFmpeg target');
  const dir = path.join(__dirname, '..', 'resources', key);
  fs.mkdirSync(dir, {recursive: true});
  const target = path.join(dir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-${key}`;
  let bytes = fs.existsSync(target) ? fs.readFileSync(target) : null;
  if (!bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== hashes[key]) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== hashes[key]) throw new Error('FFmpeg checksum mismatch');
  fs.writeFileSync(target, bytes, {mode: 0o755});
  for (const [suffix, sha256] of Object.entries({LICENSE: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903', README: 'a636a7183c58006351acbaf35303c0ed85c6e1320fd4e80de453ba6157de6311'})) {
    const response = await fetch(`https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/${key}.${suffix}`);
    if (!response.ok) throw new Error('FFmpeg license download failed');
    const data = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(data).digest('hex') !== sha256) throw new Error('FFmpeg license checksum mismatch');
    fs.writeFileSync(path.join(dir, `FFmpeg-${suffix}.txt`), data);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ffmpeg: {version: '6.1.1', url, sha256: hashes[key]}}, null, 2));
})().catch(err => {console.error(err.message); process.exit(1);});
