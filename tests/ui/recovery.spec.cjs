const {test, expect, _electron} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '../..');
const engineBinary = path.join(root, 'resources', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc');
test('startup recovery backs up unreadable cache and opens login with saved settings', async () => {
  test.skip(!fs.existsSync(engineBinary), 'Build the platform engine first');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-cache-recovery-'));
  const harness = path.join(dir, 'main.cjs');
  fs.writeFileSync(path.join(dir, 'session.enc'), 'fixture-unreadable-session');
  fs.writeFileSync(path.join(dir, 'camera-names.enc'), 'fixture-unreadable-names');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({layout: 9, fullscreenOnStart: false, rememberAudio: false}));
  fs.writeFileSync(harness, `
    const {app, dialog, safeStorage} = require('electron');
    app.setPath('userData', ${JSON.stringify(dir)});
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.decryptString = () => {throw new Error('fixture cannot decrypt');};
    dialog.showMessageBox = async options => {
      if (options.title !== '登录缓存无法读取') throw new Error('Unexpected startup dialog');
      return {response: 1};
    };
    require(${JSON.stringify(path.join(root, 'desktop/main.cjs'))});
  `);
  let client;
  try {
    client = await _electron.launch({executablePath: require('electron'), args: [harness]});
    const page = await client.firstWindow();
    await expect(page.locator('#login')).toBeVisible();
    const profile = await page.evaluate(() => window.mi.invoke('profile'));
    expect(profile.loggedIn).toBe(false); expect(profile.settings.layout).toBe(9);
    expect(profile.settings.rememberAudio).toBe(false);
    const backups = fs.readdirSync(dir).filter(name => name.includes('.unreadable-'));
    expect(backups).toHaveLength(2);
    expect(fs.readFileSync(path.join(dir, backups.find(name => name.startsWith('session.enc'))), 'utf8')).toBe('fixture-unreadable-session');
    expect(fs.existsSync(path.join(dir, 'session.enc'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))).layout).toBe(9);
  } finally {if (client) await client.close(); fs.rmSync(dir, {recursive: true, force: true});}
});
