const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const platform = process.env.TARGET_PLATFORM || process.platform;
const arch = process.env.TARGET_ARCH || process.arch;
const os = {win32: 'windows', darwin: 'darwin', linux: 'linux'}[platform];
const goarch = {x64: 'amd64', arm64: 'arm64'}[arch];
if (!os || !goarch) throw new Error('Unsupported platform');
const root = path.join(__dirname, '..');
const dir = path.join(root, 'resources', `${platform}-${arch}`);
fs.mkdirSync(dir, {recursive: true});
const r = spawnSync(process.env.GO_BINARY || 'go', ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', path.join(dir, platform === 'win32' ? 'go2rtc.exe' : 'go2rtc'), '.'], {
  cwd: path.join(root, 'engine'), stdio: 'inherit', env: {...process.env, CGO_ENABLED: '0', GOOS: os, GOARCH: goarch}
});
process.exit(r.status ?? 1);
