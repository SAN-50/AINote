import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CATEGORIES, FILTER_CATEGORIES } from './constants';
import {
  sanitizeNoteHtml,
  getPlainText,
  escapePlainTextToHtml,
  normalizeContentToSafeHtml
} from './utils/sanitize';
import { IconTrash, IconEdit, IconClose, IconMoon, IconSun, IconSettings } from './components/Icons';
import { CustomSelect } from './components/CustomSelect';
import { FormattingBar } from './components/FormattingBar';

const api = typeof window !== 'undefined' ? window.treeNoteAPI : null;

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatCreatedDate(note) {
  const ts = typeof note.createdAt === 'number'
    ? note.createdAt
    : (typeof note.id === 'number' ? note.id : note.timestamp || Date.now());
  return new Date(ts).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatCreatedDateTime(note) {
  const ts = typeof note.createdAt === 'number'
    ? note.createdAt
    : (typeof note.id === 'number' ? note.id : note.timestamp || Date.now());
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

export default function App() {
  const [notes, setNotes] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [corruptWarning, setCorruptWarning] = useState(null);
  const [statusBanner, setStatusBanner] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [appVersion, setAppVersion] = useState('1.1.0');

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [isDark, setIsDark] = useState(true);
  const [blurEnabled, setBlurEnabled] = useState(true);

  const [editingNote, setEditingNote] = useState(null);
  const [editingInitialSnapshot, setEditingInitialSnapshot] = useState(null);
  const [viewingNote, setViewingNote] = useState(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState(FILTER_CATEGORIES[0]);
  const [sortOrder, setSortOrder] = useState('최신순');
  const [showSettings, setShowSettings] = useState(false);

  const mainEditorRef = useRef(null);
  const editEditorRef = useRef(null);
  const saveTimerRef = useRef(null);

  const showToast = useCallback((message, type = 'info') => {
    setStatusBanner({ message, type });
    setTimeout(() => {
      setStatusBanner((prev) => (prev && prev.message === message ? null : prev));
    }, 4000);
  }, []);

  // 1. 초기 로드 및 기존 localStorage 자동 마이그레이션
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
      } catch (err) {
        console.warn('[Migration] Failed to parse legacy localStorage notes:', err);
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
            `데이터 파일이 손상되어 원본을 백업(${res.corruptPath})으로 안전하게 보관했습니다. 설정에서 백업 파일을 가져올 수 있습니다.`
          );
        }

        let initialNotes = res.data?.notes || [];
        let initialDark = res.data?.settings?.isDark ?? (legacyDark ?? true);
        let initialBlur = res.data?.settings?.blurEnabled ?? (legacyBlur ?? true);
        const initialDraft = res.data?.draft || null;

        // 첫 실행 시 파일이 없거나 비어 있고 localStorage에 노트가 있으면 자동 이전 (원본 localStorage도 보존)
        if (!res.exists && Array.isArray(legacyNotes) && legacyNotes.length > 0) {
          initialNotes = legacyNotes.map((n) => ({
            ...n,
            id: n.id !== undefined ? String(n.id) : generateId(),
            createdAt: typeof n.createdAt === 'number' ? n.createdAt : (typeof n.id === 'number' ? n.id : n.timestamp || Date.now()),
            content: normalizeContentToSafeHtml(n.content || '')
          }));
          await api.saveData({
            notes: initialNotes,
            settings: { isDark: initialDark, blurEnabled: initialBlur },
            draft: null
          });
          showToast(`기존 노트 ${initialNotes.length}개를 안전한 파일 저장소로 이전했습니다.`, 'success');
        } else {
          initialNotes = initialNotes.map((n) => ({
            ...n,
            content: normalizeContentToSafeHtml(n.content || '')
          }));
        }

        setNotes(initialNotes);
        setIsDark(initialDark);
        setBlurEnabled(initialBlur);

        if (initialDraft && (initialDraft.title || getPlainText(initialDraft.content))) {
          setTitle(initialDraft.title || '');
          const safeDraftHtml = normalizeContentToSafeHtml(initialDraft.content || '');
          setContent(safeDraftHtml);
          setCategory(initialDraft.category || CATEGORIES[0]);
          if (mainEditorRef.current) {
            mainEditorRef.current.innerHTML = safeDraftHtml;
          }
        }

        setIsLoaded(true);
      } else {
        // 브라우저 단독 실행 시 fallback
        const safeLegacy = (legacyNotes || []).map((n) => ({
          ...n,
          id: n.id !== undefined ? String(n.id) : generateId(),
          createdAt: typeof n.createdAt === 'number' ? n.createdAt : (typeof n.id === 'number' ? n.id : n.timestamp || Date.now()),
          content: normalizeContentToSafeHtml(n.content || '')
        }));
        setNotes(safeLegacy);
        if (legacyBlur !== null) setBlurEnabled(Boolean(legacyBlur));
        if (legacyDark !== null) setIsDark(Boolean(legacyDark));
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

  // 2. 다크 모드 동기화 (HTML 클래스 + Electron 네이티브 타이틀바)
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

  // 3. 안전한 디바운스 저장 (손상 상태일 때는 자동 덮어쓰기 방지)
  const persistPayload = useCallback(
    async (nextNotes, nextDark, nextBlur, nextDraft) => {
      if (!isLoaded || corruptWarning) return;
      const payload = {
        notes: nextNotes,
        settings: { isDark: nextDark, blurEnabled: nextBlur },
        draft: nextDraft
      };

      if (api) {
        const res = await api.saveData(payload);
        if (!res?.ok) {
          showToast(`저장 중 오류가 발생했습니다: ${res?.error || '알 수 없는 오류'}`, 'error');
        }
      } else {
        try {
          localStorage.setItem('notes', JSON.stringify(nextNotes));
          localStorage.setItem('blurEnabled', JSON.stringify(nextBlur));
          localStorage.setItem('isDark', JSON.stringify(nextDark));
        } catch (err) {
          showToast(`브라우저 저장소 용량 초과 또는 오류: ${err.message}`, 'error');
        }
      }
    },
    [isLoaded, corruptWarning, showToast]
  );

  useEffect(() => {
    if (!isLoaded || corruptWarning) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const draftObj =
      title.trim() || getPlainText(content).trim()
        ? { title, content: sanitizeNoteHtml(content), category }
        : null;

    saveTimerRef.current = setTimeout(() => {
      persistPayload(notes, isDark, blurEnabled, draftObj);
    }, 250);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [notes, isDark, blurEnabled, title, content, category, isLoaded, corruptWarning, persistPayload]);

  // 4. 편집 모달 오픈 시 에디터 초기 내용 세팅
  useEffect(() => {
    if (editingNote && editEditorRef.current) {
      editEditorRef.current.innerHTML = normalizeContentToSafeHtml(editingNote.content);
    }
  }, [editingNote?.id]);

  // 5. ESC 키로 모달 닫기 (편집 중 변경사항 확인 포함)
  const requestCloseEditModal = useCallback(() => {
    if (!editingNote) return;
    const currentHtml = editEditorRef.current
      ? sanitizeNoteHtml(editEditorRef.current.innerHTML)
      : sanitizeNoteHtml(editingNote.content);
    const hasChanges =
      editingInitialSnapshot &&
      (editingNote.title !== editingInitialSnapshot.title ||
        editingNote.category !== editingInitialSnapshot.category ||
        getPlainText(currentHtml) !== getPlainText(editingInitialSnapshot.content));

    if (hasChanges) {
      if (!window.confirm('수정 중인 내용이 있습니다. 저장하지 않고 닫으시겠습니까?')) {
        return;
      }
    }
    setEditingNote(null);
    setEditingInitialSnapshot(null);
  }, [editingNote, editingInitialSnapshot]);

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

  // 6. 붙여넣기 시 악성 스크립트/외부 스타일 정제 핸들러
  const handleSafePaste = (e, targetEditorRef, onUpdateContent) => {
    e.preventDefault();
    const clipboard = e.clipboardData;
    if (!clipboard) return;

    const rawHtml = clipboard.getData('text/html');
    const rawText = clipboard.getData('text/plain');
    const cleanHtml = rawHtml
      ? sanitizeNoteHtml(rawHtml)
      : escapePlainTextToHtml(rawText);

    document.execCommand('insertHTML', false, cleanHtml);
    if (targetEditorRef.current && onUpdateContent) {
      onUpdateContent(targetEditorRef.current.innerHTML);
    }
  };

  const resetForm = () => {
    setTitle('');
    setContent('');
    setCategory(CATEGORIES[0]);
    if (mainEditorRef.current) mainEditorRef.current.innerHTML = '';
    setIsInputFocused(false);
    setIsSelectOpen(false);
  };

  const handleAddNote = (e) => {
    e.preventDefault();
    const rawHtmlContent = mainEditorRef.current ? mainEditorRef.current.innerHTML : content;
    const safeHtmlContent = sanitizeNoteHtml(rawHtmlContent);
    const plain = getPlainText(safeHtmlContent);
    if (!title.trim() && !plain.trim()) return;

    const now = new Date();
    const nowMs = now.getTime();
    const newNote = {
      id: generateId(),
      title: title.trim(),
      content: safeHtmlContent,
      category,
      date: now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }),
      time: now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: nowMs,
      createdAt: nowMs
    };

    setNotes((prev) => [newNote, ...prev]);
    resetForm();
    setIsFocusMode(false);
  };

  const handleDeleteNote = (id) => {
    if (window.confirm('정말 이 노트를 삭제하시겠습니까?')) {
      setNotes((prev) => prev.filter((n) => n.id !== id));
    }
  };

  const handleOpenEdit = (note) => {
    const safeCopy = {
      ...note,
      content: normalizeContentToSafeHtml(note.content)
    };
    setEditingNote(safeCopy);
    setEditingInitialSnapshot(safeCopy);
  };

  const handleOpenView = (note) => {
    setViewingNote({
      ...note,
      content: normalizeContentToSafeHtml(note.content)
    });
  };

  const handleSaveEdit = () => {
    if (!editingNote) return;
    const rawHtmlContent = editEditorRef.current ? editEditorRef.current.innerHTML : editingNote.content;
    const safeHtmlContent = sanitizeNoteHtml(rawHtmlContent);
    const plain = getPlainText(safeHtmlContent);
    if (!editingNote.title.trim() && !plain.trim()) return;

    const now = new Date();
    const updatedNote = {
      ...editingNote,
      title: editingNote.title.trim(),
      content: safeHtmlContent,
      date: now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }),
      time: now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: now.getTime()
    };

    setNotes((prev) => prev.map((n) => (n.id === editingNote.id ? updatedNote : n)));
    setEditingNote(null);
    setEditingInitialSnapshot(null);
  };

  // 7. 백업 내보내기 / 가져오기
  const handleExportBackup = async () => {
    if (!api) return;
    const res = await api.exportNotes({
      notes,
      settings: { isDark, blurEnabled }
    });
    if (res?.ok) {
      showToast('노트 백업 파일을 성공적으로 저장했습니다.', 'success');
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
            `백업 파일에서 노트 ${importedNotes.length}개를 찾았습니다.\n[확인]을 누르면 기존 노트와 병합하고, [취소]를 누르면 작업을 중단합니다.`
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

    showToast(`노트 ${importedNotes.length}개를 성공적으로 가져왔습니다.`, 'success');
    setShowSettings(false);
  };

  const handleManualUpdateCheck = async () => {
    if (!api) return;
    const res = await api.checkForUpdates();
    if (res && !res.ok && res.message) {
      showToast(res.message, 'info');
    }
  };

  // 8. 빈 <br> 태그만 남았을 때 흐림 효과가 계속 켜져 있는 버그 수정
  const plainDraftContent = useMemo(() => getPlainText(content), [content]);
  const hasInputFocusOrContent =
    isInputFocused || isSelectOpen || title.trim().length > 0 || plainDraftContent.length > 0;
  const formActiveState = blurEnabled && hasInputFocusOrContent;

  // 9. 검색용 PlainText 사전 캐싱 (타이핑할 때마다 DOM 파싱하는 병목 제거)
  const notesWithPlainCache = useMemo(() => {
    return notes.map((note) => ({
      ...note,
      _plainText: getPlainText(note.content),
      _safeHtml: normalizeContentToSafeHtml(note.content)
    }));
  }, [notes]);

  const filteredAndSortedNotes = useMemo(() => {
    const sl = searchQuery.trim().toLowerCase();
    return notesWithPlainCache
      .filter((note) => {
        const t = (note.title || '').toLowerCase();
        const c = (note._plainText || '').toLowerCase();
        const ms = !sl || t.includes(sl) || c.includes(sl);
        const mc = filterCategory === FILTER_CATEGORIES[0] || note.category === filterCategory;
        return ms && mc;
      })
      .sort((a, b) => (sortOrder === '최신순' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp));
  }, [notesWithPlainCache, searchQuery, filterCategory, sortOrder]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 min-h-screen flex flex-col relative z-10">
      {/* 상태 알림 배너 / 손상 경고 / 업데이트 배너 */}
      {corruptWarning && (
        <div className="mb-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/40 text-red-600 dark:text-red-300 text-sm font-semibold flex justify-between items-center gap-3">
          <span>{corruptWarning}</span>
          <button
            type="button"
            onClick={() => setCorruptWarning(null)}
            className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-bold shrink-0"
          >
            새 저장소로 계속
          </button>
        </div>
      )}

      {statusBanner && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3.5 rounded-2xl shadow-2xl border text-sm font-bold animate-[slideUpFade_0.25s_ease-out] ${
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

      {updateInfo && updateInfo.state === 'downloaded' && (
        <div className="mb-4 p-4 rounded-2xl bg-samsung-blue/15 border border-samsung-blue/40 text-samsung-blue dark:text-blue-300 text-sm font-bold flex justify-between items-center gap-3">
          <span>{updateInfo.message}</span>
          <button
            type="button"
            onClick={() => api?.installUpdate()}
            className="px-4 py-2 rounded-xl bg-samsung-blue text-white text-xs font-bold hover:bg-blue-600 transition-colors shrink-0"
          >
            지금 재시작하여 업데이트
          </button>
        </div>
      )}

      {/* Header */}
      <header
        className={`flex justify-between items-center mb-6 pb-4 border-b border-gray-200/60 dark:border-samsung-border/60 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          formActiveState && !isFocusMode ? 'opacity-40' : 'opacity-100'
        }`}
      >
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="url(#bg)" className="drop-shadow-sm">
              <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#2B65F3" />
                  <stop offset="100%" stopColor="#A855F7" />
                </linearGradient>
              </defs>
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m-5 14H7v-2h7zm3-4H7v-2h10zm0-4H7V7h10z" />
            </svg>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-samsung-blue to-purple-500">나무 노트</span>
          </h1>
        </div>

        <div className="flex items-center gap-1.5 relative">
          <button
            type="button"
            onClick={() => setIsDark(!isDark)}
            className="p-3 rounded-full hover:bg-white dark:hover:bg-gray-800 shadow-sm border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-all duration-300 transform hover:scale-105 active:scale-95 text-gray-600 dark:text-gray-300"
            title="다크 모드 변경"
          >
            {isDark ? <IconSun /> : <IconMoon />}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className="p-3 rounded-full hover:bg-white dark:hover:bg-gray-800 shadow-sm border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-all duration-300 transform hover:scale-105 active:scale-95 text-gray-600 dark:text-gray-300"
              title="설정"
            >
              <IconSettings />
            </button>
            {showSettings && <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} />}
            {showSettings && (
              <div className="absolute right-0 top-[120%] w-[300px] bg-white/95 dark:bg-[#252527]/95 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 rounded-2xl shadow-2xl z-50 p-5 animate-[slideDown_0.2s_ease-out] flex flex-col gap-3">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="font-bold text-gray-900 dark:text-gray-100 text-[15px] flex items-center gap-2">
                    <IconSettings /> 설정
                  </h3>
                  <span className="text-xs font-semibold text-gray-400">v{appVersion}</span>
                </div>

                <div className="flex justify-between items-center bg-gray-50/80 dark:bg-black/20 p-3.5 rounded-xl border border-gray-100 dark:border-samsung-border/50">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[14px] font-bold text-gray-800 dark:text-gray-200">배경 흐림 효과</span>
                    <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">작성 시 배경을 아웃포커싱</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBlurEnabled(!blurEnabled)}
                    className={`w-[44px] h-6 rounded-full transition-colors duration-300 relative shadow-inner focus:outline-none ${
                      blurEnabled ? 'bg-samsung-blue' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 bg-white rounded-full absolute top-[4px] shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                        blurEnabled ? 'translate-x-[24px]' : 'translate-x-[4px]'
                      }`}
                    />
                  </button>
                </div>

                {api && (
                  <>
                    <div className="bg-gray-50/80 dark:bg-black/20 p-3.5 rounded-xl border border-gray-100 dark:border-samsung-border/50 flex flex-col gap-2">
                      <span className="text-[12px] font-bold text-gray-500 dark:text-gray-400">데이터 백업 및 복원</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleExportBackup}
                          className="flex-1 py-2 px-3 rounded-lg bg-white dark:bg-[#2A2A2C] hover:bg-gray-100 dark:hover:bg-[#353538] text-xs font-bold text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 transition-colors"
                        >
                          내보내기
                        </button>
                        <button
                          type="button"
                          onClick={handleImportBackup}
                          className="flex-1 py-2 px-3 rounded-lg bg-white dark:bg-[#2A2A2C] hover:bg-gray-100 dark:hover:bg-[#353538] text-xs font-bold text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 transition-colors"
                        >
                          가져오기
                        </button>
                      </div>
                    </div>

                    <div className="bg-gray-50/80 dark:bg-black/20 p-3.5 rounded-xl border border-gray-100 dark:border-samsung-border/50 flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-gray-500 dark:text-gray-400">소프트웨어 업데이트</span>
                        <button
                          type="button"
                          onClick={handleManualUpdateCheck}
                          className="py-1.5 px-3 rounded-lg bg-samsung-blue/10 hover:bg-samsung-blue/20 text-samsung-blue dark:text-blue-400 text-xs font-bold transition-colors"
                        >
                          업데이트 확인
                        </button>
                      </div>
                      {updateInfo?.message && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{updateInfo.message}</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Form + Focus Mode */}
      <div className="transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col relative z-30">
        <section className="relative z-30">
          <form
            onSubmit={handleAddNote}
            className="bg-white/80 dark:bg-samsung-darkcard/80 backdrop-blur-md p-6 rounded-3xl shadow-lg border border-gray-200/50 dark:border-samsung-border flex flex-col gap-3 transition-all duration-500 focus-within:ring-2 focus-within:ring-samsung-blue/30 focus-within:shadow-2xl hover:shadow-xl relative"
          >
            <input
              type="text"
              placeholder="제목"
              className="w-full bg-transparent text-gray-900 dark:text-white text-2xl font-bold placeholder-gray-400 focus:outline-none transition-colors px-2 mb-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
            />
            <FormattingBar editorRef={mainEditorRef} onFormatChange={(html) => setContent(html)} />
            <div
              ref={mainEditorRef}
              contentEditable
              suppressContentEditableWarning
              data-placeholder="내용을 입력하세요..."
              className={`w-full bg-transparent text-gray-700 dark:text-gray-300 text-lg placeholder-gray-500 px-2 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isFocusMode ? 'min-h-[50vh]' : 'min-h-[100px]'
              }`}
              onInput={(e) => setContent(e.currentTarget.innerHTML)}
              onPaste={(e) => handleSafePaste(e, mainEditorRef, setContent)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
            />
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pt-5 border-t border-gray-100/50 dark:border-[#333]/50 mt-2 gap-4 relative z-50">
              <CustomSelect
                value={category}
                onChange={setCategory}
                options={CATEGORIES}
                onOpenChange={setIsSelectOpen}
              />
              <div className="flex gap-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={resetForm}
                  className={`flex-1 sm:flex-none px-4 py-3.5 bg-transparent text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200 font-bold transition-all duration-300 flex items-center justify-center ${
                    hasInputFocusOrContent || isFocusMode
                      ? 'opacity-100 translate-x-0'
                      : 'opacity-0 pointer-events-none translate-x-4'
                  }`}
                >
                  초기화
                </button>
                <button
                  type="submit"
                  className="flex-1 sm:flex-none px-8 py-3.5 bg-gradient-to-r from-samsung-blue to-blue-600 hover:from-blue-600 hover:to-blue-800 text-white rounded-xl font-bold transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
                >
                  새로 저장
                </button>
              </div>
            </div>
          </form>
        </section>

        <div
          className={`flex justify-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] relative z-40 ${
            isFocusMode ? 'mt-6 opacity-100' : 'mt-3 mb-5 opacity-60 hover:opacity-100'
          }`}
        >
          <button
            type="button"
            onClick={() => setIsFocusMode(!isFocusMode)}
            className="p-2.5 bg-white/70 dark:bg-samsung-darkcard/70 backdrop-blur-md rounded-full text-gray-500 hover:text-samsung-blue dark:hover:text-blue-400 hover:bg-white dark:hover:bg-[#2A2A2C] shadow-sm border border-gray-200/50 dark:border-samsung-border transition-all duration-300 transform hover:scale-110 focus:outline-none flex items-center justify-center"
            title={isFocusMode ? '목록 보기' : '집중 작성 모드'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isFocusMode ? 'rotate-180' : ''
              }`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* List */}
      <div
        className={`transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] origin-top flex-1 ${
          isFocusMode
            ? 'opacity-0 scale-95 translate-y-32 pointer-events-none max-h-0 overflow-hidden mt-0'
            : formActiveState
            ? 'scale-[0.97] opacity-30 blur-[4px] pointer-events-none max-h-[5000px] mt-0'
            : 'scale-100 opacity-100 blur-0 max-h-[5000px] mt-0'
        }`}
      >
        {notes.length > 0 && (
          <section className="mb-6 z-20 relative">
            <div className="bg-white/50 dark:bg-samsung-darkcard/40 backdrop-blur-md p-3.5 rounded-2xl border border-gray-200/50 dark:border-samsung-border/60 flex flex-col sm:flex-row gap-3 justify-between items-center shadow-sm">
              <div className="relative w-full sm:w-1/2">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <input
                  type="text"
                  placeholder="제목이나 내용 검색..."
                  className="w-full bg-gray-100/70 dark:bg-[#2A2A2C]/70 text-gray-900 dark:text-white pl-9 pr-4 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-samsung-blue transition-all text-sm font-semibold border border-transparent placeholder-gray-400 dark:placeholder-gray-500"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex w-full sm:w-auto gap-2.5 relative z-50">
                <CustomSelect
                  value={filterCategory}
                  onChange={setFilterCategory}
                  options={FILTER_CATEGORIES}
                  isSmall={true}
                />
                <button
                  type="button"
                  onClick={() => setSortOrder(sortOrder === '최신순' ? '과거순' : '최신순')}
                  className="bg-gray-100/80 dark:bg-[#2A2A2C]/80 text-gray-800 dark:text-gray-200 px-4 py-2.5 rounded-xl hover:bg-gray-200 dark:hover:bg-[#353538] transition-colors text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`transition-transform duration-300 ${sortOrder === '과거순' ? 'rotate-180' : ''}`}
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <polyline points="19 12 12 19 5 12" />
                  </svg>
                  <span className="w-[42px] text-center">{sortOrder}</span>
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="flex-1 pb-20">
          {notes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-56 text-gray-400 animate-[fadeIn_0.5s_ease-out]">
              <svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-6 opacity-40">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <line x1="10" y1="9" x2="8" y2="9" />
              </svg>
              <p className="text-lg font-medium">아직 작성된 노트가 없습니다.</p>
              <p className="text-sm mt-2 opacity-70">위 입력창에서 첫 노트를 작성해보세요!</p>
            </div>
          ) : filteredAndSortedNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400 animate-[fadeIn_0.5s_ease-out]">
              <p className="text-lg font-medium">조건에 맞는 노트가 없습니다.</p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setFilterCategory(FILTER_CATEGORIES[0]);
                }}
                className="mt-4 text-samsung-blue font-bold px-4 py-2 hover:bg-samsung-blue/10 rounded-full transition-colors"
              >
                초기화
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {filteredAndSortedNotes.map((note, idx) => (
                <div
                  key={note.id}
                  onClick={() => handleOpenView(note)}
                  style={{ animationDelay: `${Math.min(idx * 0.03, 0.3)}s` }}
                  className="animate-list-item group flex flex-col sm:flex-row items-start sm:items-center justify-between px-7 py-6 bg-white/70 dark:bg-samsung-darkcard/90 backdrop-blur-sm hover:bg-white dark:hover:bg-[#252527] border border-gray-100 dark:border-samsung-border rounded-3xl transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md hover:-translate-y-1 relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-samsung-blue/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                  <div className="flex-1 w-full flex flex-col gap-1 pr-16 sm:pr-32 overflow-hidden relative z-10">
                    <div className="flex items-center gap-2 mb-2 text-[11px] sm:text-xs font-bold text-samsung-blue dark:text-blue-400 tracking-wide flex-wrap">
                      <span title="최초 작성일">작성: {formatCreatedDate(note)}</span>
                      <span className="opacity-40">|</span>
                      <span title="최근 수정일">
                        수정: {note.date} {note.time}
                      </span>
                      <span className="opacity-40">|</span>
                      <span>{note.category || CATEGORIES[0]}</span>
                    </div>
                    {note.title && (
                      <h3 className="font-extrabold text-xl text-gray-900 dark:text-gray-100 truncate group-hover:text-samsung-blue dark:group-hover:text-blue-400 transition-colors mb-1.5">
                        {note.title}
                      </h3>
                    )}
                    <p className="flex-1 text-gray-600 dark:text-gray-400 line-clamp-2 opacity-90 overflow-hidden tracking-wide break-keep text-lg">
                      {note._plainText}
                    </p>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 absolute top-6 right-6 sm:relative sm:top-0 sm:right-0 sm:mt-0 flex items-center gap-1 sm:gap-2 transition-all duration-300 focus-within:opacity-100 shrink-0 z-10 translate-x-4 group-hover:translate-x-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenView(note);
                      }}
                      className="p-3 text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/40 rounded-full transition-all duration-300 transform hover:scale-110"
                      title="보기"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEdit(note);
                      }}
                      className="p-3 text-gray-400 hover:text-samsung-blue hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-full transition-all duration-300 transform hover:scale-110"
                      title="편집"
                    >
                      <IconEdit />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNote(note.id);
                      }}
                      className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/40 rounded-full transition-all duration-300 transform hover:scale-110"
                      title="삭제"
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* View Modal */}
      {viewingNote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-gray-900/40 dark:bg-black/60 backdrop-blur-md transition-opacity"
          onClick={() => setViewingNote(null)}
        >
          <div
            className="bg-white/95 dark:bg-samsung-dark/95 backdrop-blur-lg w-full max-w-3xl max-h-[90vh] rounded-[2rem] shadow-2xl flex flex-col overflow-hidden animate-modal border border-white/20 dark:border-gray-700/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-7 py-5 border-b border-gray-100 dark:border-samsung-border bg-gray-50/50 dark:bg-samsung-darkcard/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-samsung-blue/10 rounded-full text-samsung-blue">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">노트 보기</h2>
                  <div className="text-[11px] font-medium text-gray-400 dark:text-gray-500 opacity-70 flex items-center gap-2">
                    <span>작성: {formatCreatedDate(viewingNote)}</span>
                    <span className="scale-[0.6] opacity-50">&bull;</span>
                    <span>
                      수정: {viewingNote.date} {viewingNote.time}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingNote(null)}
                className="p-2.5 text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-full transition-all duration-300 transform hover:rotate-90"
              >
                <IconClose />
              </button>
            </div>
            <div className="p-7 sm:p-9 flex flex-col gap-4 flex-1 overflow-y-auto">
              <div className="mb-2 flex items-center gap-2">
                <span className="px-3 py-1 bg-gray-100 dark:bg-[#2A2A2C] text-gray-600 dark:text-gray-300 rounded-lg text-sm font-bold">
                  {viewingNote.category || CATEGORIES[0]}
                </span>
              </div>
              <h1 className="w-full bg-transparent text-gray-900 dark:text-white text-3xl sm:text-4xl font-extrabold transition-all mt-1 break-words">
                {viewingNote.title}
              </h1>
              <div
                className="w-full bg-transparent text-gray-800 dark:text-gray-200 min-h-[35vh] text-lg pt-4 transition-all break-words whitespace-pre-wrap leading-relaxed"
                dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(viewingNote.content) }}
              />
            </div>
            <div className="px-7 py-4 border-t border-gray-100 dark:border-samsung-border flex justify-end items-center bg-gray-50 dark:bg-samsung-darkcard/80">
              <button
                type="button"
                onClick={() => {
                  setViewingNote(null);
                  handleOpenEdit(viewingNote);
                }}
                className="px-5 py-2.5 bg-gradient-to-r from-samsung-blue to-blue-600 hover:from-blue-600 hover:to-blue-800 text-white rounded-lg text-sm font-bold transition-all duration-300 transform hover:scale-[1.03] active:scale-[0.97] shadow-sm hover:shadow-md flex items-center justify-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                편집하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingNote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-gray-900/40 dark:bg-black/60 backdrop-blur-md transition-opacity"
          onClick={requestCloseEditModal}
        >
          <div
            className="bg-white/95 dark:bg-samsung-dark/95 backdrop-blur-lg w-full max-w-3xl max-h-[90vh] rounded-[2rem] shadow-2xl flex flex-col overflow-hidden animate-modal border border-white/20 dark:border-gray-700/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-7 py-5 border-b border-gray-100 dark:border-samsung-border bg-gray-50/50 dark:bg-samsung-darkcard/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-samsung-blue/10 rounded-full text-samsung-blue">
                  <IconEdit />
                </div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">편집 모드</h2>
              </div>
              <button
                type="button"
                onClick={requestCloseEditModal}
                className="p-2.5 text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-full transition-all duration-300 transform hover:rotate-90"
              >
                <IconClose />
              </button>
            </div>
            <div className="p-7 sm:p-9 flex flex-col gap-4 flex-1 overflow-y-auto">
              <div className="mb-2 flex items-center gap-4 relative z-50 flex-wrap">
                <CustomSelect
                  value={editingNote.category || CATEGORIES[0]}
                  onChange={(v) => setEditingNote((prev) => ({ ...prev, category: v }))}
                  options={CATEGORIES}
                  onOpenChange={() => {}}
                />
                <FormattingBar
                  editorRef={editEditorRef}
                  onFormatChange={(html) => setEditingNote((prev) => ({ ...prev, content: html }))}
                />
              </div>
              <input
                type="text"
                placeholder="제목"
                className="w-full bg-transparent text-gray-900 dark:text-white text-3xl sm:text-4xl font-extrabold placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none transition-all px-1 mt-1"
                value={editingNote.title}
                onChange={(e) => setEditingNote((prev) => ({ ...prev, title: e.target.value }))}
              />
              <div
                ref={editEditorRef}
                contentEditable
                suppressContentEditableWarning
                data-placeholder="내용"
                className="w-full bg-transparent text-gray-700 dark:text-gray-300 min-h-[35vh] text-lg px-1 pt-4 transition-all"
                onInput={(e) => setEditingNote((prev) => ({ ...prev, content: e.currentTarget.innerHTML }))}
                onPaste={(e) =>
                  handleSafePaste(e, editEditorRef, (html) =>
                    setEditingNote((prev) => ({ ...prev, content: html }))
                  )
                }
              />
            </div>
            <div className="px-7 py-5 border-t border-gray-100 dark:border-samsung-border flex flex-col sm:flex-row justify-between items-center gap-5 bg-gray-50 dark:bg-samsung-darkcard/80">
              <div className="text-sm font-semibold text-gray-500 flex flex-col sm:flex-row items-start sm:items-center gap-2 py-2 px-4 bg-white dark:bg-[#252527] rounded-xl shadow-sm border border-gray-100 dark:border-samsung-border">
                <div className="flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>작성: {formatCreatedDateTime(editingNote)}</span>
                </div>
                <span className="hidden sm:inline opacity-40">|</span>
                <div className="flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                  <span>
                    수정: {editingNote.date} {editingNote.time && <>{editingNote.time}</>}
                  </span>
                </div>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={requestCloseEditModal}
                  className="flex-1 sm:flex-none px-6 py-3.5 text-gray-600 dark:text-gray-400 font-bold hover:bg-gray-200 dark:hover:bg-[#333] rounded-xl transition-all duration-300"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="flex-1 sm:flex-none px-10 py-3.5 bg-gradient-to-r from-samsung-blue to-blue-600 hover:from-blue-600 hover:to-blue-800 text-white rounded-xl font-bold transition-all duration-300 transform hover:scale-[1.03] active:scale-[0.97] shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
                >
                  수정 완료
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
