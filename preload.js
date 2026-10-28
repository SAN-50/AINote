const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('treeNoteAPI', {
  loadData: () => ipcRenderer.invoke('notes:load'),
  saveData: (payload) => ipcRenderer.invoke('notes:save', payload),
  exportNotes: (payload) => ipcRenderer.invoke('notes:export', payload),
  importNotes: () => ipcRenderer.invoke('notes:import'),
  setTheme: (isDark) => ipcRenderer.invoke('theme:set', isDark),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  }
});
