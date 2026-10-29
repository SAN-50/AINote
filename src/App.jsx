import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CATEGORIES, FILTER_CATEGORIES, CONTENT_TYPE_TABS } from './constants';
import {
  sanitizeNoteHtml,
  getPlainText,
  escapePlainTextToHtml,
  normalizeContentToSafeHtml
} from './utils/sanitize';
import {
  IconTrash,
  IconEdit,
  IconClose,
  IconMoon,
  IconSun,
  IconSettings,
  IconCopy,
  IconPin,
  IconEye,
  IconLock,
  IconImage,
  IconFile,
  IconFolder,
  IconPaperclip
} from './components/Icons';
import { CustomSelect } from './components/CustomSelect';
import { FormattingBar } from './components/FormattingBar';
import { PasswordLockScreen, PasswordSetupModal } from './components/LicenseLockModal';
import { MonitorPanel, getTempTimeInfo, formatFileSize } from './components/MonitorPanel';

const api = typeof window !== 'undefined' ? window.treeNoteAPI : null;

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseTagsInput(str) {
  if (!str || typeof str !== 'string') return [];
  return str
    .split(',')
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 20);
}

function formatCreatedDate(note) {
  const ts =
    typeof note.createdAt === 'number'
      ? note.createdAt
      : typeof note.id === 'number'
      ? note.id
      : note.timestamp || Date.now();
  return new Date(ts).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatCreatedDateTime(note) {
  const ts =
    typeof note.createdAt === 'number'
      ? note.createdAt
      : typeof note.id === 'number'
      ? note.id
      : note.timestamp || Date.now();
  const d = new Date(ts);
  return `${d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })} ${d.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
}

function buildClipboardSignature(payload) {
  if (!payload) return '';
  if (payload.kind === 'file' && payload.fileInfo?.path) {
    return `file:${payload.fileInfo.path}:${payload.fileInfo.extraCount || 0}`;
  }
  if (payload.imageDataUrl) {
    return `image:${payload.imageDataUrl.slice(0, 140)}:${payload.imageDataUrl.length}`;
  }
  return `text:${payload.content || ''}`;
}

function getNoteContentType(note) {
  if (note.fileInfo?.path && !note.imageDataUrl) return 'file';
  if (note.category === '📎 파일') return 'file';
  if (note.imageDataUrl || note.category === '🖼️ 이미지') return 'image';
  const plain = (note._plainText || '').trim();
  if (note.category === '🔗 링크' || /^https?:\/\/\S+/i.test(plain)) return 'link';
  return 'text';
}

export default function App() {
  const [notes, setNotes] = useState([]);
  const [tempQueue, setTempQueue] = useState([]);
  const [copyLog, setCopyLog] = useState({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [corruptWarning, setCorruptWarning] = useState(null);
  const [statusBanner, setStatusBanner] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [appVersion, setAppVersion] = useState('1.3.0');

  // Settings & Password Lock State
  const [isDark, setIsDark] = useState(true);
  const [blurEnabled, setBlurEnabled] = useState(false); // 기본값: 멀미 없는 깔끔한 화면
  const [hasPassword, setHasPassword] = useState(false);
  const [lockOnStartup, setLockOnStartup] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Workspace & Composer State
  const [workspace, setWorkspace] = useState('composer'); // 'composer' | 'monitor'
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [tagsInput, setTagsInput] = useState('');
  const [attachedImage, setAttachedImage] = useState('');
  const [attachedFile, setAttachedFile] = useState(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState(FILTER_CATEGORIES[0]);
  const [contentTypeTab, setContentTypeTab] = useState('all'); // 'all' | 'text' | 'image' | 'file' | 'link'
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [sortOrder, setSortOrder] = useState('최신순');
  const [viewLayout, setViewLayout] = useState('grid'); // 'grid' | 'list'

  // Modals State
  const [editingNote, setEditingNote] = useState(null);
  const [editingTagsInput, setEditingTagsInput] = useState('');
  const [editingInitialSnapshot, setEditingInitialSnapshot] = useState(null);
  const [viewingNote, setViewingNote] = useState(null);

  // Clipboard Monitor State
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [clipboardStatus, setClipboardStatus] = useState(
    '대기 중: 감지를 시작하면 복사한 텍스트와 이미지를 실시간으로 수집합니다.'
  );
  const [detectedClipboard, setDetectedClipboard] = useState(null);

  const mainEditorRef = useRef(null);
  const editEditorRef = useRef(null);
  const searchInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const editFileInputRef = useRef(null);
  const saveTimerRef = useRef(null);
  const lastClipboardSigRef = useRef('');

  const showToast = useCallback((message, type = 'info') => {
    setStatusBanner({ message, type });
    setTimeout(() => {
      setStatusBanner((prev) => (prev && prev.message === message ? null : prev));
    }, 3200);
  }, []);

  // 1. 초기 데이터 로드 및 레거시 localStorage 자동 이전
  useEffect(() => {
    let mounted = true;

    async function initData() {
      let legacyNotes = null;
      let legacyBlur = null;
      let legacyDark = null;

      try {
        const rawLegacyNotes = localStorage.getItem('notes');
        if (rawLegacyNotes) {
          const parsed = JSON.parse(rawLegacyNotes);
          if (Array.isArray(parsed)) legacyNotes = parsed;
        }
      } catch (_e) {
        // ignore
      }

      try {
        const rawBlur = localStorage.getItem('blurEnabled');
        if (rawBlur !== null) legacyBlur = JSON.parse(rawBlur);
        const rawDark = localStorage.getItem('isDark');
        if (rawDark !== null) legacyDark = JSON.parse(rawDark);
      } catch (_e) {
        // ignore
      }

      if (api) {
        try {
          const info = await api.getAppInfo();
          if (mounted && info?.version) setAppVersion(info.version);
        } catch (_e) {
          // ignore
        }

        const res = await api.loadData();
        if (!mounted) return;

        if (res.corrupted) {
          setCorruptWarning(
            `데이터 파일이 손상되어 원본을 백업(${res.corruptPath})으로 안전하게 보관했습니다. 설정에서 백업을 가져올 수 있습니다.`
          );
        }

        let initialNotes = res.data?.notes || [];
        const initialTempQueue = res.data?.tempQueue || [];
        const initialCopyLog = res.data?.copyLog || {};
        const initialDark = res.data?.settings?.isDark ?? (legacyDark ?? true);
        const initialBlur = res.data?.settings?.blurEnabled ?? (legacyBlur ?? false);
        const initialHasPassword = Boolean(res.data?.settings?.hasPassword);
        const initialLockOnStartup = initialHasPassword
          ? Boolean(res.data?.settings?.lockOnStartup)
          : false;
        const initialDraft = res.data?.draft || null;

        if (!res.exists && Array.isArray(legacyNotes) && legacyNotes.length > 0) {
          initialNotes = legacyNotes.map((n) => ({
            ...n,
            id: n.id !== undefined ? String(n.id) : generateId(),
            tags: Array.isArray(n.tags) ? n.tags : [],
            pinned: Boolean(n.pinned),
            copied: typeof n.copied === 'number' ? n.copied : 0,
            imageDataUrl: typeof n.imageDataUrl === 'string' ? n.imageDataUrl : '',
            createdAt:
              typeof n.createdAt === 'number'
                ? n.createdAt
                : typeof n.id === 'number'
                ? n.id
                : n.timestamp || Date.now(),
            content: normalizeContentToSafeHtml(n.content || '')
          }));
          await api.saveData({
            notes: initialNotes,
            tempQueue: initialTempQueue,
            copyLog: initialCopyLog,
            settings: {
              isDark: initialDark,
              blurEnabled: initialBlur,
              lockOnStartup: initialLockOnStartup
            },
            draft: null
          });
          showToast(`기존 노트 ${initialNotes.length}개를 안전하게 불러왔습니다.`, 'success');
        } else {
          initialNotes = initialNotes.map((n) => ({
            ...n,
            tags: Array.isArray(n.tags) ? n.tags : [],
            pinned: Boolean(n.pinned),
            copied: typeof n.copied === 'number' ? n.copied : 0,
            imageDataUrl: typeof n.imageDataUrl === 'string' ? n.imageDataUrl : '',
            fileInfo: n.fileInfo && typeof n.fileInfo === 'object' ? n.fileInfo : null,
            content: normalizeContentToSafeHtml(n.content || '')
          }));
        }

        setNotes(initialNotes);
        setTempQueue(initialTempQueue);
        setCopyLog(initialCopyLog);
        setIsDark(initialDark);
        setBlurEnabled(initialBlur);
        setHasPassword(initialHasPassword);
        setLockOnStartup(initialLockOnStartup);
        setIsLocked(initialHasPassword && initialLockOnStartup);

        if (
          initialDraft &&
          (initialDraft.title ||
            getPlainText(initialDraft.content) ||
            initialDraft.imageDataUrl ||
            initialDraft.fileInfo ||
            initialDraft.tagsInput)
        ) {
          setTitle(initialDraft.title || '');
          const safeDraftHtml = normalizeContentToSafeHtml(initialDraft.content || '');
          setContent(safeDraftHtml);
          setCategory(initialDraft.category || CATEGORIES[0]);
          setTagsInput(initialDraft.tagsInput || '');
          setAttachedImage(initialDraft.imageDataUrl || '');
          setAttachedFile(initialDraft.fileInfo || null);
          if (mainEditorRef.current) {
            mainEditorRef.current.innerHTML = safeDraftHtml;
          }
        }

        setIsLoaded(true);
      } else {
        setIsLoaded(true);
      }
    }

    initData();

    if (api && api.onUpdateStatus) {
      const unsubscribe = api.onUpdateStatus((status) => {
        setUpdateInfo(status);
      });
      return () => {
        mounted = false;
        unsubscribe();
      };
    }

    return () => {
      mounted = false;
    };
  }, [showToast]);

  // 2. 다크 모드 동기화
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    if (api) {
      api.setTheme(isDark).catch(() => {});
    }
  }, [isDark]);

  // 3. 디바운스 자동 파일 저장
  const persistPayload = useCallback(
    async (
      nextNotes,
      nextTempQueue,
      nextCopyLog,
      nextDark,
      nextBlur,
      nextLockOnStartup,
      nextDraft
    ) => {
      if (!isLoaded || corruptWarning) return;
      const payload = {
        notes: nextNotes,
        tempQueue: nextTempQueue,
        copyLog: nextCopyLog,
        settings: {
          isDark: nextDark,
          blurEnabled: nextBlur,
          lockOnStartup: nextLockOnStartup
        },
        draft: nextDraft
      };

      if (api) {
        const res = await api.saveData(payload);
        if (!res?.ok) {
          showToast(`저장 중 오류 발생: ${res?.error || '오류'}`, 'error');
        }
      }
    },
    [isLoaded, corruptWarning, showToast]
  );

  useEffect(() => {
    if (!isLoaded || corruptWarning) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const draftObj =
      title.trim() ||
      getPlainText(content).trim() ||
      attachedImage ||
      attachedFile ||
      tagsInput.trim()
        ? {
            title,
            content: sanitizeNoteHtml(content),
            category,
            tagsInput,
            imageDataUrl: attachedImage,
            fileInfo: attachedFile
          }
        : null;

    saveTimerRef.current = setTimeout(() => {
      persistPayload(
        notes,
        tempQueue,
        copyLog,
        isDark,
        blurEnabled,
        lockOnStartup,
        draftObj
      );
    }, 250);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    notes,
    tempQueue,
    copyLog,
    isDark,
    blurEnabled,
    lockOnStartup,
    title,
    content,
    category,
    tagsInput,
    attachedImage,
    attachedFile,
    isLoaded,
    corruptWarning,
    persistPayload
  ]);

  // 4. 클립보드 감지 및 72시간 임시 큐 추가 (텍스트 / 이미지 / 파일 모두 지원)
  const addToTempQueue = useCallback(
    (payload) => {
      setTempQueue((prev) => {
        const sig = buildClipboardSignature(payload);
        const exists = prev.some((item) => buildClipboardSignature(item) === sig);
        if (exists) return prev;
        const defaultTitle =
          payload.kind === 'image'
            ? '클립보드 이미지'
            : payload.kind === 'file'
            ? '클립보드 파일'
            : '클립보드 텍스트';
        const newItem = {
          id: generateId(),
          kind: payload.kind || 'text',
          title: payload.title || defaultTitle,
          content: payload.content || '',
          imageDataUrl: payload.imageDataUrl || '',
          fileInfo: payload.fileInfo || null,
          detectedAt: payload.detectedAt || new Date().toISOString(),
          addedAt: new Date().toISOString()
        };
        showToast('임시 보관함에 자동 수집되었습니다 ✓', 'info');
        return [newItem, ...prev];
      });
    },
    [showToast]
  );

  const captureClipboardNow = useCallback(
    async (silentIfSame = false) => {
      if (!api || !api.readSystemClipboard) return;
      const res = await api.readSystemClipboard();
      if (!res?.ok) {
        if (!silentIfSame) {
          setClipboardStatus(`클립보드 확인 실패: ${res?.error || '알 수 없는 오류'}`);
        }
        return;
      }
      if (!res.payload) {
        if (!silentIfSame) {
          setClipboardStatus('현재 클립보드가 비어 있거나 읽을 수 있는 항목이 없습니다.');
        }
        return;
      }

      const sig = buildClipboardSignature(res.payload);
      if (sig !== lastClipboardSigRef.current) {
        lastClipboardSigRef.current = sig;
        setDetectedClipboard(res.payload);
        const kindLabel =
          res.payload.kind === 'image'
            ? '이미지'
            : res.payload.kind === 'file'
            ? '파일'
            : '텍스트';
        setClipboardStatus(`새로운 클립보드 ${kindLabel} 항목을 감지했습니다 ✓`);
        addToTempQueue(res.payload);
      } else if (!silentIfSame) {
        setDetectedClipboard(res.payload);
        setClipboardStatus('현재 클립보드는 마지막으로 감지한 내용과 같습니다.');
      }
    },
    [addToTempQueue]
  );

  useEffect(() => {
    if (!isMonitoring) return;
    // 백그라운드에서도 다른 앱에서 복사(Ctrl+C)한 텍스트·이미지·파일을 실시간 감지
    captureClipboardNow(true);
    const id = setInterval(() => {
      captureClipboardNow(true);
    }, 1800);
    return () => clearInterval(id);
  }, [isMonitoring, captureClipboardNow]);

  const handleToggleMonitor = () => {
    setIsMonitoring((prev) => {
      const next = !prev;
      setClipboardStatus(
        next
          ? '클립보드 실시간 감지를 시작했습니다. 텍스트·이미지·파일을 복사(Ctrl+C)해 보세요.'
          : '클립보드 감지가 일시정지되었습니다.'
      );
      return next;
    });
  };

  const resolveCategoryByKind = (kind) => {
    if (kind === 'image') return '🖼️ 이미지';
    if (kind === 'file') return '📎 파일';
    return '🎈 개인';
  };

  const handleSaveDetectedToNotes = (rawTags) => {
    if (!detectedClipboard) {
      showToast('저장할 감지 항목이 없습니다.', 'info');
      return;
    }
    const now = new Date();
    const nowMs = now.getTime();
    const kind = detectedClipboard.kind || 'text';
    const safeHtml = escapePlainTextToHtml(detectedClipboard.content || '');

    const newNote = {
      id: generateId(),
      title:
        detectedClipboard.title ||
        (kind === 'image' ? '클립보드 이미지' : kind === 'file' ? '클립보드 파일' : '클립보드 텍스트'),
      content: safeHtml,
      category: resolveCategoryByKind(kind),
      tags: parseTagsInput(rawTags),
      pinned: false,
      copied: 0,
      imageDataUrl: detectedClipboard.imageDataUrl || '',
      fileInfo: detectedClipboard.fileInfo || null,
      date: now.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short'
      }),
      time: now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: nowMs,
      createdAt: nowMs
    };

    setNotes((prev) => [newNote, ...prev]);
    showToast('감지된 항목을 노트에 저장했습니다 ✓', 'success');
  };

  const handleSaveTempItem = (tempId) => {
    const target = tempQueue.find((item) => item.id === tempId);
    if (!target) return;
    const now = new Date();
    const nowMs = now.getTime();
    const newNote = {
      id: generateId(),
      title: target.title,
      content: escapePlainTextToHtml(target.content || ''),
      category: resolveCategoryByKind(target.kind),
      tags: ['클립보드'],
      pinned: false,
      copied: 0,
      imageDataUrl: target.imageDataUrl || '',
      fileInfo: target.fileInfo || null,
      date: now.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short'
      }),
      time: now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: nowMs,
      createdAt: Date.parse(target.detectedAt) || nowMs
    };

    setNotes((prev) => [newNote, ...prev]);
    setTempQueue((prev) => prev.filter((item) => item.id !== tempId));
    showToast('임시 항목을 영구 노트로 저장했습니다 ✓', 'success');
  };

  const handleSaveAllTemp = () => {
    const activeItems = tempQueue.filter((item) => !getTempTimeInfo(item.addedAt).expired);
    if (activeItems.length === 0) {
      showToast('저장할 유효한 임시 항목이 없습니다.', 'info');
      return;
    }
    const now = new Date();
    const nowMs = now.getTime();
    const converted = activeItems.map((target, idx) => ({
      id: generateId(),
      title: target.title,
      content: escapePlainTextToHtml(target.content || ''),
      category: resolveCategoryByKind(target.kind),
      tags: ['클립보드'],
      pinned: false,
      copied: 0,
      imageDataUrl: target.imageDataUrl || '',
      fileInfo: target.fileInfo || null,
      date: now.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short'
      }),
      time: now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: nowMs + idx,
      createdAt: Date.parse(target.detectedAt) || nowMs
    }));

    setNotes((prev) => [...converted, ...prev]);
    setTempQueue([]);
    showToast(`${converted.length}개 임시 항목을 모두 노트에 저장했습니다 ✓`, 'success');
  };

  const handleDeleteTempItem = (tempId) => {
    setTempQueue((prev) => prev.filter((item) => item.id !== tempId));
    showToast('임시 항목을 삭제했습니다.', 'info');
  };

  const handleClearExpiredTemp = () => {
    const active = tempQueue.filter((item) => !getTempTimeInfo(item.addedAt).expired);
    const expiredCount = tempQueue.length - active.length;
    if (expiredCount === 0) {
      showToast('만료된 항목이 없습니다.', 'info');
      return;
    }
    setTempQueue(active);
    showToast(`만료된 ${expiredCount}개 항목을 정리했습니다.`, 'info');
  };

  // 5. 원클릭 클립보드 복사 및 파일 열기/폴더 보기
  const handleCopyNote = async (note, e) => {
    if (e) e.stopPropagation();
    const plain = getPlainText(note.content);
    let copiedOk = false;

    if (api && api.writeSystemClipboard) {
      const res = await api.writeSystemClipboard({
        text: plain || note.fileInfo?.path || '',
        imageDataUrl: note.imageDataUrl || '',
        filePath: note.fileInfo?.path || ''
      });
      copiedOk = Boolean(res?.ok);
    }

    if (!copiedOk && (plain || note.fileInfo?.path)) {
      try {
        await navigator.clipboard.writeText(plain || note.fileInfo?.path || '');
        copiedOk = true;
      } catch (_e) {
        copiedOk = false;
      }
    }

    if (copiedOk) {
      const todayKey = new Date().toISOString().slice(0, 10);
      setCopyLog((prev) => ({
        ...prev,
        [todayKey]: (prev[todayKey] || 0) + 1
      }));
      setNotes((prev) =>
        prev.map((n) => (n.id === note.id ? { ...n, copied: (n.copied || 0) + 1 } : n))
      );
      showToast('클립보드에 복사되었습니다 ✓', 'success');
    } else {
      showToast('복사할 내용이 없습니다.', 'error');
    }
  };

  const handleOpenFilePath = async (filePath, e) => {
    if (e) e.stopPropagation();
    if (!api || !api.openFile || !filePath) return;
    const res = await api.openFile(filePath);
    if (!res?.ok) {
      showToast(res?.error || '파일을 열 수 없습니다.', 'error');
    }
  };

  const handleShowFileInFolder = async (filePath, e) => {
    if (e) e.stopPropagation();
    if (!api || !api.showFileInFolder || !filePath) return;
    const res = await api.showFileInFolder(filePath);
    if (!res?.ok) {
      showToast(res?.error || '폴더를 열 수 없습니다.', 'error');
    }
  };

  const handleTogglePin = (id, e) => {
    if (e) e.stopPropagation();
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)));
  };

  // 6. 이미지 / 파일 첨부 및 드래그 앤 드롭 지원
  const applyInspectedAttachment = (inspected, isEdit = false) => {
    if (!inspected) return;
    if (isEdit) {
      setEditingNote((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          title: prev.title.trim() ? prev.title : inspected.fileInfo?.name || prev.title,
          imageDataUrl: inspected.imageDataUrl || prev.imageDataUrl || '',
          fileInfo: inspected.fileInfo || prev.fileInfo || null,
          category:
            prev.category === CATEGORIES[0]
              ? inspected.isImage
                ? '🖼️ 이미지'
                : '📎 파일'
              : prev.category
        };
      });
    } else {
      if (inspected.imageDataUrl) {
        setAttachedImage(inspected.imageDataUrl);
      }
      if (inspected.fileInfo) {
        setAttachedFile(inspected.fileInfo);
      }
      if (!title.trim() && inspected.fileInfo?.name) {
        setTitle(inspected.fileInfo.name);
      }
      if (category === CATEGORIES[0]) {
        setCategory(inspected.isImage ? '🖼️ 이미지' : '📎 파일');
      }
    }
    showToast(
      inspected.isImage ? '이미지가 첨부되었습니다 ✓' : `파일(${inspected.fileInfo?.name})이 첨부되었습니다 ✓`,
      'info'
    );
  };

  const handlePickNativeAttachment = async (mode = 'any', isEdit = false) => {
    if (api && api.pickFile) {
      const res = await api.pickFile({ mode });
      if (!res || res.canceled) return;
      if (!res.ok) {
        showToast(res.error || '파일을 불러올 수 없습니다.', 'error');
        return;
      }
      applyInspectedAttachment(res, isEdit);
      return;
    }
    if (isEdit) {
      editFileInputRef.current?.click();
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleImageFileSelect = (e, isEdit = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const droppedPath = api?.getDroppedFilePath ? api.getDroppedFilePath(file) : file.path || '';
    if (droppedPath && api?.inspectFile) {
      api.inspectFile(droppedPath).then((res) => {
        if (res?.ok) applyInspectedAttachment(res, isEdit);
      });
      e.target.value = '';
      return;
    }

    if (file.type.startsWith('image/')) {
      if (file.size > 15 * 1024 * 1024) {
        showToast('이미지 크기는 15MB 이하여야 합니다.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result;
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
          applyInspectedAttachment(
            {
              isImage: true,
              imageDataUrl: dataUrl,
              fileInfo: {
                name: file.name,
                path: droppedPath || file.name,
                size: file.size,
                ext: '',
                isDirectory: false
              }
            },
            isEdit
          );
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleDropAttachment = async (e, isEdit = false) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const localPath = api?.getDroppedFilePath ? api.getDroppedFilePath(file) : file.path || '';
    if (localPath && api?.inspectFile) {
      const res = await api.inspectFile(localPath);
      if (res?.ok) {
        applyInspectedAttachment(res, isEdit);
        return;
      }
    }
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result;
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
          applyInspectedAttachment(
            {
              isImage: true,
              imageDataUrl: dataUrl,
              fileInfo: {
                name: file.name,
                path: localPath || file.name,
                size: file.size,
                ext: '',
                isDirectory: false
              }
            },
            isEdit
          );
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSafePaste = (e, targetEditorRef, onUpdateContent, isEdit = false) => {
    const clipboard = e.clipboardData;
    if (!clipboard) return;

    const items = clipboard.items || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target?.result;
            if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
              if (isEdit) {
                setEditingNote((prev) => (prev ? { ...prev, imageDataUrl: dataUrl } : prev));
              } else {
                setAttachedImage(dataUrl);
              }
              showToast('이미지가 노트에 첨부되었습니다 ✓', 'info');
            }
          };
          reader.readAsDataURL(file);
        }
        return;
      }
    }

    e.preventDefault();
    const rawHtml = clipboard.getData('text/html');
    const rawText = clipboard.getData('text/plain');
    const cleanHtml = rawHtml ? sanitizeNoteHtml(rawHtml) : escapePlainTextToHtml(rawText);

    document.execCommand('insertHTML', false, cleanHtml);
    if (targetEditorRef.current && onUpdateContent) {
      onUpdateContent(targetEditorRef.current.innerHTML);
    }
  };

  // 7. 편집 모달 세팅 및 닫기 보호 + 키보드 단축키 (Ctrl+F, Ctrl+K, Esc)
  useEffect(() => {
    if (editingNote && editEditorRef.current) {
      editEditorRef.current.innerHTML = normalizeContentToSafeHtml(editingNote.content);
    }
  }, [editingNote?.id]);

  const requestCloseEditModal = useCallback(() => {
    if (!editingNote) return;
    const currentHtml = editEditorRef.current
      ? sanitizeNoteHtml(editEditorRef.current.innerHTML)
      : sanitizeNoteHtml(editingNote.content);
    const hasChanges =
      editingInitialSnapshot &&
      (editingNote.title !== editingInitialSnapshot.title ||
        editingNote.category !== editingInitialSnapshot.category ||
        editingNote.imageDataUrl !== editingInitialSnapshot.imageDataUrl ||
        editingTagsInput !== (editingInitialSnapshot.tags || []).join(', ') ||
        getPlainText(currentHtml) !== getPlainText(editingInitialSnapshot.content));

    if (hasChanges) {
      if (!window.confirm('수정 중인 내용이 있습니다. 저장하지 않고 닫으시겠습니까?')) {
        return;
      }
    }
    setEditingNote(null);
    setEditingInitialSnapshot(null);
  }, [editingNote, editingInitialSnapshot, editingTagsInput]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'k')) {
        if (!editingNote && !viewingNote && !showSettings && !showPasswordModal) {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      } else if (e.key === 'Escape') {
        if (editingNote) {
          requestCloseEditModal();
        } else if (viewingNote) {
          setViewingNote(null);
        } else if (showPasswordModal) {
          setShowPasswordModal(false);
        } else if (showSettings) {
          setShowSettings(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingNote, viewingNote, showSettings, showPasswordModal, requestCloseEditModal]);

  // 8. 노트 추가 / 수정 / 삭제
  const resetForm = () => {
    setTitle('');
    setContent('');
    setCategory(CATEGORIES[0]);
    setTagsInput('');
    setAttachedImage('');
    setAttachedFile(null);
    if (mainEditorRef.current) mainEditorRef.current.innerHTML = '';
    setIsInputFocused(false);
    setIsSelectOpen(false);
  };

  const handleAddNote = (e) => {
    e.preventDefault();
    const rawHtmlContent = mainEditorRef.current ? mainEditorRef.current.innerHTML : content;
    const safeHtmlContent = sanitizeNoteHtml(rawHtmlContent);
    const plain = getPlainText(safeHtmlContent);
    if (!title.trim() && !plain.trim() && !attachedImage && !attachedFile) return;

    const now = new Date();
    const nowMs = now.getTime();
    const fallbackTitle = attachedFile?.name || (attachedImage ? '이미지 노트' : plain.slice(0, 30));
    const finalContent =
      safeHtmlContent || (attachedFile?.path ? escapePlainTextToHtml(attachedFile.path) : '');

    const newNote = {
      id: generateId(),
      title: title.trim() || fallbackTitle,
      content: finalContent,
      category,
      tags: parseTagsInput(tagsInput),
      pinned: false,
      copied: 0,
      imageDataUrl: attachedImage,
      fileInfo: attachedFile || null,
      date: now.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short'
      }),
      time: now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: nowMs,
      createdAt: nowMs
    };

    setNotes((prev) => [newNote, ...prev]);
    resetForm();
    setIsFocusMode(false);
    showToast('새 노트가 저장되었습니다 ✓', 'success');
  };

  const handleDeleteNote = (id, e) => {
    if (e) e.stopPropagation();
    if (window.confirm('정말 이 노트를 삭제하시겠습니까?')) {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      showToast('노트가 삭제되었습니다.', 'info');
    }
  };

  const handleOpenEdit = (note, e) => {
    if (e) e.stopPropagation();
    const safeCopy = {
      ...note,
      tags: Array.isArray(note.tags) ? note.tags : [],
      imageDataUrl: note.imageDataUrl || '',
      fileInfo: note.fileInfo || null,
      content: normalizeContentToSafeHtml(note.content)
    };
    setEditingNote(safeCopy);
    setEditingTagsInput(safeCopy.tags.join(', '));
    setEditingInitialSnapshot(safeCopy);
  };

  const handleOpenView = (note) => {
    setViewingNote({
      ...note,
      tags: Array.isArray(note.tags) ? note.tags : [],
      imageDataUrl: note.imageDataUrl || '',
      fileInfo: note.fileInfo || null,
      content: normalizeContentToSafeHtml(note.content)
    });
  };

  const handleSaveEdit = () => {
    if (!editingNote) return;
    const rawHtmlContent = editEditorRef.current ? editEditorRef.current.innerHTML : editingNote.content;
    const safeHtmlContent = sanitizeNoteHtml(rawHtmlContent);
    const plain = getPlainText(safeHtmlContent);
    if (
      !editingNote.title.trim() &&
      !plain.trim() &&
      !editingNote.imageDataUrl &&
      !editingNote.fileInfo
    )
      return;

    const now = new Date();
    const updatedNote = {
      ...editingNote,
      title: editingNote.title.trim() || editingNote.fileInfo?.name || '제목 없음',
      content: safeHtmlContent,
      tags: parseTagsInput(editingTagsInput),
      date: now.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short'
      }),
      time: now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: now.getTime()
    };

    setNotes((prev) => prev.map((n) => (n.id === editingNote.id ? updatedNote : n)));
    setEditingNote(null);
    setEditingInitialSnapshot(null);
    showToast('노트가 수정되었습니다 ✓', 'success');
  };

  // 9. 개인 비밀번호 설정 / 검증 / 해제
  const handleVerifyPassword = async (inputPassword) => {
    if (api && api.verifyPassword) {
      const res = await api.verifyPassword(inputPassword);
      if (res?.ok) {
        setIsLocked(false);
        showToast('잠금이 해제되었습니다 ✓', 'success');
        return true;
      }
      return false;
    }
    return false;
  };

  const handleSavePassword = async (payload) => {
    if (!api || !api.setPassword) return { ok: false, error: '지원되지 않는 환경입니다.' };
    const res = await api.setPassword(payload);
    if (res?.ok) {
      setHasPassword(true);
      setLockOnStartup(Boolean(res.lockOnStartup));
      showToast('개인 비밀번호가 안전하게 저장되었습니다 ✓', 'success');
    }
    return res;
  };

  const handleRemovePassword = async (currentPassword) => {
    if (!api || !api.removePassword) return { ok: false, error: '지원되지 않는 환경입니다.' };
    const res = await api.removePassword(currentPassword);
    if (res?.ok) {
      setHasPassword(false);
      setLockOnStartup(false);
      setIsLocked(false);
      showToast('비밀번호 잠금이 해제되었습니다 ✓', 'info');
    }
    return res;
  };

  const handleLockNow = () => {
    if (!hasPassword) {
      setShowSettings(false);
      setShowPasswordModal(true);
      return;
    }
    setIsLocked(true);
    setShowSettings(false);
  };

  // 10. 백업 내보내기 / 가져오기
  const handleExportBackup = async () => {
    if (!api) return;
    const res = await api.exportNotes({
      notes,
      tempQueue,
      copyLog,
      settings: { isDark, blurEnabled, lockOnStartup }
    });
    if (res?.ok) {
      showToast('백업 파일을 성공적으로 저장했습니다 ✓', 'success');
      setShowSettings(false);
    } else if (res && !res.canceled) {
      showToast(`내보내기 실패: ${res.error}`, 'error');
    }
  };

  const handleImportBackup = async () => {
    if (!api) return;
    const res = await api.importNotes();
    if (!res || res.canceled) return;
    if (!res.ok) {
      showToast(res.error || '가져오기에 실패했습니다.', 'error');
      return;
    }

    const importedNotes = (res.data?.notes || []).map((n) => ({
      ...n,
      content: normalizeContentToSafeHtml(n.content || '')
    }));

    if (importedNotes.length === 0) {
      showToast('선택한 백업 파일에 노트가 없습니다.', 'info');
      return;
    }

    const shouldMerge =
      notes.length > 0
        ? window.confirm(
            `백업 파일에서 노트 ${importedNotes.length}개를 찾았습니다.\n[확인]을 누르면 기존 노트와 병합합니다.`
          )
        : true;

    if (!shouldMerge) return;

    setCorruptWarning(null);
    setNotes((prev) => {
      const existingIds = new Set(prev.map((x) => x.id));
      const merged = [...prev];
      for (const item of importedNotes) {
        if (!existingIds.has(item.id)) {
          merged.push(item);
          existingIds.add(item.id);
        } else {
          merged.push({ ...item, id: generateId() });
        }
      }
      return merged.sort((a, b) => b.timestamp - a.timestamp);
    });

    showToast(`노트 ${importedNotes.length}개를 성공적으로 가져왔습니다 ✓`, 'success');
    setShowSettings(false);
  };

  const handleManualUpdateCheck = async () => {
    if (!api) return;
    const res = await api.checkForUpdates();
    if (res && !res.ok && res.message) {
      showToast(res.message, 'info');
    }
  };

  // 11. 통계, 카테고리별 개수 및 필터링 계산
  const todayCopyCount = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return copyLog[todayKey] || 0;
  }, [copyLog]);

  const pinnedNotesCount = useMemo(() => notes.filter((n) => n.pinned).length, [notes]);

  const categoryCounts = useMemo(() => {
    const counts = { [FILTER_CATEGORIES[0]]: notes.length };
    for (const cat of CATEGORIES) {
      counts[cat] = 0;
    }
    for (const n of notes) {
      const c = n.category || CATEGORIES[0];
      counts[c] = (counts[c] || 0) + 1;
    }
    return counts;
  }, [notes]);

  const plainDraftContent = useMemo(() => getPlainText(content), [content]);
  const hasInputFocusOrContent =
    isInputFocused ||
    isSelectOpen ||
    title.trim().length > 0 ||
    plainDraftContent.length > 0 ||
    Boolean(attachedImage) ||
    Boolean(attachedFile);
  const formActiveState = blurEnabled && workspace === 'composer' && hasInputFocusOrContent;

  const notesWithPlainCache = useMemo(() => {
    return notes.map((note) => {
      const plainText = getPlainText(note.content);
      const enriched = {
        ...note,
        tags: Array.isArray(note.tags) ? note.tags : [],
        _plainText: plainText,
        _safeHtml: normalizeContentToSafeHtml(note.content)
      };
      enriched._contentType = getNoteContentType(enriched);
      return enriched;
    });
  }, [notes]);

  const contentTypeCounts = useMemo(() => {
    const counts = { all: notesWithPlainCache.length, text: 0, image: 0, file: 0, link: 0 };
    for (const n of notesWithPlainCache) {
      const t = n._contentType || 'text';
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [notesWithPlainCache]);

  const filteredAndSortedNotes = useMemo(() => {
    const sl = searchQuery.trim().toLowerCase();
    return notesWithPlainCache
      .filter((note) => {
        if (pinnedOnly && !note.pinned) return false;
        if (contentTypeTab !== 'all' && note._contentType !== contentTypeTab) return false;
        const mc =
          filterCategory === FILTER_CATEGORIES[0] || note.category === filterCategory;
        if (!mc) return false;
        if (!sl) return true;

        const t = (note.title || '').toLowerCase();
        const c = (note._plainText || '').toLowerCase();
        const tg = (note.tags || []).join(' ').toLowerCase();
        const fp = (note.fileInfo?.name || note.fileInfo?.path || '').toLowerCase();
        return t.includes(sl) || c.includes(sl) || tg.includes(sl) || fp.includes(sl);
      })
      .sort((a, b) => {
        if (Boolean(b.pinned) !== Boolean(a.pinned)) {
          return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        }
        return sortOrder === '최신순' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
      });
  }, [notesWithPlainCache, searchQuery, filterCategory, contentTypeTab, pinnedOnly, sortOrder]);

  return (
    <>
      {/* 상단 드래그 타이틀바 영역 */}
      <div className="drag-titlebar" />

      {/* 개인 비밀번호 잠금 화면 (제한적 Glassmorphism 10%) */}
      <PasswordLockScreen isLocked={isLocked} onVerify={handleVerifyPassword} />

      {/* 비밀번호 설정/변경/해제 모달 */}
      <PasswordSetupModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        hasPassword={hasPassword}
        lockOnStartup={lockOnStartup}
        onSavePassword={handleSavePassword}
        onRemovePassword={handleRemovePassword}
      />

      {/* 중앙 환경 설정 모달 */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-md"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="bg-surface-light dark:bg-surface-dark w-full max-w-md rounded-[20px] shadow-2xl border border-line-light dark:border-line-dark p-6 flex flex-col gap-4 animate-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-3 border-b border-line-light dark:border-line-dark">
              <div className="flex items-center gap-2">
                <IconSettings />
                <h3 className="font-extrabold text-zinc-900 dark:text-gray-100 text-base">
                  환경 설정
                </h3>
                <span className="px-2 py-0.5 rounded-md bg-muted-light dark:bg-muted-dark text-[11px] font-bold text-zinc-500">
                  v{appVersion}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:bg-muted-light dark:hover:bg-muted-dark"
              >
                <IconClose />
              </button>
            </div>

            {/* 1. 작성 집중 디밍 효과 */}
            <div className="flex justify-between items-center bg-canvas-light dark:bg-canvas-dark p-3.5 rounded-xl border border-line-light dark:border-line-dark">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-zinc-800 dark:text-gray-200">
                  작성 시 목록 디밍(Dimming) 효과
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  글을 입력할 때 아래 목록의 투명도를 낮춰 집중도 향상
                </span>
              </div>
              <button
                type="button"
                onClick={() => setBlurEnabled(!blurEnabled)}
                className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                  blurEnabled ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-transform ${
                    blurEnabled ? 'translate-x-[22px]' : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </div>

            {/* 2. 개인 비밀번호 잠금 설정 */}
            <div className="flex flex-col gap-2.5 bg-canvas-light dark:bg-canvas-dark p-3.5 rounded-xl border border-line-light dark:border-line-dark">
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-zinc-800 dark:text-gray-200">
                    개인 비밀번호 잠금
                  </span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {hasPassword ? '비밀번호 설정됨' : '미설정 (누구나 바로 사용 가능)'}
                  </span>
                </div>
                {hasPassword && (
                  <button
                    type="button"
                    onClick={() => setLockOnStartup(!lockOnStartup)}
                    title="앱 시작 시 자동 잠금 켜기/끄기"
                    className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                      lockOnStartup ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-transform ${
                        lockOnStartup ? 'translate-x-[22px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSettings(false);
                    setShowPasswordModal(true);
                  }}
                  className="flex-1 py-2 px-3 rounded-lg bg-surface-light dark:bg-surface-dark hover:bg-muted-light dark:hover:bg-muted-dark text-zinc-700 dark:text-gray-200 text-xs font-bold border border-line-light dark:border-line-dark transition-colors"
                >
                  {hasPassword ? '비밀번호 변경 / 해제' : '비밀번호 설정하기'}
                </button>
                {hasPassword && (
                  <button
                    type="button"
                    onClick={handleLockNow}
                    className="py-2 px-3.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs font-bold transition-colors"
                  >
                    🔒 지금 잠금
                  </button>
                )}
              </div>
            </div>

            {/* 3. 백업 및 복원 */}
            {api && (
              <>
                <div className="bg-canvas-light dark:bg-canvas-dark p-3.5 rounded-xl border border-line-light dark:border-line-dark flex flex-col gap-2">
                  <span className="text-xs font-bold text-zinc-800 dark:text-gray-200">
                    데이터 백업 및 복원 (JSON)
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleExportBackup}
                      className="flex-1 py-2 px-3 rounded-lg bg-surface-light dark:bg-surface-dark hover:bg-muted-light dark:hover:bg-muted-dark text-xs font-bold border border-line-light dark:border-line-dark transition-colors"
                    >
                      백업 내보내기
                    </button>
                    <button
                      type="button"
                      onClick={handleImportBackup}
                      className="flex-1 py-2 px-3 rounded-lg bg-surface-light dark:bg-surface-dark hover:bg-muted-light dark:hover:bg-muted-dark text-xs font-bold border border-line-light dark:border-line-dark transition-colors"
                    >
                      백업 가져오기
                    </button>
                  </div>
                </div>

                {/* 4. 소프트웨어 업데이트 */}
                <div className="bg-canvas-light dark:bg-canvas-dark p-3.5 rounded-xl border border-line-light dark:border-line-dark flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-zinc-800 dark:text-gray-200">
                      소프트웨어 업데이트
                    </span>
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {updateInfo?.message || 'GitHub Releases 자동 업데이트 연동됨'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleManualUpdateCheck}
                    className="py-2 px-3.5 rounded-lg bg-muted-light dark:bg-muted-dark hover:bg-blue-600 hover:text-white text-zinc-700 dark:text-zinc-200 text-xs font-bold border border-line-light dark:border-line-dark transition-colors shrink-0"
                  >
                    업데이트 확인
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      {statusBanner && (
        <div
          className={`fixed bottom-6 right-6 z-[9999] px-4 py-3 rounded-xl shadow-lg border text-xs font-bold animate-[slideUpFade_0.2s_ease-out] ${
            statusBanner.type === 'error'
              ? 'bg-red-600 text-white border-red-500'
              : statusBanner.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500'
              : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-700'
          }`}
        >
          {statusBanner.message}
        </div>
      )}

      {/* ================= Modern Dashboard 전체 레이아웃 ================= */}
      <div
        className={`w-[min(1440px,calc(100%-32px))] mx-auto pt-10 pb-8 min-h-screen grid grid-cols-1 lg:grid-cols-[268px_1fr] gap-5 relative z-10 ${
          isLocked ? 'blur-lg pointer-events-none select-none' : ''
        }`}
      >
        {/* ================= 좌측 고정 사이드바 (Solid Sidebar Surface) ================= */}
        <aside className="bg-sidebar-light dark:bg-sidebar-dark border border-line-light dark:border-line-dark rounded-[20px] p-5 flex flex-col gap-5 lg:sticky lg:top-10 lg:self-start">
          {/* 브랜드 헤더 + 빠른 잠금 & 환경설정 버튼 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white grid place-items-center shadow-sm shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Workspace
                </span>
                <h1 className="text-lg font-extrabold text-zinc-900 dark:text-white tracking-tight">
                  나무 노트
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-1 no-drag">
              <button
                type="button"
                onClick={handleLockNow}
                className="p-2 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-surface-light dark:hover:bg-surface-dark hover:text-zinc-900 dark:hover:text-white transition-colors"
                title={hasPassword ? '지금 화면 잠그기' : '비밀번호 잠금 설정'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-surface-light dark:hover:bg-surface-dark hover:text-zinc-900 dark:hover:text-white transition-colors"
                title="환경 설정"
              >
                <IconSettings />
              </button>
            </div>
          </div>

          {/* 워크스페이스 전환 */}
          <nav className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 px-1 mb-0.5">
              워크스페이스
            </span>
            <button
              type="button"
              onClick={() => setWorkspace('composer')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-colors border ${
                workspace === 'composer'
                  ? 'bg-surface-light dark:bg-surface-dark text-blue-600 dark:text-blue-400 border-line-light dark:border-line-dark shadow-sm'
                  : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-surface-light/60 dark:hover:bg-surface-dark/60'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              <span>노트·클립 작성</span>
            </button>

            <button
              type="button"
              onClick={() => setWorkspace('monitor')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between transition-colors border ${
                workspace === 'monitor'
                  ? 'bg-surface-light dark:bg-surface-dark text-emerald-600 dark:text-emerald-400 border-line-light dark:border-line-dark shadow-sm'
                  : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-surface-light/60 dark:hover:bg-surface-dark/60'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>클립보드 자동 감지</span>
              </div>
              <div className="flex items-center gap-1.5">
                {isMonitoring && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                )}
                {tempQueue.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-extrabold">
                    {tempQueue.length}
                  </span>
                )}
              </div>
            </button>
          </nav>

          {/* Bento 미니 통계 대시보드 */}
          <section className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 px-1">
              요약 통계
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark rounded-xl py-2.5 px-2 flex flex-col items-center">
                <span className="text-base font-extrabold text-zinc-900 dark:text-white">
                  {notes.length}
                </span>
                <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                  전체
                </span>
              </div>
              <div className="bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark rounded-xl py-2.5 px-2 flex flex-col items-center">
                <span className="text-base font-extrabold text-blue-600 dark:text-blue-400">
                  {pinnedNotesCount}
                </span>
                <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                  고정됨
                </span>
              </div>
              <div className="bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark rounded-xl py-2.5 px-2 flex flex-col items-center">
                <span className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                  {todayCopyCount}
                </span>
                <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                  오늘 복사
                </span>
              </div>
            </div>
          </section>

          {/* 수직 리스트형 카테고리 네비게이션 (항목별 카운트 배지 포함) */}
          <section className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 px-1 mb-0.5">
              카테고리
            </span>
            <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto pr-0.5">
              {FILTER_CATEGORIES.map((cat) => {
                const active = filterCategory === cat;
                const count = categoryCounts[cat] || 0;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setFilterCategory(cat)}
                    className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors ${
                      active
                        ? 'bg-blue-600 text-white font-bold shadow-sm'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-surface-light/70 dark:hover:bg-surface-dark/70'
                    }`}
                  >
                    <span className="truncate">{cat}</span>
                    <span
                      className={`text-[11px] px-1.5 py-0.2 rounded-md font-bold ${
                        active
                          ? 'bg-white/20 text-white'
                          : 'text-zinc-400 dark:text-zinc-500'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 하단 테마 전환 버튼 */}
          <div className="mt-auto pt-2 border-t border-line-light dark:border-line-dark">
            <button
              type="button"
              onClick={() => setIsDark(!isDark)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface-light dark:bg-surface-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 flex items-center justify-center gap-2 transition-colors"
            >
              {isDark ? <IconSun /> : <IconMoon />}
              <span>{isDark ? '라이트 모드 (Warm Paper)' : '다크 모드 (Carbon Slate)'}</span>
            </button>
          </div>
        </aside>

        {/* ================= 우측 메인 워크스페이스 ================= */}
        <main className="flex flex-col gap-4 min-w-0">
          {/* 손상 경고 배너 / 업데이트 배너 */}
          {corruptWarning && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-300 text-xs font-bold flex justify-between items-center gap-3">
              <span>{corruptWarning}</span>
              <button
                type="button"
                onClick={() => setCorruptWarning(null)}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold shrink-0"
              >
                확인
              </button>
            </div>
          )}

          {updateInfo && updateInfo.state === 'downloaded' && (
            <div className="p-3.5 rounded-xl bg-blue-600/10 border border-blue-600/30 text-blue-600 dark:text-blue-300 text-xs font-bold flex justify-between items-center gap-3">
              <span>{updateInfo.message}</span>
              <button
                type="button"
                onClick={() => api?.installUpdate()}
                className="px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shrink-0"
              >
                지금 재시작하여 업데이트
              </button>
            </div>
          )}

          {/* 상단 고정 검색 & 필터 바 */}
          <section className="bg-surface-light dark:bg-surface-dark px-4 py-3 rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 min-w-[220px]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 shrink-0">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="제목, 본문, #태그 검색 (Ctrl+F)..."
                className="w-full bg-transparent text-xs sm:text-sm font-medium text-zinc-900 dark:text-white placeholder-zinc-400 outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-1.5"
                  title="검색어 지우기"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {/* 고정 항목만 토글 */}
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={pinnedOnly}
                  onChange={(e) => setPinnedOnly(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`w-8 h-4.5 rounded-full transition-colors relative py-2 ${
                    pinnedOnly ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-700'
                  }`}
                >
                  <div
                    className={`w-3 h-3 bg-white rounded-full absolute top-[2px] transition-transform ${
                      pinnedOnly ? 'translate-x-[16px]' : 'translate-x-[2px]'
                    }`}
                  />
                </div>
                <span>고정 항목만</span>
              </label>

              <div className="w-px h-4 bg-line-light dark:bg-line-dark" />

              {/* 최신순 / 과거순 */}
              <button
                type="button"
                onClick={() => setSortOrder(sortOrder === '최신순' ? '과거순' : '최신순')}
                className="px-2.5 py-1.5 rounded-lg bg-muted-light dark:bg-muted-dark text-zinc-700 dark:text-zinc-200 text-xs font-semibold border border-line-light dark:border-line-dark hover:border-zinc-400 transition-colors"
              >
                {sortOrder}
              </button>

              {/* 카드형 / 목록형 뷰 전환 */}
              <div className="flex rounded-lg bg-muted-light dark:bg-muted-dark p-0.5 border border-line-light dark:border-line-dark">
                <button
                  type="button"
                  onClick={() => setViewLayout('grid')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                    viewLayout === 'grid'
                      ? 'bg-surface-light dark:bg-surface-dark text-zinc-900 dark:text-white shadow-sm'
                      : 'text-zinc-500'
                  }`}
                >
                  카드형
                </button>
                <button
                  type="button"
                  onClick={() => setViewLayout('list')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                    viewLayout === 'list'
                      ? 'bg-surface-light dark:bg-surface-dark text-zinc-900 dark:text-white shadow-sm'
                      : 'text-zinc-500'
                  }`}
                >
                  목록형
                </button>
              </div>
            </div>
          </section>

          {/* ================= 1) Warm Minimalism 솔리드 노트 에디터 OR 2) 클립보드 감지 패널 ================= */}
          {workspace === 'composer' ? (
            <section
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => handleDropAttachment(e, false)}
              className={`bg-surface-light dark:bg-surface-dark p-5 sm:p-6 rounded-[20px] shadow-sm border transition-colors focus-within:border-blue-600/60 ${
                isDraggingOver
                  ? 'border-blue-600 ring-2 ring-blue-600/20'
                  : 'border-line-light dark:border-line-dark'
              }`}
            >
              <form
                onSubmit={handleAddNote}
                className={`flex flex-col gap-3 ${
                  isFocusMode ? 'max-w-[720px] mx-auto w-full py-2' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2.5 flex-wrap sm:flex-nowrap">
                  <input
                    type="text"
                    placeholder="제목 또는 클립 용도를 입력하세요..."
                    className="w-full bg-transparent text-zinc-900 dark:text-gray-100 text-lg sm:text-xl font-extrabold placeholder-zinc-400 focus:outline-none px-1"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={(e) => handleImageFileSelect(e, false)}
                    className="hidden"
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePickNativeAttachment('image', false)}
                      className="px-3 py-1.5 rounded-xl bg-muted-light dark:bg-muted-dark hover:bg-zinc-200/70 dark:hover:bg-white/10 border border-line-light dark:border-line-dark text-zinc-700 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      title="이미지 파일 추가"
                    >
                      <IconImage />
                      <span>이미지 추가</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePickNativeAttachment('any', false)}
                      className="px-3 py-1.5 rounded-xl bg-muted-light dark:bg-muted-dark hover:bg-zinc-200/70 dark:hover:bg-white/10 border border-line-light dark:border-line-dark text-zinc-700 dark:text-zinc-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      title="문서, 압축파일, 실행파일 등 일반 파일 첨부"
                    >
                      <IconPaperclip />
                      <span>파일 첨부</span>
                    </button>
                  </div>
                </div>

                {/* 슬림 1줄 서식 툴바 */}
                <FormattingBar editorRef={mainEditorRef} onFormatChange={(html) => setContent(html)} />

                {/* 불투명 고대비 본문 에디터 */}
                <div
                  ref={mainEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="내용을 작성하거나 텍스트·이미지를 붙여넣으세요 (Ctrl+V). 이미지나 파일을 이 영역에 끌어다 놓아도 첨부됩니다."
                  className={`w-full bg-transparent text-zinc-800 dark:text-gray-100 text-base px-1.5 transition-all ${
                    isFocusMode ? 'min-h-[48vh]' : 'min-h-[104px]'
                  }`}
                  onInput={(e) => setContent(e.currentTarget.innerHTML)}
                  onPaste={(e) => handleSafePaste(e, mainEditorRef, setContent, false)}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                />

                {/* 전용 이미지 / 파일 첨부 칸 */}
                {(attachedImage || attachedFile) && (
                  <div className="p-3.5 rounded-2xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        첨부된 이미지 / 파일
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAttachedImage('');
                          setAttachedFile(null);
                        }}
                        className="text-[11px] font-semibold text-red-500 hover:underline"
                      >
                        전체 첨부 해제
                      </button>
                    </div>

                    <div className="flex flex-wrap items-start gap-3">
                      {attachedImage && (
                        <div className="relative p-2 rounded-xl bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark">
                          <img
                            src={attachedImage}
                            alt="첨부 이미지"
                            className="max-h-36 rounded-lg object-contain"
                          />
                          <button
                            type="button"
                            onClick={() => setAttachedImage('')}
                            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-zinc-800 text-white text-[10px] font-bold grid place-items-center shadow"
                            title="첨부 이미지 제거"
                          >
                            ✕
                          </button>
                        </div>
                      )}

                      {attachedFile && (
                        <div className="relative flex-1 min-w-[240px] p-3 rounded-xl bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-9 h-9 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0">
                              <IconFile />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-zinc-900 dark:text-gray-100 truncate">
                                  {attachedFile.name}
                                </span>
                                {attachedFile.size > 0 && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted-light dark:bg-muted-dark text-zinc-500 shrink-0">
                                    {formatFileSize(attachedFile.size)}
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                                {attachedFile.path}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAttachedFile(null)}
                            className="w-6 h-6 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-muted-light dark:hover:bg-muted-dark grid place-items-center shrink-0"
                            title="첨부 파일 제거"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center pt-3.5 border-t border-line-light dark:border-line-dark mt-1 gap-2.5 relative z-50">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
                    <CustomSelect
                      value={category}
                      onChange={setCategory}
                      options={CATEGORIES}
                      onOpenChange={setIsSelectOpen}
                      isSmall={true}
                    />
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="#태그 입력 (쉼표로 구분)"
                      className="flex-1 bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark text-zinc-800 dark:text-zinc-200 px-3 py-2 rounded-xl text-xs font-medium outline-none focus:border-blue-600"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    {(hasInputFocusOrContent || isFocusMode) && (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="px-3 py-2 rounded-xl text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                      >
                        초기화
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsFocusMode(!isFocusMode)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                        isFocusMode
                          ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 border-blue-600/30'
                          : 'bg-muted-light dark:bg-muted-dark text-zinc-600 dark:text-zinc-300 border-line-light dark:border-line-dark hover:border-zinc-400'
                      }`}
                    >
                      {isFocusMode ? '목록 보기' : '집중 모드'}
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition-colors"
                    >
                      저장하기
                    </button>
                  </div>
                </div>
              </form>
            </section>
          ) : (
            <MonitorPanel
              isMonitoring={isMonitoring}
              onToggleMonitor={handleToggleMonitor}
              onCaptureNow={() => captureClipboardNow(false)}
              clipboardStatus={clipboardStatus}
              detectedClipboard={detectedClipboard}
              onSaveDetected={handleSaveDetectedToNotes}
              tempQueue={tempQueue}
              onSaveTempItem={handleSaveTempItem}
              onSaveAllTemp={handleSaveAllTemp}
              onDeleteTempItem={handleDeleteTempItem}
              onClearExpiredTemp={handleClearExpiredTemp}
              onOpenFilePath={handleOpenFilePath}
              onShowFileInFolder={handleShowFileInFolder}
            />
          )}

          {/* ================= 유형별 모아보기 칸 (전체 / 텍스트 / 이미지 / 파일 / 링크) ================= */}
          {!(isFocusMode && workspace === 'composer') && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                {CONTENT_TYPE_TABS.map((tab) => {
                  const active = contentTypeTab === tab.id;
                  const count = contentTypeCounts[tab.id] || 0;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setContentTypeTab(tab.id)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border transition-colors ${
                        active
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-surface-light dark:bg-surface-dark text-zinc-700 dark:text-zinc-300 border-line-light dark:border-line-dark hover:bg-muted-light dark:hover:bg-muted-dark'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`text-[11px] px-1.5 py-0.2 rounded-md font-extrabold ${
                          active
                            ? 'bg-white/20 text-white'
                            : 'bg-muted-light dark:bg-muted-dark text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium px-1">
                표시 중 {filteredAndSortedNotes.length}개
              </span>
            </div>
          )}

          {/* ================= Bento UI 노트 & 클립 카드 그리드 ================= */}
          <section
            className={`transition-opacity duration-300 pb-16 ${
              isFocusMode && workspace === 'composer'
                ? 'opacity-0 pointer-events-none max-h-0 overflow-hidden'
                : formActiveState
                ? 'opacity-45'
                : 'opacity-100'
            }`}
          >
            {filteredAndSortedNotes.length === 0 ? (
              <div className="bg-surface-light/60 dark:bg-surface-dark/60 border border-dashed border-line-light dark:border-line-dark rounded-[20px] py-16 px-6 text-center text-zinc-400">
                <p className="text-sm font-bold text-zinc-600 dark:text-zinc-300">
                  표시할 노트나 클립이 없습니다.
                </p>
                <p className="text-xs mt-1 text-zinc-400">
                  위 입력창에서 새 노트를 작성하거나 이미지·파일을 첨부, 또는 클립보드 자동 감지를 시작해 보세요.
                </p>
              </div>
            ) : (
              <div
                className={
                  viewLayout === 'grid'
                    ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5'
                    : 'flex flex-col gap-3'
                }
              >
                {filteredAndSortedNotes.map((note, idx) => (
                  <article
                    key={note.id}
                    onClick={() => handleOpenView(note)}
                    style={{ animationDelay: `${Math.min(idx * 0.02, 0.2)}s` }}
                    className={`animate-list-item group bg-surface-light dark:bg-surface-dark flex flex-col justify-between p-5 rounded-2xl border transition-all duration-150 cursor-pointer hover:-translate-y-0.5 hover:shadow-md ${
                      note.pinned
                        ? 'border-l-[3px] border-l-blue-600 border-t-line-light border-r-line-light border-b-line-light dark:border-t-line-dark dark:border-r-line-dark dark:border-b-line-dark'
                        : 'border-line-light dark:border-line-dark hover:border-zinc-300 dark:hover:border-zinc-600'
                    }`}
                  >
                    <div>
                      {/* 카드 헤더: 절제된 톤온톤 카테고리 배지 + 제목 + 고정 핀 */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-2 py-0.5 rounded-md bg-muted-light dark:bg-muted-dark text-zinc-600 dark:text-zinc-300 text-[11px] font-semibold border border-line-light dark:border-line-dark">
                              {note.category || CATEGORIES[0]}
                            </span>
                            {note.fileInfo?.path && (
                              <span className="px-2 py-0.5 rounded-md bg-blue-600/10 text-blue-600 dark:text-blue-400 text-[10px] font-bold">
                                📎 파일
                              </span>
                            )}
                            {note.pinned && (
                              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">
                                📌 고정됨
                              </span>
                            )}
                          </div>
                          <h3 className="font-bold text-[15px] text-zinc-900 dark:text-gray-100 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-snug">
                            {note.title || '제목 없음'}
                          </h3>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => handleTogglePin(note.id, e)}
                          className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 transition-colors ${
                            note.pinned
                              ? 'text-blue-600 dark:text-blue-400 bg-blue-600/10'
                              : 'text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-muted-light dark:hover:bg-muted-dark hover:text-zinc-700 dark:hover:text-zinc-200'
                          }`}
                          title={note.pinned ? '고정 해제' : '상단 고정'}
                        >
                          <IconPin filled={note.pinned} />
                        </button>
                      </div>

                      {/* 통일된 높이의 이미지 썸네일 컨테이너 */}
                      {note.imageDataUrl && (
                        <div className="w-full h-36 rounded-xl bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark mb-2.5 overflow-hidden flex items-center justify-center">
                          <img
                            src={note.imageDataUrl}
                            alt="클립 이미지"
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                      )}

                      {/* 첨부 파일 전용 칸 */}
                      {note.fileInfo?.path && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="p-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark mb-2.5 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0">
                              <IconFile />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-bold text-zinc-800 dark:text-gray-100 truncate">
                                {note.fileInfo.name}
                              </span>
                              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                                {note.fileInfo.size > 0
                                  ? `${formatFileSize(note.fileInfo.size)} · `
                                  : ''}
                                {note.fileInfo.path}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => handleOpenFilePath(note.fileInfo.path, e)}
                              className="px-2 py-1 rounded-md bg-surface-light dark:bg-surface-dark hover:bg-blue-600 hover:text-white text-zinc-700 dark:text-zinc-200 text-[11px] font-bold border border-line-light dark:border-line-dark transition-colors"
                              title="파일 실행/열기"
                            >
                              열기
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleShowFileInFolder(note.fileInfo.path, e)}
                              className="p-1 rounded-md bg-surface-light dark:bg-surface-dark hover:bg-muted-light dark:hover:bg-muted-dark text-zinc-600 dark:text-zinc-300 border border-line-light dark:border-line-dark transition-colors"
                              title="폴더에서 보기"
                            >
                              <IconFolder />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* 본문 요약 (WCAG 고대비 보조 텍스트) */}
                      <p className="text-xs sm:text-[13px] text-zinc-600 dark:text-gray-400 line-clamp-3 whitespace-pre-wrap break-words leading-relaxed mb-3">
                        {note._plainText || (note.imageDataUrl ? '이미지 클립입니다.' : '')}
                      </p>

                      {/* 절제된 무채색/단일톤 해시태그 */}
                      {note.tags && note.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {note.tags.map((tag) => (
                            <span
                              key={tag}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSearchQuery(tag);
                              }}
                              className="px-2 py-0.5 rounded-md bg-muted-light dark:bg-muted-dark text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 text-[11px] font-medium transition-colors"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 카드 푸터: 메타 정보 & 깔끔한 버튼 위계 */}
                    <div className="pt-2.5 border-t border-line-light dark:border-line-dark flex items-center justify-between gap-2">
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium truncate">
                        {formatCreatedDate(note)} · 복사 {note.copied || 0}회
                      </span>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleCopyNote(note, e)}
                          className="py-1.5 px-2.5 rounded-lg bg-muted-light dark:bg-muted-dark hover:bg-blue-600 text-zinc-700 dark:text-zinc-200 hover:text-white text-xs font-semibold flex items-center gap-1 border border-line-light dark:border-line-dark transition-colors"
                          title="클립보드에 복사"
                        >
                          <IconCopy />
                          <span>복사</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleOpenEdit(note, e)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-800 dark:hover:text-white hover:bg-muted-light dark:hover:bg-muted-dark transition-colors"
                          title="편집"
                        >
                          <IconEdit />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteNote(note.id, e)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-red-600 transition-colors"
                          title="삭제"
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      {/* ================= 아티클 스타일 상세 보기 모달 (Reader View) ================= */}
      {viewingNote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/55 backdrop-blur-md"
          onClick={() => setViewingNote(null)}
        >
          <div
            className="bg-surface-light dark:bg-surface-dark w-full max-w-3xl max-h-[88vh] rounded-[20px] shadow-2xl flex flex-col overflow-hidden animate-modal border border-line-light dark:border-line-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-7 py-4 border-b border-line-light dark:border-line-dark bg-canvas-light/60 dark:bg-canvas-dark/60">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-md bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark text-zinc-700 dark:text-zinc-300 text-xs font-bold">
                  {viewingNote.category || CATEGORIES[0]}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  작성: {formatCreatedDateTime(viewingNote)} · 복사 {viewingNote.copied || 0}회
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewingNote(null)}
                className="p-1.5 rounded-lg text-zinc-400 hover:bg-muted-light dark:hover:bg-muted-dark"
              >
                <IconClose />
              </button>
            </div>

            {/* 독서 최적화 컨테이너 (최대 줄 길이 68ch 중심) */}
            <div className="px-8 py-8 overflow-y-auto flex-1">
              <div className="max-w-[68ch] mx-auto flex flex-col gap-5">
                <h1 className="text-2xl sm:text-[28px] font-extrabold text-zinc-900 dark:text-white break-words leading-tight">
                  {viewingNote.title}
                </h1>

                {viewingNote.tags && viewingNote.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {viewingNote.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2.5 py-0.5 rounded-md bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark text-zinc-600 dark:text-zinc-300 text-xs font-semibold"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {viewingNote.imageDataUrl && (
                  <img
                    src={viewingNote.imageDataUrl}
                    alt="첨부 이미지"
                    className="max-h-96 object-contain rounded-xl bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark self-start"
                  />
                )}

                {viewingNote.fileInfo?.path && (
                  <div className="p-4 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0">
                        <IconFile />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                            {viewingNote.fileInfo.name}
                          </span>
                          {viewingNote.fileInfo.size > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded bg-muted-light dark:bg-muted-dark text-zinc-500 font-semibold shrink-0">
                              {formatFileSize(viewingNote.fileInfo.size)}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                          {viewingNote.fileInfo.path}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleOpenFilePath(viewingNote.fileInfo.path, e)}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs font-bold transition-colors"
                      >
                        파일 열기
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleShowFileInFolder(viewingNote.fileInfo.path, e)}
                        className="px-3 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark hover:bg-muted-light dark:hover:bg-muted-dark text-zinc-700 dark:text-zinc-200 text-xs font-semibold border border-line-light dark:border-line-dark transition-colors flex items-center gap-1"
                      >
                        <IconFolder />
                        <span>폴더 열기</span>
                      </button>
                    </div>
                  </div>
                )}

                <div
                  className="text-zinc-800 dark:text-gray-100 text-base leading-[1.75] whitespace-pre-wrap break-words pt-1"
                  dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(viewingNote.content) }}
                />
              </div>
            </div>

            <div className="px-7 py-3.5 border-t border-line-light dark:border-line-dark flex justify-end gap-2 bg-canvas-light/60 dark:bg-canvas-dark/60">
              <button
                type="button"
                onClick={(e) => handleCopyNote(viewingNote, e)}
                className="px-4 py-2 rounded-xl bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark text-zinc-800 dark:text-gray-100 text-xs font-bold flex items-center gap-1.5 hover:border-zinc-400"
              >
                <IconCopy />
                <span>클립보드 복사</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = viewingNote;
                  setViewingNote(null);
                  handleOpenEdit(target);
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold flex items-center gap-1.5 hover:bg-blue-700"
              >
                <IconEdit />
                <span>편집하기</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 편집 모달 (Edit Modal) ================= */}
      {editingNote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/55 backdrop-blur-md"
          onClick={requestCloseEditModal}
        >
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDropAttachment(e, true)}
            className="bg-surface-light dark:bg-surface-dark w-full max-w-3xl max-h-[90vh] rounded-[20px] shadow-2xl flex flex-col overflow-hidden animate-modal border border-line-light dark:border-line-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-7 py-4 border-b border-line-light dark:border-line-dark bg-canvas-light/60 dark:bg-canvas-dark/60">
              <h2 className="text-base font-extrabold text-zinc-900 dark:text-white flex items-center gap-2">
                <IconEdit /> 노트·클립 편집
              </h2>
              <button
                type="button"
                onClick={requestCloseEditModal}
                className="p-1.5 rounded-lg text-zinc-400 hover:bg-muted-light dark:hover:bg-muted-dark"
              >
                <IconClose />
              </button>
            </div>

            <div className="p-7 overflow-y-auto flex-1 flex flex-col gap-3.5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CustomSelect
                  value={editingNote.category || CATEGORIES[0]}
                  onChange={(v) => setEditingNote((prev) => ({ ...prev, category: v }))}
                  options={CATEGORIES}
                  onOpenChange={() => {}}
                  isSmall={true}
                />
                <div className="flex items-center gap-2">
                  <input
                    ref={editFileInputRef}
                    type="file"
                    onChange={(e) => handleImageFileSelect(e, true)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => handlePickNativeAttachment('image', true)}
                    className="px-3 py-1.5 rounded-xl bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-semibold flex items-center gap-1.5 hover:bg-zinc-200/70 dark:hover:bg-white/10"
                  >
                    <IconImage />
                    <span>이미지 추가/변경</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePickNativeAttachment('any', true)}
                    className="px-3 py-1.5 rounded-xl bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-semibold flex items-center gap-1.5 hover:bg-zinc-200/70 dark:hover:bg-white/10"
                  >
                    <IconPaperclip />
                    <span>파일 첨부/변경</span>
                  </button>
                </div>
              </div>

              <FormattingBar
                editorRef={editEditorRef}
                onFormatChange={(html) => setEditingNote((prev) => ({ ...prev, content: html }))}
              />

              <input
                type="text"
                placeholder="제목"
                value={editingNote.title}
                onChange={(e) => setEditingNote((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full bg-transparent text-xl sm:text-2xl font-extrabold text-zinc-900 dark:text-white outline-none px-1"
              />

              <input
                type="text"
                placeholder="#태그 입력 (쉼표로 구분)"
                value={editingTagsInput}
                onChange={(e) => setEditingTagsInput(e.target.value)}
                className="w-full bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark px-3.5 py-2 rounded-xl text-xs font-medium text-zinc-800 dark:text-gray-200 outline-none focus:border-blue-600"
              />

              {editingNote.imageDataUrl && (
                <div className="relative self-start p-2 rounded-xl bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark">
                  <img
                    src={editingNote.imageDataUrl}
                    alt="첨부 이미지"
                    className="max-h-44 object-contain rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setEditingNote((prev) => ({ ...prev, imageDataUrl: '' }))}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-zinc-800 text-white text-[10px] font-bold grid place-items-center"
                  >
                    ✕
                  </button>
                </div>
              )}

              {editingNote.fileInfo && (
                <div className="p-3 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0">
                      <IconFile />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                        {editingNote.fileInfo.name}
                      </span>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {editingNote.fileInfo.path}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingNote((prev) => ({ ...prev, fileInfo: null }))}
                    className="px-2.5 py-1 rounded-lg bg-muted-light dark:bg-muted-dark hover:bg-red-600 hover:text-white text-zinc-500 text-xs font-bold transition-colors shrink-0"
                  >
                    첨부 제거
                  </button>
                </div>
              )}

              <div
                ref={editEditorRef}
                contentEditable
                suppressContentEditableWarning
                data-placeholder="내용"
                className="w-full bg-transparent text-zinc-800 dark:text-gray-100 min-h-[28vh] text-base pt-2 px-1 leading-[1.75]"
                onInput={(e) =>
                  setEditingNote((prev) => ({ ...prev, content: e.currentTarget.innerHTML }))
                }
                onPaste={(e) =>
                  handleSafePaste(
                    e,
                    editEditorRef,
                    (html) => setEditingNote((prev) => ({ ...prev, content: html })),
                    true
                  )
                }
              />
            </div>

            <div className="px-7 py-3.5 border-t border-line-light dark:border-line-dark flex justify-end gap-2 bg-canvas-light/60 dark:bg-canvas-dark/60">
              <button
                type="button"
                onClick={requestCloseEditModal}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-500 hover:bg-muted-light dark:hover:bg-muted-dark"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm"
              >
                수정 완료
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
