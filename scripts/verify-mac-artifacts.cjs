const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
if (process.platform !== 'darwin') process.exit(0);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-mac-signature-'));
function verify(app) {
  for (const file of [app, ...['go2rtc', 'ffmpeg'].map(name => path.join(app, 'Contents', 'Resources', 'engine', name))]) {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', file], {stdio: 'inherit'});
  }
}
try {
  const version = require('../package.json').version;
  const zip = path.join(__dirname, '..', 'dist', `Mi-Camera-Desktop-${version}-mac-${process.arch}.zip`);
  execFileSync('ditto', ['-x', '-k', zip, dir]);
  const app = path.join(dir, 'Mi Camera Desktop.app');
  verify(app);
  const mount = path.join(dir, 'dmg'); fs.mkdirSync(mount);
  const dmg = zip.replace(/\.zip$/, '.dmg');
  execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg], {timeout: 120000});
  try {verify(path.join(mount, 'Mi Camera Desktop.app'));}
  finally {execFileSync('hdiutil', ['detach', mount], {timeout: 30000});}
  console.log('Mac ZIP and mounted DMG: application, helpers, frameworks and engine signatures verified');
} finally {fs.rmSync(dir, {recursive: true, force: true});}
