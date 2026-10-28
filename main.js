const { app, BrowserWindow, nativeTheme, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 1. UserData 경로 고정 (productName이나 appId가 바뀌어도 기존 %APPDATA%\ainote 경로 유지)
const appDataRoot = app.getPath('appData');
const fixedUserDataPath = path.join(appDataRoot, 'ainote');
app.setPath('userData', fixedUserDataPath);

// 2. 다중 인스턴스 실행 방지 (LevelDB 및 파일 쓰기 충돌 방지)
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
  process.exit(0);
}

const CURRENT_SCHEMA_VERSION = 1;
const MAX_BACKUPS = 10;
let mainWindow = null;

function getNotesFilePath() {
  return path.join(app.getPath('userData'), 'notes-data.json');
}

function getBackupDirPath() {
  return path.join(app.getPath('userData'), 'backups');
}

function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const now = Date.now();
  const numericTimestamp = typeof raw.timestamp === 'number' && !Number.isNaN(raw.timestamp)
    ? raw.timestamp
    : (typeof raw.id === 'number' && !Number.isNaN(raw.id) ? raw.id : now);
  const createdAt = typeof raw.createdAt === 'number' && !Number.isNaN(raw.createdAt)
    ? raw.createdAt
    : (typeof raw.id === 'number' && !Number.isNaN(raw.id) ? raw.id : numericTimestamp);

  return {
    id: raw.id !== undefined && raw.id !== null ? String(raw.id) : crypto.randomUUID(),
    title: typeof raw.title === 'string' ? raw.title.slice(0, 500) : '',
    content: typeof raw.content === 'string' ? raw.content : '',
    category: typeof raw.category === 'string' ? raw.category : '📝 일반',
    date: typeof raw.date === 'string' ? raw.date : new Date(numericTimestamp).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }),
    time: typeof raw.time === 'string' ? raw.time : new Date(numericTimestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    timestamp: numericTimestamp,
    createdAt
  };
}

function migratePayload(data) {
  if (!data || typeof data !== 'object') {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      notes: [],
      settings: { isDark: true, blurEnabled: true },
      draft: null
    };
  }
  const rawNotes = Array.isArray(data.notes) ? data.notes : (Array.isArray(data) ? data : []);
  const seenIds = new Set();
  const normalizedNotes = [];

  for (const item of rawNotes) {
    const n = normalizeNote(item);
    if (!n) continue;
    if (seenIds.has(n.id)) {
      n.id = crypto.randomUUID();
    }
    seenIds.add(n.id);
    normalizedNotes.push(n);
  }

  const settings = {
    isDark: data.settings && typeof data.settings.isDark === 'boolean' ? data.settings.isDark : true,
    blurEnabled: data.settings && typeof data.settings.blurEnabled === 'boolean' ? data.settings.blurEnabled : true
  };

  const draft = data.draft && typeof data.draft === 'object'
    ? {
        title: typeof data.draft.title === 'string' ? data.draft.title : '',
        content: typeof data.draft.content === 'string' ? data.draft.content : '',
        category: typeof data.draft.category === 'string' ? data.draft.category : '📝 일반'
      }
    : null;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    notes: normalizedNotes,
    settings,
    draft
  };
}

function writeAtomicJson(filePath, dataObj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = JSON.stringify(dataObj, null, 2);
  fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', flag: 'w' });
  fs.renameSync(tempPath, filePath);
}

function createDailyBackupIfNeeded(dataObj) {
  try {
    const backupDir = getBackupDirPath();
    fs.mkdirSync(backupDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const backupFile = path.join(backupDir, `notes-backup-${today}.json`);
    writeAtomicJson(backupFile, dataObj);

    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith('notes-backup-') && f.endsWith('.json'))
      .sort()
      .reverse();

    for (let i = MAX_BACKUPS; i < files.length; i++) {
      try {
        fs.unlinkSync(path.join(backupDir, files[i]));
      } catch (_e) {
        // ignore cleanup error
      }
    }
  } catch (err) {
    console.warn('[Backup] Failed to write rolling backup:', err.message);
  }
}

