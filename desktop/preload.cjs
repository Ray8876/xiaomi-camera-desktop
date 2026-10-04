const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('mi', {
  invoke: (action, payload) => ipcRenderer.invoke('mi', action, payload),
  onEngine: callback => ipcRenderer.on('engine-status', (_event, status) => callback(status))
});
