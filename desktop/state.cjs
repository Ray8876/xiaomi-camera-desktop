const fs = require('node:fs');
const crypto = require('node:crypto');
const DEFAULTS = {version: 1, layout: 4, slots: [], region: 'cn', autoStart: false, fullscreenOnStart: false, rememberAudio: true, quality: 'auto', fit: 'contain'};
const LAYOUTS = [1, 2, 4, 6, 9, 12, 16];
function normalize(input = {}) {
  return {...DEFAULTS,
    layout: LAYOUTS.includes(input.layout) ? input.layout : 4,
    slots: Array.isArray(input.slots) ? input.slots.slice(0, 16).map(s => ({alias: /^cam_[a-f0-9]{16}$/.test(s?.alias) ? s.alias : null, muted: s?.muted !== false, quality: ['auto', 'hd', 'sd', 'compatible'].includes(s?.quality) ? s.quality : 'auto'})) : [],
    region: ['cn', 'de', 'i2', 'ru', 'sg', 'us'].includes(input.region) ? input.region : 'cn',
    autoStart: input.autoStart === true, fullscreenOnStart: input.fullscreenOnStart === true,
    rememberAudio: input.rememberAudio !== false,
    quality: ['auto', 'hd', 'sd', 'compatible'].includes(input.quality) ? input.quality : 'auto',
    fit: input.fit === 'cover' ? 'cover' : 'contain'
  };
}
function atomicWrite(file, data) {
  fs.writeFileSync(`${file}.tmp`, data, {mode: 0o600});
  fs.renameSync(`${file}.tmp`, file);
}
function aliasFor(source) {
  const u = new URL(source);
  if (u.protocol !== 'xiaomi:' || !u.searchParams.get('did')) throw new Error('Invalid Xiaomi camera');
  return 'cam_' + crypto.createHash('sha256').update([u.username, u.password, u.searchParams.get('did')].join(':')).digest('hex').slice(0, 16);
}
module.exports = {DEFAULTS, LAYOUTS, normalize, atomicWrite, aliasFor};
