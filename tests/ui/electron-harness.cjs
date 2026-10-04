// Isolated playback host using the exact Electron runtime shipped with the app.
const {app, BrowserWindow} = require('electron');
app.setPath('userData', process.env.MI_TEST_USER_DATA);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
app.whenReady().then(async () => {
  const win = new BrowserWindow({width: 1440, height: 920, show: false,
    webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false}});
  await win.webContents.session.setProxy({mode: 'direct'});
  await win.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
