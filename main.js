const {
  app,
  BrowserWindow,
  nativeTheme,
  ipcMain,
  dialog,
  shell,
  Menu,
  clipboard,
  nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 1. UserData 경로 고정 (%APPDATA%\ainote)
const appDataRoot = app.getPath('appData');
const fixedUserDataPath = path.join(appDataRoot, 'ainote');
app.setPath('userData', fixedUserDataPath);

// 2. 다중 인스턴스 실행 방지
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
  process.exit(0);
}

const CURRENT_SCHEMA_VERSION = 2;
const MAX_BACKUPS = 10;

// TREECLIP 라이센스 코드의 SHA-256 해시 (TREE-CHO-8547, TREE-KIM-1128)
const VALID_LICENSE_HASHES = new Set([
  crypto.createHash('sha256').update('TREE-CHO-8547').digest('hex'),
  crypto.createHash('sha256').update('TREE-KIM-1128').digest('hex')
]);

let mainWindow = null;

function getNotesFilePath() {
  return path.join(app.getPath('userData'), 'notes-data.json');
}

function getBackupDirPath() {
  return path.join(app.getPath('userData'), 'backups');
}

function normalizeTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  return rawTags
    .map((t) => (typeof t === 'string' ? t.trim().replace(/^#/, '') : ''))
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const now = Date.now();
  const numericTimestamp =
    typeof raw.timestamp === 'number' && !Number.isNaN(raw.timestamp)
      ? raw.timestamp
      : typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt))
      ? Date.parse(raw.createdAt)
      : typeof raw.id === 'number' && !Number.isNaN(raw.id)
      ? raw.id
      : now;

  const createdAt =
    typeof raw.createdAt === 'number' && !Number.isNaN(raw.createdAt)
      ? raw.createdAt
      : typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt))
      ? Date.parse(raw.createdAt)
      : typeof raw.id === 'number' && !Number.isNaN(raw.id)
      ? raw.id
      : numericTimestamp;

  const imageDataUrl =
    typeof raw.imageDataUrl === 'string' && raw.imageDataUrl.startsWith('data:image/')
      ? raw.imageDataUrl
      : '';

  return {
    id: raw.id !== undefined && raw.id !== null ? String(raw.id) : crypto.randomUUID(),
    title: typeof raw.title === 'string' ? raw.title.slice(0, 500) : '',
    content: typeof raw.content === 'string' ? raw.content : '',
    category: typeof raw.category === 'string' ? raw.category : '📝 일반',
    tags: normalizeTags(raw.tags),
    pinned: Boolean(raw.pinned),
    copied: typeof raw.copied === 'number' && raw.copied >= 0 ? raw.copied : 0,
    imageDataUrl,
    date:
      typeof raw.date === 'string'
        ? raw.date
        : new Date(numericTimestamp).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'short'
          }),
    time:
      typeof raw.time === 'string'
        ? raw.time
        : new Date(numericTimestamp).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit'
          }),
    timestamp: numericTimestamp,
    createdAt
  };
}

function normalizeTempItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const imageDataUrl =
    typeof raw.imageDataUrl === 'string' && raw.imageDataUrl.startsWith('data:image/')
      ? raw.imageDataUrl
      : '';
  return {
    id: raw.id ? String(raw.id) : crypto.randomUUID(),
    kind: raw.kind === 'image' ? 'image' : 'text',
    title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : '클립보드 항목',
    content: typeof raw.content === 'string' ? raw.content : '',
    imageDataUrl,
    detectedAt: typeof raw.detectedAt === 'string' ? raw.detectedAt : new Date().toISOString(),
    addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : new Date().toISOString()
  };
}