function loadStoredData() {
  const filePath = getNotesFilePath();
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      corrupted: false,
      data: migratePayload(null)
    };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      exists: true,
      corrupted: false,
      data: migratePayload(parsed)
    };
  } catch (err) {
    // 파싱 실패 시 손상된 원본 파일을 절대 빈 배열로 덮어쓰지 않고 별도 보존
    const corruptBackupPath = `${filePath}.corrupt-${Date.now()}.bak`;
    try {
      fs.copyFileSync(filePath, corruptBackupPath);
    } catch (_e) {
      // ignore
    }
    return {
      exists: true,
      corrupted: true,
      corruptPath: corruptBackupPath,
      error: err.message,
      data: migratePayload(null)
    };
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    backgroundColor: '#111111',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    autoHideMenuBar: true,
    title: '나무 노트'
  });

  // 우클릭 컨텍스트 메뉴 (잘라내기 / 복사 / 붙여넣기 / 모두 선택)
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menuTemplate = [];
    if (params.isEditable) {
      menuTemplate.push(
        { label: '실행 취소', role: 'undo', enabled: params.editFlags.canUndo },
        { label: '다시 실행', role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { label: '잘라내기', role: 'cut', enabled: params.editFlags.canCut },
        { label: '복사', role: 'copy', enabled: params.editFlags.canCopy },
        { label: '붙여넣기', role: 'paste', enabled: params.editFlags.canPaste },
        { label: '모두 선택', role: 'selectAll', enabled: params.editFlags.canSelectAll }
      );
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      menuTemplate.push(
        { label: '복사', role: 'copy' },
        { label: '모두 선택', role: 'selectAll' }
      );
    }

    if (menuTemplate.length > 0) {
      const menu = Menu.buildFromTemplate(menuTemplate);
      menu.popup({ window: mainWindow });
    }
  });

  const builtIndex = path.join(__dirname, 'renderer-dist', 'index.html');
  mainWindow.loadFile(builtIndex);
}

// 3. 전역 웹콘텐츠 보안 가드 (외부 탐색 및 새 창 차단, 안전한 외부 브라우저 연결)
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      if (parsed.protocol !== 'file:') {
        event.preventDefault();
      }
    } catch (_e) {
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url);
      }
    } catch (_e) {
      // ignore invalid URLs
    }
    return { action: 'deny' };
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// 4. IPC 핸들러 등록
ipcMain.handle('notes:load', async () => {
  return loadStoredData();
});

ipcMain.handle('notes:save', async (_event, payload) => {
  try {
    const cleanData = migratePayload(payload);
    writeAtomicJson(getNotesFilePath(), cleanData);
    createDailyBackupIfNeeded(cleanData);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('notes:export', async (_event, payload) => {
  try {
    const cleanData = migratePayload(payload);
    const defaultName = `나무노트_백업_${new Date().toISOString().slice(0, 10)}.json`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '노트 백업 내보내기',
      defaultPath: defaultName,
      filters: [{ name: 'JSON 백업 파일', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    writeAtomicJson(filePath, {
      ...cleanData,
      exportedAt: new Date().toISOString(),
      appVersion: app.getVersion()
    });
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('notes:import', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '노트 백업 가져오기',
      properties: ['openFile'],
      filters: [{ name: 'JSON 백업 파일', extensions: ['json'] }]
    });
    if (canceled || !filePaths || filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    const parsed = JSON.parse(raw);
    const migrated = migratePayload(parsed);
    return { ok: true, data: migrated };
  } catch (err) {
    return { ok: false, error: `백업 파일을 읽을 수 없습니다: ${err.message}` };
  }
});

ipcMain.handle('theme:set', (_event, isDark) => {
  nativeTheme.themeSource = isDark ? 'dark' : 'light';
  return { ok: true };
});

ipcMain.handle('app:info', () => {
  return {
    version: app.getVersion(),
    userDataPath: app.getPath('userData'),
    isPackaged: app.isPackaged
  };
});

// 5. 자동 업데이트 (electron-updater)
function setupAutoUpdater() {
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (_e) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const sendStatus = (statusObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', statusObj);
    }
  };

  autoUpdater.on('checking-for-update', () => {
    sendStatus({ state: 'checking', message: '업데이트 확인 중...' });
  });
  autoUpdater.on('update-available', (info) => {
    sendStatus({ state: 'available', version: info?.version, message: `새 버전(${info?.version}) 다운로드 중...` });
  });
  autoUpdater.on('update-not-available', () => {
    sendStatus({ state: 'not-available', message: '현재 최신 버전을 사용 중입니다.' });
  });
  autoUpdater.on('error', (err) => {
    sendStatus({ state: 'error', message: `업데이트 확인 실패: ${err?.message || '오류'}` });
  });
  autoUpdater.on('update-downloaded', (info) => {
    // 업데이트 설치 전 데이터 백업 보장
    const current = loadStoredData();
    if (current.exists && !current.corrupted) {
      createDailyBackupIfNeeded(current.data);
    }
    sendStatus({
      state: 'downloaded',
      version: info?.version,
      message: `새 버전(${info?.version})이 준비되었습니다. 재시작하면 적용됩니다.`
    });
  });

  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) {
      return { ok: false, message: '개발 모드에서는 자동 업데이트를 실행하지 않습니다.' };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('updater:install', () => {
    if (app.isPackaged) {
      autoUpdater.quitAndInstall();
    }
  });

  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 3000);
  }
}

app.whenReady().then(() => {
  const stored = loadStoredData();
  nativeTheme.themeSource = stored.data.settings.isDark ? 'dark' : 'light';
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
