const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.join(__dirname, '..', 'dist');
const executable = process.platform === 'win32' ? path.join(root, 'win-unpacked', 'Mi Camera Desktop.exe') : path.join(root, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Mi Camera Desktop.app', 'Contents', 'MacOS', 'Mi Camera Desktop');
const result = spawnSync(executable, ['--smoke-test'], {encoding: 'utf8', timeout: 30000, env: {...process.env, ELECTRON_ENABLE_LOGGING: '1'}});
if (result.status !== 0 || !result.stdout?.includes('SMOKE_RESULT')) {
  console.error(result.error?.message || result.stderr || 'Packaged app did not pass smoke test'); process.exit(1);
}
console.log(result.stdout.trim());
