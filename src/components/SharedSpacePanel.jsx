import React, { useState, useEffect, useRef, useMemo } from 'react';
import { normalizeContentToSafeHtml, getPlainText, sanitizeNoteHtml } from '../utils/sanitize';
import { FormattingBar } from './FormattingBar';

const STATUS_BADGE_STYLES = {
  중요: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  검토필요: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  확정: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  질문: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30'
};

const SECTION_ACCENT_STYLES = {
  blue: 'border-t-blue-500',
  amber: 'border-t-amber-500',
  purple: 'border-t-purple-500',
  emerald: 'border-t-emerald-500',
  zinc: 'border-t-zinc-500',
  rose: 'border-t-rose-500'
};

function UserAvatar({ user, size = 'md' }) {
  const sizeClass =
    size === 'sm'
      ? 'w-6 h-6 text-[11px]'
      : size === 'lg'
      ? 'w-10 h-10 text-sm'
      : 'w-8 h-8 text-xs';
  const initial = (user?.name || user?.accountId || '?').trim().charAt(0).toUpperCase();

  return (
    <div
      style={{ backgroundColor: user?.avatarColor || '#2563EB' }}
      className={`${sizeClass} rounded-full text-white font-bold flex items-center justify-center shrink-0 shadow-sm select-none`}
    >
      {initial}
    </div>
  );
}

