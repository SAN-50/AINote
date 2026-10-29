const {
  app,
  BrowserWindow,
  nativeTheme,
  ipcMain,
  dialog,
  shell,
  Menu,
  clipboard,
  ClipboardItem,
  nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { fileURLToPath, pathToFileURL } = require('url');

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

const CURRENT_SCHEMA_VERSION = 3;
const MAX_BACKUPS = 10;

let mainWindow = null;

function getNotesFilePath() {
  return path.join(app.getPath('userData'), 'notes-data.json');
}

function getBackupDirPath() {
  return path.join(app.getPath('userData'), 'backups');
}

function hashPasswordWithSalt(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPasswordWithHash(password, saltHex, expectedHashHex) {
  if (!password || !saltHex || !expectedHashHex) return false;
  try {
    const computed = crypto.scryptSync(String(password), saltHex, 64);
    const expected = Buffer.from(expectedHashHex, 'hex');
    if (computed.length !== expected.length) return false;
    return crypto.timingSafeEqual(computed, expected);
  } catch (_e) {
    return false;
  }
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

  const fileInfo =
    raw.fileInfo && typeof raw.fileInfo === 'object'
      ? {
          name: typeof raw.fileInfo.name === 'string' ? raw.fileInfo.name : '',
          path: typeof raw.fileInfo.path === 'string' ? raw.fileInfo.path : '',
          size: typeof raw.fileInfo.size === 'number' ? raw.fileInfo.size : 0,
          ext: typeof raw.fileInfo.ext === 'string' ? raw.fileInfo.ext : '',
          isDirectory: Boolean(raw.fileInfo.isDirectory),
          extraCount: typeof raw.fileInfo.extraCount === 'number' ? raw.fileInfo.extraCount : 0
        }
      : null;

  return {
    id: raw.id !== undefined && raw.id !== null ? String(raw.id) : crypto.randomUUID(),
    title: typeof raw.title === 'string' ? raw.title.slice(0, 500) : '',
    content: typeof raw.content === 'string' ? raw.content : '',
    category: typeof raw.category === 'string' ? raw.category : '📝 일반',
    tags: normalizeTags(raw.tags),
    pinned: Boolean(raw.pinned),
    copied: typeof raw.copied === 'number' && raw.copied >= 0 ? raw.copied : 0,
    imageDataUrl,
    fileInfo,
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
  const fileInfo =
    raw.fileInfo && typeof raw.fileInfo === 'object'
      ? {
          name: typeof raw.fileInfo.name === 'string' ? raw.fileInfo.name : '',
          path: typeof raw.fileInfo.path === 'string' ? raw.fileInfo.path : '',
          size: typeof raw.fileInfo.size === 'number' ? raw.fileInfo.size : 0,
          ext: typeof raw.fileInfo.ext === 'string' ? raw.fileInfo.ext : '',
          isDirectory: Boolean(raw.fileInfo.isDirectory),
          extraCount: typeof raw.fileInfo.extraCount === 'number' ? raw.fileInfo.extraCount : 0
        }
      : null;
  const kind = raw.kind === 'image' ? 'image' : raw.kind === 'file' ? 'file' : 'text';
  return {
    id: raw.id ? String(raw.id) : crypto.randomUUID(),
    kind,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : '클립보드 항목',
    content: typeof raw.content === 'string' ? raw.content : '',
    imageDataUrl,
    fileInfo,
    detectedAt: typeof raw.detectedAt === 'string' ? raw.detectedAt : new Date().toISOString(),
    addedAt: typeof raw.addedAt === 'string' ? raw.addedAt : new Date().toISOString()
  };
}

function migratePayload(data, existingSecurity) {
  if (!data || typeof data !== 'object') {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      notes: [],
      tempQueue: [],
      copyLog: {},
      settings: {
        isDark: true,
        blurEnabled: true,
        lockOnStartup: false
      },
      security: existingSecurity || {
        passwordSalt: '',
        passwordHash: ''
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

  const security =
    existingSecurity ||
    (data.security && typeof data.security === 'object'
      ? {
          passwordSalt:
            typeof data.security.passwordSalt === 'string' ? data.security.passwordSalt : '',
          passwordHash:
            typeof data.security.passwordHash === 'string' ? data.security.passwordHash : ''
        }
      : { passwordSalt: '', passwordHash: '' });

  const hasPassword = Boolean(security.passwordSalt && security.passwordHash);

  const settings = {
    isDark:
      data.settings && typeof data.settings.isDark === 'boolean'
        ? data.settings.isDark
        : true,
    blurEnabled:
      data.settings && typeof data.settings.blurEnabled === 'boolean'
        ? data.settings.blurEnabled
        : true,
    lockOnStartup:
      hasPassword &&
      data.settings &&
      typeof data.settings.lockOnStartup === 'boolean'
        ? data.settings.lockOnStartup
        : false
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
              : '',
          fileInfo:
            data.draft.fileInfo && typeof data.draft.fileInfo === 'object'
              ? {
                  name: typeof data.draft.fileInfo.name === 'string' ? data.draft.fileInfo.name : '',
                  path: typeof data.draft.fileInfo.path === 'string' ? data.draft.fileInfo.path : '',
                  size: typeof data.draft.fileInfo.size === 'number' ? data.draft.fileInfo.size : 0,
                  ext: typeof data.draft.fileInfo.ext === 'string' ? data.draft.fileInfo.ext : '',
                  isDirectory: Boolean(data.draft.fileInfo.isDirectory),
                  extraCount:
                    typeof data.draft.fileInfo.extraCount === 'number'
                      ? data.draft.fileInfo.extraCount
                      : 0
                }
              : null
        }
      : null;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    notes: normalizedNotes,
    tempQueue,
    copyLog,
    settings,
    security,
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

function loadStoredDataInternal() {
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

function toRendererSafeResponse(stored) {
  const hasPassword = Boolean(
    stored.data?.security?.passwordSalt && stored.data?.security?.passwordHash
  );
  return {
    exists: stored.exists,
    corrupted: stored.corrupted,
    corruptPath: stored.corruptPath,
    error: stored.error,
    data: {
      schemaVersion: stored.data.schemaVersion,
      notes: stored.data.notes,
      tempQueue: stored.data.tempQueue,
      copyLog: stored.data.copyLog,
      settings: {
        ...stored.data.settings,
        hasPassword
      },
      draft: stored.data.draft
    }
  };
}

function inspectLocalPath(filePath) {
  try {
    if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath) || filePath;
    const isImageFile =
      stat.isFile() &&
      stat.size <= 15 * 1024 * 1024 &&
      ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'].includes(ext);

    let imageDataUrl = '';
    if (isImageFile) {
      if (ext === '.ico') {
        const nImg = nativeImage.createFromPath(filePath);
        if (!nImg.isEmpty()) {
          imageDataUrl = nImg.toDataURL();
        }
      } else {
        const bytes = fs.readFileSync(filePath);
        let mime = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
        else if (ext === '.gif') mime = 'image/gif';
        else if (ext === '.webp') mime = 'image/webp';
        else if (ext === '.bmp') mime = 'image/bmp';
        imageDataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
      }
    }

    return {
      isImage: Boolean(imageDataUrl),
      imageDataUrl,
      fileInfo: {
        name,
        path: filePath,
        size: stat.isFile() ? stat.size : 0,
        ext,
        isDirectory: stat.isDirectory(),
        extraCount: 0
      }
    };
  } catch (_e) {
    return null;
  }
}

// 안전한 네이티브 클립보드 읽기 (Electron 45 비동기 ClipboardItem API + 파일/이미지/텍스트 통합 지원)
async function readNativeClipboard() {
  try {
    if (typeof clipboard.read === 'function') {
      try {
        const items = await clipboard.read();
        for (const item of items || []) {
          const types = Array.isArray(item?.types) ? item.types : [];

          // 1) 탐색기에서 복사한 파일/폴더 (text/uri-list)
          if (types.includes('text/uri-list')) {
            const uriBlob = await item.getType('text/uri-list');
            const uriText = await uriBlob.text();
            const validPaths = uriText
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l && !l.startsWith('#'))
              .map((u) => {
                try {
                  return fileURLToPath(u);
                } catch (_e) {
                  return '';
                }
              })
              .filter((p) => p && fs.existsSync(p));

            if (validPaths.length > 0) {
              const firstInspected = inspectLocalPath(validPaths[0]);
              if (firstInspected) {
                if (validPaths.length === 1 && firstInspected.isImage && firstInspected.imageDataUrl) {
                  return {
                    ok: true,
                    payload: {
                      kind: 'image',
                      title: firstInspected.fileInfo.name || '클립보드 이미지',
                      content: validPaths[0],
                      imageDataUrl: firstInspected.imageDataUrl,
                      fileInfo: firstInspected.fileInfo,
                      detectedAt: new Date().toISOString()
                    }
                  };
                }
                return {
                  ok: true,
                  payload: {
                    kind: 'file',
                    title:
                      validPaths.length > 1
                        ? `${firstInspected.fileInfo.name} 외 ${validPaths.length - 1}개`
                        : firstInspected.fileInfo.name,
                    content: validPaths.join('\n'),
                    imageDataUrl: firstInspected.imageDataUrl || '',
                    fileInfo: {
                      ...firstInspected.fileInfo,
                      extraCount: validPaths.length - 1
                    },
                    detectedAt: new Date().toISOString()
                  }
                };
              }
            }
          }

          // 2) Windows OS 클립보드 FileName / FileNameW 포맷 폴백
          const fileNameFormat = types.find(
            (t) => t.includes('format="FileNameW"') || t.includes('format="FileName"')
          );
          if (fileNameFormat) {
            const fileBlob = await item.getType(fileNameFormat);
            const buf = Buffer.from(await fileBlob.arrayBuffer());
            const decoded = fileNameFormat.includes('FileNameW')
              ? buf.toString('utf16le')
              : buf.toString('utf8');
            const cleanPath = decoded.replace(/\0.*$/, '').replace(/\u0000.*$/, '').trim();
            const inspected = inspectLocalPath(cleanPath);
            if (inspected) {
              return {
                ok: true,
                payload: {
                  kind: inspected.isImage ? 'image' : 'file',
                  title: inspected.fileInfo.name,
                  content: cleanPath,
                  imageDataUrl: inspected.imageDataUrl || '',
                  fileInfo: inspected.fileInfo,
                  detectedAt: new Date().toISOString()
                }
              };
            }
          }

          // 3) 클립보드 비트맵/스크린샷 이미지 (image/png, image/jpeg 등)
          const imgType = types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const imgBlob = await item.getType(imgType);
            const buf = Buffer.from(await imgBlob.arrayBuffer());
            if (buf.length > 0) {
              return {
                ok: true,
                payload: {
                  kind: 'image',
                  title: '클립보드 이미지',
                  content: '',
                  imageDataUrl: `data:${imgType};base64,${buf.toString('base64')}`,
                  fileInfo: null,
                  detectedAt: new Date().toISOString()
                }
              };
            }
          }
        }
      } catch (_readErr) {
        // clipboard.read() 실패 시 아래 readText()로 안전하게 폴백
      }
    }

    // 4) 일반 텍스트 클립보드 읽기 (Promise 및 동기 반환 모두 호환)
    if (typeof clipboard.readText === 'function') {
      const rawText = await clipboard.readText();
      const text = typeof rawText === 'string' ? rawText : '';
      if (text.trim().length > 0) {
        const firstLine = text.trim().split(/\r?\n/)[0].slice(0, 50);
        return {
          ok: true,
          payload: {
            kind: 'text',
            title: firstLine || '클립보드 텍스트',
            content: text,
            imageDataUrl: '',
            fileInfo: null,
            detectedAt: new Date().toISOString()
          }
        };
      }
    }

    return { ok: true, payload: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function writeNativeClipboard(payload) {
  try {
    if (!payload || typeof payload !== 'object') return { ok: false };
    if (
      payload.imageDataUrl &&
      typeof payload.imageDataUrl === 'string' &&
      payload.imageDataUrl.startsWith('data:image/')
    ) {
      const nImg = nativeImage.createFromDataURL(payload.imageDataUrl);
      if (!nImg.isEmpty()) {
        if (typeof clipboard.write === 'function' && ClipboardItem) {
          const pngBuf = nImg.toPNG();
          const imgBlob = new Blob([pngBuf], { type: 'image/png' });
          await clipboard.write([new ClipboardItem({ 'image/png': imgBlob })]);
          return { ok: true };
        } else if (typeof clipboard.writeImage === 'function') {
          clipboard.writeImage(nImg);
          return { ok: true };
        }
      }
    }
    if (payload.filePath && typeof payload.filePath === 'string' && fs.existsSync(payload.filePath)) {
      if (typeof clipboard.write === 'function' && ClipboardItem) {
        try {
          const fileUri = pathToFileURL(payload.filePath).href;
          const uriBlob = new Blob([fileUri], { type: 'text/uri-list' });
          const textBlob = new Blob([payload.filePath], { type: 'text/plain' });
          await clipboard.write([
            new ClipboardItem({
              'text/uri-list': uriBlob,
              'text/plain': textBlob
            })
          ]);
          return { ok: true };
        } catch (_e) {
          // 폴백: 경로 텍스트 복사
        }
      }
      await clipboard.writeText(payload.filePath);
      return { ok: true };
    }
    if (typeof payload.text === 'string' && payload.text.length > 0) {
      await clipboard.writeText(payload.text);
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
    backgroundColor: isDarkInitial ? '#0F1014' : '#F6F5F2',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: isDarkInitial ? '#0F1014' : '#F6F5F2',
      symbolColor: isDarkInitial ? '#F3F4F6' : '#18181B',
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
  const stored = loadStoredDataInternal();
  return toRendererSafeResponse(stored);
});

ipcMain.handle('notes:save', async (_event, payload) => {
  try {
    const existing = loadStoredDataInternal();
    const cleanData = migratePayload(payload, existing.data.security);
    writeAtomicJson(getNotesFilePath(), cleanData);
    createDailyBackupIfNeeded(cleanData);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('lock:set-password', async (_event, payload) => {
  try {
    const { currentPassword, newPassword, lockOnStartup } = payload || {};
    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 2) {
      return { ok: false, error: '비밀번호는 2자 이상 입력해 주세요.' };
    }

    const stored = loadStoredDataInternal();
    const existingSec = stored.data.security || { passwordSalt: '', passwordHash: '' };
    const hadPassword = Boolean(existingSec.passwordSalt && existingSec.passwordHash);

    if (hadPassword) {
      const validCurrent = verifyPasswordWithHash(
        currentPassword,
        existingSec.passwordSalt,
        existingSec.passwordHash
      );
      if (!validCurrent) {
        return { ok: false, error: '현재 비밀번호가 일치하지 않습니다.' };
      }
    }

    const { salt, hash } = hashPasswordWithSalt(newPassword.trim());
    const nextData = {
      ...stored.data,
      security: {
        passwordSalt: salt,
        passwordHash: hash
      },
      settings: {
        ...stored.data.settings,
        lockOnStartup: typeof lockOnStartup === 'boolean' ? lockOnStartup : true
      }
    };

    writeAtomicJson(getNotesFilePath(), nextData);
    return {
      ok: true,
      hasPassword: true,
      lockOnStartup: nextData.settings.lockOnStartup
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('lock:verify-password', async (_event, password) => {
  const stored = loadStoredDataInternal();
  const sec = stored.data.security || { passwordSalt: '', passwordHash: '' };
  if (!sec.passwordSalt || !sec.passwordHash) {
    return { ok: true };
  }
  const matched = verifyPasswordWithHash(password, sec.passwordSalt, sec.passwordHash);
  return { ok: matched };
});

ipcMain.handle('lock:remove-password', async (_event, currentPassword) => {
  try {
    const stored = loadStoredDataInternal();
    const sec = stored.data.security || { passwordSalt: '', passwordHash: '' };
    if (sec.passwordSalt && sec.passwordHash) {
      const matched = verifyPasswordWithHash(
        currentPassword,
        sec.passwordSalt,
        sec.passwordHash
      );
      if (!matched) {
        return { ok: false, error: '현재 비밀번호가 일치하지 않습니다.' };
      }
    }

    const nextData = {
      ...stored.data,
      security: { passwordSalt: '', passwordHash: '' },
      settings: {
        ...stored.data.settings,
        lockOnStartup: false
      }
    };
    writeAtomicJson(getNotesFilePath(), nextData);
    return { ok: true, hasPassword: false, lockOnStartup: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('clipboard:read', async () => {
  return await readNativeClipboard();
});

ipcMain.handle('clipboard:write', async (_event, payload) => {
  return await writeNativeClipboard(payload);
});

ipcMain.handle('file:pick', async (_event, options) => {
  try {
    const mode = options?.mode || 'any';
    const filters =
      mode === 'image'
        ? [{ name: '이미지 파일', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'] }]
        : [{ name: '모든 파일', extensions: ['*'] }];

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: mode === 'image' ? '이미지 선택' : '첨부할 파일 선택',
      properties: ['openFile'],
      filters
    });
    if (canceled || !filePaths || filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    const inspected = inspectLocalPath(filePaths[0]);
    if (!inspected) {
      return { ok: false, error: '선택한 파일을 읽을 수 없습니다.' };
    }
    return { ok: true, ...inspected };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:inspect', async (_event, filePath) => {
  const inspected = inspectLocalPath(filePath);
  if (!inspected) {
    return { ok: false, error: '파일을 읽을 수 없습니다.' };
  }
  return { ok: true, ...inspected };
});

ipcMain.handle('file:open', async (_event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
      return { ok: false, error: '해당 경로에 파일이 존재하지 않습니다.' };
    }
    const errMsg = await shell.openPath(filePath);
    if (errMsg) return { ok: false, error: errMsg };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('file:show-in-folder', async (_event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
      return { ok: false, error: '해당 경로에 파일이 존재하지 않습니다.' };
    }
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('notes:export', async (_event, payload) => {
  try {
    const existing = loadStoredDataInternal();
    const cleanData = migratePayload(payload, { passwordSalt: '', passwordHash: '' });
    const defaultName = `나무노트_백업_${new Date().toISOString().slice(0, 10)}.json`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '노트 및 클립 백업 내보내기',
      defaultPath: defaultName,
      filters: [{ name: 'JSON 백업 파일', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    writeAtomicJson(filePath, {
      schemaVersion: cleanData.schemaVersion,
      notes: cleanData.notes || existing.data.notes,
      tempQueue: cleanData.tempQueue,
      copyLog: cleanData.copyLog,
      settings: cleanData.settings,
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
    const existing = loadStoredDataInternal();
    const migrated = migratePayload(parsed, existing.data.security);
    return { ok: true, data: migrated };
  } catch (err) {
    return { ok: false, error: `백업 파일을 읽을 수 없습니다: ${err.message}` };
  }
});

ipcMain.handle('theme:set', (_event, isDark) => {
  nativeTheme.themeSource = isDark ? 'dark' : 'light';
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    typeof mainWindow.setTitleBarOverlay === 'function'
  ) {
    try {
      mainWindow.setTitleBarOverlay({
        color: isDark ? '#0F1014' : '#F6F5F2',
        symbolColor: isDark ? '#F3F4F6' : '#18181B',
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
    const current = loadStoredDataInternal();
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
  const stored = loadStoredDataInternal();
  const isDarkInitial = stored.data.settings.isDark;
  nativeTheme.themeSource = isDarkInitial ? 'dark' : 'light';
  createWindow(isDarkInitial);
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0)
      createWindow(nativeTheme.shouldUseDarkColors);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
