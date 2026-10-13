const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('mi', {
  invoke: (action, payload) => ipcRenderer.invoke('mi', action, payload),
  onFullscreen: callback => ipcRenderer.on('fullscreen-state', (_event, active) => callback(active)),
  onEngine: callback => ipcRenderer.on('engine-status', (_event, status) => callback(status))
});