export function SharedSpacePanel({
  api,
  personalNotes = [],
  onSaveToPersonalNotes,
  showToast
}) {
  // 1. Auth & Room State
  const [loadingInit, setLoadingInit] = useState(true);
  const [currentAccount, setCurrentAccount] = useState(null);
  const [registeredAccounts, setRegisteredAccounts] = useState([]);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [loginIdInput, setLoginIdInput] = useState('');
  const [loginPasswordInput, setLoginPasswordInput] = useState('');
  const [signupIdInput, setSignupIdInput] = useState('');
  const [signupNameInput, setSignupNameInput] = useState('');
  const [signupPasswordInput, setSignupPasswordInput] = useState('');
  const [signupConfirmInput, setSignupConfirmInput] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const loginPasswordInputRef = useRef(null);

  // Account Settings Modal State
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [currPwdInput, setCurrPwdInput] = useState('');
  const [newPwdInput, setNewPwdInput] = useState('');
  const [deletePwdInput, setDeletePwdInput] = useState('');
  const [accountEditBusy, setAccountEditBusy] = useState(false);

  // Lobby inputs (Host / Join)
  const [recentRooms, setRecentRooms] = useState([]);
  const [savedRooms, setSavedRooms] = useState([]);
  const [joinedRooms, setJoinedRooms] = useState([]);
  const [importBackupDraft, setImportBackupDraft] = useState(null);
  const [hostRoomName, setHostRoomName] = useState('');
  const [hostPassword, setHostPassword] = useState('');
  const [hostPermissionMode, setHostPermissionMode] = useState('all');
  const [joinRoomName, setJoinRoomName] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinHostCode, setJoinHostCode] = useState('');
  const [roomActionBusy, setRoomActionBusy] = useState(false);

  // Active Room State
  const [activeRoom, setActiveRoom] = useState(null);
  const [showRoomManageModal, setShowRoomManageModal] = useState(false);
  const [showJoinedRoomsPopover, setShowJoinedRoomsPopover] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editingSectionTitle, setEditingSectionTitle] = useState('');
  const [viewMode, setViewMode] = useState('board'); // 'board' | 'grid' | 'checklist'
  const [selectedFolderId, setSelectedFolderId] = useState('all-notes');
  const [roomSearch, setRoomSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Smart Organization: Multi-select & Merge
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTitle, setMergeTitle] = useState('');
  const [mergeRemoveOriginals, setMergeRemoveOriginals] = useState(false);

  // New / Edit Shared Note Modal
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteSectionId, setNoteSectionId] = useState('idea');
  const [noteFolderId, setNoteFolderId] = useState('all-notes');
  const [noteStatusBadge, setNoteStatusBadge] = useState('');
  const [noteTagsInput, setNoteTagsInput] = useState('');
  const [notePinned, setNotePinned] = useState(false);
  const [noteImage, setNoteImage] = useState('');
  const [noteChecklist, setNoteChecklist] = useState([]);
  const [newCheckItemText, setNewCheckItemText] = useState('');
  const noteEditorRef = useRef(null);

  // Viewing Shared Note Detail Modal
  const [viewingSharedNote, setViewingSharedNote] = useState(null);

  // Personal Note Picker Modal (Import from personal notes)
  const [showPersonalPicker, setShowPersonalPicker] = useState(false);

  // Section / Folder creation inputs
  const [showNewSectionInput, setShowNewSectionInput] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Chat Panel State
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [chatImage, setChatImage] = useState('');
  const [chatShareNoteRef, setChatShareNoteRef] = useState(null);
  const [showChatNotePicker, setShowChatNotePicker] = useState(false);
  const [showMembersPopover, setShowMembersPopover] = useState(false);
  const chatEndRef = useRef(null);

  // Drag & Drop state for Kanban sections
  const [draggedNoteId, setDraggedNoteId] = useState(null);
  const [dragOverSectionId, setDragOverSectionId] = useState(null);

  // Load initial state & subscribe to real-time updates
  useEffect(() => {
    let mounted = true;
    async function initShared() {
      if (!api?.getSharedState) {
        setLoadingInit(false);
        return;
      }
      const res = await api.getSharedState();
      if (mounted && res?.ok) {
        setCurrentAccount(res.currentAccount || null);
        setRegisteredAccounts(res.registeredAccounts || []);
        if (res.lastAccountId) {
          setLoginIdInput(res.lastAccountId);
        }
        setRecentRooms(res.recentRooms || []);
        setSavedRooms(res.savedRooms || []);
        setJoinedRooms(res.joinedRooms || []);
        setActiveRoom(res.activeRoom || null);
      }
      if (mounted) setLoadingInit(false);
    }
    initShared();

    const unsubRoom = api?.onSharedRoomUpdated
      ? api.onSharedRoomUpdated((snapshot) => {
          if (mounted) {
            setActiveRoom(snapshot);
          }
        })
      : null;

    const unsubDisc = api?.onSharedRoomDisconnected
      ? api.onSharedRoomDisconnected((info) => {
          if (mounted) {
            setActiveRoom(null);
            showToast?.(info?.reason || '공유 방 연결이 종료되었습니다.', 'info');
          }
        })
      : null;

    return () => {
      mounted = false;
      if (unsubRoom) unsubRoom();
      if (unsubDisc) unsubDisc();
    };
  }, [api, showToast]);

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeRoom?.messages?.length, chatOpen]);

  // Keep viewingSharedNote in sync with room updates
  useEffect(() => {
    if (viewingSharedNote && activeRoom?.notes) {
      const updated = activeRoom.notes.find((n) => n.id === viewingSharedNote.id);
      if (updated) setViewingSharedNote(updated);
    }
  }, [activeRoom?.notes, viewingSharedNote]);

  // ============================================================================
  // Handlers: Native TreeNote Account Auth (Sign Up / Log In / Account Settings)
  // ============================================================================
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!api?.loginSharedAccount || authBusy) return;
    setAuthError('');
    setAuthBusy(true);
    try {
      const res = await api.loginSharedAccount({
        accountId: loginIdInput,
        password: loginPasswordInput
      });
      if (res?.ok && res.currentAccount) {
        setCurrentAccount(res.currentAccount);
        setRegisteredAccounts(res.registeredAccounts || []);
        if (res.savedRooms) setSavedRooms(res.savedRooms);
        if (res.joinedRooms) setJoinedRooms(res.joinedRooms);
        setLoginPasswordInput('');
        setAuthError('');
        showToast?.(`로그인 완료: ${res.currentAccount.name} (@${res.currentAccount.accountId}) ✓`, 'success');
      } else {
        const err = res?.error || '아이디 또는 비밀번호를 확인해 주세요.';
        setAuthError(err);
        showToast?.(err, 'error');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    if (!api?.registerSharedAccount || authBusy) return;
    setAuthError('');
    if (signupPasswordInput !== signupConfirmInput) {
      const msg = '비밀번호와 비밀번호 확인이 일치하지 않습니다.';
      setAuthError(msg);
      showToast?.(msg, 'error');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await api.registerSharedAccount({
        accountId: signupIdInput,
        displayName: signupNameInput,
        password: signupPasswordInput,
        confirmPassword: signupConfirmInput
      });
      if (res?.ok && res.accountId) {
        setRegisteredAccounts(res.registeredAccounts || []);
        setAuthMode('login');
        setLoginIdInput(res.accountId);
        setLoginPasswordInput('');
        setSignupIdInput('');
        setSignupNameInput('');
        setSignupPasswordInput('');
        setSignupConfirmInput('');
        setAuthError('');
        showToast?.(`회원가입 완료! '${res.accountId}' 계정으로 로그인해 주세요.`, 'success');
        setTimeout(() => {
          loginPasswordInputRef.current?.focus();
        }, 50);
      } else {
        const err = res?.error || '회원가입을 완료하지 못했습니다.';
        setAuthError(err);
        showToast?.(err, 'error');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    if (!api?.logoutSharedAccount) return;
    const res = await api.logoutSharedAccount();
    setCurrentAccount(null);
    setActiveRoom(null);
    setShowAccountSettings(false);
    if (res?.registeredAccounts) setRegisteredAccounts(res.registeredAccounts);
    if (res?.lastAccountId) setLoginIdInput(res.lastAccountId);
    setLoginPasswordInput('');
    setAuthMode('login');
    setAuthError('');
    showToast?.('계정에서 로그아웃되었습니다.', 'info');
  };

  const handleOpenAccountSettings = () => {
    setEditDisplayName(currentAccount?.name || '');
    setCurrPwdInput('');
    setNewPwdInput('');
    setDeletePwdInput('');
    setShowAccountSettings(true);
  };

  const handleUpdateAccount = async (e) => {
    e.preventDefault();
    if (!api?.updateSharedAccount || accountEditBusy) return;
    setAccountEditBusy(true);
    try {
      const res = await api.updateSharedAccount({
        displayName: editDisplayName,
        currentPassword: currPwdInput,
        newPassword: newPwdInput
      });
      if (res?.ok && res.currentAccount) {
        setCurrentAccount(res.currentAccount);
        setCurrPwdInput('');
        setNewPwdInput('');
        setShowAccountSettings(false);
        showToast?.('계정 정보가 업데이트되었습니다. ✓', 'success');
      } else {
        showToast?.(res?.error || '계정 정보를 수정하지 못했습니다.', 'error');
      }
    } finally {
      setAccountEditBusy(false);
    }
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    if (!api?.deleteSharedAccount || accountEditBusy) return;
    if (!deletePwdInput) {
      showToast?.('계정 삭제를 위해 현재 비밀번호를 입력해 주세요.', 'error');
      return;
    }
    setAccountEditBusy(true);
    try {
      const res = await api.deleteSharedAccount({ currentPassword: deletePwdInput });
      if (res?.ok) {
        setCurrentAccount(null);
        setActiveRoom(null);
        setRegisteredAccounts(res.registeredAccounts || []);
        setLoginIdInput(res.lastAccountId || '');
        setLoginPasswordInput('');
        setDeletePwdInput('');
        setShowAccountSettings(false);
        showToast?.('계정이 삭제되었습니다.', 'info');
      } else {
        showToast?.(res?.error || '계정을 삭제하지 못했습니다.', 'error');
      }
    } finally {
      setAccountEditBusy(false);
    }
  };

  // ============================================================================
  // Handlers: Host / Join / Leave Room
  // ============================================================================
  const handleHostRoom = async (e) => {
    e.preventDefault();
    if (!api?.hostSharedRoom || roomActionBusy) return;
    setRoomActionBusy(true);
    try {
      const res = await api.hostSharedRoom({
        roomName: hostRoomName,
        password: hostPassword,
        permissionMode: hostPermissionMode
      });
      if (res?.ok && res.room) {
        setActiveRoom(res.room);
        const stateRes = await api.getSharedState();
        if (stateRes?.recentRooms) setRecentRooms(stateRes.recentRooms);
        if (stateRes?.savedRooms) setSavedRooms(stateRes.savedRooms);
        if (stateRes?.joinedRooms) setJoinedRooms(stateRes.joinedRooms);
        showToast?.(`'${res.room.roomName}' 방 호스트를 시작했습니다 ✓`, 'success');
      } else {
        showToast?.(res?.error || '방 생성에 실패했습니다.', 'error');
      }
    } finally {
      setRoomActionBusy(false);
    }
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    if (!api?.joinSharedRoom || roomActionBusy) return;
    setRoomActionBusy(true);
    try {
      const res = await api.joinSharedRoom({
        roomName: joinRoomName,
        password: joinPassword,
        hostCode: joinHostCode
      });
      if (res?.ok && res.room) {
        setActiveRoom(res.room);
        const stateRes = await api.getSharedState();
        if (stateRes?.recentRooms) setRecentRooms(stateRes.recentRooms);
        if (stateRes?.savedRooms) setSavedRooms(stateRes.savedRooms);
        if (stateRes?.joinedRooms) setJoinedRooms(stateRes.joinedRooms);
        showToast?.(`'${res.room.roomName}' 방에 입장했습니다 ✓`, 'success');
      } else {
        showToast?.(res?.error || '방 입장에 실패했습니다.', 'error');
      }
    } finally {
      setRoomActionBusy(false);
    }
  };

  const handleQuickEnterRoom = async (roomId) => {
    if (!api?.quickEnterSharedRoom || roomActionBusy) return;
    setRoomActionBusy(true);
    setShowJoinedRoomsPopover(false);
    try {
      const res = await api.quickEnterSharedRoom({ roomId });
      if (res?.ok && res.room) {
        setActiveRoom(res.room);
        setSelectedNoteIds([]);
        const stateRes = await api.getSharedState();
        if (stateRes?.recentRooms) setRecentRooms(stateRes.recentRooms);
        if (stateRes?.savedRooms) setSavedRooms(stateRes.savedRooms);
        if (stateRes?.joinedRooms) setJoinedRooms(stateRes.joinedRooms);
        showToast?.(`'${res.room.roomName}' 방에 바로 입장했습니다 ✓`, 'success');
      } else {
        showToast?.(res?.error || '방 바로 입장에 실패했습니다.', 'error');
      }
    } finally {
      setRoomActionBusy(false);
    }
  };

  const handleRemoveJoinedRoom = async (roomId, roomName) => {
    if (!api?.removeJoinedSharedRoom) return;
    const res = await api.removeJoinedSharedRoom({ roomId });
    if (res?.ok) {
      if (res.state?.joinedRooms) setJoinedRooms(res.state.joinedRooms);
      showToast?.(`'${roomName}' 방을 참여 목록에서 제거했습니다.`, 'info');
    }
  };

  const handleLeaveRoom = async () => {
    if (!api?.leaveSharedRoom) return;
    await api.leaveSharedRoom();
    setActiveRoom(null);
    setSelectedNoteIds([]);
    setShowRoomManageModal(false);
    setShowJoinedRoomsPopover(false);
    const stateRes = await api.getSharedState();
    if (stateRes?.recentRooms) setRecentRooms(stateRes.recentRooms);
    if (stateRes?.savedRooms) setSavedRooms(stateRes.savedRooms);
    if (stateRes?.joinedRooms) setJoinedRooms(stateRes.joinedRooms);
    showToast?.('방에서 나왔습니다.', 'info');
  };

  const handleSaveRoomNow = async () => {
    if (!api?.saveSharedRoomNow) return;
    const res = await api.saveSharedRoomNow();
    if (res?.ok) {
      if (res.room) setActiveRoom(res.room);
      if (res.state?.savedRooms) setSavedRooms(res.state.savedRooms);
      showToast?.('현재 방 상태와 모든 공유 노트가 저장되었습니다 ✓', 'success');
    } else {
      showToast?.(res?.error || '방 저장에 실패했습니다.', 'error');
    }
  };

  const handleExportRoom = async (roomId) => {
    if (!api?.exportSharedRoom) return;
    const res = await api.exportSharedRoom({ roomId });
    if (res?.ok) {
      showToast?.('공유 방 백업 파일(.json)이 저장되었습니다 ✓', 'success');
    } else if (!res?.canceled) {
      showToast?.(res?.error || '백업 파일 내보내기에 실패했습니다.', 'error');
    }
  };

  const handlePickRoomBackup = async () => {
    if (!api?.pickSharedRoomBackup) return;
    const res = await api.pickSharedRoomBackup();
    if (res?.ok && res.backupData) {
      setImportBackupDraft({
        backupData: res.backupData,
        roomName: res.defaultRoomName || '',
        password: '',
        noteCount: res.noteCount || 0,
        messageCount: res.messageCount || 0
      });
    } else if (!res?.canceled) {
      showToast?.(res?.error || '백업 파일을 열지 못했습니다.', 'error');
    }
  };

  const handleConfirmImportBackup = async (e) => {
    e.preventDefault();
    if (!api?.importSharedRoom || !importBackupDraft) return;
    const res = await api.importSharedRoom({
      backupData: importBackupDraft.backupData,
      roomName: importBackupDraft.roomName,
      password: importBackupDraft.password
    });
    if (res?.ok) {
      if (res.state?.savedRooms) setSavedRooms(res.state.savedRooms);
      if (res.state?.recentRooms) setRecentRooms(res.state.recentRooms);
      if (res.state?.joinedRooms) setJoinedRooms(res.state.joinedRooms);
      setHostRoomName(res.roomName || '');
      setHostPassword(importBackupDraft.password);
      setImportBackupDraft(null);
      showToast?.(`'${res.roomName}' 방을 복원했습니다. 위 [참여 중인 그룹 노트]에서 바로 들어갈 수 있습니다 ✓`, 'success');
    } else {
      showToast?.(res?.error || '방 복원에 실패했습니다.', 'error');
    }
  };

  const handleDeleteSavedRoom = async (roomId, roomName) => {
    if (!api?.deleteSavedSharedRoom) return;
    if (!window.confirm(`'${roomName}' 공유 방과 방 안의 모든 그룹 노트·채팅 기록을 영구 삭제하시겠습니까?`)) {
      return;
    }
    const res = await api.deleteSavedSharedRoom({ roomId });
    if (res?.ok) {
      if (res.state?.savedRooms) setSavedRooms(res.state.savedRooms);
      if (res.state?.recentRooms) setRecentRooms(res.state.recentRooms);
      if (res.state?.joinedRooms) setJoinedRooms(res.state.joinedRooms);
      if (activeRoom?.roomId === roomId) {
        setActiveRoom(null);
        setShowRoomManageModal(false);
      }
      showToast?.(`'${roomName}' 방이 영구 삭제되었습니다.`, 'info');
    } else {
      showToast?.(res?.error || '방 삭제에 실패했습니다.', 'error');
    }
  };

  const handleCopyInviteInfo = async () => {
    if (!activeRoom) return;
    const text = `[나무 노트 공유 방 초대]\n• 방 이름: ${activeRoom.roomName}\n• 초대 코드: ${activeRoom.inviteCode || '같은 네트워크 자동 탐색'}`;
    if (api?.writeSystemClipboard) {
      await api.writeSystemClipboard({ text });
    } else {
      navigator.clipboard?.writeText(text);
    }
    showToast?.('방 이름과 초대 코드가 복사되었습니다 ✓', 'success');
  };

  // ============================================================================
  // Handlers: Shared Notes CRUD & Smart Organization
  // ============================================================================
  const openCreateNoteModal = (defaultSectionId = 'idea') => {
    setEditingNote(null);
    setNoteTitle('');
    setNoteSectionId(defaultSectionId);
    setNoteFolderId(selectedFolderId === 'all-notes' ? 'meeting' : selectedFolderId);
    setNoteStatusBadge('');
    setNoteTagsInput('');
    setNotePinned(false);
    setNoteImage('');
    setNoteChecklist([]);
    setNewCheckItemText('');
    setShowNoteModal(true);
    setTimeout(() => {
      if (noteEditorRef.current) noteEditorRef.current.innerHTML = '';
    }, 30);
  };

  const openEditNoteModal = (note) => {
    setEditingNote(note);
    setNoteTitle(note.title || '');
    setNoteSectionId(note.sectionId || 'idea');
    setNoteFolderId(note.folderId || 'all-notes');
    setNoteStatusBadge(note.statusBadge || '');
    setNoteTagsInput((note.tags || []).join(', '));
    setNotePinned(Boolean(note.pinned));
    setNoteImage(note.imageDataUrl || '');
    setNoteChecklist(Array.isArray(note.checklist) ? [...note.checklist] : []);
    setNewCheckItemText('');
    setShowNoteModal(true);
    setTimeout(() => {
      if (noteEditorRef.current) {
        noteEditorRef.current.innerHTML = normalizeContentToSafeHtml(note.content || '');
      }
    }, 30);
  };

  const handleAddChecklistItem = () => {
    const trimmed = newCheckItemText.trim();
    if (!trimmed) return;
    setNoteChecklist((prev) => [
      ...prev,
      { id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: trimmed, done: false }
    ]);
    setNewCheckItemText('');
  };

  const handleSaveSharedNote = async (e) => {
    e.preventDefault();
    const rawHtml = noteEditorRef.current ? noteEditorRef.current.innerHTML : '';
    const safeHtml = sanitizeNoteHtml(rawHtml);
    const plain = getPlainText(safeHtml);

    if (!noteTitle.trim() && !plain && !noteImage && noteChecklist.length === 0) {
      showToast?.('노트 제목이나 본문, 체크리스트 중 하나를 입력해 주세요.', 'error');
      return;
    }

    const parsedTags = noteTagsInput
      .split(/[,#\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const sectionObj = (activeRoom?.sections || []).find((s) => s.id === noteSectionId);

    const payload = {
      id: editingNote?.id,
      title: noteTitle.trim() || plain.slice(0, 40) || '공유 노트',
      content: safeHtml,
      category: sectionObj?.title || '💡 아이디어',
      sectionId: noteSectionId,
      folderId: noteFolderId,
      statusBadge: noteStatusBadge,
      checklist: noteChecklist,
      tags: parsedTags,
      pinned: notePinned,
      imageDataUrl: noteImage
    };

    const res = await api.dispatchSharedAction({
      type: editingNote ? 'UPDATE_NOTE' : 'ADD_NOTE',
      note: payload
    });

    if (res?.ok) {
      setShowNoteModal(false);
      setEditingNote(null);
      showToast?.(editingNote ? '공유 노트가 수정되었습니다 ✓' : '새 공유 노트가 등록되었습니다 ✓', 'success');
    } else {
      showToast?.(res?.error || '저장에 실패했습니다.', 'error');
    }
  };

  const handleDeleteSharedNote = async (noteId) => {
    if (!window.confirm('이 공유 노트를 방에서 삭제하시겠습니까?')) return;
    const res = await api.dispatchSharedAction({
      type: 'DELETE_NOTE',
      noteId
    });
    if (res?.ok) {
      if (viewingSharedNote?.id === noteId) setViewingSharedNote(null);
      setSelectedNoteIds((prev) => prev.filter((id) => id !== noteId));
      showToast?.('공유 노트가 삭제되었습니다.', 'info');
    } else {
      showToast?.(res?.error || '삭제 권한이 없습니다.', 'error');
    }
  };

  const handleBatchDeleteNotes = async () => {
    if (selectedNoteIds.length === 0) return;
    if (!window.confirm(`선택한 공유 노트 ${selectedNoteIds.length}개를 방에서 삭제하시겠습니까?`)) {
      return;
    }
    const res = await api.dispatchSharedAction({
      type: 'DELETE_NOTES_BATCH',
      noteIds: selectedNoteIds
    });
    if (res?.ok) {
      if (viewingSharedNote && selectedNoteIds.includes(viewingSharedNote.id)) {
        setViewingSharedNote(null);
      }
      setSelectedNoteIds([]);
      showToast?.('선택한 공유 노트가 삭제되었습니다 ✓', 'success');
    } else {
      showToast?.(res?.error || '일괄 삭제 권한이 없습니다.', 'error');
    }
  };

  const handleToggleChecklistItem = async (noteId, itemId) => {
    await api.dispatchSharedAction({
      type: 'TOGGLE_CHECKLIST_ITEM',
      noteId,
      itemId
    });
  };

  const handleMoveNotes = async (noteIds, { sectionId, folderId, statusBadge }) => {
    const res = await api.dispatchSharedAction({
      type: 'MOVE_NOTES',
      noteIds,
      sectionId,
      folderId,
      statusBadge
    });
    if (res?.ok) {
      setSelectedNoteIds([]);
      showToast?.('노트 분류가 변경되었습니다 ✓', 'success');
    } else {
      showToast?.(res?.error || '변경에 실패했습니다.', 'error');
    }
  };

  const handleExecuteSmartMerge = async (e) => {
    e.preventDefault();
    if (selectedNoteIds.length < 2) return;
    const res = await api.dispatchSharedAction({
      type: 'MERGE_NOTES',
      noteIds: selectedNoteIds,
      mergedTitle: mergeTitle,
      removeOriginal: mergeRemoveOriginals,
      targetSectionId: 'done',
      targetFolderId: selectedFolderId === 'all-notes' ? 'meeting' : selectedFolderId
    });
    if (res?.ok) {
      setShowMergeModal(false);
      setSelectedNoteIds([]);
      setMergeTitle('');
      showToast?.(`선택한 노트 ${selectedNoteIds.length}개를 하나로 깔끔하게 병합했습니다 ✓`, 'success');
    } else {
      showToast?.(res?.error || '병합에 실패했습니다.', 'error');
    }
  };

  const handleSharePersonalNoteToRoom = async (personalNote) => {
    const res = await api.dispatchSharedAction({
      type: 'ADD_NOTE',
      note: {
        title: personalNote.title || '내 노트에서 공유됨',
        content: personalNote.content || '',
        sectionId: 'idea',
        folderId: selectedFolderId === 'all-notes' ? 'reference' : selectedFolderId,
        statusBadge: '',
        tags: personalNote.tags || [],
        imageDataUrl: personalNote.imageDataUrl || ''
      }
    });
    if (res?.ok) {
      setShowPersonalPicker(false);
      showToast?.(`'${personalNote.title}' 노트를 공유 방에 게시했습니다 ✓`, 'success');
    } else {
      showToast?.(res?.error || '공유에 실패했습니다.', 'error');
    }
  };

  // ============================================================================
  // Handlers: Sections & Folders Management
  // ============================================================================
  const handleAddSection = async (e) => {
    e.preventDefault();
    if (!newSectionTitle.trim()) return;
    const res = await api.dispatchSharedAction({
      type: 'ADD_SECTION',
      title: newSectionTitle.trim(),
      color: 'blue'
    });
    if (res?.ok) {
      setNewSectionTitle('');
      setShowNewSectionInput(false);
    } else {
      showToast?.(res?.error || '섹션 추가 실패', 'error');
    }
  };

  const handleAddFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const res = await api.dispatchSharedAction({
      type: 'ADD_FOLDER',
      name: newFolderName.trim(),
      icon: '📁'
    });
    if (res?.ok) {
      setNewFolderName('');
      setShowNewFolderInput(false);
    } else {
      showToast?.(res?.error || '폴더 추가 실패', 'error');
    }
  };

  const handleRenameSection = async (e) => {
    e.preventDefault();
    if (!editingSectionId || !editingSectionTitle.trim()) return;
    const res = await api.dispatchSharedAction({
      type: 'RENAME_SECTION',
      sectionId: editingSectionId,
      title: editingSectionTitle.trim()
    });
    if (res?.ok) {
      setEditingSectionId(null);
      setEditingSectionTitle('');
      showToast?.('섹션 이름이 변경되었습니다 ✓', 'success');
    } else {
      showToast?.(res?.error || '섹션 이름 변경 실패', 'error');
    }
  };

  const handleDeleteSection = async (section) => {
    if (!window.confirm(`'${section.title}' 섹션을 삭제하시겠습니까? 섹션 안의 노트는 첫 번째 섹션으로 이동됩니다.`)) {
      return;
    }
    const res = await api.dispatchSharedAction({
      type: 'DELETE_SECTION',
      sectionId: section.id
    });
    if (res?.ok) {
      showToast?.('섹션이 삭제되었습니다.', 'info');
    } else {
      showToast?.(res?.error || '섹션 삭제 실패', 'error');
    }
  };

  const handleDeleteFolder = async (folder) => {
    if (!window.confirm(`'${folder.name}' 폴더를 삭제하시겠습니까? 노트는 [전체 공유 노트]로 이동됩니다.`)) {
      return;
    }
    const res = await api.dispatchSharedAction({
      type: 'DELETE_FOLDER',
      folderId: folder.id
    });
    if (res?.ok) {
      if (selectedFolderId === folder.id) setSelectedFolderId('all-notes');
      showToast?.('폴더가 삭제되었습니다.', 'info');
    } else {
      showToast?.(res?.error || '폴더 삭제 실패', 'error');
    }
  };

  // ============================================================================
  // Handlers: Real-Time Group Chat & Promote to Note
  // ============================================================================
  const handleSendChat = async (e) => {
    e?.preventDefault();
    if (!chatInput.trim() && !chatImage && !chatShareNoteRef) return;
    const res = await api.dispatchSharedAction({
      type: 'SEND_CHAT',
      message: {
        text: chatInput.trim(),
        imageDataUrl: chatImage,
        sharedNoteRef: chatShareNoteRef
      }
    });
    if (res?.ok) {
      setChatInput('');
      setChatImage('');
      setChatShareNoteRef(null);
    } else {
      showToast?.(res?.error || '메시지 전송 실패', 'error');
    }
  };

  const handlePromoteChatToNote = async (messageId) => {
    const res = await api.dispatchSharedAction({
      type: 'PROMOTE_CHAT_TO_NOTE',
      messageId,
      sectionId: 'idea',
      folderId: selectedFolderId === 'all-notes' ? 'meeting' : selectedFolderId
    });
    if (res?.ok) {
      showToast?.('채팅 메시지를 공유 노트로 박제했습니다 📌', 'success');
    } else {
      showToast?.(res?.error || '노트 박제 실패', 'error');
    }
  };

  const handleChatPaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            setChatImage(reader.result);
          }
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  // Filtered Shared Notes
  const filteredRoomNotes = useMemo(() => {
    const list = activeRoom?.notes || [];
    const q = roomSearch.trim().toLowerCase();
    return list.filter((n) => {
      if (selectedFolderId !== 'all-notes' && n.folderId !== selectedFolderId) {
        return false;
      }
      if (statusFilter !== 'all' && n.statusBadge !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const plain = getPlainText(n.content || '').toLowerCase();
      const title = (n.title || '').toLowerCase();
      const tags = (n.tags || []).join(' ').toLowerCase();
      const authorName = (n.author?.name || '').toLowerCase();
      return (
        title.includes(q) || plain.includes(q) || tags.includes(q) || authorName.includes(q)
      );
    });
  }, [activeRoom?.notes, selectedFolderId, statusFilter, roomSearch]);

  if (loadingInit) {
    return (
      <div className="p-12 text-center text-sm text-zinc-400">
        공유 스페이스 불러오는 중...
      </div>
    );
  }

  // ============================================================================
  // VIEW 1: Native Account Login / Sign-up Gate (!currentAccount)
  // ============================================================================
  if (!currentAccount) {
    return (
      <div className="max-w-lg mx-auto my-8 bg-surface-light dark:bg-surface-dark rounded-2xl border border-line-light dark:border-line-dark shadow-sm p-7 flex flex-col gap-5">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center shrink-0 text-2xl">
            🔐
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              {authMode === 'signup' ? 'TreeNote Account Sign Up' : 'TreeNote Account'}
            </span>
            <h2 className="text-lg font-extrabold text-zinc-900 dark:text-zinc-100">
              {authMode === 'signup' ? '공유 스페이스 회원가입' : '공유 스페이스 로그인'}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {authMode === 'signup'
                ? '사용할 아이디와 비밀번호를 등록한 뒤 바로 로그인할 수 있습니다.'
                : '아이디와 비밀번호로 로그인해 공유 방 호스트, 그룹 노트 정리, 실시간 채팅을 이용하세요.'}
            </p>
          </div>
        </div>

        {authMode === 'login' ? (
          <form onSubmit={handleLoginSubmit} className="flex flex-col gap-3.5">
            {registeredAccounts.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400">
                  이 기기에 등록된 계정
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {registeredAccounts.map((acc) => {
                    const selected = loginIdInput.trim().toLowerCase() === acc.accountId;
                    return (
                      <button
                        key={acc.uid}
                        type="button"
                        onClick={() => {
                          setLoginIdInput(acc.accountId);
                          setAuthError('');
                          setTimeout(() => loginPasswordInputRef.current?.focus(), 20);
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
                          selected
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-canvas-light dark:bg-canvas-dark text-zinc-700 dark:text-zinc-200 border-line-light dark:border-line-dark hover:border-blue-500/50'
                        }`}
                      >
                        <span
                          style={{ backgroundColor: acc.avatarColor || '#2563EB' }}
                          className="w-4 h-4 rounded-full text-[9px] text-white font-bold flex items-center justify-center"
                        >
                          {(acc.name || acc.accountId).charAt(0).toUpperCase()}
                        </span>
                        <span>@{acc.accountId}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                아이디
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={loginIdInput}
                onChange={(e) => {
                  setLoginIdInput(e.target.value);
                  setAuthError('');
                }}
                placeholder="아이디 입력 (예: alice_01)"
                className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-sm text-zinc-900 dark:text-white outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                비밀번호
              </label>
              <input
                ref={loginPasswordInputRef}
                type="password"
                required
                autoComplete="current-password"
                value={loginPasswordInput}
                onChange={(e) => {
                  setLoginPasswordInput(e.target.value);
                  setAuthError('');
                }}
                placeholder="비밀번호 입력"
                className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-sm text-zinc-900 dark:text-white outline-none focus:border-blue-500"
              />
            </div>

            {authError && (
              <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/25 text-xs font-semibold text-red-600 dark:text-red-400">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authBusy}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold shadow-sm transition-colors"
            >
              {authBusy ? '로그인 확인 중...' : '로그인'}
            </button>

            <div className="flex items-center justify-between pt-2 border-t border-line-light dark:border-line-dark text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">
                계정이 아직 없으신가요?
              </span>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('signup');
                  setAuthError('');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-muted-light dark:bg-muted-dark hover:bg-blue-600/10 hover:text-blue-600 dark:hover:text-blue-400 text-zinc-700 dark:text-zinc-200 font-bold border border-line-light dark:border-line-dark transition-colors"
              >
                회원가입
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSignupSubmit} className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                아이디 <span className="font-normal text-zinc-400">(영문 소문자·숫자·_·-, 3~24자)</span>
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={signupIdInput}
                onChange={(e) => {
                  setSignupIdInput(e.target.value);
                  setAuthError('');
                }}
                placeholder="사용할 아이디 입력 (예: minsu_note)"
                className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-sm text-zinc-900 dark:text-white outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                표시 이름 <span className="font-normal text-zinc-400">(선택 · 비워두면 아이디로 표시)</span>
              </label>
              <input
                type="text"
                value={signupNameInput}
                onChange={(e) => setSignupNameInput(e.target.value)}
                placeholder="방에 표시될 이름"
                className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-sm text-zinc-900 dark:text-white outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                  비밀번호 <span className="font-normal text-zinc-400">(6자 이상)</span>
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={signupPasswordInput}
                  onChange={(e) => {
                    setSignupPasswordInput(e.target.value);
                    setAuthError('');
                  }}
                  placeholder="비밀번호"
                  className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-sm text-zinc-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                  비밀번호 확인
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={signupConfirmInput}
                  onChange={(e) => {
                    setSignupConfirmInput(e.target.value);
                    setAuthError('');
                  }}
                  placeholder="비밀번호 재입력"
                  className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-sm text-zinc-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {authError && (
              <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/25 text-xs font-semibold text-red-600 dark:text-red-400">
                {authError}
              </div>
            )}

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setAuthError('');
                }}
                className="px-4 py-3 rounded-xl bg-muted-light dark:bg-muted-dark hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-sm font-bold border border-line-light dark:border-line-dark transition-colors"
              >
                로그인으로 돌아가기
              </button>
              <button
                type="submit"
                disabled={authBusy}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold shadow-sm transition-colors"
              >
                {authBusy ? '계정 생성 중...' : '가입 완료'}
              </button>
            </div>
          </form>
        )}

        <div className="p-3 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-[11px] text-zinc-500 dark:text-zinc-400">
          🛡️ 계정 정보는 기기에 암호화되어 안전하게 보관됩니다.
        </div>
      </div>
    );
  }

  // ============================================================================
  // VIEW 2: Room Lobby (Create/Host a Room or Join with Room Name + Password)
  // ============================================================================
  if (!activeRoom) {
    return (
      <div className="flex flex-col gap-5">
        {/* 상단 내 계정 프로필 바 */}
        <div className="bg-surface-light dark:bg-surface-dark p-4 rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <UserAvatar user={currentAccount} size="lg" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                  {currentAccount.name}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  TreeNote 계정
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                @{currentAccount.accountId}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenAccountSettings}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-700 dark:text-zinc-200 bg-canvas-light dark:bg-canvas-dark hover:border-blue-500/50 border border-line-light dark:border-line-dark transition-colors"
            >
              계정 설정
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-300 bg-muted-light dark:bg-muted-dark hover:bg-red-500/10 hover:text-red-500 border border-line-light dark:border-line-dark transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>

        {/* 참여 중인 그룹 노트 (비밀번호 재입력 없이 바로 들어가기) */}
        <div className="bg-surface-light dark:bg-surface-dark p-5 rounded-2xl border border-blue-500/25 dark:border-blue-500/20 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold px-2.5 py-1 rounded-md bg-blue-600/10 text-blue-600 dark:text-blue-400">
                🚪 참여 중인 그룹 노트 ({joinedRooms.length})
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                한 번 들어가거나 만든 방은 비밀번호를 다시 입력할 필요 없이 바로 들어가고 나올 수 있습니다.
              </span>
            </div>
          </div>

          {joinedRooms.length === 0 ? (
            <div className="py-4 text-center text-xs text-zinc-400 border border-dashed border-line-light dark:border-line-dark rounded-xl">
              아직 참여 중인 그룹 노트가 없습니다. 아래에서 새 방을 만들거나 기존 방에 한 번 입장하면 이곳에 고정됩니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {joinedRooms.map((jr) => (
                <div
                  key={jr.roomId}
                  className="p-3.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark hover:border-blue-500/50 flex flex-col justify-between gap-2.5 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 truncate">
                        {jr.roomName}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                          jr.role === 'host'
                            ? 'bg-blue-600/15 text-blue-600 dark:text-blue-400'
                            : 'bg-emerald-600/15 text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {jr.role === 'host' ? '👑 방장' : '🟢 참여 중'}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                      {jr.hostName ? `방장: ${jr.hostName}` : ''} · 노트 {jr.noteCount || 0}개 · 채팅{' '}
                      {jr.messageCount || 0}개
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={roomActionBusy}
                      onClick={() => handleQuickEnterRoom(jr.roomId)}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold transition-colors"
                    >
                      {roomActionBusy ? '연결 중...' : '🚀 바로 들어가기'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveJoinedRoom(jr.roomId, jr.roomName)}
                      title="참여 목록에서 제거"
                      className="px-2 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark hover:bg-red-500/10 text-zinc-400 hover:text-red-500 border border-line-light dark:border-line-dark text-[11px] font-bold transition-colors"
                    >
                      제거
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 방 호스트하기 vs 방 참가하기 2단 카드 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 1) 방 호스트하기 (방 만들기) */}
          <form
            onSubmit={handleHostRoom}
            className="bg-surface-light dark:bg-surface-dark p-6 rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-col justify-between gap-4"
          >
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-blue-600/10 text-blue-600 dark:text-blue-400">
                  🏠 HOST A ROOM
                </span>
                <span className="text-[11px] text-zinc-400">AES-256 종단간 암호화</span>
              </div>
              <div>
                <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                  새 공유 방 호스트하기 (방 만들기)
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  방 이름과 비밀번호를 정해 그룹 스페이스를 엽니다. 이전에 만든 방 이름을 입력하면 기존 데이터가 그대로 복원됩니다.
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">방 이름</label>
                <input
                  type="text"
                  required
                  value={hostRoomName}
                  onChange={(e) => setHostRoomName(e.target.value)}
                  placeholder="예: 디자인팀 회의방, 스터디 노트"
                  className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs sm:text-sm font-normal text-zinc-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">방 비밀번호</label>
                <input
                  type="password"
                  required
                  value={hostPassword}
                  onChange={(e) => setHostPassword(e.target.value)}
                  placeholder="입장 및 암호화에 사용할 비밀번호 (2자 이상)"
                  className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs sm:text-sm font-normal text-zinc-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">멤버 편집 권한</label>
                <select
                  value={hostPermissionMode}
                  onChange={(e) => setHostPermissionMode(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-zinc-900 border border-line-light dark:border-line-dark text-xs font-medium text-zinc-800 dark:text-zinc-200 outline-none"
                >
                  <option value="all">모두 노트 작성 · 편집 · 삭제 가능 (공동 작업)</option>
                  <option value="host-delete">모두 작성 · 편집 가능 / 삭제는 호스트와 본인만</option>
                  <option value="readonly">호스트만 노트 편집 가능 / 멤버는 열람 및 채팅만 (공지방)</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={roomActionBusy}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors mt-2"
            >
              {roomActionBusy ? '방 준비 중...' : '🚀 방 호스트 시작하기'}
            </button>
          </form>

          {/* 2) 방 참가하기 (방 이름 + 비밀번호로 입장) */}
          <form
            onSubmit={handleJoinRoom}
            className="bg-surface-light dark:bg-surface-dark p-6 rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-col justify-between gap-4"
          >
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-emerald-600/10 text-emerald-600 dark:text-emerald-400">
                  🔑 JOIN A ROOM
                </span>
                <span className="text-[11px] text-zinc-400">방 이름 + 비밀번호 입장</span>
              </div>
              <div>
                <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                  열려 있는 공유 방 들어가기
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  다른 PC·다른 네트워크에서도 방 이름과 비밀번호만으로 바로 입장됩니다.
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">방 이름</label>
                <input
                  type="text"
                  required
                  value={joinRoomName}
                  onChange={(e) => setJoinRoomName(e.target.value)}
                  placeholder="입장할 방 이름 입력"
                  className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs sm:text-sm font-normal text-zinc-900 dark:text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">방 비밀번호</label>
                <input
                  type="password"
                  required
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  placeholder="방 비밀번호 입력"
                  className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs sm:text-sm font-normal text-zinc-900 dark:text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                  초대 코드 <span className="text-[11px] font-normal text-zinc-400">(선택 사항 · 비워두어도 온라인 자동 탐색)</span>
                </label>
                <input
                  type="text"
                  value={joinHostCode}
                  onChange={(e) => setJoinHostCode(e.target.value)}
                  placeholder="선택 사항: 초대 코드 또는 복사된 초대 메시지 붙여넣기"
                  className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs font-medium text-zinc-800 dark:text-zinc-200 outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={roomActionBusy}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors mt-2"
            >
              {roomActionBusy ? '온라인 / LAN 방 탐색 중...' : '✨ 방 입장하기'}
            </button>
          </form>
        </div>

        {/* 저장된 내 공유 방 (호스트 생성 후 자동 저장됨 · 열기 / 백업 내보내기 / 영구 삭제 / 백업 불러오기) */}
        <div className="bg-surface-light dark:bg-surface-dark p-5 rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                💾 저장된 내 공유 방 ({savedRooms.length})
              </h4>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                만든 방과 노트·채팅 내역은 자동으로 이 기기에 영구 저장되며 언제든 다시 열거나 파일로 백업할 수 있습니다.
              </p>
            </div>
            <button
              type="button"
              onClick={handlePickRoomBackup}
              className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 shrink-0 transition-colors"
            >
              📂 백업 파일(.json)에서 방 불러오기
            </button>
          </div>

          {savedRooms.length === 0 ? (
            <div className="py-5 text-center text-xs text-zinc-400 border border-dashed border-line-light dark:border-line-dark rounded-xl">
              아직 저장된 공유 방이 없습니다. 위에서 새 방을 호스트하면 자동 저장됩니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {savedRooms.map((sr) => (
                <div
                  key={sr.roomId}
                  className="p-3.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 truncate">
                      {sr.roomName}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      노트 {sr.noteCount}개 · 채팅 {sr.messageCount}개 · 최근 저장{' '}
                      {sr.updatedAt
                        ? new Date(sr.updatedAt).toLocaleDateString('ko-KR', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : '-'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setHostRoomName(sr.roomName);
                        setHostPermissionMode(sr.permissionMode || 'all');
                        showToast?.(`'${sr.roomName}' 방이 선택되었습니다. 비밀번호 입력 후 [방 호스트 시작하기]를 누르세요.`, 'info');
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold transition-colors"
                    >
                      열기
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportRoom(sr.roomId)}
                      title="백업 파일(.json)로 저장"
                      className="px-2 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-[11px] font-bold text-zinc-700 dark:text-zinc-200 transition-colors"
                    >
                      백업
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSavedRoom(sr.roomId, sr.roomName)}
                      title="저장된 방 영구 삭제"
                      className="px-2 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white text-[11px] font-bold transition-colors"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 백업 파일 복원 모달 */}
        {importBackupDraft && (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setImportBackupDraft(null)}
          >
            <form
              onSubmit={handleConfirmImportBackup}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-surface-light dark:bg-surface-dark rounded-2xl border border-line-light dark:border-line-dark shadow-2xl p-5 flex flex-col gap-4"
            >
              <div className="flex items-center justify-between border-b border-line-light dark:border-line-dark pb-3">
                <div>
                  <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                    📂 공유 방 백업 복원
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    공유 노트 {importBackupDraft.noteCount}개 · 채팅 {importBackupDraft.messageCount}개를 불러옵니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setImportBackupDraft(null)}
                  className="text-sm text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">방 이름</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={importBackupDraft.roomName}
                  onChange={(e) =>
                    setImportBackupDraft((prev) => ({ ...prev, roomName: e.target.value }))
                  }
                  className="px-3 py-2 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs font-normal text-zinc-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                  입장 비밀번호 설정 (2자 이상)
                </label>
                <input
                  type="password"
                  required
                  minLength={2}
                  value={importBackupDraft.password}
                  onChange={(e) =>
                    setImportBackupDraft((prev) => ({ ...prev, password: e.target.value }))
                  }
                  placeholder="멤버와 공유할 비밀번호 입력"
                  autoFocus
                  className="px-3 py-2 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs font-normal text-zinc-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setImportBackupDraft(null)}
                  className="px-3 py-2 rounded-xl bg-muted-light dark:bg-muted-dark text-xs font-bold text-zinc-600 dark:text-zinc-300"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                >
                  복원 후 저장
                </button>
              </div>
            </form>
          </div>
        )}

        {/* 최근 호스트/참여했던 방 목록 */}
        {recentRooms.length > 0 && (
          <div className="bg-surface-light dark:bg-surface-dark p-5 rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              🕒 최근 사용한 공유 방 (클릭하여 방 이름 자동 입력)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {recentRooms.map((r) => (
                <button
                  key={r.roomId}
                  type="button"
                  onClick={() => {
                    if (r.isHost) {
                      setHostRoomName(r.roomName);
                    } else {
                      setJoinRoomName(r.roomName);
                      setJoinHostCode(r.hostCode || '');
                    }
                    showToast?.(`'${r.roomName}' 방 정보가 입력칸에 채워졌습니다. 비밀번호를 입력해 주세요.`, 'info');
                  }}
                  className="p-3 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:border-blue-500/50 border border-line-light dark:border-line-dark text-left flex items-center justify-between gap-2 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                      {r.roomName}
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {r.isHost ? '내가 호스트한 방' : '참여했던 방'}
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-muted-light dark:bg-muted-dark text-zinc-600 dark:text-zinc-300 shrink-0">
                    선택
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 계정 설정 모달 (표시 이름 변경, 비밀번호 변경, 계정 삭제) */}
        {showAccountSettings && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-surface-light dark:bg-surface-dark rounded-2xl border border-line-light dark:border-line-dark shadow-2xl p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-line-light dark:border-line-dark pb-3">
                <div>
                  <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                    계정 설정 (@{currentAccount.accountId})
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    표시 이름, 비밀번호 변경 또는 로컬 계정을 관리합니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAccountSettings(false)}
                  className="text-sm text-zinc-400 hover:text-zinc-600"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleUpdateAccount} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                    표시 이름
                  </label>
                  <input
                    type="text"
                    required
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    placeholder="표시 이름"
                    className="px-3 py-2 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs text-zinc-900 dark:text-white outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                    새 비밀번호 <span className="font-normal text-zinc-400">(변경할 경우에만 입력)</span>
                  </label>
                  <input
                    type="password"
                    minLength={6}
                    value={newPwdInput}
                    onChange={(e) => setNewPwdInput(e.target.value)}
                    placeholder="새 비밀번호 (6자 이상)"
                    className="px-3 py-2 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs text-zinc-900 dark:text-white outline-none focus:border-blue-500"
                  />
                </div>

                {newPwdInput && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                      현재 비밀번호 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      value={currPwdInput}
                      onChange={(e) => setCurrPwdInput(e.target.value)}
                      placeholder="현재 비밀번호 확인"
                      className="px-3 py-2 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs text-zinc-900 dark:text-white outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={accountEditBusy}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold transition-colors"
                >
                  {accountEditBusy ? '저장 중...' : '변경 내용 저장'}
                </button>
              </form>

              <form
                onSubmit={handleDeleteAccount}
                className="pt-3 border-t border-line-light dark:border-line-dark flex flex-col gap-2"
              >
                <span className="text-[11px] font-bold text-red-500">계정 영구 삭제</span>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={deletePwdInput}
                    onChange={(e) => setDeletePwdInput(e.target.value)}
                    placeholder="삭제 확인용 비밀번호"
                    className="flex-1 px-3 py-2 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs text-zinc-900 dark:text-white outline-none focus:border-red-500"
                  />
                  <button
                    type="submit"
                    disabled={accountEditBusy}
                    className="px-3 py-2 rounded-xl bg-red-500/15 hover:bg-red-600 text-red-600 hover:text-white text-xs font-bold border border-red-500/30 transition-colors shrink-0"
                  >
                    계정 삭제
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // VIEW 3: Active Shared Room Workspace (Notes Board + Smart Organizer + Chat)
  // ============================================================================
  const isHost = activeRoom.mode === 'host' || activeRoom.hostProfile?.uid === currentAccount.uid;

  return (
    <div className="flex flex-col gap-3.5 min-w-0">
      {/* 1. 상단 방 컨트롤 헤더 */}
      <div className="bg-surface-light dark:bg-surface-dark px-4 py-3 rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-blue-600 text-white font-extrabold flex items-center justify-center shadow-sm shrink-0">
            👥
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-sm sm:text-base font-extrabold text-zinc-900 dark:text-zinc-100 truncate max-w-[260px] sm:max-w-xs">
                {activeRoom.roomName}
              </h2>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${
                  isHost
                    ? 'bg-blue-600/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                    : 'bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                }`}
              >
                {isHost ? '👑 호스트' : '🟢 멤버'}
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-muted-light dark:bg-muted-dark text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                {activeRoom.permissionMode === 'readonly'
                  ? '🔒 읽기 전용'
                  : activeRoom.permissionMode === 'host-delete'
                  ? '🛡️ 삭제 보호'
                  : '✏️ 모두 편집'}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap border ${
                  activeRoom.relayConnected
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                    : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                }`}
                title="다른 PC·외부 네트워크 접속 가능 상태"
              >
                {activeRoom.relayConnected ? '🌐 온라인 연결됨' : '📡 로컬 네트워크'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
              방장: {activeRoom.hostProfile?.name} (@{activeRoom.hostProfile?.accountId || 'host'}) · 💾 자동 저장됨
              {activeRoom.lastSavedAt
                ? ` (${new Date(activeRoom.lastSavedAt).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })})`
                : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* 접속 멤버 보기 & 권한 관리 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMembersPopover((v) => !v)}
              className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>멤버 {(activeRoom.members || []).length}명</span>
            </button>

            {showMembersPopover && (
              <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-32px)] bg-surface-light dark:bg-surface-dark rounded-2xl border border-line-light dark:border-line-dark shadow-xl p-3.5 z-40 flex flex-col gap-2.5">
                <div className="flex items-center justify-between border-b border-line-light dark:border-line-dark pb-2">
                  <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    접속 중인 멤버
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowMembersPopover(false)}
                    className="text-xs text-zinc-400 hover:text-zinc-600 px-1"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                  {(activeRoom.members || []).map((m) => (
                    <div key={m.uid} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserAvatar user={m} size="sm" />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                            {m.name} {m.isHost && '👑'}
                          </div>
                          <div className="text-[10px] text-zinc-400 truncate">
                            {m.accountId ? `@${m.accountId}` : m.uid?.slice(0, 8)}
                          </div>
                        </div>
                      </div>
                      {isHost && !m.isHost && (
                        <button
                          type="button"
                          onClick={() =>
                            api.dispatchSharedAction({ type: 'KICK_MEMBER', targetUid: m.uid })
                          }
                          className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white shrink-0"
                        >
                          내보내기
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {isHost && (
                  <div className="pt-2 border-t border-line-light dark:border-line-dark flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-zinc-400">방 편집 권한 변경</label>
                    <select
                      value={activeRoom.permissionMode || 'all'}
                      onChange={(e) =>
                        api.dispatchSharedAction({
                          type: 'SET_PERMISSION_MODE',
                          permissionMode: e.target.value
                        })
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-canvas-light dark:bg-zinc-900 border border-line-light dark:border-line-dark text-xs font-semibold text-zinc-800 dark:text-zinc-200 outline-none"
                    >
                      <option value="all">모두 편집 가능</option>
                      <option value="host-delete">호스트만 삭제 가능</option>
                      <option value="readonly">읽기 전용 (호스트만 작성)</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleCopyInviteInfo}
            className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 whitespace-nowrap shrink-0 transition-colors"
            title="방 이름과 초대 코드 복사"
          >
            🔗 초대 코드 복사
          </button>

          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors whitespace-nowrap shrink-0 ${
              chatOpen
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-canvas-light dark:bg-canvas-dark text-zinc-700 dark:text-zinc-200 border-line-light dark:border-line-dark'
            }`}
          >
            💬 채팅 ({(activeRoom.messages || []).length})
          </button>

          <button
            type="button"
            onClick={handleSaveRoomNow}
            className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 whitespace-nowrap shrink-0 transition-colors"
            title="현재 방 상태를 즉시 저장"
          >
            💾 방 저장
          </button>

          <button
            type="button"
            onClick={() => setShowRoomManageModal(true)}
            className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 whitespace-nowrap shrink-0 transition-colors"
            title="백업 내보내기 및 방 설정·삭제"
          >
            ⚙️ 방 관리
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowJoinedRoomsPopover((v) => !v)}
              className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 whitespace-nowrap shrink-0 transition-colors"
              title="참여 중인 다른 그룹 노트 바로 전환 또는 로비로 이동"
            >
              🚪 참여 방 ({joinedRooms.length})
            </button>

            {showJoinedRoomsPopover && (
              <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-32px)] bg-surface-light dark:bg-surface-dark rounded-2xl border border-line-light dark:border-line-dark shadow-xl p-3.5 z-40 flex flex-col gap-2.5">
                <div className="flex items-center justify-between border-b border-line-light dark:border-line-dark pb-2">
                  <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    참여 중인 그룹 노트 (비밀번호 없이 이동)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowJoinedRoomsPopover(false)}
                    className="text-xs text-zinc-400 hover:text-zinc-600 px-1"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                  {joinedRooms.length === 0 ? (
                    <div className="text-[11px] text-zinc-400 py-3 text-center">
                      저장된 참여 방이 없습니다.
                    </div>
                  ) : (
                    joinedRooms.map((jr) => {
                      const isCurr = jr.roomId === activeRoom.roomId;
                      return (
                        <button
                          key={jr.roomId}
                          type="button"
                          disabled={roomActionBusy}
                          onClick={() => {
                            if (isCurr) {
                              setShowJoinedRoomsPopover(false);
                              return;
                            }
                            handleQuickEnterRoom(jr.roomId);
                          }}
                          className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors ${
                            isCurr
                              ? 'bg-blue-600/10 border-blue-500/40 text-blue-600 dark:text-blue-400'
                              : 'bg-canvas-light dark:bg-canvas-dark hover:border-blue-500/40 border-line-light dark:border-line-dark text-zinc-800 dark:text-zinc-200'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{jr.roomName}</div>
                            <div className="text-[10px] text-zinc-400 truncate">
                              {jr.role === 'host' ? '👑 방장' : '🟢 참여 중'} · 노트 {jr.noteCount || 0}개
                            </div>
                          </div>
                          <span className="text-[10px] font-bold shrink-0">
                            {isCurr ? '현재 방' : '이동 ↗'}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleLeaveRoom}
                  className="w-full py-2 rounded-xl bg-muted-light dark:bg-muted-dark hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-bold transition-colors"
                >
                  ← 로비(방 목록)로 나가기
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleLeaveRoom}
            className="px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-600 dark:text-red-400 hover:text-white border border-red-500/20 text-xs font-bold transition-colors whitespace-nowrap shrink-0"
          >
            방 나가기
          </button>
        </div>
      </div>

      {/* 2. 폴더(컬렉션) 정리 바 + 뷰 스위치 + 검색 + 액션 버튼 */}
      <div className="bg-surface-light dark:bg-surface-dark p-3 rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-col gap-2.5">
        {/* 상단 줄: 폴더 탭 & 새 폴더 */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {(activeRoom.folders || []).map((folder) => {
              const active = selectedFolderId === folder.id;
              return (
                <div key={folder.id} className="inline-flex items-center group">
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`px-2.5 py-1 text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                      isHost && folder.id !== 'all-notes' ? 'rounded-l-xl' : 'rounded-xl'
                    } ${
                      active
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm'
                        : 'bg-canvas-light dark:bg-canvas-dark text-zinc-600 dark:text-zinc-300 hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark'
                    }`}
                  >
                    <span>{folder.icon || '📁'}</span>
                    <span>{folder.name}</span>
                  </button>
                  {isHost && folder.id !== 'all-notes' && (
                    <button
                      type="button"
                      onClick={() => handleDeleteFolder(folder)}
                      title={`'${folder.name}' 폴더 삭제`}
                      className={`px-1.5 py-1 rounded-r-xl text-[10px] font-bold border-y border-r transition-colors ${
                        active
                          ? 'bg-zinc-800 dark:bg-zinc-200 text-zinc-300 dark:text-zinc-700 border-zinc-700 dark:border-zinc-300 hover:text-red-400'
                          : 'bg-canvas-light dark:bg-canvas-dark text-zinc-400 hover:text-red-500 border-line-light dark:border-line-dark'
                      }`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}

            {showNewFolderInput ? (
              <form onSubmit={handleAddFolder} className="flex items-center gap-1">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="새 폴더명"
                  autoFocus
                  className="px-2.5 py-1 rounded-lg bg-canvas-light dark:bg-canvas-dark border border-blue-500 text-xs text-zinc-900 dark:text-white outline-none w-28"
                />
                <button type="submit" className="px-2 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold">
                  추가
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewFolderInput(false)}
                  className="px-1.5 py-1 text-xs text-zinc-400"
                >
                  ✕
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowNewFolderInput(true)}
                className="px-2.5 py-1 rounded-xl text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 whitespace-nowrap"
              >
                + 폴더 추가
              </button>
            )}
          </div>

          {/* 우측: 새 공유 노트 작성 & 내 노트 불러오기 */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => setShowPersonalPicker(true)}
              className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 whitespace-nowrap"
            >
              📤 내 노트 불러오기
            </button>
            <button
              type="button"
              onClick={() => openCreateNoteModal('idea')}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm whitespace-nowrap"
            >
              + 새 공유 노트
            </button>
          </div>
        </div>

        {/* 하단 줄: 정리 뷰 모드 전환 + 상태 배지 필터 + 검색창 */}
        <div className="flex items-center justify-between gap-2.5 flex-wrap pt-2 border-t border-line-light dark:border-line-dark">
          <div className="flex items-center gap-1 bg-canvas-light dark:bg-canvas-dark p-1 rounded-xl border border-line-light dark:border-line-dark flex-wrap">
            <button
              type="button"
              onClick={() => setViewMode('board')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                viewMode === 'board'
                  ? 'bg-surface-light dark:bg-surface-dark text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-500'
              }`}
            >
              🗂️ 섹션 보드
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                viewMode === 'grid'
                  ? 'bg-surface-light dark:bg-surface-dark text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-500'
              }`}
            >
              📋 카드 그리드
            </button>
            <button
              type="button"
              onClick={() => setViewMode('checklist')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                viewMode === 'checklist'
                  ? 'bg-surface-light dark:bg-surface-dark text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-500'
              }`}
            >
              ☑️ 체크리스트
            </button>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl bg-canvas-light dark:bg-zinc-900 border border-line-light dark:border-line-dark text-xs font-semibold text-zinc-700 dark:text-zinc-200 outline-none shrink-0"
            >
              <option value="all">상태: 전체</option>
              <option value="중요">🔥 중요</option>
              <option value="검토필요">🧐 검토필요</option>
              <option value="확정">✅ 확정</option>
              <option value="질문">❓ 질문</option>
            </select>
            <input
              type="search"
              value={roomSearch}
              onChange={(e) => setRoomSearch(e.target.value)}
              placeholder="공유 노트 제목, 본문, 작성자 검색..."
              className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs font-medium text-zinc-900 dark:text-white outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* 3. 다중 선택 스마트 정리 & 병합 바 (Smart Merge Bar) */}
      {selectedNoteIds.length > 0 && (
        <div className="bg-blue-600 text-white px-4 py-2.5 rounded-2xl shadow-md flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold">
            <span>✨ {selectedNoteIds.length}개의 공유 노트가 선택됨</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedNoteIds.length >= 2 && (
              <button
                type="button"
                onClick={() => {
                  setMergeTitle('');
                  setMergeRemoveOriginals(false);
                  setShowMergeModal(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-white text-blue-600 text-xs font-extrabold shadow-sm hover:bg-blue-50"
              >
                🔗 선택 노트 하나로 합치기 (스마트 병합)
              </button>
            )}
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  handleMoveNotes(selectedNoteIds, { sectionId: e.target.value });
                  e.target.value = '';
                }
              }}
              className="px-2.5 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-bold outline-none border border-white/20"
            >
              <option value="" disabled>
                섹션 일괄 이동...
              </option>
              {(activeRoom.sections || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  handleMoveNotes(selectedNoteIds, { folderId: e.target.value });
                  e.target.value = '';
                }
              }}
              className="px-2.5 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-bold outline-none border border-white/20"
            >
              <option value="" disabled>
                폴더 일괄 이동...
              </option>
              {(activeRoom.folders || []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleBatchDeleteNotes}
              className="px-2.5 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-bold shadow-sm"
            >
              🗑️ 선택 삭제
            </button>
            <button
              type="button"
              onClick={() => setSelectedNoteIds([])}
              className="px-2.5 py-1.5 rounded-lg bg-blue-800/60 hover:bg-blue-800 text-xs font-bold"
            >
              선택 해제
            </button>
          </div>
        </div>
      )}

      {/* 4. 메인 영역: 좌측 공유 노트 보드 + 우측 실시간 그룹 채팅 */}
      <div className="flex flex-col xl:flex-row gap-4 items-stretch xl:items-start min-w-0">
        {/* 좌측 공유 노트 영역 */}
        <div className="flex-1 min-w-0 w-full">
          {/* (A) 섹션 칸반 보드 뷰 */}
          {viewMode === 'board' && (
            <div className="flex gap-3.5 overflow-x-auto pb-3 items-start">
              {(activeRoom.sections || []).map((section) => {
                const sectionNotes = filteredRoomNotes.filter(
                  (n) => (n.sectionId || 'idea') === section.id
                );
                const topBorder = SECTION_ACCENT_STYLES[section.color] || 'border-t-blue-500';
                const isDragOver = dragOverSectionId === section.id;

                return (
                  <div
                    key={section.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverSectionId(section.id);
                    }}
                    onDragLeave={() => setDragOverSectionId(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverSectionId(null);
                      if (draggedNoteId) {
                        handleMoveNotes([draggedNoteId], { sectionId: section.id });
                        setDraggedNoteId(null);
                      }
                    }}
                    className={`w-[272px] sm:w-[292px] shrink-0 bg-surface-light dark:bg-surface-dark rounded-2xl border border-line-light dark:border-line-dark border-t-4 ${topBorder} p-3.5 flex flex-col gap-3 transition-colors ${
                      isDragOver ? 'ring-2 ring-blue-500 bg-blue-500/5' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      {editingSectionId === section.id ? (
                        <form onSubmit={handleRenameSection} className="flex items-center gap-1 flex-1 min-w-0">
                          <input
                            type="text"
                            value={editingSectionTitle}
                            onChange={(e) => setEditingSectionTitle(e.target.value)}
                            autoFocus
                            className="flex-1 min-w-0 px-2 py-0.5 rounded-lg bg-canvas-light dark:bg-canvas-dark border border-blue-500 text-xs font-normal text-zinc-900 dark:text-white outline-none"
                          />
                          <button
                            type="submit"
                            className="text-[11px] font-bold text-blue-600 px-1.5 py-0.5"
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSectionId(null)}
                            className="text-[11px] text-zinc-400 px-1"
                          >
                            ✕
                          </button>
                        </form>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <h3 className="text-xs font-extrabold text-zinc-900 dark:text-zinc-100 truncate">
                              {section.title}
                            </h3>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-muted-light dark:bg-muted-dark text-zinc-600 dark:text-zinc-300 shrink-0">
                              {sectionNotes.length}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {isHost && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSectionId(section.id);
                                    setEditingSectionTitle(section.title);
                                  }}
                                  className="text-[11px] text-zinc-400 hover:text-blue-500 px-1"
                                  title="섹션 이름 변경"
                                >
                                  ✏️
                                </button>
                                {(activeRoom.sections || []).length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSection(section)}
                                    className="text-[11px] text-zinc-400 hover:text-red-500 px-1"
                                    title="섹션 삭제"
                                  >
                                    🗑️
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => openCreateNoteModal(section.id)}
                              className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 px-2 py-0.5 rounded-lg"
                              title="이 섹션에 노트 추가"
                            >
                              + 추가
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex flex-col gap-2.5 min-h-[120px]">
                      {sectionNotes.length === 0 ? (
                        <div className="py-8 text-center text-[11px] text-zinc-400 border border-dashed border-line-light dark:border-line-dark rounded-xl">
                          노트를 끌어다 놓거나 [+ 추가]를 누르세요
                        </div>
                      ) : (
                        sectionNotes.map((note) => (
                          <SharedNoteCard
                            key={note.id}
                            note={note}
                            isSelected={selectedNoteIds.includes(note.id)}
                            onToggleSelect={() =>
                              setSelectedNoteIds((prev) =>
                                prev.includes(note.id)
                                  ? prev.filter((id) => id !== note.id)
                                  : [...prev, note.id]
                              )
                            }
                            onDragStart={() => setDraggedNoteId(note.id)}
                            onView={() => setViewingSharedNote(note)}
                            onEdit={() => openEditNoteModal(note)}
                            onDelete={() => handleDeleteSharedNote(note.id)}
                            onToggleCheck={(itemId) => handleToggleChecklistItem(note.id, itemId)}
                            onSavePersonal={() => onSaveToPersonalNotes?.(note)}
                            onShareInChat={() => {
                              setChatOpen(true);
                              setChatShareNoteRef({
                                id: note.id,
                                title: note.title,
                                sectionId: note.sectionId,
                                statusBadge: note.statusBadge
                              });
                            }}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}

              {/* 새 섹션 컬럼 추가 */}
              <div className="w-[240px] shrink-0">
                {showNewSectionInput ? (
                  <form
                    onSubmit={handleAddSection}
                    className="bg-surface-light dark:bg-surface-dark p-3.5 rounded-2xl border border-line-light dark:border-line-dark flex flex-col gap-2"
                  >
                    <input
                      type="text"
                      value={newSectionTitle}
                      onChange={(e) => setNewSectionTitle(e.target.value)}
                      placeholder="예: 🧪 테스트 대기"
                      autoFocus
                      className="px-3 py-2 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs font-semibold text-zinc-900 dark:text-white outline-none"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowNewSectionInput(false)}
                        className="px-2.5 py-1 text-xs text-zinc-400"
                      >
                        취소
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold"
                      >
                        섹션 추가
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowNewSectionInput(true)}
                    className="w-full py-3.5 px-4 rounded-2xl border border-dashed border-line-light dark:border-line-dark text-xs font-bold text-zinc-500 hover:text-blue-600 hover:border-blue-500/50 transition-colors"
                  >
                    + 새 보드 섹션(컬럼) 추가
                  </button>
                )}
              </div>
            </div>
          )}

          {/* (B) 카드 그리드 뷰 */}
          {viewMode === 'grid' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {filteredRoomNotes.length === 0 ? (
                <div className="col-span-full bg-surface-light dark:bg-surface-dark p-10 rounded-2xl border border-line-light dark:border-line-dark text-center text-xs text-zinc-400">
                  조건에 맞는 공유 노트가 없습니다.
                </div>
              ) : (
                filteredRoomNotes.map((note) => (
                  <SharedNoteCard
                    key={note.id}
                    note={note}
                    isSelected={selectedNoteIds.includes(note.id)}
                    onToggleSelect={() =>
                      setSelectedNoteIds((prev) =>
                        prev.includes(note.id)
                          ? prev.filter((id) => id !== note.id)
                          : [...prev, note.id]
                      )
                    }
                    onDragStart={() => setDraggedNoteId(note.id)}
                    onView={() => setViewingSharedNote(note)}
                    onEdit={() => openEditNoteModal(note)}
                    onDelete={() => handleDeleteSharedNote(note.id)}
                    onToggleCheck={(itemId) => handleToggleChecklistItem(note.id, itemId)}
                    onSavePersonal={() => onSaveToPersonalNotes?.(note)}
                    onShareInChat={() => {
                      setChatOpen(true);
                      setChatShareNoteRef({
                        id: note.id,
                        title: note.title,
                        sectionId: note.sectionId,
                        statusBadge: note.statusBadge
                      });
                    }}
                  />
                ))
              )}
            </div>
          )}

          {/* (C) 체크리스트 모아보기 뷰 */}
          {viewMode === 'checklist' && (
            <div className="bg-surface-light dark:bg-surface-dark p-5 rounded-2xl border border-line-light dark:border-line-dark flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                  ☑️ 방 전체 공동 체크리스트 모아보기
                </h3>
                <span className="text-xs text-zinc-400">
                  클릭하면 모든 참여자 화면에 실시간으로 완료 표시됩니다
                </span>
              </div>
              {filteredRoomNotes.filter((n) => (n.checklist || []).length > 0).length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-400">
                  체크리스트가 포함된 공유 노트가 없습니다. 노트 작성 시 할 일 항목을 추가해 보세요!
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filteredRoomNotes
                    .filter((n) => (n.checklist || []).length > 0)
                    .map((note) => {
                      const doneCount = note.checklist.filter((c) => c.done).length;
                      return (
                        <div
                          key={note.id}
                          className="p-4 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex flex-col gap-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => setViewingSharedNote(note)}
                              className="text-xs font-extrabold text-zinc-900 dark:text-zinc-100 hover:text-blue-600 text-left truncate"
                            >
                              {note.title}
                            </button>
                            <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 shrink-0">
                              {doneCount}/{note.checklist.length} 완료
                            </span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {note.checklist.map((item) => (
                              <label
                                key={item.id}
                                className="flex items-center gap-2 text-xs cursor-pointer select-none"
                              >
                                <input
                                  type="checkbox"
                                  checked={Boolean(item.done)}
                                  onChange={() => handleToggleChecklistItem(note.id, item.id)}
                                  className="w-3.5 h-3.5 accent-blue-600 rounded"
                                />
                                <span
                                  className={
                                    item.done
                                      ? 'line-through text-zinc-400'
                                      : 'text-zinc-800 dark:text-zinc-200 font-medium'
                                  }
                                >
                                  {item.text}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 우측 도킹형 실시간 그룹 채팅 패널 (뷰포트 높이에 맞춰 자동 조절 + sticky 고정으로 입력창 잘림 방지) */}
        {chatOpen && (
          <aside className="w-full xl:w-[340px] 2xl:w-[370px] shrink-0 min-w-0 overflow-hidden bg-surface-light dark:bg-surface-dark rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-col h-[460px] xl:h-[clamp(400px,calc(100vh-250px),680px)] xl:sticky xl:top-10">
            {/* 채팅 헤더 */}
            <div className="shrink-0 px-4 py-2.5 border-b border-line-light dark:border-line-dark flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="text-xs font-extrabold text-zinc-900 dark:text-zinc-100 truncate">
                  💬 그룹 실시간 채팅
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-zinc-400 whitespace-nowrap">
                  📌 눌러 노트화
                </span>
                <button
                  type="button"
                  onClick={() => setChatOpen(false)}
                  className="w-6 h-6 rounded-lg text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-muted-light dark:hover:bg-muted-dark grid place-items-center transition-colors"
                  title="채팅창 접기"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 채팅 메시지 목록 */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-3">
              {(activeRoom.messages || []).length === 0 ? (
                <div className="my-auto py-8 text-center text-xs text-zinc-400">
                  첫 메시지를 보내 팀원과 대화를 시작해 보세요.
                </div>
              ) : (
                (activeRoom.messages || []).map((msg) => {
                  if (msg.isSystem) {
                    return (
                      <div key={msg.id} className="text-center my-0.5">
                        <span className="inline-block max-w-full break-words text-[11px] px-2.5 py-1 rounded-full bg-muted-light dark:bg-muted-dark text-zinc-500 dark:text-zinc-400">
                          {msg.text}
                        </span>
                      </div>
                    );
                  }

                  const isMine = msg.author?.uid === currentAccount.uid;
                  const timeStr = new Date(msg.createdAt || Date.now()).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                  return (
                    <div
                      key={msg.id}
                      className={`group flex gap-2 min-w-0 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                      <UserAvatar user={msg.author} size="sm" />
                      <div
                        className={`min-w-0 max-w-[82%] flex flex-col ${
                          isMine ? 'items-end' : 'items-start'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 max-w-full">
                          <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300 truncate">
                            {msg.author?.name}
                          </span>
                          <span className="text-[10px] text-zinc-400 shrink-0">{timeStr}</span>
                        </div>

                        <div
                          className={`max-w-full px-3 py-2.5 rounded-2xl text-xs leading-relaxed break-words [overflow-wrap:anywhere] overflow-hidden ${
                            isMine
                              ? 'bg-blue-600 text-white rounded-tr-sm'
                              : 'bg-canvas-light dark:bg-canvas-dark text-zinc-900 dark:text-zinc-100 border border-line-light dark:border-line-dark rounded-tl-sm'
                          }`}
                        >
                          {msg.text && <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.text}</div>}
                          {msg.imageDataUrl && (
                            <img
                              src={msg.imageDataUrl}
                              alt="채팅 이미지"
                              className="mt-2 rounded-lg max-h-44 max-w-full object-contain bg-black/10"
                            />
                          )}
                          {msg.sharedNoteRef && (
                            <button
                              type="button"
                              onClick={() => {
                                const target = (activeRoom.notes || []).find(
                                  (n) => n.id === msg.sharedNoteRef.id
                                );
                                if (target) {
                                  setViewingSharedNote(target);
                                } else {
                                  showToast?.('해당 노트가 삭제되었거나 찾을 수 없습니다.', 'info');
                                }
                              }}
                              className={`mt-2 w-full min-w-0 max-w-full overflow-hidden p-2 rounded-xl text-left flex items-center justify-between gap-2 border ${
                                isMine
                                  ? 'bg-blue-700/80 border-white/20 text-white'
                                  : 'bg-surface-light dark:bg-surface-dark border-line-light dark:border-line-dark text-zinc-800 dark:text-zinc-200'
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] opacity-75">📄 공유 노트 바로가기</div>
                                <div className="text-xs font-bold truncate">
                                  {msg.sharedNoteRef.title}
                                </div>
                              </div>
                              <span className="text-xs shrink-0">↗</span>
                            </button>
                          )}
                        </div>

                        {/* 채팅 메시지 -> 공유 노트로 즉시 박제 버튼 */}
                        <div className="mt-1 flex items-center gap-2">
                          {msg.pinnedToNoteId ? (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                              📌 공유 노트로 등록됨
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handlePromoteChatToNote(msg.id)}
                              className="opacity-75 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline transition-opacity"
                            >
                              📌 노트로 박제
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* 인라인 노트 공유 선택 트레이 (클립/짤림 방지) */}
            {showChatNotePicker && (
              <div className="shrink-0 max-h-44 overflow-y-auto px-3 py-2 bg-canvas-light dark:bg-canvas-dark border-t border-line-light dark:border-line-dark flex flex-col gap-1">
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400">
                    채팅에 공유할 노트 선택
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowChatNotePicker(false)}
                    className="text-xs text-zinc-400 hover:text-zinc-600 px-1"
                  >
                    ✕
                  </button>
                </div>
                {(activeRoom.notes || []).length === 0 ? (
                  <div className="text-[11px] text-zinc-400 px-2 py-2 text-center">
                    아직 방에 공유할 노트가 없습니다.
                  </div>
                ) : (
                  (activeRoom.notes || []).map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        setChatShareNoteRef({
                          id: n.id,
                          title: n.title,
                          sectionId: n.sectionId,
                          statusBadge: n.statusBadge
                        });
                        setShowChatNotePicker(false);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-left text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate"
                    >
                      📄 {n.title}
                    </button>
                  ))
                )}
              </div>
            )}

            {/* 첨부 미리보기 (이미지 또는 노트 링크 카드) */}
            {(chatImage || chatShareNoteRef) && (
              <div className="shrink-0 px-3.5 py-2 bg-canvas-light dark:bg-canvas-dark border-t border-line-light dark:border-line-dark flex items-center justify-between gap-2 min-w-0">
                {chatImage && (
                  <div className="flex items-center gap-2 min-w-0">
                    <img src={chatImage} alt="첨부" className="w-8 h-8 rounded object-cover shrink-0" />
                    <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 truncate">
                      클립보드 이미지 첨부됨
                    </span>
                  </div>
                )}
                {chatShareNoteRef && (
                  <div className="text-[11px] font-bold text-blue-600 dark:text-blue-400 truncate min-w-0">
                    📄 노트 공유: {chatShareNoteRef.title}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setChatImage('');
                    setChatShareNoteRef(null);
                  }}
                  className="text-xs text-zinc-400 hover:text-red-500 shrink-0 px-1"
                >
                  ✕
                </button>
              </div>
            )}

            {/* 채팅 입력창 */}
            <form
              onSubmit={handleSendChat}
              className="shrink-0 p-3 border-t border-line-light dark:border-line-dark flex flex-col gap-2 bg-surface-light dark:bg-surface-dark"
            >
              <div className="flex items-center justify-between gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setShowChatNotePicker((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold whitespace-nowrap transition-colors ${
                    showChatNotePicker
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border-line-light dark:border-line-dark text-zinc-600 dark:text-zinc-300'
                  }`}
                  title="방 안의 노트 카드를 채팅에 공유"
                >
                  📄 노트 공유
                </button>
                <span className="text-[10px] text-zinc-400 truncate">
                  Ctrl+V 이미지 전송
                </span>
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onPaste={handleChatPaste}
                  placeholder="메시지 입력 (Enter 전송)..."
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs font-medium text-zinc-900 dark:text-white outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shrink-0 transition-colors"
                >
                  전송
                </button>
              </div>
            </form>
          </aside>
        )}
      </div>

      {/* ========================================================================
          MODAL 1: 공유 노트 작성 / 수정 모달
         ======================================================================== */}
      {showNoteModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowNoteModal(false)}
        >
          <div
            className="bg-surface-light dark:bg-surface-dark w-full max-w-2xl rounded-2xl border border-line-light dark:border-line-dark shadow-2xl p-4 sm:p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                {editingNote ? '✏️ 공유 노트 수정' : '📝 새 공유 노트 작성'}
              </h3>
              <button
                type="button"
                onClick={() => setShowNoteModal(false)}
                className="text-sm text-zinc-400 hover:text-zinc-600 px-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSharedNote} className="flex flex-col gap-3.5">
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="공유 노트 제목을 입력하세요"
                className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-sm font-normal text-zinc-900 dark:text-white outline-none focus:border-blue-500"
              />

              {/* 분류 선택: 섹션 / 폴더 / 상태 배지 / 상단 고정 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-zinc-500">보드 섹션(컬럼)</label>
                  <select
                    value={noteSectionId}
                    onChange={(e) => setNoteSectionId(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-canvas-light dark:bg-zinc-900 border border-line-light dark:border-line-dark text-xs font-semibold text-zinc-800 dark:text-zinc-200 outline-none"
                  >
                    {(activeRoom.sections || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-zinc-500">폴더(컬렉션)</label>
                  <select
                    value={noteFolderId}
                    onChange={(e) => setNoteFolderId(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-canvas-light dark:bg-zinc-900 border border-line-light dark:border-line-dark text-xs font-semibold text-zinc-800 dark:text-zinc-200 outline-none"
                  >
                    {(activeRoom.folders || []).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.icon} {f.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-zinc-500">상태 배지</label>
                  <select
                    value={noteStatusBadge}
                    onChange={(e) => setNoteStatusBadge(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-canvas-light dark:bg-zinc-900 border border-line-light dark:border-line-dark text-xs font-semibold text-zinc-800 dark:text-zinc-200 outline-none"
                  >
                    <option value="">선택 안 함</option>
                    <option value="중요">🔥 중요</option>
                    <option value="검토필요">🧐 검토필요</option>
                    <option value="확정">✅ 확정</option>
                    <option value="질문">❓ 질문</option>
                  </select>
                </div>
              </div>

              {/* 서식 바 + 본문 에디터 */}
              <div className="rounded-xl border border-line-light dark:border-line-dark overflow-hidden bg-canvas-light dark:bg-canvas-dark">
                <FormattingBar editorRef={noteEditorRef} />
                <div
                  ref={noteEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (items) {
                      for (const item of items) {
                        if (item.type.startsWith('image/')) {
                          e.preventDefault();
                          const file = item.getAsFile();
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            if (typeof reader.result === 'string') setNoteImage(reader.result);
                          };
                          reader.readAsDataURL(file);
                          return;
                        }
                      }
                    }
                  }}
                  data-placeholder="공유할 노트 내용을 작성하세요 (Ctrl+V로 스크린샷 이미지 첨부 가능)..."
                  className="rich-editor min-h-[140px] max-h-[260px] overflow-y-auto p-3.5 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 outline-none"
                />
              </div>

              {/* 이미지 첨부 미리보기 */}
              {noteImage && (
                <div className="p-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex items-center justify-between">
                  <img src={noteImage} alt="첨부" className="max-h-28 rounded-lg object-contain" />
                  <button
                    type="button"
                    onClick={() => setNoteImage('')}
                    className="text-xs font-bold text-red-500 px-2.5 py-1"
                  >
                    이미지 제거
                  </button>
                </div>
              )}

              {/* 공동 체크리스트 편집 영역 */}
              <div className="p-3.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex flex-col gap-2">
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                  ☑️ 공동 체크리스트 (할 일 항목)
                </span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCheckItemText}
                    onChange={(e) => setNewCheckItemText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddChecklistItem();
                      }
                    }}
                    placeholder="할 일 항목 입력 후 [추가] 클릭"
                    className="flex-1 px-3 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark text-xs text-zinc-900 dark:text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddChecklistItem}
                    className="px-3 py-1.5 rounded-lg bg-muted-light dark:bg-muted-dark text-xs font-bold text-zinc-700 dark:text-zinc-200"
                  >
                    + 항목 추가
                  </button>
                </div>
                {noteChecklist.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-1">
                    {noteChecklist.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-800 dark:text-zinc-200">• {item.text}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setNoteChecklist((prev) => prev.filter((c) => c.id !== item.id))
                          }
                          className="text-zinc-400 hover:text-red-500 text-xs"
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <input
                  type="text"
                  value={noteTagsInput}
                  onChange={(e) => setNoteTagsInput(e.target.value)}
                  placeholder="#태그 입력 (쉼표 구분)"
                  className="flex-1 px-3 py-2 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs text-zinc-900 dark:text-white outline-none"
                />
                <label className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notePinned}
                    onChange={(e) => setNotePinned(e.target.checked)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span>📌 상단 고정</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNoteModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-500 hover:bg-muted-light dark:hover:bg-muted-dark"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm"
                >
                  {editingNote ? '수정 완료' : '공유 노트 등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================
          MODAL 2: 공유 노트 상세 리더 뷰 모달
         ======================================================================== */}
      {viewingSharedNote && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setViewingSharedNote(null)}
        >
          <div
            className="bg-surface-light dark:bg-surface-dark w-full max-w-2xl rounded-2xl border border-line-light dark:border-line-dark shadow-2xl p-6 flex flex-col gap-4 max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {viewingSharedNote.statusBadge && (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        STATUS_BADGE_STYLES[viewingSharedNote.statusBadge] || ''
                      }`}
                    >
                      {viewingSharedNote.statusBadge}
                    </span>
                  )}
                  <span className="text-xs text-zinc-400">
                    작성자: {viewingSharedNote.author?.name} (
                    {viewingSharedNote.author?.accountId
                      ? `@${viewingSharedNote.author.accountId}`
                      : viewingSharedNote.author?.uid?.slice(0, 8)}
                    )
                  </span>
                </div>
                <h3 className="text-lg font-extrabold text-zinc-900 dark:text-zinc-100">
                  {viewingSharedNote.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setViewingSharedNote(null)}
                className="text-sm text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>

            {viewingSharedNote.imageDataUrl && (
              <img
                src={viewingSharedNote.imageDataUrl}
                alt="첨부 이미지"
                className="max-h-72 rounded-xl object-contain bg-black/5 border border-line-light dark:border-line-dark"
              />
            )}

            <div
              className="prose-editor text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed bg-canvas-light dark:bg-canvas-dark p-4 rounded-xl border border-line-light dark:border-line-dark"
              dangerouslySetInnerHTML={{
                __html: normalizeContentToSafeHtml(viewingSharedNote.content || '')
              }}
            />

            {(viewingSharedNote.checklist || []).length > 0 && (
              <div className="p-4 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex flex-col gap-2">
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                  ☑️ 공동 체크리스트
                </span>
                {viewingSharedNote.checklist.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-2 text-xs cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(item.done)}
                      onChange={() => handleToggleChecklistItem(viewingSharedNote.id, item.id)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <span
                      className={
                        item.done
                          ? 'line-through text-zinc-400'
                          : 'text-zinc-800 dark:text-zinc-200 font-medium'
                      }
                    >
                      {item.text}
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line-light dark:border-line-dark">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSaveToPersonalNotes?.(viewingSharedNote);
                    setViewingSharedNote(null);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                >
                  📥 내 개인 노트로 복사 저장
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const n = viewingSharedNote;
                    setChatOpen(true);
                    setChatShareNoteRef({
                      id: n.id,
                      title: n.title,
                      sectionId: n.sectionId,
                      statusBadge: n.statusBadge
                    });
                    setViewingSharedNote(null);
                    showToast?.('채팅창에 노트가 첨부되었습니다.', 'info');
                  }}
                  className="px-3 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-bold"
                >
                  💬 채팅 공유
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const n = viewingSharedNote;
                    setViewingSharedNote(null);
                    openEditNoteModal(n);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                >
                  수정하기
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSharedNote(viewingSharedNote.id)}
                  className="px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white text-xs font-bold"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          MODAL 3: 선택 노트 스마트 병합 (Smart Merge) 모달
         ======================================================================== */}
      {showMergeModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowMergeModal(false)}
        >
          <form
            onSubmit={handleExecuteSmartMerge}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-light dark:bg-surface-dark w-full max-w-md rounded-2xl border border-line-light dark:border-line-dark shadow-2xl p-6 flex flex-col gap-4"
          >
            <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
              🔗 선택한 노트 {selectedNoteIds.length}개 하나로 합치기
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              선택한 노트들의 본문, 체크리스트, 태그를 하나의 통합 노트로 깔끔하게 정리합니다.
            </p>
            <input
              type="text"
              value={mergeTitle}
              onChange={(e) => setMergeTitle(e.target.value)}
              placeholder="합쳐진 노트의 새 제목 (비워두면 자동 생성)"
              className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs font-normal text-zinc-900 dark:text-white outline-none"
            />
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={mergeRemoveOriginals}
                onChange={(e) => setMergeRemoveOriginals(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <span>병합 후 기존 개별 노트 삭제하기</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-500"
              >
                취소
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
              >
                ✨ 하나로 병합하기
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================
          MODAL 4: 내 개인 노트에서 불러와 공유 방에 게시
         ======================================================================== */}
      {showPersonalPicker && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowPersonalPicker(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-light dark:bg-surface-dark w-full max-w-lg rounded-2xl border border-line-light dark:border-line-dark shadow-2xl p-6 flex flex-col gap-4 max-h-[80vh]"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                📤 내 개인 노트를 공유 방에 게시하기
              </h3>
              <button
                type="button"
                onClick={() => setShowPersonalPicker(false)}
                className="text-sm text-zinc-400"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-2">
              {personalNotes.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-400">
                  저장된 개인 노트가 없습니다.
                </div>
              ) : (
                personalNotes.map((pn) => (
                  <div
                    key={pn.id}
                    className="p-3 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                        {pn.title}
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate">
                        {getPlainText(pn.content || '').slice(0, 60)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSharePersonalNoteToRoom(pn)}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shrink-0"
                    >
                      방에 공유
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          MODAL 5: 방 관리 · 저장 · 백업 · 영구 삭제 모달
         ======================================================================== */}
      {showRoomManageModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowRoomManageModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-light dark:bg-surface-dark w-full max-w-md rounded-2xl border border-line-light dark:border-line-dark shadow-2xl p-6 flex flex-col gap-4 max-h-[88vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-line-light dark:border-line-dark pb-3">
              <div>
                <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                  ⚙️ 방 관리 · 저장 ({activeRoom.roomName})
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  공유 노트 {(activeRoom.notes || []).length}개 · 채팅 {(activeRoom.messages || []).length}개
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRoomManageModal(false)}
                className="text-sm text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-zinc-700 dark:text-zinc-300">네트워크 연결 상태</span>
                <span className={activeRoom.relayConnected ? 'text-emerald-600 font-bold' : 'text-zinc-500 font-bold'}>
                  {activeRoom.relayConnected ? '🌐 온라인 중계 + LAN 활성' : '📡 로컬 네트워크(LAN)'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {activeRoom.relayConnected
                  ? '다른 네트워크·외부 PC에서도 방 이름과 비밀번호만으로 바로 입장할 수 있습니다.'
                  : '현재 로컬 네트워크(LAN) 모드입니다. 인터넷 연결을 확인하면 외부에서도 입장할 수 있습니다.'}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleSaveRoomNow}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors text-left flex items-center justify-between"
              >
                <span>💾 이 기기에 방 상태 즉시 저장하기</span>
                <span className="text-[11px] opacity-80">로컬 저장소</span>
              </button>

              <button
                type="button"
                onClick={() => handleExportRoom(activeRoom.roomId)}
                className="w-full py-2.5 px-4 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-zinc-800 dark:text-zinc-200 text-xs font-bold transition-colors text-left flex items-center justify-between"
              >
                <span>📤 백업 파일(.json)로 내보내기</span>
                <span className="text-[11px] text-zinc-400">파일 저장</span>
              </button>
            </div>

            {isHost && (
              <div className="pt-3 border-t border-line-light dark:border-line-dark flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                    방 편집 권한 설정
                  </label>
                  <select
                    value={activeRoom.permissionMode || 'all'}
                    onChange={(e) =>
                      api.dispatchSharedAction({
                        type: 'SET_PERMISSION_MODE',
                        permissionMode: e.target.value
                      })
                    }
                    className="px-3 py-2 rounded-xl bg-canvas-light dark:bg-zinc-900 border border-line-light dark:border-line-dark text-xs font-semibold text-zinc-800 dark:text-zinc-200 outline-none"
                  >
                    <option value="all">모두 편집 가능</option>
                    <option value="host-delete">호스트만 삭제 가능</option>
                    <option value="readonly">읽기 전용 (호스트만 작성)</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteSavedRoom(activeRoom.roomId, activeRoom.roomName)}
                  className="w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-600 text-red-600 dark:text-red-400 hover:text-white border border-red-500/30 text-xs font-bold transition-colors"
                >
                  🗑️ 이 공유 방 및 그룹 노트 영구 삭제
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SharedNoteCard({
  note,
  isSelected,
  onToggleSelect,
  onDragStart,
  onView,
  onEdit,
  onDelete,
  onToggleCheck,
  onSavePersonal,
  onShareInChat
}) {
  const plain = getPlainText(note.content || '');
  const checklist = note.checklist || [];
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`group bg-canvas-light dark:bg-canvas-dark rounded-xl border p-3.5 flex flex-col gap-2.5 transition-all hover:border-blue-500/40 ${
        isSelected
          ? 'ring-2 ring-blue-600 border-blue-600'
          : note.pinned
          ? 'border-l-4 border-l-blue-600 border-line-light dark:border-line-dark'
          : 'border-line-light dark:border-line-dark'
      }`}
    >
      {/* 상단: 선택 체크박스 + 상태 배지 + 작성자 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="w-3.5 h-3.5 accent-blue-600 rounded cursor-pointer"
            title="병합/일괄 이동 선택"
          />
          {note.statusBadge && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                STATUS_BADGE_STYLES[note.statusBadge] || ''
              }`}
            >
              {note.statusBadge}
            </span>
          )}
          {note.pinned && <span className="text-[11px]">📌</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <UserAvatar user={note.author} size="sm" />
          <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 truncate max-w-[75px]">
            {note.author?.name}
          </span>
        </div>
      </div>

      {/* 제목 & 본문 요약 */}
      <div onClick={onView} className="cursor-pointer flex flex-col gap-1 min-w-0">
        <h4 className="text-xs sm:text-sm font-extrabold text-zinc-900 dark:text-zinc-100 line-clamp-2 break-words [overflow-wrap:anywhere]">
          {note.title}
        </h4>
        {plain && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-3 leading-relaxed break-words [overflow-wrap:anywhere]">
            {plain}
          </p>
        )}
      </div>

      {/* 썸네일 이미지 */}
      {note.imageDataUrl && (
        <img
          src={note.imageDataUrl}
          alt="첨부"
          onClick={onView}
          className="rounded-lg max-h-32 w-full object-cover cursor-pointer border border-line-light dark:border-line-dark"
        />
      )}

      {/* 미니 체크리스트 프리뷰 */}
      {checklist.length > 0 && (
        <div className="p-2 rounded-lg bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400">
            <span>☑️ 체크리스트</span>
            <span>
              {doneCount}/{checklist.length}
            </span>
          </div>
          {checklist.slice(0, 3).map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={Boolean(item.done)}
                onChange={() => onToggleCheck(item.id)}
                className="w-3 h-3 accent-blue-600"
              />
              <span
                className={`truncate ${
                  item.done ? 'line-through text-zinc-400' : 'text-zinc-700 dark:text-zinc-200'
                }`}
              >
                {item.text}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* 태그 */}
      {(note.tags || []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {note.tags.map((tag, i) => (
            <span
              key={i}
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted-light dark:bg-muted-dark text-zinc-500 dark:text-zinc-400"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* 하단 액션 바 */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 pt-2 border-t border-line-light dark:border-line-dark text-[11px] font-bold">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSavePersonal}
            className="text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap"
            title="내 개인 노트로 저장"
          >
            📥 내 노트로
          </button>
          <button
            type="button"
            onClick={onShareInChat}
            className="text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            title="채팅창에 이 노트 공유"
          >
            💬 채팅공유
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 whitespace-nowrap"
          >
            수정
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-zinc-400 hover:text-red-500 whitespace-nowrap"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
