const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pulseAPI', {
  isDesktop: true,
  notifySignal: (title, body) => ipcRenderer.send('notify-signal', { title, body }),
  platform: process.platform,
});
