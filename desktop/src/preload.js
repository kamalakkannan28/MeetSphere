const { contextBridge, ipcRenderer } = require('electron');

// Tiny, explicit API for the web app. The web app uses `window.meetsphereDesktop` to know it runs inside the
// desktop shell (it then uses cloud transcription, because Electron has no built-in speech recogniser).
contextBridge.exposeInMainWorld('meetsphereDesktop', {
  isDesktop: true,
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('config:get'),
  setServerUrl: (url) => ipcRenderer.invoke('config:set', url),
  retry: () => ipcRenderer.invoke('app:retry'),
});
