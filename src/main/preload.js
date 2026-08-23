const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  listWindows: () => ipcRenderer.invoke('list-windows'),
  startFill: (params) => ipcRenderer.invoke('start-fill', params),
  stopFill: () => ipcRenderer.invoke('stop-fill'),
  onFillProgress: (cb) => {
    ipcRenderer.on('fill-progress', (_e, data) => cb(data));
  },
  offFillProgress: () => {
    ipcRenderer.removeAllListeners('fill-progress');
  },
  onStopShortcut: (cb) => {
    ipcRenderer.on('stop-shortcut', () => cb());
  },
  offStopShortcut: () => {
    ipcRenderer.removeAllListeners('stop-shortcut');
  },
  onStartShortcut: (cb) => {
    ipcRenderer.on('start-shortcut', () => cb());
  },
  offStartShortcut: () => {
    ipcRenderer.removeAllListeners('start-shortcut');
  }
});