function migratePayload(data) {
  if (!data || typeof data !== 'object') {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      notes: [],
      tempQueue: [],
      copyLog: {},
      settings: {
        isDark: true,
        blurEnabled: true,
        licenseLockEnabled: false,
        licenseActivated: true
      },
      draft: null
    };
  }

  const rawNotes = Array.isArray(data.notes)
    ? data.notes
    : Array.isArray(data)
    ? data
    : [];
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

  const rawTemp = Array.isArray(data.tempQueue) ? data.tempQueue : [];
  const tempQueue = rawTemp.map(normalizeTempItem).filter(Boolean).slice(0, 200);

  const copyLog =
    data.copyLog && typeof data.copyLog === 'object' && !Array.isArray(data.copyLog)
      ? data.copyLog
      : {};

  const settings = {
    isDark:
      data.settings && typeof data.settings.isDark === 'boolean'
        ? data.settings.isDark
        : true,
    blurEnabled:
      data.settings && typeof data.settings.blurEnabled === 'boolean'
        ? data.settings.blurEnabled
        : true,
    licenseLockEnabled:
      data.settings && typeof data.settings.licenseLockEnabled === 'boolean'
        ? data.settings.licenseLockEnabled
        : false,
    licenseActivated:
      data.settings && typeof data.settings.licenseActivated === 'boolean'
        ? data.settings.licenseActivated
        : true
  };

  const draft =
    data.draft && typeof data.draft === 'object'
      ? {
          title: typeof data.draft.title === 'string' ? data.draft.title : '',
          content: typeof data.draft.content === 'string' ? data.draft.content : '',
          category: typeof data.draft.category === 'string' ? data.draft.category : '📝 일반',
          tagsInput: typeof data.draft.tagsInput === 'string' ? data.draft.tagsInput : '',
          imageDataUrl:
            typeof data.draft.imageDataUrl === 'string' &&
            data.draft.imageDataUrl.startsWith('data:image/')
              ? data.draft.imageDataUrl
              : ''
        }
      : null;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    notes: normalizedNotes,
    tempQueue,
    copyLog,
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

    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith('notes-backup-') && f.endsWith('.json'))
      .sort()
      .reverse();

    for (let i = MAX_BACKUPS; i < files.length; i++) {
      try {
        fs.unlinkSync(path.join(backupDir, files[i]));
      } catch (_e) {
        // ignore
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

// 안전한 네이티브 클립보드 읽기 (파일 탐색기 복사 이미지 + 일반 클립보드 이미지 + 텍스트)
function readNativeClipboard() {
  try {
    // 1) 윈도우 탐색기에서 복사한 이미지 파일(FileNameW) 확인
    const fileBuf = clipboard.readBuffer('FileNameW');
    if (fileBuf && fileBuf.length > 0) {
      const filePath = fileBuf
        .toString('utf16le')
        .replace(/\0.*$/, '')
        .replace(/\u0000.*$/, '')
        .trim();
      const lower = filePath.toLowerCase();
      const isImageFile = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].some((ext) =>
        lower.endsWith(ext)
      );
      if (isImageFile && fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.size <= 15 * 1024 * 1024) {
          const bytes = fs.readFileSync(filePath);
          let mime = 'image/png';
          if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
          else if (lower.endsWith('.gif')) mime = 'image/gif';
          else if (lower.endsWith('.webp')) mime = 'image/webp';
          else if (lower.endsWith('.bmp')) mime = 'image/bmp';

          return {
            ok: true,
            payload: {
              kind: 'image',
              title: path.basename(filePath) || '클립보드 이미지',
              content: filePath,
              imageDataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
              detectedAt: new Date().toISOString()
            }
          };
        }
      }
    }

    // 2) 클립보드에 직접 들어있는 비트맵/스크린샷 이미지 확인
    const img = clipboard.readImage();
    if (img && !img.isEmpty()) {
      const dataUrl = img.toDataURL();
      if (dataUrl && dataUrl.startsWith('data:image/')) {
        return {
          ok: true,
          payload: {
            kind: 'image',
            title: '클립보드 이미지',
            content: '',
            imageDataUrl: dataUrl,
            detectedAt: new Date().toISOString()
          }
        };
      }
    }

    // 3) 일반 텍스트 확인
    const text = clipboard.readText();
    if (text && text.trim().length > 0) {
      const firstLine = text.trim().split(/\r?\n/)[0].slice(0, 40);
      return {
        ok: true,
        payload: {
          kind: 'text',
          title: firstLine || '클립보드 텍스트',
          content: text,
          imageDataUrl: '',
          detectedAt: new Date().toISOString()
        }
      };
    }

    return { ok: true, payload: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function writeNativeClipboard(payload) {
  try {
    if (!payload || typeof payload !== 'object') return { ok: false };
    if (payload.imageDataUrl && typeof payload.imageDataUrl === 'string' && payload.imageDataUrl.startsWith('data:image/')) {
      const nImg = nativeImage.createFromDataURL(payload.imageDataUrl);
      if (!nImg.isEmpty()) {
        clipboard.writeImage(nImg);
        return { ok: true };
      }
    }
    if (typeof payload.text === 'string' && payload.text.length > 0) {
      clipboard.writeText(payload.text);
      return { ok: true };
    }
    return { ok: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function createWindow(isDarkInitial) {
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: isDarkInitial ? '#111113' : '#f5f3f0',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: isDarkInitial ? '#111113' : '#f5f3f0',
      symbolColor: isDarkInitial ? '#ececee' : '#1a1a1a',
      height: 34
    },
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
      // ignore
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

// IPC 핸들러 등록
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

ipcMain.handle('clipboard:read', async () => {
  return readNativeClipboard();
});

ipcMain.handle('clipboard:write', async (_event, payload) => {
  return writeNativeClipboard(payload);
});

ipcMain.handle('license:verify', async (_event, rawCode) => {
  if (!rawCode || typeof rawCode !== 'string') return { ok: false };
  const normalized = rawCode.trim().toUpperCase();
  const digest = crypto.createHash('sha256').update(normalized).digest('hex');
  return { ok: VALID_LICENSE_HASHES.has(digest) };
});

ipcMain.handle('notes:export', async (_event, payload) => {
  try {
    const cleanData = migratePayload(payload);
    const defaultName = `나무노트_백업_${new Date().toISOString().slice(0, 10)}.json`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '노트 및 클립 백업 내보내기',
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
      title: '노트 및 클립 백업 가져오기',
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
  if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setTitleBarOverlay === 'function') {
    try {
      mainWindow.setTitleBarOverlay({
        color: isDark ? '#111113' : '#f5f3f0',
        symbolColor: isDark ? '#ececee' : '#1a1a1a',
        height: 34
      });
    } catch (_e) {
      // ignore
    }
  }
  return { ok: true };
});

ipcMain.handle('app:info', () => {
  return {
    version: app.getVersion(),
    userDataPath: app.getPath('userData'),
    isPackaged: app.isPackaged
  };
});

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
    sendStatus({
      state: 'available',
      version: info?.version,
      message: `새 버전(${info?.version}) 다운로드 중...`
    });
  });
  autoUpdater.on('update-not-available', () => {
    sendStatus({ state: 'not-available', message: '현재 최신 버전을 사용 중입니다.' });
  });
  autoUpdater.on('error', (err) => {
    sendStatus({ state: 'error', message: `업데이트 확인 실패: ${err?.message || '오류'}` });
  });
  autoUpdater.on('update-downloaded', (info) => {
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
  const isDarkInitial = stored.data.settings.isDark;
  nativeTheme.themeSource = isDarkInitial ? 'dark' : 'light';
  createWindow(isDarkInitial);
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(nativeTheme.shouldUseDarkColors);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
