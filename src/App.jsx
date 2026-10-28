import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CATEGORIES, FILTER_CATEGORIES } from './constants';
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
  IconImage
} from './components/Icons';
import { CustomSelect } from './components/CustomSelect';
import { FormattingBar } from './components/FormattingBar';
import { LicenseLockModal } from './components/LicenseLockModal';
import { MonitorPanel, getTempTimeInfo } from './components/MonitorPanel';

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
  if (payload.imageDataUrl) {
    return `image:${payload.imageDataUrl.slice(0, 140)}:${payload.imageDataUrl.length}`;
  }
  return `text:${payload.content || ''}`;
}

export default function App() {
  const [notes, setNotes] = useState([]);
  const [tempQueue, setTempQueue] = useState([]);
  const [copyLog, setCopyLog] = useState({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [corruptWarning, setCorruptWarning] = useState(null);
  const [statusBanner, setStatusBanner] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [appVersion, setAppVersion] = useState('1.2.0');

  // Settings & Lock State
  const [isDark, setIsDark] = useState(true);
  const [blurEnabled, setBlurEnabled] = useState(true);
  const [licenseLockEnabled, setLicenseLockEnabled] = useState(false);
  const [licenseActivated, setLicenseActivated] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // Workspace & Composer State
  const [workspace, setWorkspace] = useState('composer'); // 'composer' | 'monitor'
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [tagsInput, setTagsInput] = useState('');
  const [attachedImage, setAttachedImage] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState(FILTER_CATEGORIES[0]);
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
  const fileInputRef = useRef(null);
  const editFileInputRef = useRef(null);
  const saveTimerRef = useRef(null);
  const lastClipboardSigRef = useRef('');

  const showToast = useCallback((message, type = 'info') => {
    setStatusBanner({ message, type });
    setTimeout(() => {
      setStatusBanner((prev) => (prev && prev.message === message ? null : prev));
    }, 3500);
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
        const initialBlur = res.data?.settings?.blurEnabled ?? (legacyBlur ?? true);
        const initialLockEnabled = res.data?.settings?.licenseLockEnabled ?? false;
        const initialLockActivated = res.data?.settings?.licenseActivated ?? true;
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
              licenseLockEnabled: initialLockEnabled,
              licenseActivated: initialLockActivated
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
            content: normalizeContentToSafeHtml(n.content || '')
          }));
        }

        setNotes(initialNotes);
        setTempQueue(initialTempQueue);
        setCopyLog(initialCopyLog);
        setIsDark(initialDark);
        setBlurEnabled(initialBlur);
        setLicenseLockEnabled(initialLockEnabled);
        setLicenseActivated(initialLockEnabled ? initialLockActivated : true);

        if (
          initialDraft &&
          (initialDraft.title ||
            getPlainText(initialDraft.content) ||
            initialDraft.imageDataUrl ||
            initialDraft.tagsInput)
        ) {
          setTitle(initialDraft.title || '');
          const safeDraftHtml = normalizeContentToSafeHtml(initialDraft.content || '');
          setContent(safeDraftHtml);
          setCategory(initialDraft.category || CATEGORIES[0]);
          setTagsInput(initialDraft.tagsInput || '');
          setAttachedImage(initialDraft.imageDataUrl || '');
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
      nextLockEnabled,
      nextLockActivated,
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
          licenseLockEnabled: nextLockEnabled,
          licenseActivated: nextLockActivated
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
      title.trim() || getPlainText(content).trim() || attachedImage || tagsInput.trim()
        ? {
            title,
            content: sanitizeNoteHtml(content),
            category,
            tagsInput,
            imageDataUrl: attachedImage
          }
        : null;

    saveTimerRef.current = setTimeout(() => {
      persistPayload(
        notes,
        tempQueue,
        copyLog,
        isDark,
        blurEnabled,
        licenseLockEnabled,
        licenseActivated,
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
    licenseLockEnabled,
    licenseActivated,
    title,
    content,
    category,
    tagsInput,
    attachedImage,
    isLoaded,
    corruptWarning,
    persistPayload
  ]);

  // 4. 클립보드 감지 및 72시간 임시 큐 추가
  const addToTempQueue = useCallback(
    (payload) => {
      setTempQueue((prev) => {
        const sig = buildClipboardSignature(payload);
        const exists = prev.some((item) => buildClipboardSignature(item) === sig);
        if (exists) return prev;
        const newItem = {
          id: generateId(),
          kind: payload.kind,
          title: payload.title || (payload.kind === 'image' ? '클립보드 이미지' : '클립보드 텍스트'),
          content: payload.content || '',
          imageDataUrl: payload.imageDataUrl || '',
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
        setClipboardStatus('클립보드를 읽는 중 오류가 발생했습니다.');
        return;
      }
      if (!res.payload) {
        if (!silentIfSame) {
          setClipboardStatus('클립보드에서 텍스트나 이미지를 찾지 못했습니다.');
        }
        return;
      }

      const sig = buildClipboardSignature(res.payload);
      if (sig !== lastClipboardSigRef.current) {
        lastClipboardSigRef.current = sig;
        setDetectedClipboard(res.payload);
        setClipboardStatus('새로운 클립보드 항목을 감지했습니다 ✓');
        addToTempQueue(res.payload);
      } else if (!silentIfSame) {
        setClipboardStatus('현재 클립보드는 마지막으로 감지한 내용과 같습니다.');
      }
    },
    [addToTempQueue]
  );

  useEffect(() => {
    if (!isMonitoring) return;
    captureClipboardNow(true);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        captureClipboardNow(true);
      }
    }, 2200);
    return () => clearInterval(id);
  }, [isMonitoring, captureClipboardNow]);

  const handleToggleMonitor = () => {
    setIsMonitoring((prev) => {
      const next = !prev;
      setClipboardStatus(
        next
          ? '클립보드 실시간 감지를 시작했습니다. (Ctrl+C 복사 시 자동 수집)'
          : '클립보드 감지가 일시정지되었습니다.'
      );
      return next;
    });
  };

  const handleSaveDetectedToNotes = (rawTags) => {
    if (!detectedClipboard) {
      showToast('저장할 감지 항목이 없습니다.', 'info');
      return;
    }
    const now = new Date();
    const nowMs = now.getTime();
    const isImg = detectedClipboard.kind === 'image';
    const safeHtml = isImg
      ? escapePlainTextToHtml(detectedClipboard.content || '')
      : escapePlainTextToHtml(detectedClipboard.content || '');

    const newNote = {
      id: generateId(),
      title: detectedClipboard.title || (isImg ? '클립보드 이미지' : '클립보드 텍스트'),
      content: safeHtml,
      category: isImg ? '🖼️ 이미지' : '🎈 개인',
      tags: parseTagsInput(rawTags),
      pinned: false,
      copied: 0,
      imageDataUrl: detectedClipboard.imageDataUrl || '',
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
    showToast('감지된 클립을 노트에 저장했습니다 ✓', 'success');
  };

  const handleSaveTempItem = (tempId) => {
    const target = tempQueue.find((item) => item.id === tempId);
    if (!target) return;
    const now = new Date();
    const nowMs = now.getTime();
    const isImg = target.kind === 'image';
    const newNote = {
      id: generateId(),
      title: target.title,
      content: escapePlainTextToHtml(target.content || ''),
      category: isImg ? '🖼️ 이미지' : '🎈 개인',
      tags: ['클립보드'],
      pinned: false,
      copied: 0,
      imageDataUrl: target.imageDataUrl || '',
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
      category: target.kind === 'image' ? '🖼️ 이미지' : '🎈 개인',
      tags: ['클립보드'],
      pinned: false,
      copied: 0,
      imageDataUrl: target.imageDataUrl || '',
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

  // 5. 원클릭 클립보드 복사 (텍스트 & 이미지 지원 + 오늘의 복사 횟수 통계)
  const handleCopyNote = async (note, e) => {
    if (e) e.stopPropagation();
    const plain = getPlainText(note.content);
    let copiedOk = false;

    if (api && api.writeSystemClipboard) {
      const res = await api.writeSystemClipboard({
        text: plain,
        imageDataUrl: note.imageDataUrl || ''
      });
      copiedOk = Boolean(res?.ok);
    }

    if (!copiedOk && plain) {
      try {
        await navigator.clipboard.writeText(plain);
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

  const handleTogglePin = (id, e) => {
    if (e) e.stopPropagation();
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)));
  };

  // 6. 이미지 파일 선택 & 에디터 이미지 붙여넣기
  const handleImageFileSelect = (e, isEdit = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('이미지 파일만 첨부할 수 있습니다.', 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('이미지 크기는 15MB 이하여야 합니다.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result;
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        if (isEdit) {
          setEditingNote((prev) => (prev ? { ...prev, imageDataUrl: dataUrl } : prev));
        } else {
          setAttachedImage(dataUrl);
          if (category === CATEGORIES[0]) setCategory('🖼️ 이미지');
        }
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSafePaste = (e, targetEditorRef, onUpdateContent, isEdit = false) => {
    const clipboard = e.clipboardData;
    if (!clipboard) return;

    // 클립보드에 이미지가 들어있는 경우 이미지 첨부 처리
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

  // 7. 편집 모달 세팅 및 닫기 보호
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
      if (e.key === 'Escape') {
        if (editingNote) {
          requestCloseEditModal();
        } else if (viewingNote) {
          setViewingNote(null);
        } else if (showSettings) {
          setShowSettings(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingNote, viewingNote, showSettings, requestCloseEditModal]);

  // 8. 노트 추가 / 수정 / 삭제
  const resetForm = () => {
    setTitle('');
    setContent('');
    setCategory(CATEGORIES[0]);
    setTagsInput('');
    setAttachedImage('');
    if (mainEditorRef.current) mainEditorRef.current.innerHTML = '';
    setIsInputFocused(false);
    setIsSelectOpen(false);
  };

  const handleAddNote = (e) => {
    e.preventDefault();
    const rawHtmlContent = mainEditorRef.current ? mainEditorRef.current.innerHTML : content;
    const safeHtmlContent = sanitizeNoteHtml(rawHtmlContent);
    const plain = getPlainText(safeHtmlContent);
    if (!title.trim() && !plain.trim() && !attachedImage) return;

    const now = new Date();
    const nowMs = now.getTime();
    const newNote = {
      id: generateId(),
      title: title.trim() || (attachedImage ? '이미지 노트' : plain.slice(0, 30)),
      content: safeHtmlContent,
      category,
      tags: parseTagsInput(tagsInput),
      pinned: false,
      copied: 0,
      imageDataUrl: attachedImage,
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
      content: normalizeContentToSafeHtml(note.content)
    });
  };

  const handleSaveEdit = () => {
    if (!editingNote) return;
    const rawHtmlContent = editEditorRef.current ? editEditorRef.current.innerHTML : editingNote.content;
    const safeHtmlContent = sanitizeNoteHtml(rawHtmlContent);
    const plain = getPlainText(safeHtmlContent);
    if (!editingNote.title.trim() && !plain.trim() && !editingNote.imageDataUrl) return;

    const now = new Date();
    const updatedNote = {
      ...editingNote,
      title: editingNote.title.trim(),
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

  // 9. 라이센스 잠금 검증
  const handleVerifyLicense = async (inputCode) => {
    if (api && api.verifyLicense) {
      const res = await api.verifyLicense(inputCode);
      if (res?.ok) {
        setLicenseActivated(true);
        showToast('라이센스 인증이 완료되었습니다 ✓', 'success');
        return true;
      }
      return false;
    }
    return false;
  };

  const handleLockNow = () => {
    setLicenseLockEnabled(true);
    setLicenseActivated(false);
    setShowSettings(false);
  };

  // 10. 백업 내보내기 / 가져오기
  const handleExportBackup = async () => {
    if (!api) return;
    const res = await api.exportNotes({
      notes,
      tempQueue,
      copyLog,
      settings: { isDark, blurEnabled, licenseLockEnabled, licenseActivated }
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

  // 11. 통계 및 필터링 계산
  const todayCopyCount = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return copyLog[todayKey] || 0;
  }, [copyLog]);

  const pinnedNotesCount = useMemo(() => notes.filter((n) => n.pinned).length, [notes]);

  const plainDraftContent = useMemo(() => getPlainText(content), [content]);
  const hasInputFocusOrContent =
    isInputFocused ||
    isSelectOpen ||
    title.trim().length > 0 ||
    plainDraftContent.length > 0 ||
    Boolean(attachedImage);
  const formActiveState = blurEnabled && workspace === 'composer' && hasInputFocusOrContent;

  const notesWithPlainCache = useMemo(() => {
    return notes.map((note) => ({
      ...note,
      tags: Array.isArray(note.tags) ? note.tags : [],
      _plainText: getPlainText(note.content),
      _safeHtml: normalizeContentToSafeHtml(note.content)
    }));
  }, [notes]);

  const filteredAndSortedNotes = useMemo(() => {
    const sl = searchQuery.trim().toLowerCase();
    return notesWithPlainCache
      .filter((note) => {
        if (pinnedOnly && !note.pinned) return false;
        const mc =
          filterCategory === FILTER_CATEGORIES[0] || note.category === filterCategory;
        if (!mc) return false;
        if (!sl) return true;

        const t = (note.title || '').toLowerCase();
        const c = (note._plainText || '').toLowerCase();
        const tg = (note.tags || []).join(' ').toLowerCase();
        return t.includes(sl) || c.includes(sl) || tg.includes(sl);
      })
      .sort((a, b) => {
        // 상단 고정(Pinned) 항목 우선 정렬
        if (Boolean(b.pinned) !== Boolean(a.pinned)) {
          return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        }
        return sortOrder === '최신순' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
      });
  }, [notesWithPlainCache, searchQuery, filterCategory, pinnedOnly, sortOrder]);

  const isLocked = licenseLockEnabled && !licenseActivated;

  return (
    <>
      {/* 상단 드래그 타이틀바 영역 */}
      <div className="drag-titlebar" />

      {/* 라이센스 잠금 모달 */}
      <LicenseLockModal isLocked={isLocked} onVerify={handleVerifyLicense} />

      {/* 토스트 알림 */}
      {statusBanner && (
        <div
          className={`fixed bottom-6 right-6 z-[9999] px-5 py-3.5 rounded-2xl shadow-2xl border text-sm font-bold animate-[slideUpFade_0.25s_ease-out] ${
            statusBanner.type === 'error'
              ? 'bg-red-600 text-white border-red-500'
              : statusBanner.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500'
              : 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-700'
          }`}
        >
          {statusBanner.message}
        </div>
      )}

      {/* 전체 앱 쉘 (TREECLIP 좌측 사이드바 + 우측 메인 워크스페이스) */}
      <div
        className={`w-[min(1440px,calc(100%-36px))] mx-auto pt-10 pb-8 min-h-screen grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-5 relative z-10 transition-all ${
          isLocked ? 'blur-lg pointer-events-none select-none' : ''
        }`}
      >
        {/* ================= 좌측 사이드바 (Sidebar) ================= */}
        <aside className="bg-white/80 dark:bg-[#1C1C21]/90 backdrop-blur-2xl border border-gray-200/70 dark:border-samsung-border rounded-3xl p-6 shadow-xl flex flex-col gap-6 lg:sticky lg:top-10 lg:self-start">
          {/* 브랜드 헤더 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-samsung-blue to-purple-600 text-white grid place-items-center shadow-md shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                  Smart Note & Clip
                </span>
                <h1 className="text-xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-samsung-blue to-purple-500">
                  나무 노트
                </h1>
              </div>
            </div>

            {/* 설정 버튼 */}
            <div className="relative no-drag">
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className="p-2.5 rounded-xl bg-gray-100/80 dark:bg-[#2A2A30] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#35353D] transition-all"
                title="환경 설정"
              >
                <IconSettings />
              </button>
              {showSettings && (
                <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} />
              )}
              {showSettings && (
                <div className="absolute left-0 lg:left-auto lg:right-0 top-[115%] w-[300px] bg-white/95 dark:bg-[#25252B]/95 backdrop-blur-2xl border border-gray-200/70 dark:border-gray-700 rounded-2xl shadow-2xl z-50 p-5 animate-[slideDown_0.2s_ease-out] flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-gray-900 dark:text-gray-100 text-sm flex items-center gap-2">
                      <IconSettings /> 환경 설정
                    </h3>
                    <span className="text-xs font-bold text-gray-400">v{appVersion}</span>
                  </div>

                  {/* 배경 흐림 토글 */}
                  <div className="flex justify-between items-center bg-gray-50 dark:bg-black/25 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                        작성 집중 흐림 효과
                      </span>
                      <span className="text-[11px] text-gray-400">작성 중 아래 목록 아웃포커싱</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBlurEnabled(!blurEnabled)}
                      className={`w-11 h-6 rounded-full transition-colors relative ${
                        blurEnabled ? 'bg-samsung-blue' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${
                          blurEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* 라이센스 잠금 토글 */}
                  <div className="flex flex-col gap-2 bg-gray-50 dark:bg-black/25 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                    <div className="flex justify-between items-center">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                          시작 시 라이센스 잠금
                        </span>
                        <span className="text-[11px] text-gray-400">코드 입력 후 앱 열기</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLicenseLockEnabled(!licenseLockEnabled)}
                        className={`w-11 h-6 rounded-full transition-colors relative ${
                          licenseLockEnabled ? 'bg-samsung-blue' : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${
                            licenseLockEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleLockNow}
                      className="w-full py-1.5 rounded-lg bg-gray-200/80 dark:bg-[#2F2F37] hover:bg-samsung-blue hover:text-white text-gray-700 dark:text-gray-200 text-xs font-bold transition-colors"
                    >
                      🔒 지금 화면 잠그기
                    </button>
                  </div>

                  {/* 백업 내보내기 / 가져오기 */}
                  {api && (
                    <>
                      <div className="bg-gray-50 dark:bg-black/25 p-3 rounded-xl border border-gray-100 dark:border-gray-800 flex flex-col gap-2">
                        <span className="text-[11px] font-bold text-gray-400">
                          데이터 백업 및 복원
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleExportBackup}
                            className="flex-1 py-2 px-3 rounded-lg bg-white dark:bg-[#2A2A30] hover:bg-gray-100 dark:hover:bg-[#35353D] text-xs font-bold border border-gray-200 dark:border-gray-700"
                          >
                            내보내기
                          </button>
                          <button
                            type="button"
                            onClick={handleImportBackup}
                            className="flex-1 py-2 px-3 rounded-lg bg-white dark:bg-[#2A2A30] hover:bg-gray-100 dark:hover:bg-[#35353D] text-xs font-bold border border-gray-200 dark:border-gray-700"
                          >
                            가져오기
                          </button>
                        </div>
                      </div>

                      <div className="bg-gray-50 dark:bg-black/25 p-3 rounded-xl border border-gray-100 dark:border-gray-800 flex justify-between items-center">
                        <span className="text-[11px] font-bold text-gray-400">자동 업데이트</span>
                        <button
                          type="button"
                          onClick={handleManualUpdateCheck}
                          className="py-1.5 px-3 rounded-lg bg-samsung-blue/15 text-samsung-blue dark:text-blue-400 text-xs font-bold hover:bg-samsung-blue/25"
                        >
                          업데이트 확인
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 워크스페이스 스위처 (직접 작성 vs 클립보드 자동 감지) */}
          <nav className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-1">
              워크스페이스
            </span>
            <button
              type="button"
              onClick={() => setWorkspace('composer')}
              className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-3 transition-all ${
                workspace === 'composer'
                  ? 'bg-samsung-blue/15 text-samsung-blue dark:text-blue-400 border border-samsung-blue/25 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5'
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              <span>노트·클립 직접 작성</span>
            </button>

            <button
              type="button"
              onClick={() => setWorkspace('monitor')}
              className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center justify-between transition-all ${
                workspace === 'monitor'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 text-[11px] font-extrabold">
                    {tempQueue.length}
                  </span>
                )}
              </div>
            </button>
          </nav>

          {/* 통계 대시보드 (전체 / 고정 / 오늘 복사) */}
          <section className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-1">
              통계
            </span>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-100/70 dark:bg-white/5 rounded-2xl py-3 px-2 flex flex-col items-center">
                <span className="text-xl font-extrabold text-samsung-blue dark:text-blue-400">
                  {notes.length}
                </span>
                <span className="text-[11px] font-bold text-gray-400 mt-0.5">전체</span>
              </div>
              <div className="bg-gray-100/70 dark:bg-white/5 rounded-2xl py-3 px-2 flex flex-col items-center">
                <span className="text-xl font-extrabold text-purple-500 dark:text-purple-400">
                  {pinnedNotesCount}
                </span>
                <span className="text-[11px] font-bold text-gray-400 mt-0.5">고정</span>
              </div>
              <div className="bg-gray-100/70 dark:bg-white/5 rounded-2xl py-3 px-2 flex flex-col items-center">
                <span className="text-xl font-extrabold text-emerald-500 dark:text-emerald-400">
                  {todayCopyCount}
                </span>
                <span className="text-[11px] font-bold text-gray-400 mt-0.5">오늘 복사</span>
              </div>
            </div>
          </section>

          {/* 카테고리 필터 칩 */}
          <section className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-1">
              카테고리 필터
            </span>
            <div className="flex flex-wrap gap-1.5">
              {FILTER_CATEGORIES.map((cat) => {
                const active = filterCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setFilterCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                      active
                        ? 'bg-samsung-blue text-white border-samsung-blue shadow-sm'
                        : 'bg-transparent text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-white/5'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 하단 다크모드 전환 버튼 */}
          <div className="mt-auto pt-2">
            <button
              type="button"
              onClick={() => setIsDark(!isDark)}
              className="w-full px-4 py-3 rounded-2xl bg-gray-100/80 dark:bg-white/5 hover:bg-gray-200/80 dark:hover:bg-white/10 border border-gray-200/60 dark:border-gray-700/60 text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center justify-center gap-2.5 transition-all"
            >
              {isDark ? <IconSun /> : <IconMoon />}
              <span>{isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}</span>
            </button>
          </div>
        </aside>

        {/* ================= 우측 메인 패널 (Main Panel) ================= */}
        <main className="flex flex-col gap-4 min-w-0">
          {/* 손상 경고 배너 / 업데이트 배너 */}
          {corruptWarning && (
            <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/40 text-red-600 dark:text-red-300 text-xs font-bold flex justify-between items-center gap-3">
              <span>{corruptWarning}</span>
              <button
                type="button"
                onClick={() => setCorruptWarning(null)}
                className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-bold shrink-0"
              >
                확인
              </button>
            </div>
          )}

          {updateInfo && updateInfo.state === 'downloaded' && (
            <div className="p-4 rounded-2xl bg-samsung-blue/15 border border-samsung-blue/40 text-samsung-blue dark:text-blue-300 text-xs font-bold flex justify-between items-center gap-3">
              <span>{updateInfo.message}</span>
              <button
                type="button"
                onClick={() => api?.installUpdate()}
                className="px-4 py-2 rounded-xl bg-samsung-blue text-white text-xs font-bold hover:bg-blue-600 shrink-0"
              >
                지금 재시작하여 업데이트
              </button>
            </div>
          )}

          {/* 상단 검색 & 고정필터 & 정렬 툴바 */}
          <section className="bg-white/80 dark:bg-[#1C1C21]/90 backdrop-blur-xl px-5 py-3.5 rounded-2xl border border-gray-200/70 dark:border-samsung-border shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 min-w-[220px]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="제목, 본문 내용, #태그 검색..."
                className="w-full bg-transparent text-sm font-semibold text-gray-900 dark:text-white placeholder-gray-400 outline-none"
              />
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* 고정 항목만 보기 토글 */}
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={pinnedOnly}
                  onChange={(e) => setPinnedOnly(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`w-9 h-5 rounded-full transition-colors relative ${
                    pinnedOnly ? 'bg-samsung-blue' : 'bg-gray-300 dark:bg-gray-700'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-transform ${
                      pinnedOnly ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </div>
                <span>고정 항목만</span>
              </label>

              {/* 최신순 / 과거순 */}
              <button
                type="button"
                onClick={() => setSortOrder(sortOrder === '최신순' ? '과거순' : '최신순')}
                className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#2A2A30] text-gray-700 dark:text-gray-200 text-xs font-bold hover:bg-gray-200 dark:hover:bg-[#35353D] transition-colors flex items-center gap-1.5"
              >
                <span>{sortOrder}</span>
              </button>

              {/* 그리드 / 리스트 보기 전환 */}
              <div className="flex rounded-xl bg-gray-100 dark:bg-[#2A2A30] p-0.5">
                <button
                  type="button"
                  onClick={() => setViewLayout('grid')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                    viewLayout === 'grid'
                      ? 'bg-white dark:bg-samsung-blue text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500'
                  }`}
                >
                  카드형
                </button>
                <button
                  type="button"
                  onClick={() => setViewLayout('list')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                    viewLayout === 'list'
                      ? 'bg-white dark:bg-samsung-blue text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500'
                  }`}
                >
                  목록형
                </button>
              </div>
            </div>
          </section>

          {/* 워크스페이스 영역: 1) 노트/클립 리치 작성기 OR 2) 클립보드 자동 감지 패널 */}
          {workspace === 'composer' ? (
            <div className="flex flex-col relative z-30">
              <form
                onSubmit={handleAddNote}
                className="bg-white/85 dark:bg-[#1C1C21]/90 backdrop-blur-xl p-6 rounded-3xl shadow-lg border border-gray-200/70 dark:border-samsung-border flex flex-col gap-3 transition-all focus-within:ring-2 focus-within:ring-samsung-blue/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <input
                    type="text"
                    placeholder="제목 또는 클립 용도"
                    className="w-full bg-transparent text-gray-900 dark:text-white text-xl font-extrabold placeholder-gray-400 focus:outline-none px-1"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageFileSelect(e, false)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl bg-gray-100 dark:bg-[#2A2A30] hover:bg-gray-200 dark:hover:bg-[#35353D] text-gray-700 dark:text-gray-200 text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors"
                    title="이미지 파일 첨부"
                  >
                    <IconImage />
                    <span>이미지 첨부</span>
                  </button>
                </div>

                <FormattingBar editorRef={mainEditorRef} onFormatChange={(html) => setContent(html)} />

                <div
                  ref={mainEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="내용을 입력하거나 텍스트/이미지를 붙여넣으세요 (Ctrl+V)..."
                  className={`w-full bg-transparent text-gray-700 dark:text-gray-200 text-base px-2 transition-all ${
                    isFocusMode ? 'min-h-[45vh]' : 'min-h-[100px]'
                  }`}
                  onInput={(e) => setContent(e.currentTarget.innerHTML)}
                  onPaste={(e) => handleSafePaste(e, mainEditorRef, setContent, false)}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                />

                {/* 첨부된 이미지 미리보기 */}
                {attachedImage && (
                  <div className="relative self-start mt-1 p-2 rounded-2xl bg-gray-100 dark:bg-black/30 border border-gray-200 dark:border-gray-700">
                    <img
                      src={attachedImage}
                      alt="첨부 이미지"
                      className="max-h-44 rounded-xl object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setAttachedImage('')}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold grid place-items-center shadow-md"
                      title="첨부 이미지 제거"
                    >
                      ✕
                    </button>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center pt-4 border-t border-gray-100 dark:border-gray-800 mt-1 gap-3 relative z-50">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
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
                      placeholder="#태그 입력 (쉼표로 구분, 예: 메일, 응답)"
                      className="flex-1 bg-gray-100/80 dark:bg-[#2A2A30]/80 text-gray-800 dark:text-gray-200 px-3.5 py-2.5 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-samsung-blue"
                    />
                  </div>

                  <div className="flex gap-2">
                    {(hasInputFocusOrContent || isFocusMode) && (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      >
                        초기화
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsFocusMode(!isFocusMode)}
                      className="px-3.5 py-2.5 rounded-xl bg-gray-100 dark:bg-[#2A2A30] text-gray-600 dark:text-gray-300 text-xs font-bold hover:bg-gray-200 transition-colors"
                    >
                      {isFocusMode ? '목록 보기' : '집중 모드'}
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2.5 bg-gradient-to-r from-samsung-blue to-purple-600 hover:opacity-95 text-white rounded-xl text-xs font-bold shadow-md transition-all active:scale-95"
                    >
                      저장하기
                    </button>
                  </div>
                </div>
              </form>
            </div>
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
            />
          )}

          {/* ================= 노트 & 클립 카드 목록 ================= */}
          <section
            className={`transition-all duration-500 pb-16 ${
              isFocusMode && workspace === 'composer'
                ? 'opacity-0 pointer-events-none max-h-0 overflow-hidden'
                : formActiveState
                ? 'opacity-35 blur-[3px] scale-[0.99] pointer-events-none'
                : 'opacity-100 blur-0 scale-100'
            }`}
          >
            {filteredAndSortedNotes.length === 0 ? (
              <div className="bg-white/60 dark:bg-[#1C1C21]/60 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-3xl py-16 px-6 text-center text-gray-400">
                <p className="text-base font-bold">표시할 노트나 클립이 없습니다.</p>
                <p className="text-xs mt-1.5 opacity-80">
                  위에서 직접 작성하거나 [클립보드 자동 감지]를 켜서 복사한 항목을 수집해 보세요!
                </p>
              </div>
            ) : (
              <div
                className={
                  viewLayout === 'grid'
                    ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
                    : 'flex flex-col gap-3.5'
                }
              >
                {filteredAndSortedNotes.map((note, idx) => (
                  <article
                    key={note.id}
                    onClick={() => handleOpenView(note)}
                    style={{ animationDelay: `${Math.min(idx * 0.025, 0.25)}s` }}
                    className={`animate-list-item group flex flex-col justify-between p-5 rounded-3xl border transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg hover:-translate-y-0.5 ${
                      note.pinned
                        ? 'bg-gradient-to-br from-white to-blue-50/60 dark:from-[#22222A] dark:to-[#1E2235] border-samsung-blue/35'
                        : 'bg-white/85 dark:bg-[#1C1C21]/90 border-gray-200/70 dark:border-samsung-border'
                    }`}
                  >
                    <div>
                      {/* 카드 상단: 카테고리 + 제목 + 고정(Pin) 버튼 */}
                      <div className="flex items-start justify-between gap-2 mb-2.5">
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <span className="self-start px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-bold">
                            {note.category || CATEGORIES[0]}
                          </span>
                          <h3 className="font-extrabold text-base text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-samsung-blue dark:group-hover:text-blue-400 transition-colors">
                            {note.title || '제목 없음'}
                          </h3>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => handleTogglePin(note.id, e)}
                          className={`w-8 h-8 rounded-xl border grid place-items-center shrink-0 transition-all ${
                            note.pinned
                              ? 'bg-samsung-blue/15 text-samsung-blue dark:text-blue-400 border-samsung-blue/30'
                              : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:text-samsung-blue hover:border-samsung-blue'
                          }`}
                          title={note.pinned ? '고정 해제' : '상단 고정'}
                        >
                          <IconPin filled={note.pinned} />
                        </button>
                      </div>

                      {/* 첨부 이미지 썸네일 */}
                      {note.imageDataUrl && (
                        <img
                          src={note.imageDataUrl}
                          alt="클립 이미지"
                          className="w-full max-h-40 object-contain rounded-2xl bg-black/5 dark:bg-black/30 border border-gray-200/60 dark:border-gray-800 mb-2.5"
                        />
                      )}

                      {/* 본문 요약 */}
                      <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 whitespace-pre-wrap break-words leading-relaxed mb-3">
                        {note._plainText || (note.imageDataUrl ? '이미지 클립입니다.' : '')}
                      </p>

                      {/* 해시태그 목록 */}
                      {note.tags && note.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {note.tags.map((tag) => (
                            <span
                              key={tag}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSearchQuery(tag);
                              }}
                              className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold hover:bg-emerald-500/20"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 카드 하단: 날짜 · 복사 횟수 & 액션 버튼 (복사 / 보기 / 수정 / 삭제) */}
                    <div className="pt-2.5 border-t border-gray-100 dark:border-gray-800 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between text-[11px] text-gray-400 font-semibold">
                        <span>{formatCreatedDate(note)}</span>
                        <span>복사 {note.copied || 0}회</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => handleCopyNote(note, e)}
                          className="flex-1 py-2 px-3 rounded-xl bg-samsung-blue/10 hover:bg-samsung-blue text-samsung-blue dark:text-blue-400 hover:text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                        >
                          <IconCopy />
                          <span>복사</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenView(note);
                          }}
                          className="p-2 rounded-xl bg-gray-100 dark:bg-[#2A2A30] hover:bg-gray-200 text-gray-600 dark:text-gray-300 transition-colors"
                          title="상세 보기"
                        >
                          <IconEye />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleOpenEdit(note, e)}
                          className="p-2 rounded-xl bg-gray-100 dark:bg-[#2A2A30] hover:bg-blue-500/20 text-gray-600 dark:text-gray-300 hover:text-samsung-blue transition-colors"
                          title="편집"
                        >
                          <IconEdit />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteNote(note.id, e)}
                          className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white transition-colors"
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

      {/* ================= 상세 보기 모달 (View Modal) ================= */}
      {viewingNote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-md"
          onClick={() => setViewingNote(null)}
        >
          <div
            className="bg-white dark:bg-[#18181D] w-full max-w-3xl max-h-[88vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-modal border border-gray-200/40 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-7 py-5 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full bg-samsung-blue/15 text-samsung-blue dark:text-blue-400 text-xs font-bold">
                  {viewingNote.category || CATEGORIES[0]}
                </span>
                <span className="text-xs text-gray-400">
                  작성: {formatCreatedDateTime(viewingNote)} · 복사 {viewingNote.copied || 0}회
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewingNote(null)}
                className="p-2 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <IconClose />
              </button>
            </div>

            <div className="p-7 overflow-y-auto flex-1 flex flex-col gap-4">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white break-words">
                {viewingNote.title}
              </h1>

              {viewingNote.tags && viewingNote.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {viewingNote.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-bold"
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
                  className="max-h-96 object-contain rounded-2xl bg-black/5 dark:bg-black/30 border border-gray-200 dark:border-gray-800 self-start"
                />
              )}

              <div
                className="text-gray-800 dark:text-gray-200 text-base leading-relaxed whitespace-pre-wrap break-words pt-2"
                dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(viewingNote.content) }}
              />
            </div>

            <div className="px-7 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2.5 bg-gray-50 dark:bg-[#141418]">
              <button
                type="button"
                onClick={(e) => handleCopyNote(viewingNote, e)}
                className="px-5 py-2.5 rounded-xl bg-gray-200 dark:bg-[#2A2A30] text-gray-800 dark:text-gray-100 text-xs font-bold flex items-center gap-1.5 hover:opacity-90"
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
                className="px-5 py-2.5 rounded-xl bg-samsung-blue text-white text-xs font-bold flex items-center gap-1.5 hover:bg-blue-600"
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-md"
          onClick={requestCloseEditModal}
        >
          <div
            className="bg-white dark:bg-[#18181D] w-full max-w-3xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-modal border border-gray-200/40 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-7 py-5 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-lg font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                <IconEdit /> 노트·클립 편집
              </h2>
              <button
                type="button"
                onClick={requestCloseEditModal}
                className="p-2 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <IconClose />
              </button>
            </div>

            <div className="p-7 overflow-y-auto flex-1 flex flex-col gap-4">
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
                    accept="image/*"
                    onChange={(e) => handleImageFileSelect(e, true)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => editFileInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl bg-gray-100 dark:bg-[#2A2A30] text-xs font-bold flex items-center gap-1.5"
                  >
                    <IconImage />
                    <span>이미지 변경/추가</span>
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
                className="w-full bg-transparent text-2xl font-extrabold text-gray-900 dark:text-white outline-none"
              />

              <input
                type="text"
                placeholder="#태그 입력 (쉼표로 구분)"
                value={editingTagsInput}
                onChange={(e) => setEditingTagsInput(e.target.value)}
                className="w-full bg-gray-100 dark:bg-[#25252C] px-3.5 py-2 rounded-xl text-xs font-semibold text-gray-800 dark:text-gray-200 outline-none"
              />

              {editingNote.imageDataUrl && (
                <div className="relative self-start p-2 rounded-2xl bg-gray-100 dark:bg-black/30 border border-gray-200 dark:border-gray-700">
                  <img
                    src={editingNote.imageDataUrl}
                    alt="첨부 이미지"
                    className="max-h-48 object-contain rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => setEditingNote((prev) => ({ ...prev, imageDataUrl: '' }))}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold grid place-items-center"
                  >
                    ✕
                  </button>
                </div>
              )}

              <div
                ref={editEditorRef}
                contentEditable
                suppressContentEditableWarning
                data-placeholder="내용"
                className="w-full bg-transparent text-gray-700 dark:text-gray-200 min-h-[28vh] text-base pt-2"
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

            <div className="px-7 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3 bg-gray-50 dark:bg-[#141418]">
              <button
                type="button"
                onClick={requestCloseEditModal}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-7 py-2.5 rounded-xl bg-gradient-to-r from-samsung-blue to-purple-600 text-white text-xs font-bold shadow-md hover:opacity-95"
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
