const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('treeNoteAPI', {
  loadData: () => ipcRenderer.invoke('notes:load'),
  saveData: (payload) => ipcRenderer.invoke('notes:save', payload),
  exportNotes: (payload) => ipcRenderer.invoke('notes:export', payload),
  importNotes: () => ipcRenderer.invoke('notes:import'),
  readSystemClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeSystemClipboard: (payload) => ipcRenderer.invoke('clipboard:write', payload),
  pickFile: (options) => ipcRenderer.invoke('file:pick', options),
  inspectFile: (filePath) => ipcRenderer.invoke('file:inspect', filePath),
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  showFileInFolder: (filePath) => ipcRenderer.invoke('file:show-in-folder', filePath),
  getDroppedFilePath: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file) || '';
      }
      return file?.path || '';
    } catch (_e) {
      return '';
    }
  },
  setPassword: (payload) => ipcRenderer.invoke('lock:set-password', payload),
  verifyPassword: (password) => ipcRenderer.invoke('lock:verify-password', password),
  removePassword: (currentPassword) => ipcRenderer.invoke('lock:remove-password', currentPassword),
  setTheme: (isDark) => ipcRenderer.invoke('theme:set', isDark),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  getUpdateStatus: () => ipcRenderer.invoke('updater:get-status'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
  // 공유 스페이스 (Google 계정 로그인 + 방 호스트/참가/채팅/정리)
  getSharedState: () => ipcRenderer.invoke('shared:get-state'),
  saveGoogleOAuthConfig: (config) => ipcRenderer.invoke('shared:save-oauth-config', config),
  startGoogleOAuthLogin: () => ipcRenderer.invoke('shared:google-oauth-login'),
  signInGoogleProfile: (payload) => ipcRenderer.invoke('shared:google-profile-login', payload),
  signOutGoogle: () => ipcRenderer.invoke('shared:google-logout'),
  hostSharedRoom: (payload) => ipcRenderer.invoke('shared:host-room', payload),
  joinSharedRoom: (payload) => ipcRenderer.invoke('shared:join-room', payload),
  leaveSharedRoom: () => ipcRenderer.invoke('shared:leave-room'),
  dispatchSharedAction: (action) => ipcRenderer.invoke('shared:dispatch-action', action),
  onSharedRoomUpdated: (callback) => {
    const handler = (_event, roomSnapshot) => callback(roomSnapshot);
    ipcRenderer.on('shared:room-updated', handler);
    return () => ipcRenderer.removeListener('shared:room-updated', handler);
  },
  onSharedRoomDisconnected: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('shared:room-disconnected', handler);
    return () => ipcRenderer.removeListener('shared:room-disconnected', handler);
  },
  onSharedAuthUpdated: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('shared:auth-updated', handler);
    return () => ipcRenderer.removeListener('shared:auth-updated', handler);
  }
});
