import React, { useState, useEffect, useRef, useMemo } from 'react';
import { normalizeContentToSafeHtml, getPlainText, sanitizeNoteHtml } from '../utils/sanitize';
import { FormattingBar } from './FormattingBar';

const MAX_CHAT_FILE_BYTES = 3 * 1024 * 1024;
const CHAT_QUICK_EMOJIS = ['👍', '❤️', '✅', '😂', '🎉', '🔥', '👀', '👏', '🙏', '💡', '🚀', '📌'];
const CHAT_REACTIONS = ['👍', '❤️', '✅', '😂', '🎉', '🔥', '👀'];

const STATUS_BADGE_STYLES = {
  중요: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35',
  검토필요: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35',
  확정: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35',
  질문: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/35'
};

const SECTION_ACCENT_STYLES = {
  blue: 'border-t-blue-500',
  amber: 'border-t-amber-500',
  purple: 'border-t-purple-500',
  emerald: 'border-t-emerald-500',
  zinc: 'border-t-zinc-500',
  rose: 'border-t-rose-500'
};

function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtensionBadge(name = '', mime = '') {
  const extMatch = String(name).match(/\.([a-zA-Z0-9]{1,6})$/);
  if (extMatch) return extMatch[1].toUpperCase();
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z')) return 'ZIP';
  if (mime.includes('audio')) return 'AUDIO';
  if (mime.includes('video')) return 'VIDEO';
  return 'FILE';
}

function readBrowserFileAsAttachment(file) {
  return new Promise((resolve) => {
    if (!file || file.size > MAX_CHAT_FILE_BYTES) {
      resolve({ error: `${file?.name || '파일'} (3MB 초과)` });
      return;
    }
    const lowerName = String(file.name || '').toLowerCase();
    if (lowerName.endsWith('.html') || lowerName.endsWith('.htm') || lowerName.endsWith('.svg')) {
      resolve({ error: `${file.name} (보안상 지원되지 않는 웹 파일)` });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        resolve({ error: `${file.name} 읽기 실패` });
        return;
      }
      const mime = file.type || (lowerName.endsWith('.gif') ? 'image/gif' : 'application/octet-stream');
      resolve({
        attachment: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name || '첨부파일',
          mime,
          size: file.size,
          dataUrl,
          isImage: /^image\/(png|jpeg|jpg|gif|webp|bmp)$/i.test(mime),
          isGif: /^image\/gif$/i.test(mime) || lowerName.endsWith('.gif')
        }
      });
    };
    reader.onerror = () => resolve({ error: `${file.name} 읽기 실패` });
    reader.readAsDataURL(file);
  });
}

function Icon({ name, size = 14, className = '' }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: `shrink-0 ${className}`,
    'aria-hidden': 'true'
  };
  switch (name) {
    case 'grip':
      return (
        <svg {...props}>
          <circle cx="9" cy="6" r="1" fill="currentColor" />
          <circle cx="15" cy="6" r="1" fill="currentColor" />
          <circle cx="9" cy="12" r="1" fill="currentColor" />
          <circle cx="15" cy="12" r="1" fill="currentColor" />
          <circle cx="9" cy="18" r="1" fill="currentColor" />
          <circle cx="15" cy="18" r="1" fill="currentColor" />
        </svg>
      );
    case 'paperclip':
      return (
        <svg {...props}>
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      );
    case 'image':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    case 'smile':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" y1="9" x2="9.01" y2="9" />
          <line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      );
    case 'send':
      return (
        <svg {...props}>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      );
    case 'reply':
      return (
        <svg {...props}>
          <polyline points="9 14 4 9 9 4" />
          <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
        </svg>
      );
    case 'download':
      return (
        <svg {...props}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...props}>
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...props}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...props}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...props}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...props}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case 'up':
      return (
        <svg {...props}>
          <polyline points="18 15 12 9 6 15" />
        </svg>
      );
    case 'down':
      return (
        <svg {...props}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      );
    case 'left':
      return (
        <svg {...props}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
      );
    case 'right':
      return (
        <svg {...props}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      );
    case 'board':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      );
    case 'grid':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case 'checkSquare':
      return (
        <svg {...props}>
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    case 'users':
      return (
        <svg {...props}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'link':
      return (
        <svg {...props}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case 'message':
      return (
        <svg {...props}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'save':
      return (
        <svg {...props}>
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...props}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'note':
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case 'close':
      return (
        <svg {...props}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    default:
      return null;
  }
}

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
  const [joinedRoomOrderIds, setJoinedRoomOrderIds] = useState([]);
  const [draggedJoinedRoomId, setDraggedJoinedRoomId] = useState(null);
  const [dragOverJoinedRoomId, setDragOverJoinedRoomId] = useState(null);
  const [importBackupDraft, setImportBackupDraft] = useState(null);
  const [hostRoomName, setHostRoomName] = useState('');
  const [hostPassword, setHostPassword] = useState('');
  const [hostPermissionMode, setHostPermissionMode] = useState('all');
  const [joinMode, setJoinMode] = useState('code'); // 'code' | 'credentials'
  const [joinInviteOnlyCode, setJoinInviteOnlyCode] = useState('');
  const [joinRoomName, setJoinRoomName] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
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

  // Chat Panel State & Attachments & Replies & Reactions
  const [chatOpen, setChatOpen] = useState(true);
  const [chatPanelWidth, setChatPanelWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('treenote_shared_chat_width'));
      if (saved >= 290 && saved <= 560) return saved;
    } catch (_e) {}
    return 360;
  });
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatImage, setChatImage] = useState('');
  const [chatAttachments, setChatAttachments] = useState([]);
  const [chatShareNoteRef, setChatShareNoteRef] = useState(null);
  const [chatReplyTarget, setChatReplyTarget] = useState(null);
  const [chatSending, setChatSending] = useState(false);
  const [chatDragActive, setChatDragActive] = useState(false);
  const [showChatNotePicker, setShowChatNotePicker] = useState(false);
  const [showChatEmojiPicker, setShowChatEmojiPicker] = useState(false);
  const [activeReactionMsgId, setActiveReactionMsgId] = useState(null);
  const [showMembersPopover, setShowMembersPopover] = useState(false);
  const [lightboxMedia, setLightboxMedia] = useState(null); // { src, name, isGif }
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const chatFileInputRef = useRef(null);
  const chatGifInputRef = useRef(null);

  // Drag & Drop state for Notes & Board Sections
  const [draggedNoteId, setDraggedNoteId] = useState(null);
  const [dragOverSectionId, setDragOverSectionId] = useState(null);
  const [dropTargetNote, setDropTargetNote] = useState(null); // { noteId, position: 'before' | 'after' }
  const [draggedSectionId, setDraggedSectionId] = useState(null);
  const [dragOverHeaderSectionId, setDragOverHeaderSectionId] = useState(null);

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

  // Load saved joinedRooms card order per account
  useEffect(() => {
    if (!currentAccount?.uid) {
      setJoinedRoomOrderIds([]);
      return;
    }
    try {
      const raw = localStorage.getItem(`treenote_joined_order_${currentAccount.uid}`);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setJoinedRoomOrderIds(parsed);
    } catch (_e) {
      setJoinedRoomOrderIds([]);
    }
  }, [currentAccount?.uid]);

  // Drag split resizer between Group Notes and Messenger
  useEffect(() => {
    if (!isResizingSplit) return;
    const onMove = (e) => {
      const nextWidth = Math.max(290, Math.min(540, window.innerWidth - e.clientX - 36));
      setChatPanelWidth(nextWidth);
    };
    const onUp = () => {
      setIsResizingSplit(false);
      try {
        localStorage.setItem('treenote_shared_chat_width', String(chatPanelWidth));
      } catch (_e) {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizingSplit, chatPanelWidth]);

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
        password: joinPassword
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

  const handleJoinByInviteCode = async (e) => {
    e.preventDefault();
    if (!api?.joinSharedRoomByCode || roomActionBusy) return;
    setRoomActionBusy(true);
    try {
      const res = await api.joinSharedRoomByCode({
        inviteCode: joinInviteOnlyCode
      });
      if (res?.ok && res.room) {
        setActiveRoom(res.room);
        setJoinInviteOnlyCode('');
        const stateRes = await api.getSharedState();
        if (stateRes?.recentRooms) setRecentRooms(stateRes.recentRooms);
        if (stateRes?.savedRooms) setSavedRooms(stateRes.savedRooms);
        if (stateRes?.joinedRooms) setJoinedRooms(stateRes.joinedRooms);
        showToast?.(`초대 코드로 '${res.room.roomName}' 방에 입장했습니다 ✓`, 'success');
      } else {
        showToast?.(res?.error || '초대 코드 입장에 실패했습니다.', 'error');
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
    const text = activeRoom.inviteToken || activeRoom.inviteCode || '';
    if (!text) {
      showToast?.('복사할 초대 코드가 아직 준비되지 않았습니다.', 'info');
      return;
    }
    if (api?.writeSystemClipboard) {
      await api.writeSystemClipboard({ text });
    } else {
      navigator.clipboard?.writeText(text);
    }
    showToast?.(
      '초대 코드가 복사되었습니다. 상대방은 이 코드만 입력하면 바로 입장할 수 있습니다 ✓',
      'success'
    );
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
  // Handlers: Reorder Notes, Sections, Joined Rooms & Real-Time Group Chat
  // ============================================================================
  const orderedJoinedRooms = useMemo(() => {
    if (!joinedRooms.length) return [];
    const orderIdx = new Map(joinedRoomOrderIds.map((id, i) => [id, i]));
    return [...joinedRooms].sort((a, b) => {
      const ai = orderIdx.has(a.roomId) ? orderIdx.get(a.roomId) : 9999;
      const bi = orderIdx.has(b.roomId) ? orderIdx.get(b.roomId) : 9999;
      return ai - bi;
    });
  }, [joinedRooms, joinedRoomOrderIds]);

  const handleReorderJoinedRoom = (fromRoomId, toRoomId) => {
    if (!fromRoomId || !toRoomId || fromRoomId === toRoomId) return;
    const ids = orderedJoinedRooms.map((r) => r.roomId);
    const fromIdx = ids.indexOf(fromRoomId);
    const toIdx = ids.indexOf(toRoomId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    setJoinedRoomOrderIds(ids);
    if (currentAccount?.uid) {
      try {
        localStorage.setItem(`treenote_joined_order_${currentAccount.uid}`, JSON.stringify(ids));
      } catch (_e) {}
    }
  };

  const handleMoveJoinedRoomByStep = (roomId, delta) => {
    const ids = orderedJoinedRooms.map((r) => r.roomId);
    const idx = ids.indexOf(roomId);
    const nextIdx = idx + delta;
    if (idx === -1 || nextIdx < 0 || nextIdx >= ids.length) return;
    handleReorderJoinedRoom(roomId, ids[nextIdx]);
  };

  const handleReorderNote = async ({ noteId, targetSectionId, targetNoteId, position, direction }) => {
    if (!noteId || !api?.dispatchSharedAction) return;
    const res = await api.dispatchSharedAction({
      type: 'REORDER_NOTE',
      noteId,
      targetSectionId,
      targetNoteId,
      position,
      direction
    });
    if (!res?.ok) {
      showToast?.(res?.error || '노트 순서를 변경하지 못했습니다.', 'error');
    }
  };

  const handleReorderSections = async ({ sectionId, targetSectionId, position, direction }) => {
    if (!sectionId || !api?.dispatchSharedAction) return;
    const res = await api.dispatchSharedAction({
      type: 'REORDER_SECTIONS',
      sectionId,
      targetSectionId,
      position,
      direction
    });
    if (!res?.ok) {
      showToast?.(res?.error || '섹션 순서를 변경하지 못했습니다.', 'error');
    }
  };

  const appendChatAttachmentList = (newItems, skipped = []) => {
    if (skipped.length > 0) {
      showToast?.(`첨부 제외됨: ${skipped.join(', ')}`, 'error');
    }
    if (!newItems || newItems.length === 0) return;
    setChatAttachments((prev) => {
      const merged = [...prev];
      for (const att of newItems) {
        if (merged.length >= 4) {
          showToast?.('한 번에 최대 4개 파일까지 첨부할 수 있습니다.', 'info');
          break;
        }
        merged.push(att);
      }
      return merged;
    });
  };

  const handlePickChatFilesNative = async (mode = 'any') => {
    if (api?.pickSharedChatFiles) {
      const res = await api.pickSharedChatFiles({ mode });
      if (res?.ok) {
        appendChatAttachmentList(res.attachments || [], res.skipped || []);
      } else if (!res?.canceled && res?.error) {
        showToast?.(res.error, 'error');
      }
      return;
    }
    if (mode === 'gif') chatGifInputRef.current?.click();
    else chatFileInputRef.current?.click();
  };

  const handleChatFileInputChange = async (e) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    if (fileList.length === 0) return;
    const valid = [];
    const skipped = [];
    for (const f of fileList.slice(0, 4)) {
      const out = await readBrowserFileAsAttachment(f);
      if (out.attachment) valid.push(out.attachment);
      else if (out.error) skipped.push(out.error);
    }
    appendChatAttachmentList(valid, skipped);
  };

  const handleChatDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setChatDragActive(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    const valid = [];
    const skipped = [];
    for (const f of files.slice(0, 4)) {
      const out = await readBrowserFileAsAttachment(f);
      if (out.attachment) valid.push(out.attachment);
      else if (out.error) skipped.push(out.error);
    }
    appendChatAttachmentList(valid, skipped);
  };

  const handleSaveAttachment = async (att) => {
    if (!att?.dataUrl) return;
    if (api?.saveSharedAttachment) {
      const res = await api.saveSharedAttachment({ name: att.name || 'attachment', dataUrl: att.dataUrl });
      if (res?.ok) {
        showToast?.(`'${att.name || '파일'}' 저장 완료 ✓`, 'success');
      } else if (!res?.canceled && res?.error) {
        showToast?.(res.error, 'error');
      }
      return;
    }
    const a = document.createElement('a');
    a.href = att.dataUrl;
    a.download = att.name || 'attachment';
    a.click();
  };

  const handleSendChat = async (e) => {
    e?.preventDefault();
    if (chatSending) return;
    if (!chatInput.trim() && !chatImage && chatAttachments.length === 0 && !chatShareNoteRef) return;
    setChatSending(true);
    try {
      const res = await api.dispatchSharedAction({
        type: 'SEND_CHAT',
        message: {
          text: chatInput.trim(),
          imageDataUrl: chatImage,
          attachments: chatAttachments,
          replyTo: chatReplyTarget,
          sharedNoteRef: chatShareNoteRef
        }
      });
      if (res?.ok) {
        setChatInput('');
        setChatImage('');
        setChatAttachments([]);
        setChatReplyTarget(null);
        setChatShareNoteRef(null);
        setShowChatEmojiPicker(false);
        if (chatInputRef.current) {
          chatInputRef.current.style.height = 'auto';
        }
      } else {
        showToast?.(res?.error || '메시지 전송 실패', 'error');
      }
    } finally {
      setChatSending(false);
    }
  };

  const handleReactChat = async (messageId, emoji) => {
    setActiveReactionMsgId(null);
    const res = await api.dispatchSharedAction({
      type: 'REACT_CHAT',
      messageId,
      emoji
    });
    if (!res?.ok) {
      showToast?.(res?.error || '리액션 실패', 'error');
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
      showToast?.('채팅 메시지를 공유 노트로 박제했습니다 ✓', 'success');
    } else {
      showToast?.(res?.error || '노트 박제 실패', 'error');
    }
  };

  const handleChatPaste = async (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length > 0) {
      e.preventDefault();
      const valid = [];
      const skipped = [];
      for (const f of files.slice(0, 4)) {
        const out = await readBrowserFileAsAttachment(f);
        if (out.attachment) valid.push(out.attachment);
        else if (out.error) skipped.push(out.error);
      }
      appendChatAttachmentList(valid, skipped);
      return;
    }
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const out = await readBrowserFileAsAttachment(file);
        if (out.attachment) appendChatAttachmentList([out.attachment]);
        else if (out.error) showToast?.(out.error, 'error');
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

        {/* 참여 중인 그룹 노트 (비밀번호 재입력 없이 바로 들어가기 + 카드 순서 끌어다 옮기기) */}
        <div className="bg-surface-light dark:bg-surface-dark p-5 rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-col gap-3.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold px-2.5 py-1 rounded-lg bg-blue-600/10 text-blue-700 dark:text-blue-400">
                <Icon name="users" size={14} />
                <span>참여 중인 그룹 노트 ({orderedJoinedRooms.length})</span>
              </span>
              <span className="text-xs text-zinc-600 dark:text-zinc-300">
                카드를 끌거나 화살표 버튼으로 순서를 정리할 수 있으며, 비밀번호 재입력 없이 바로 입장합니다.
              </span>
            </div>
          </div>

          {orderedJoinedRooms.length === 0 ? (
            <div className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400 border border-dashed border-line-light dark:border-line-dark rounded-xl">
              아직 참여 중인 그룹 노트가 없습니다. 아래에서 새 방을 만들거나 기존 방에 한 번 입장하면 이곳에 고정됩니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {orderedJoinedRooms.map((jr, idx) => {
                const isDragOverCard = dragOverJoinedRoomId === jr.roomId;
                const isDraggingCard = draggedJoinedRoomId === jr.roomId;
                return (
                  <div
                    key={jr.roomId}
                    draggable
                    onDragStart={(e) => {
                      setDraggedJoinedRoomId(jr.roomId);
                      if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', jr.roomId);
                      }
                    }}
                    onDragEnd={() => {
                      setDraggedJoinedRoomId(null);
                      setDragOverJoinedRoomId(null);
                    }}
                    onDragOver={(e) => {
                      if (!draggedJoinedRoomId || draggedJoinedRoomId === jr.roomId) return;
                      e.preventDefault();
                      setDragOverJoinedRoomId(jr.roomId);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget)) {
                        setDragOverJoinedRoomId((prev) => (prev === jr.roomId ? null : prev));
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromId = draggedJoinedRoomId;
                      setDraggedJoinedRoomId(null);
                      setDragOverJoinedRoomId(null);
                      if (fromId && fromId !== jr.roomId) {
                        handleReorderJoinedRoom(fromId, jr.roomId);
                      }
                    }}
                    className={`p-4 rounded-xl bg-canvas-light dark:bg-canvas-dark border flex flex-col justify-between gap-3 transition-all ${
                      isDraggingCard
                        ? 'opacity-60 scale-[0.98] border-blue-500'
                        : isDragOverCard
                        ? 'ring-2 ring-blue-500 border-blue-500 bg-blue-500/5'
                        : 'border-line-light dark:border-line-dark hover:border-blue-500/50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-grab active:cursor-grabbing shrink-0 p-0.5"
                            title="끌어서 그룹 노트 카드 순서 변경"
                          >
                            <Icon name="grip" size={14} />
                          </span>
                          <span className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 truncate">
                            {jr.roomName}
                          </span>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                            jr.role === 'host'
                              ? 'bg-blue-600/15 text-blue-700 dark:text-blue-400'
                              : 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              jr.role === 'host' ? 'bg-blue-600' : 'bg-emerald-500'
                            }`}
                          />
                          {jr.role === 'host' ? '방장' : '참여 중'}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-300 mt-1.5 truncate">
                        {jr.hostName ? `방장: ${jr.hostName} · ` : ''}노트 {jr.noteCount || 0}개 · 채팅{' '}
                        {jr.messageCount || 0}개
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {orderedJoinedRooms.length > 1 && (
                        <div className="flex items-center rounded-lg border border-line-light dark:border-line-dark bg-surface-light dark:bg-surface-dark overflow-hidden shrink-0">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveJoinedRoomByStep(jr.roomId, -1)}
                            title="앞으로 이동"
                            aria-label="참여 방 카드 앞으로 이동"
                            className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 transition-colors"
                          >
                            <Icon name="left" size={12} />
                          </button>
                          <button
                            type="button"
                            disabled={idx === orderedJoinedRooms.length - 1}
                            onClick={() => handleMoveJoinedRoomByStep(jr.roomId, 1)}
                            title="뒤로 이동"
                            aria-label="참여 방 카드 뒤로 이동"
                            className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 border-l border-line-light dark:border-line-dark transition-colors"
                          >
                            <Icon name="right" size={12} />
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={roomActionBusy}
                        onClick={() => handleQuickEnterRoom(jr.roomId)}
                        className="flex-1 py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <span>{roomActionBusy ? '연결 중...' : '바로 들어가기'}</span>
                        {!roomActionBusy && <Icon name="right" size={12} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveJoinedRoom(jr.roomId, jr.roomName)}
                        title="참여 목록에서 제거"
                        className="px-2.5 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark hover:bg-red-500/10 text-zinc-500 hover:text-red-500 border border-line-light dark:border-line-dark text-xs font-semibold transition-colors cursor-pointer shrink-0"
                      >
                        제거
                      </button>
                    </div>
                  </div>
                );
              })}
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

          {/* 2) 방 참가하기 (초대 코드 단독 입장 / 방 이름 + 비밀번호 입장 분리) */}
          <div className="bg-surface-light dark:bg-surface-dark p-6 rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-col justify-between gap-4">
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                  <Icon name="link" size={13} />
                  <span>JOIN A ROOM</span>
                </span>
                <div className="inline-flex p-0.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark">
                  <button
                    type="button"
                    onClick={() => setJoinMode('code')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                      joinMode === 'code'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    초대 코드로 입장
                  </button>
                  <button
                    type="button"
                    onClick={() => setJoinMode('credentials')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                      joinMode === 'credentials'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    방 이름 · 비밀번호 입장
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                  {joinMode === 'code' ? '초대 코드만으로 바로 들어가기' : '방 이름과 비밀번호로 들어가기'}
                </h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-0.5">
                  {joinMode === 'code'
                    ? '방장이나 멤버에게 받은 초대 코드(TN1-...)만 붙여넣으면 방 이름과 비밀번호 없이 즉시 입장합니다.'
                    : '방 호스트가 설정한 방 이름과 비밀번호만 입력해 다른 PC·네트워크에서도 입장합니다.'}
                </p>
              </div>

              {joinMode === 'code' ? (
                <form onSubmit={handleJoinByInviteCode} className="flex flex-col gap-3.5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                      초대 코드 (TN1-...)
                    </label>
                    <input
                      type="text"
                      required
                      value={joinInviteOnlyCode}
                      onChange={(e) => setJoinInviteOnlyCode(e.target.value)}
                      placeholder="전달받은 초대 코드 붙여넣기 (TN1-...)"
                      className="px-3.5 py-2.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs sm:text-sm font-normal text-zinc-900 dark:text-white outline-none focus:border-emerald-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={roomActionBusy || !joinInviteOnlyCode.trim()}
                    className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors cursor-pointer"
                  >
                    {roomActionBusy ? '초대 코드로 방 연결 중...' : '초대 코드로 바로 입장하기'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleJoinRoom} className="flex flex-col gap-3.5">
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

                  <button
                    type="submit"
                    disabled={roomActionBusy}
                    className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors cursor-pointer"
                  >
                    {roomActionBusy ? '온라인 / LAN 방 탐색 중...' : '방 이름 · 비밀번호로 입장하기'}
                  </button>
                </form>
              )}
            </div>
          </div>
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
                      setJoinMode('credentials');
                      setJoinRoomName(r.roomName);
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
          <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
            <Icon name="users" size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-sm sm:text-base font-extrabold text-zinc-900 dark:text-zinc-100 truncate max-w-[260px] sm:max-w-xs">
                {activeRoom.roomName}
              </h2>
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${
                  isHost
                    ? 'bg-blue-600/15 text-blue-700 dark:text-blue-400 border border-blue-500/30'
                    : 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isHost ? 'bg-blue-600' : 'bg-emerald-500'}`} />
                {isHost ? '호스트' : '멤버'}
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-muted-light dark:bg-muted-dark text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                {activeRoom.permissionMode === 'readonly'
                  ? '읽기 전용'
                  : activeRoom.permissionMode === 'host-delete'
                  ? '삭제 보호'
                  : '모두 편집 가능'}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap border ${
                  activeRoom.relayConnected
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25'
                    : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/25'
                }`}
                title="다른 PC·외부 네트워크 접속 가능 상태"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    activeRoom.relayConnected ? 'bg-emerald-500' : 'bg-zinc-400'
                  }`}
                />
                {activeRoom.relayConnected ? '온라인 연결됨' : '로컬 네트워크'}
              </span>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-0.5 truncate">
              방장: {activeRoom.hostProfile?.name} (@{activeRoom.hostProfile?.accountId || 'host'}) · 자동 저장됨
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
              className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
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
                    className="p-1 rounded-md text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100"
                    aria-label="멤버 창 닫기"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                  {(activeRoom.members || []).map((m) => (
                    <div key={m.uid} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserAvatar user={m} size="sm" />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                            {m.name} {m.isHost && <span className="text-[10px] text-blue-600 dark:text-blue-400">(방장)</span>}
                          </div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
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
                          className="text-[11px] font-bold px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white shrink-0"
                        >
                          내보내기
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {isHost && (
                  <div className="pt-2 border-t border-line-light dark:border-line-dark flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                      방 편집 권한 변경
                    </label>
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
            className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            title="방 이름과 초대 코드 복사"
          >
            <Icon name="link" size={13} />
            <span>초대 코드 복사</span>
          </button>

          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              chatOpen
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                : 'bg-canvas-light dark:bg-canvas-dark text-zinc-700 dark:text-zinc-200 border-line-light dark:border-line-dark hover:bg-muted-light dark:hover:bg-muted-dark'
            }`}
          >
            <Icon name="message" size={13} />
            <span>채팅 ({(activeRoom.messages || []).length})</span>
          </button>

          <button
            type="button"
            onClick={handleSaveRoomNow}
            className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            title="현재 방 상태를 즉시 저장"
          >
            <Icon name="save" size={13} />
            <span>방 저장</span>
          </button>

          <button
            type="button"
            onClick={() => setShowRoomManageModal(true)}
            className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            title="백업 내보내기 및 방 설정·삭제"
          >
            <Icon name="settings" size={13} />
            <span>방 관리</span>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowJoinedRoomsPopover((v) => !v)}
              className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              title="참여 중인 다른 그룹 노트 바로 전환 또는 로비로 이동"
            >
              <Icon name="folder" size={13} />
              <span>참여 방 ({orderedJoinedRooms.length})</span>
            </button>

            {showJoinedRoomsPopover && (
              <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-32px)] bg-surface-light dark:bg-surface-dark rounded-2xl border border-line-light dark:border-line-dark shadow-xl p-3.5 z-40 flex flex-col gap-2.5">
                <div className="flex items-center justify-between border-b border-line-light dark:border-line-dark pb-2">
                  <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    참여 중인 그룹 노트 (바로 전환)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowJoinedRoomsPopover(false)}
                    className="p-1 rounded-md text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100"
                    aria-label="참여 방 목록 닫기"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
                <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                  {orderedJoinedRooms.length === 0 ? (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 py-3 text-center">
                      저장된 참여 방이 없습니다.
                    </div>
                  ) : (
                    orderedJoinedRooms.map((jr) => {
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
                              ? 'bg-blue-600/10 border-blue-500/40 text-blue-700 dark:text-blue-400'
                              : 'bg-canvas-light dark:bg-canvas-dark hover:border-blue-500/40 border-line-light dark:border-line-dark text-zinc-800 dark:text-zinc-200'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{jr.roomName}</div>
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300 truncate">
                              {jr.role === 'host' ? '방장' : '참여 중'} · 노트 {jr.noteCount || 0}개
                            </div>
                          </div>
                          <span className="text-[11px] font-bold shrink-0">
                            {isCurr ? '현재 방' : '이동'}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleLeaveRoom}
                  className="w-full py-2 rounded-xl bg-muted-light dark:bg-muted-dark hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 text-xs font-bold transition-colors"
                >
                  로비(방 목록)로 나가기
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleLeaveRoom}
            className="px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-600 text-red-600 dark:text-red-400 hover:text-white border border-red-500/20 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            방 나가기
          </button>
        </div>
      </div>

      {/* 2. 폴더(컬렉션) 정리 바 + 뷰 스위치 + 검색 + 액션 버튼 */}
      <div className="bg-surface-light dark:bg-surface-dark p-3.5 rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-col gap-3">
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
                    className={`px-3 py-1.5 text-xs font-bold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                      isHost && folder.id !== 'all-notes' ? 'rounded-l-xl' : 'rounded-xl'
                    } ${
                      active
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm'
                        : 'bg-canvas-light dark:bg-canvas-dark text-zinc-700 dark:text-zinc-200 hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark'
                    }`}
                  >
                    <Icon name="folder" size={13} />
                    <span>{folder.name}</span>
                  </button>
                  {isHost && folder.id !== 'all-notes' && (
                    <button
                      type="button"
                      onClick={() => handleDeleteFolder(folder)}
                      title={`'${folder.name}' 폴더 삭제`}
                      aria-label={`'${folder.name}' 폴더 삭제`}
                      className={`px-2 py-1.5 rounded-r-xl text-xs font-bold border-y border-r transition-colors cursor-pointer ${
                        active
                          ? 'bg-zinc-800 dark:bg-zinc-200 text-zinc-300 dark:text-zinc-700 border-zinc-700 dark:border-zinc-300 hover:text-red-400'
                          : 'bg-canvas-light dark:bg-canvas-dark text-zinc-500 hover:text-red-500 border-line-light dark:border-line-dark'
                      }`}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  )}
                </div>
              );
            })}

            {showNewFolderInput ? (
              <form onSubmit={handleAddFolder} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="새 폴더명"
                  autoFocus
                  className="px-2.5 py-1.5 rounded-lg bg-canvas-light dark:bg-canvas-dark border border-blue-500 text-xs font-normal text-zinc-900 dark:text-white outline-none w-32"
                />
                <button type="submit" className="px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold">
                  추가
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewFolderInput(false)}
                  className="p-1.5 text-zinc-500 hover:text-zinc-700"
                  aria-label="취소"
                >
                  <Icon name="close" size={13} />
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowNewFolderInput(true)}
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
              >
                <Icon name="plus" size={13} />
                <span>폴더 추가</span>
              </button>
            )}
          </div>

          {/* 우측: 새 공유 노트 작성 & 내 노트 불러오기 */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => setShowPersonalPicker(true)}
              className="px-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-xs font-bold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <Icon name="note" size={13} />
              <span>내 노트 불러오기</span>
            </button>
            <button
              type="button"
              onClick={() => openCreateNoteModal('idea')}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <Icon name="plus" size={14} />
              <span>새 공유 노트</span>
            </button>
          </div>
        </div>

        {/* 하단 줄: 정리 뷰 모드 전환 + 상태 배지 필터 + 검색창 */}
        <div className="flex items-center justify-between gap-2.5 flex-wrap pt-2.5 border-t border-line-light dark:border-line-dark">
          <div className="flex items-center gap-1 bg-canvas-light dark:bg-canvas-dark p-1 rounded-xl border border-line-light dark:border-line-dark flex-wrap">
            <button
              type="button"
              onClick={() => setViewMode('board')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                viewMode === 'board'
                  ? 'bg-surface-light dark:bg-surface-dark text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <Icon name="board" size={13} />
              <span>섹션 보드</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-surface-light dark:bg-surface-dark text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <Icon name="grid" size={13} />
              <span>카드 그리드</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('checklist')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                viewMode === 'checklist'
                  ? 'bg-surface-light dark:bg-surface-dark text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <Icon name="checkSquare" size={13} />
              <span>체크리스트</span>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl bg-canvas-light dark:bg-zinc-900 border border-line-light dark:border-line-dark text-xs font-semibold text-zinc-800 dark:text-zinc-200 outline-none shrink-0"
            >
              <option value="all">상태: 전체</option>
              <option value="중요">중요</option>
              <option value="검토필요">검토필요</option>
              <option value="확정">확정</option>
              <option value="질문">질문</option>
            </select>
            <div className="relative flex-1 min-w-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none">
                <Icon name="search" size={13} />
              </span>
              <input
                type="search"
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                placeholder="공유 노트 제목, 본문, 작성자 검색..."
                className="w-full min-w-0 pl-8 pr-3 py-1.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs font-normal text-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:border-blue-500"
              />
            </div>
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

      {/* 4. 메인 영역: 좌측 공유 노트 보드 + 크기 조절 핸들 + 우측 실시간 그룹 채팅 */}
      <div className="flex flex-col xl:flex-row gap-4 xl:gap-0 items-stretch xl:items-start min-w-0">
        {/* 좌측 공유 노트 영역 */}
        <div className="flex-1 min-w-0 w-full xl:pr-2">
          {/* (A) 섹션 칸반 보드 뷰 (섹션 컬럼 드래그 + 노트 카드 드래그/순서 이동 지원) */}
          {viewMode === 'board' && (
            <div className="flex gap-4 overflow-x-auto pb-3 items-start">
              {(activeRoom.sections || []).map((section, secIdx) => {
                const sectionNotes = filteredRoomNotes.filter(
                  (n) => (n.sectionId || 'idea') === section.id
                );
                const topBorder = SECTION_ACCENT_STYLES[section.color] || 'border-t-blue-500';
                const isDragOverCol = dragOverSectionId === section.id;
                const isHeaderDragOver = dragOverHeaderSectionId === section.id;
                const isDraggingThisSec = draggedSectionId === section.id;

                return (
                  <div
                    key={section.id}
                    onDragOver={(e) => {
                      if (draggedSectionId && draggedSectionId !== section.id && isHost) {
                        e.preventDefault();
                        setDragOverHeaderSectionId(section.id);
                        return;
                      }
                      if (draggedNoteId) {
                        e.preventDefault();
                        setDragOverSectionId(section.id);
                      }
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget)) {
                        setDragOverSectionId((prev) => (prev === section.id ? null : prev));
                        setDragOverHeaderSectionId((prev) => (prev === section.id ? null : prev));
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverSectionId(null);
                      setDragOverHeaderSectionId(null);
                      if (draggedSectionId && draggedSectionId !== section.id && isHost) {
                        const fromIdx = (activeRoom.sections || []).findIndex(
                          (s) => s.id === draggedSectionId
                        );
                        handleReorderSections({
                          sectionId: draggedSectionId,
                          targetSectionId: section.id,
                          position: fromIdx < secIdx ? 'after' : 'before'
                        });
                        setDraggedSectionId(null);
                        return;
                      }
                      if (draggedNoteId) {
                        handleReorderNote({
                          noteId: draggedNoteId,
                          targetSectionId: section.id,
                          position: 'end'
                        });
                        setDraggedNoteId(null);
                        setDropTargetNote(null);
                      }
                    }}
                    className={`w-[280px] sm:w-[304px] shrink-0 bg-surface-light dark:bg-surface-dark rounded-2xl border border-line-light dark:border-line-dark border-t-4 ${topBorder} p-3.5 flex flex-col gap-3 transition-all ${
                      isDraggingThisSec
                        ? 'opacity-60 scale-[0.98]'
                        : isHeaderDragOver
                        ? 'ring-2 ring-blue-600 bg-blue-500/5'
                        : isDragOverCol
                        ? 'ring-2 ring-blue-500/80 bg-blue-500/5'
                        : ''
                    }`}
                  >
                    <div
                      draggable={isHost && editingSectionId !== section.id}
                      onDragStart={(e) => {
                        if (!isHost || editingSectionId === section.id) return;
                        e.stopPropagation();
                        setDraggedSectionId(section.id);
                        if (e.dataTransfer) {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', `sec:${section.id}`);
                        }
                      }}
                      onDragEnd={() => {
                        setDraggedSectionId(null);
                        setDragOverHeaderSectionId(null);
                      }}
                      className="flex items-center justify-between gap-2"
                    >
                      {editingSectionId === section.id ? (
                        <form onSubmit={handleRenameSection} className="flex items-center gap-1 flex-1 min-w-0">
                          <input
                            type="text"
                            value={editingSectionTitle}
                            onChange={(e) => setEditingSectionTitle(e.target.value)}
                            autoFocus
                            className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-canvas-light dark:bg-canvas-dark border border-blue-500 text-xs font-normal text-zinc-900 dark:text-white outline-none"
                          />
                          <button
                            type="submit"
                            className="text-xs font-bold text-blue-600 px-1.5 py-0.5 cursor-pointer"
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSectionId(null)}
                            className="p-1 text-zinc-500 hover:text-zinc-700 cursor-pointer"
                            aria-label="섹션 이름 변경 취소"
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </form>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isHost && (
                              <span
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-grab active:cursor-grabbing shrink-0"
                                title="끌어서 섹션 컬럼 순서 변경"
                              >
                                <Icon name="grip" size={13} />
                              </span>
                            )}
                            <h3 className="text-[13px] font-extrabold text-zinc-900 dark:text-zinc-100 truncate">
                              {section.title}
                            </h3>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-muted-light dark:bg-muted-dark text-zinc-700 dark:text-zinc-200 shrink-0">
                              {sectionNotes.length}
                            </span>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {isHost && (activeRoom.sections || []).length > 1 && (
                              <>
                                <button
                                  type="button"
                                  disabled={secIdx === 0}
                                  onClick={() =>
                                    handleReorderSections({
                                      sectionId: section.id,
                                      direction: 'left'
                                    })
                                  }
                                  className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-25 cursor-pointer"
                                  title="섹션 왼쪽으로 이동"
                                  aria-label="섹션 왼쪽으로 이동"
                                >
                                  <Icon name="left" size={12} />
                                </button>
                                <button
                                  type="button"
                                  disabled={secIdx === (activeRoom.sections || []).length - 1}
                                  onClick={() =>
                                    handleReorderSections({
                                      sectionId: section.id,
                                      direction: 'right'
                                    })
                                  }
                                  className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-25 cursor-pointer"
                                  title="섹션 오른쪽으로 이동"
                                  aria-label="섹션 오른쪽으로 이동"
                                >
                                  <Icon name="right" size={12} />
                                </button>
                              </>
                            )}
                            {isHost && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSectionId(section.id);
                                    setEditingSectionTitle(section.title);
                                  }}
                                  className="p-1 rounded-md text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                                  title="섹션 이름 변경"
                                  aria-label="섹션 이름 변경"
                                >
                                  <Icon name="edit" size={12} />
                                </button>
                                {(activeRoom.sections || []).length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSection(section)}
                                    className="p-1 rounded-md text-zinc-400 hover:text-red-500 cursor-pointer"
                                    title="섹션 삭제"
                                    aria-label="섹션 삭제"
                                  >
                                    <Icon name="trash" size={12} />
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => openCreateNoteModal(section.id)}
                              className="ml-0.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 px-2 py-1 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                              title="이 섹션에 노트 추가"
                            >
                              <Icon name="plus" size={12} />
                              <span>추가</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex flex-col gap-2.5 min-h-[120px]">
                      {sectionNotes.length === 0 ? (
                        <div className="py-10 px-3 text-center text-xs text-zinc-500 dark:text-zinc-400 border border-dashed border-line-light dark:border-line-dark rounded-xl leading-relaxed">
                          노트 카드를 끌어다 놓거나
                          <br />
                          상단 [+ 추가] 버튼으로 생성하세요
                        </div>
                      ) : (
                        sectionNotes.map((note, noteIdx) => (
                          <SharedNoteCard
                            key={note.id}
                            note={note}
                            isSelected={selectedNoteIds.includes(note.id)}
                            isDragging={draggedNoteId === note.id}
                            dropPosition={
                              dropTargetNote?.noteId === note.id ? dropTargetNote.position : null
                            }
                            canMoveUp={noteIdx > 0}
                            canMoveDown={noteIdx < sectionNotes.length - 1}
                            sections={activeRoom.sections || []}
                            onToggleSelect={() =>
                              setSelectedNoteIds((prev) =>
                                prev.includes(note.id)
                                  ? prev.filter((id) => id !== note.id)
                                  : [...prev, note.id]
                              )
                            }
                            onDragStart={(e) => {
                              e.stopPropagation();
                              setDraggedNoteId(note.id);
                              if (e.dataTransfer) {
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', note.id);
                              }
                            }}
                            onDragEnd={() => {
                              setDraggedNoteId(null);
                              setDropTargetNote(null);
                              setDragOverSectionId(null);
                            }}
                            onDragOverCard={(e) => {
                              if (!draggedNoteId || draggedNoteId === note.id) return;
                              e.preventDefault();
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              const pos = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
                              setDragOverSectionId(section.id);
                              setDropTargetNote((prev) =>
                                prev?.noteId === note.id && prev?.position === pos
                                  ? prev
                                  : { noteId: note.id, position: pos }
                              );
                            }}
                            onDropOnCard={(e) => {
                              if (!draggedNoteId) return;
                              e.preventDefault();
                              e.stopPropagation();
                              const pos =
                                dropTargetNote?.noteId === note.id
                                  ? dropTargetNote.position
                                  : 'before';
                              if (draggedNoteId !== note.id) {
                                handleReorderNote({
                                  noteId: draggedNoteId,
                                  targetSectionId: section.id,
                                  targetNoteId: note.id,
                                  position: pos
                                });
                              }
                              setDraggedNoteId(null);
                              setDropTargetNote(null);
                              setDragOverSectionId(null);
                            }}
                            onMoveStep={(dir) => {
                              const neighbor =
                                dir === 'up'
                                  ? sectionNotes[noteIdx - 1]
                                  : sectionNotes[noteIdx + 1];
                              if (!neighbor) return;
                              handleReorderNote({
                                noteId: note.id,
                                targetSectionId: section.id,
                                targetNoteId: neighbor.id,
                                direction: dir
                              });
                            }}
                            onMoveToSection={(targetSecId) =>
                              handleReorderNote({
                                noteId: note.id,
                                targetSectionId: targetSecId,
                                position: 'end'
                              })
                            }
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
              <div className="w-[244px] shrink-0">
                {showNewSectionInput ? (
                  <form
                    onSubmit={handleAddSection}
                    className="bg-surface-light dark:bg-surface-dark p-3.5 rounded-2xl border border-line-light dark:border-line-dark flex flex-col gap-2"
                  >
                    <input
                      type="text"
                      value={newSectionTitle}
                      onChange={(e) => setNewSectionTitle(e.target.value)}
                      placeholder="예: 테스트 대기"
                      autoFocus
                      className="px-3 py-2 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-xs font-normal text-zinc-900 dark:text-white outline-none focus:border-blue-500"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowNewSectionInput(false)}
                        className="px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-700"
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
                    className="w-full py-3.5 px-4 rounded-2xl border border-dashed border-line-light dark:border-line-dark text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-500/50 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Icon name="plus" size={14} />
                    <span>새 보드 섹션 추가</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* (B) 카드 그리드 뷰 (카드 드래그/화살표 순서 재정렬 지원) */}
          {viewMode === 'grid' && (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3.5">
              {filteredRoomNotes.length === 0 ? (
                <div className="col-span-full bg-surface-light dark:bg-surface-dark p-10 rounded-2xl border border-line-light dark:border-line-dark text-center text-xs text-zinc-500 dark:text-zinc-400">
                  조건에 맞는 공유 노트가 없습니다.
                </div>
              ) : (
                filteredRoomNotes.map((note, noteIdx) => (
                  <SharedNoteCard
                    key={note.id}
                    note={note}
                    isSelected={selectedNoteIds.includes(note.id)}
                    isDragging={draggedNoteId === note.id}
                    dropPosition={
                      dropTargetNote?.noteId === note.id ? dropTargetNote.position : null
                    }
                    canMoveUp={noteIdx > 0}
                    canMoveDown={noteIdx < filteredRoomNotes.length - 1}
                    sections={activeRoom.sections || []}
                    onToggleSelect={() =>
                      setSelectedNoteIds((prev) =>
                        prev.includes(note.id)
                          ? prev.filter((id) => id !== note.id)
                          : [...prev, note.id]
                      )
                    }
                    onDragStart={(e) => {
                      setDraggedNoteId(note.id);
                      if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', note.id);
                      }
                    }}
                    onDragEnd={() => {
                      setDraggedNoteId(null);
                      setDropTargetNote(null);
                    }}
                    onDragOverCard={(e) => {
                      if (!draggedNoteId || draggedNoteId === note.id) return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pos = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
                      setDropTargetNote((prev) =>
                        prev?.noteId === note.id && prev?.position === pos
                          ? prev
                          : { noteId: note.id, position: pos }
                      );
                    }}
                    onDropOnCard={(e) => {
                      if (!draggedNoteId || draggedNoteId === note.id) return;
                      e.preventDefault();
                      const pos =
                        dropTargetNote?.noteId === note.id ? dropTargetNote.position : 'before';
                      handleReorderNote({
                        noteId: draggedNoteId,
                        targetSectionId: note.sectionId || 'idea',
                        targetNoteId: note.id,
                        position: pos
                      });
                      setDraggedNoteId(null);
                      setDropTargetNote(null);
                    }}
                    onMoveStep={(dir) => {
                      const neighbor =
                        dir === 'up' ? filteredRoomNotes[noteIdx - 1] : filteredRoomNotes[noteIdx + 1];
                      if (!neighbor) return;
                      handleReorderNote({
                        noteId: note.id,
                        targetNoteId: neighbor.id,
                        direction: dir
                      });
                    }}
                    onMoveToSection={(targetSecId) =>
                      handleReorderNote({
                        noteId: note.id,
                        targetSectionId: targetSecId,
                        position: 'end'
                      })
                    }
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
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 inline-flex items-center gap-2">
                  <Icon name="checkSquare" size={16} className="text-blue-600 dark:text-blue-400" />
                  <span>방 전체 공동 체크리스트 모아보기</span>
                </h3>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  클릭하면 모든 참여자 화면에 실시간으로 완료 표시됩니다
                </span>
              </div>
              {filteredRoomNotes.filter((n) => (n.checklist || []).length > 0).length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  체크리스트가 포함된 공유 노트가 없습니다. 노트 작성 시 할 일 항목을 추가해 보세요.
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
                              className="text-xs font-extrabold text-zinc-900 dark:text-zinc-100 hover:text-blue-600 text-left truncate cursor-pointer"
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

        {/* 데스크톱 분할 너비 드래그 핸들 */}
        {chatOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="메신저 창 너비 조절"
            title="끌어서 채팅창 너비 조절 (더블클릭 시 기본 크기)"
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizingSplit(true);
            }}
            onDoubleClick={() => setChatPanelWidth(360)}
            className="hidden xl:flex w-3 shrink-0 cursor-col-resize items-center justify-center group select-none self-stretch py-6"
          >
            <span
              className={`w-1 h-16 rounded-full transition-colors ${
                isResizingSplit
                  ? 'bg-blue-600'
                  : 'bg-line-light dark:bg-line-dark group-hover:bg-blue-500'
              }`}
            />
          </div>
        )}

        {/* 우측 도킹형 실시간 메신저 패널 (드래그 너비 조절 + 파일/GIF 첨부 + 답장 + 이모지 반응) */}
        {chatOpen && (
          <aside
            style={{ '--chat-w': `${chatPanelWidth}px` }}
            onDragOver={(e) => {
              if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                setChatDragActive(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setChatDragActive(false);
              }
            }}
            onDrop={handleChatDrop}
            className="relative w-full xl:w-[var(--chat-w)] shrink-0 min-w-0 overflow-hidden bg-surface-light dark:bg-surface-dark rounded-2xl border border-line-light dark:border-line-dark shadow-sm flex flex-col h-[520px] xl:h-[clamp(440px,calc(100vh-225px),740px)] xl:sticky xl:top-6"
          >
            {/* 파일 / GIF 드롭 오버레이 */}
            {chatDragActive && (
              <div className="absolute inset-0 z-30 bg-blue-600/15 backdrop-blur-[2px] border-2 border-dashed border-blue-500 rounded-2xl flex flex-col items-center justify-center gap-2 p-6 text-center pointer-events-none">
                <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md">
                  <Icon name="paperclip" size={20} />
                </div>
                <p className="text-sm font-extrabold text-blue-700 dark:text-blue-300">
                  파일·이미지·GIF를 여기에 놓으세요
                </p>
                <p className="text-xs text-zinc-700 dark:text-zinc-200">
                  메시지당 최대 4개, 파일당 최대 3MB까지 첨부됩니다
                </p>
              </div>
            )}

            {/* 메신저 헤더 */}
            <div className="shrink-0 px-4 py-3 border-b border-line-light dark:border-line-dark flex items-center justify-between gap-2 bg-surface-light dark:bg-surface-dark">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    activeRoom.relayConnected ? 'bg-emerald-500 animate-pulse' : 'bg-blue-500'
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-extrabold text-zinc-900 dark:text-zinc-100 truncate">
                    그룹 메신저
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {activeRoom.relayConnected ? '실시간 온라인' : '로컬 네트워크'} · 답장·GIF·파일 첨부
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-muted-light dark:hover:bg-muted-dark transition-colors cursor-pointer shrink-0"
                title="메신저 창 접기"
                aria-label="메신저 창 접기"
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            {/* 채팅 메시지 목록 */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 flex flex-col gap-2.5">
              {(activeRoom.messages || []).length === 0 ? (
                <div className="my-auto py-10 px-4 text-center flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-muted-light dark:bg-muted-dark text-zinc-500 flex items-center justify-center">
                    <Icon name="message" size={18} />
                  </div>
                  <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    첫 메시지를 보내 팀원과 대화를 시작해 보세요.
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    파일·GIF를 끌어다 놓거나 Ctrl+V로 이미지를 바로 보낼 수 있습니다.
                  </p>
                </div>
              ) : (
                (activeRoom.messages || []).map((msg, msgIndex, msgArr) => {
                  const prevMsg = msgIndex > 0 ? msgArr[msgIndex - 1] : null;
                  const currDateKey = new Date(msg.createdAt || Date.now()).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  });
                  const prevDateKey = prevMsg
                    ? new Date(prevMsg.createdAt || Date.now()).toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })
                    : null;
                  const showDateDivider = currDateKey !== prevDateKey;

                  if (msg.isSystem) {
                    return (
                      <div key={msg.id} className="flex flex-col gap-2 my-0.5">
                        {showDateDivider && (
                          <div className="flex items-center justify-center my-1">
                            <span className="text-[11px] font-semibold px-3 py-0.5 rounded-full bg-muted-light dark:bg-muted-dark text-zinc-600 dark:text-zinc-300">
                              {currDateKey}
                            </span>
                          </div>
                        )}
                        <div className="text-center">
                          <span className="inline-block max-w-full break-words text-[11px] px-3 py-1 rounded-full bg-muted-light dark:bg-muted-dark text-zinc-600 dark:text-zinc-300">
                            {msg.text}
                          </span>
                        </div>
                      </div>
                    );
                  }

                  const isMine = msg.author?.uid === currentAccount.uid;
                  const isGrouped =
                    !showDateDivider &&
                    prevMsg &&
                    !prevMsg.isSystem &&
                    prevMsg.author?.uid === msg.author?.uid &&
                    Math.abs((msg.createdAt || 0) - (prevMsg.createdAt || 0)) < 3 * 60 * 1000;
                  const timeStr = new Date(msg.createdAt || Date.now()).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                  const msgAttachments = Array.isArray(msg.attachments) ? msg.attachments : [];
                  const hasLegacyStandaloneImage =
                    Boolean(msg.imageDataUrl) &&
                    !msgAttachments.some((a) => a.dataUrl === msg.imageDataUrl);
                  const reactionEntries = Object.entries(msg.reactions || {}).filter(
                    ([, uids]) => Array.isArray(uids) && uids.length > 0
                  );

                  return (
                    <div key={msg.id} className="flex flex-col gap-1.5">
                      {showDateDivider && (
                        <div className="flex items-center justify-center my-1.5">
                          <span className="text-[11px] font-semibold px-3 py-0.5 rounded-full bg-muted-light dark:bg-muted-dark text-zinc-600 dark:text-zinc-300">
                            {currDateKey}
                          </span>
                        </div>
                      )}

                      <div
                        className={`group flex gap-2 min-w-0 ${
                          isMine ? 'flex-row-reverse' : 'flex-row'
                        } ${isGrouped ? '-mt-1' : 'mt-1'}`}
                      >
                        <div className="w-7 shrink-0">
                          {!isGrouped && <UserAvatar user={msg.author} size="sm" />}
                        </div>

                        <div
                          className={`min-w-0 max-w-[84%] flex flex-col ${
                            isMine ? 'items-end' : 'items-start'
                          }`}
                        >
                          {!isGrouped && (
                            <div
                              className={`flex items-center gap-1.5 mb-1 max-w-full ${
                                isMine ? 'flex-row-reverse' : 'flex-row'
                              }`}
                            >
                              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate">
                                {msg.author?.name}
                              </span>
                              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0">
                                {timeStr}
                              </span>
                            </div>
                          )}

                          <div
                            className={`max-w-full px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed break-words [overflow-wrap:anywhere] overflow-hidden shadow-xs ${
                              isMine
                                ? 'bg-blue-600 text-white rounded-tr-sm'
                                : 'bg-canvas-light dark:bg-canvas-dark text-zinc-900 dark:text-zinc-100 border border-line-light dark:border-line-dark rounded-tl-sm'
                            }`}
                          >
                            {/* 답장/인용 블록 */}
                            {msg.replyTo && (
                              <div
                                className={`mb-2 pl-2.5 pr-2 py-1.5 rounded-lg border-l-2 text-[11px] ${
                                  isMine
                                    ? 'bg-blue-700/70 border-white/70 text-blue-50'
                                    : 'bg-surface-light dark:bg-surface-dark border-blue-500 text-zinc-600 dark:text-zinc-300'
                                }`}
                              >
                                <div className="font-bold truncate">
                                  ↳ {msg.replyTo.authorName}에게 답장
                                </div>
                                <div className="truncate opacity-90">
                                  {msg.replyTo.text || msg.replyTo.preview}
                                </div>
                              </div>
                            )}

                            {/* 본문 텍스트 */}
                            {msg.text && (
                              <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                {msg.text}
                              </div>
                            )}

                            {/* 레거시 단일 이미지 / GIF */}
                            {hasLegacyStandaloneImage && (
                              <div className="mt-2 relative group/media inline-block max-w-full">
                                <img
                                  src={msg.imageDataUrl}
                                  alt="채팅 이미지"
                                  onClick={() =>
                                    setLightboxMedia({
                                      src: msg.imageDataUrl,
                                      name: msg.imageDataUrl.startsWith('data:image/gif')
                                        ? 'image.gif'
                                        : 'image.png',
                                      isGif: msg.imageDataUrl.startsWith('data:image/gif')
                                    })
                                  }
                                  className="rounded-xl max-h-52 max-w-full object-contain bg-black/10 cursor-zoom-in"
                                />
                                {msg.imageDataUrl.startsWith('data:image/gif') && (
                                  <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/75 text-white text-[10px] font-extrabold tracking-wide">
                                    GIF
                                  </span>
                                )}
                              </div>
                            )}

                            {/* 다중 첨부파일 (GIF / 이미지 / 일반 파일) */}
                            {msgAttachments.length > 0 && (
                              <div className="mt-2 flex flex-col gap-2 max-w-full">
                                {msgAttachments.map((att) => {
                                  const attMime = att.mime || att.mimeType || '';
                                  const isGif =
                                    Boolean(att.isGif) ||
                                    att.kind === 'gif' ||
                                    attMime === 'image/gif' ||
                                    att.dataUrl?.startsWith('data:image/gif');
                                  const isImgOrGif =
                                    Boolean(att.isImage) ||
                                    isGif ||
                                    att.kind === 'image' ||
                                    attMime.startsWith('image/');

                                  if (isImgOrGif) {
                                    return (
                                      <div
                                        key={att.id || att.name}
                                        className="relative rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black/5"
                                      >
                                        <img
                                          src={att.dataUrl}
                                          alt={att.name}
                                          onClick={() =>
                                            setLightboxMedia({
                                              src: att.dataUrl,
                                              name: att.name,
                                              isGif
                                            })
                                          }
                                          className="max-h-56 w-full object-contain cursor-zoom-in"
                                        />
                                        {isGif && (
                                          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/75 text-white text-[10px] font-extrabold tracking-wide">
                                            GIF
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => handleSaveAttachment(att)}
                                          title="파일 저장"
                                          className="absolute bottom-2 right-2 px-2 py-1 rounded-lg bg-black/70 hover:bg-black text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                                        >
                                          <Icon name="download" size={12} />
                                          <span>저장</span>
                                        </button>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div
                                      key={att.id || att.name}
                                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2.5 min-w-0 ${
                                        isMine
                                          ? 'bg-blue-700/75 border-white/20 text-white'
                                          : 'bg-surface-light dark:bg-surface-dark border-line-light dark:border-line-dark text-zinc-900 dark:text-zinc-100'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <span
                                          className={`px-2 py-1 rounded-lg text-[10px] font-extrabold tracking-wider shrink-0 ${
                                            isMine
                                              ? 'bg-white/20 text-white'
                                              : 'bg-blue-600/15 text-blue-700 dark:text-blue-300'
                                          }`}
                                        >
                                          {getFileExtensionBadge(att.name, attMime)}
                                        </span>
                                        <div className="min-w-0">
                                          <div className="text-xs font-bold truncate">{att.name}</div>
                                          <div
                                            className={`text-[11px] ${
                                              isMine ? 'text-blue-100' : 'text-zinc-500 dark:text-zinc-400'
                                            }`}
                                          >
                                            {formatFileSize(att.size)}
                                          </div>
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleSaveAttachment(att)}
                                        title="PC에 파일 저장"
                                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors ${
                                          isMine
                                            ? 'bg-white text-blue-700 hover:bg-blue-50'
                                            : 'bg-blue-600 text-white hover:bg-blue-700'
                                        }`}
                                      >
                                        <Icon name="download" size={12} />
                                        <span>저장</span>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* 공유 노트 링크 카드 */}
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
                                className={`mt-2 w-full min-w-0 max-w-full overflow-hidden p-2.5 rounded-xl text-left flex items-center justify-between gap-2 border cursor-pointer ${
                                  isMine
                                    ? 'bg-blue-700/80 border-white/25 text-white hover:bg-blue-700'
                                    : 'bg-surface-light dark:bg-surface-dark border-line-light dark:border-line-dark text-zinc-900 dark:text-zinc-100 hover:border-blue-500/50'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <Icon name="note" size={14} className="shrink-0" />
                                  <div className="min-w-0">
                                    <div className="text-[11px] opacity-80">공유 노트 바로가기</div>
                                    <div className="text-xs font-bold truncate">
                                      {msg.sharedNoteRef.title}
                                    </div>
                                  </div>
                                </div>
                                <Icon name="right" size={13} className="shrink-0" />
                              </button>
                            )}
                          </div>

                          {/* 이모지 반응 배지 */}
                          {reactionEntries.length > 0 && (
                            <div
                              className={`mt-1 flex flex-wrap gap-1 ${
                                isMine ? 'justify-end' : 'justify-start'
                              }`}
                            >
                              {reactionEntries.map(([emoji, uids]) => {
                                const reactedByMe = uids.includes(currentAccount.uid);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => handleReactChat(msg.id, emoji)}
                                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold border inline-flex items-center gap-1 cursor-pointer transition-colors ${
                                      reactedByMe
                                        ? 'bg-blue-600/15 border-blue-500/50 text-blue-700 dark:text-blue-300'
                                        : 'bg-canvas-light dark:bg-canvas-dark border-line-light dark:border-line-dark text-zinc-700 dark:text-zinc-300 hover:border-blue-500/40'
                                    }`}
                                  >
                                    <span>{emoji}</span>
                                    <span>{uids.length}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* 말풍선 빠른 액션 바 (답장 / 반응 / 노트화 / 복사) */}
                          <div
                            className={`mt-1 flex items-center gap-2 flex-wrap ${
                              isMine ? 'justify-end' : 'justify-start'
                            }`}
                          >
                            {isGrouped && (
                              <span className="text-[10px] text-zinc-400">{timeStr}</span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const preview =
                                  msg.text ||
                                  (msg.attachments?.length
                                    ? `첨부파일 ${msg.attachments.length}개`
                                    : msg.imageDataUrl
                                    ? '이미지'
                                    : msg.sharedNoteRef?.title || '메시지');
                                setChatReplyTarget({
                                  id: msg.id,
                                  authorName: msg.author?.name || '팀원',
                                  text: preview,
                                  preview
                                });
                                chatInputRef.current?.focus();
                              }}
                              className="opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 inline-flex items-center gap-0.5 cursor-pointer transition-opacity"
                            >
                              <Icon name="reply" size={11} />
                              <span>답장</span>
                            </button>

                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveReactionMsgId((prev) =>
                                    prev === msg.id ? null : msg.id
                                  )
                                }
                                className="opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 inline-flex items-center gap-0.5 cursor-pointer transition-opacity"
                              >
                                <Icon name="smile" size={11} />
                                <span>반응</span>
                              </button>
                              {activeReactionMsgId === msg.id && (
                                <div
                                  className={`absolute bottom-full mb-1 z-30 bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark rounded-full shadow-lg px-2 py-1 flex items-center gap-1 ${
                                    isMine ? 'right-0' : 'left-0'
                                  }`}
                                >
                                  {CHAT_REACTIONS.map((emoji) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      onClick={() => handleReactChat(msg.id, emoji)}
                                      className="w-6 h-6 rounded-full hover:bg-muted-light dark:hover:bg-muted-dark text-sm grid place-items-center cursor-pointer"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            {msg.pinnedToNoteId ? (
                              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold inline-flex items-center gap-0.5">
                                <Icon name="pin" size={11} />
                                <span>노트 등록됨</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handlePromoteChatToNote(msg.id)}
                                className="opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5 cursor-pointer transition-opacity"
                              >
                                <Icon name="pin" size={11} />
                                <span>노트화</span>
                              </button>
                            )}

                            {msg.text && (
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(msg.text);
                                  showToast?.('메시지 텍스트를 복사했습니다.', 'success');
                                }}
                                className="opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 inline-flex items-center gap-0.5 cursor-pointer transition-opacity"
                                title="텍스트 복사"
                              >
                                <Icon name="copy" size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* 인라인 노트 공유 선택 트레이 */}
            {showChatNotePicker && (
              <div className="shrink-0 max-h-44 overflow-y-auto px-3 py-2.5 bg-canvas-light dark:bg-canvas-dark border-t border-line-light dark:border-line-dark flex flex-col gap-1.5">
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                    채팅에 공유할 노트 선택
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowChatNotePicker(false)}
                    className="p-1 text-zinc-500 hover:text-zinc-700"
                    aria-label="노트 선택 닫기"
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
                {(activeRoom.notes || []).length === 0 ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 px-2 py-2 text-center">
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
                      className="w-full px-2.5 py-1.5 rounded-lg bg-surface-light dark:bg-surface-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-left text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Icon name="note" size={12} className="shrink-0 text-blue-600 dark:text-blue-400" />
                      <span className="truncate">{n.title}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* 빠른 이모지 선택 트레이 */}
            {showChatEmojiPicker && (
              <div className="shrink-0 px-3 py-2 bg-canvas-light dark:bg-canvas-dark border-t border-line-light dark:border-line-dark flex flex-wrap gap-1.5">
                {CHAT_QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      setChatInput((prev) => `${prev}${emoji}`);
                      chatInputRef.current?.focus();
                    }}
                    className="w-8 h-8 rounded-lg hover:bg-surface-light dark:hover:bg-surface-dark border border-transparent hover:border-line-light dark:hover:border-line-dark text-base grid place-items-center cursor-pointer transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {/* 답장 대상 미리보기 */}
            {chatReplyTarget && (
              <div className="shrink-0 px-3.5 py-2 bg-canvas-light dark:bg-canvas-dark border-t border-line-light dark:border-line-dark flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 pl-2 border-l-2 border-blue-500">
                  <div className="text-[11px] font-bold text-blue-600 dark:text-blue-400 truncate">
                    {chatReplyTarget.authorName}에게 답장 중
                  </div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-300 truncate">
                    {chatReplyTarget.preview}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setChatReplyTarget(null)}
                  className="p-1 text-zinc-400 hover:text-red-500 shrink-0 cursor-pointer"
                  aria-label="답장 취소"
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            )}

            {/* 첨부 대기 트레이 (다중 파일 / GIF / 이미지 + 노트 링크) */}
            {(chatImage || chatAttachments.length > 0 || chatShareNoteRef) && (
              <div className="shrink-0 px-3.5 py-2 bg-canvas-light dark:bg-canvas-dark border-t border-line-light dark:border-line-dark flex flex-col gap-2 min-w-0">
                {(chatImage || chatAttachments.length > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {chatImage && (
                      <div className="relative flex items-center gap-2 px-2 py-1 rounded-xl bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark">
                        <img
                          src={chatImage}
                          alt="첨부 이미지"
                          className="w-8 h-8 rounded-lg object-cover shrink-0"
                        />
                        <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
                          이미지
                        </span>
                        <button
                          type="button"
                          onClick={() => setChatImage('')}
                          className="text-zinc-400 hover:text-red-500 p-0.5 cursor-pointer"
                        >
                          <Icon name="close" size={11} />
                        </button>
                      </div>
                    )}

                    {chatAttachments.map((att) => {
                      const attMime = att.mime || att.mimeType || '';
                      const isGif = Boolean(att.isGif) || att.kind === 'gif' || attMime === 'image/gif';
                      const isMedia =
                        Boolean(att.isImage) ||
                        isGif ||
                        att.kind === 'image' ||
                        attMime.startsWith('image/');
                      return (
                        <div
                          key={att.id}
                          className="flex items-center gap-2 px-2 py-1 rounded-xl bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark max-w-full"
                        >
                          {isMedia ? (
                            <img
                              src={att.dataUrl}
                              alt={att.name}
                              className="w-8 h-8 rounded-lg object-cover shrink-0"
                            />
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-blue-600/15 text-blue-700 dark:text-blue-300 text-[10px] font-extrabold shrink-0">
                              {getFileExtensionBadge(att.name, attMime)}
                            </span>
                          )}
                          <div className="min-w-0 max-w-[125px]">
                            <div className="text-[11px] font-bold text-zinc-800 dark:text-zinc-100 truncate">
                              {att.name}
                            </div>
                            <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                              {isGif ? 'GIF · ' : ''}
                              {formatFileSize(att.size)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setChatAttachments((prev) => prev.filter((item) => item.id !== att.id))
                            }
                            className="text-zinc-400 hover:text-red-500 p-0.5 shrink-0 cursor-pointer"
                            title="첨부 취소"
                          >
                            <Icon name="close" size={11} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {chatShareNoteRef && (
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-blue-600/10 border border-blue-500/30 min-w-0">
                    <div className="text-xs font-bold text-blue-700 dark:text-blue-300 truncate inline-flex items-center gap-1.5 min-w-0">
                      <Icon name="note" size={13} className="shrink-0" />
                      <span className="truncate">노트 공유: {chatShareNoteRef.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setChatShareNoteRef(null)}
                      className="text-zinc-400 hover:text-red-500 p-0.5 shrink-0 cursor-pointer"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 숨겨진 HTML 파일 피커 (브라우저 / 폴백) */}
            <input
              ref={chatFileInputRef}
              type="file"
              multiple
              onChange={(e) => handleChatFileInputChange(e, 'any')}
              className="hidden"
            />
            <input
              ref={chatGifInputRef}
              type="file"
              accept="image/gif,image/png,image/jpeg,image/webp"
              multiple
              onChange={(e) => handleChatFileInputChange(e, 'gif')}
              className="hidden"
            />

            {/* 채팅 입력 폼 */}
            <form
              onSubmit={handleSendChat}
              className="shrink-0 p-3 border-t border-line-light dark:border-line-dark flex flex-col gap-2 bg-surface-light dark:bg-surface-dark"
            >
              <div className="flex items-center justify-between gap-1.5 min-w-0 flex-wrap">
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handlePickChatFilesNative('any')}
                    className="px-2 py-1 rounded-lg bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-[11px] font-bold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1 cursor-pointer transition-colors"
                    title="파일, 문서, 이미지 첨부 (최대 3MB)"
                  >
                    <Icon name="paperclip" size={12} />
                    <span>파일</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePickChatFilesNative('gif')}
                    className="px-2 py-1 rounded-lg bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border border-line-light dark:border-line-dark text-[11px] font-bold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1 cursor-pointer transition-colors"
                    title="움직이는 GIF / 이미지 첨부"
                  >
                    <Icon name="image" size={12} />
                    <span>GIF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowChatEmojiPicker((v) => !v)}
                    className={`px-2 py-1 rounded-lg border text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                      showChatEmojiPicker
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border-line-light dark:border-line-dark text-zinc-700 dark:text-zinc-200'
                    }`}
                    title="빠른 이모지"
                  >
                    <Icon name="smile" size={12} />
                    <span>이모지</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowChatNotePicker((v) => !v)}
                    className={`px-2 py-1 rounded-lg border text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                      showChatNotePicker
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-canvas-light dark:bg-canvas-dark hover:bg-muted-light dark:hover:bg-muted-dark border-line-light dark:border-line-dark text-zinc-700 dark:text-zinc-200'
                    }`}
                    title="방 안의 노트 카드를 채팅에 공유"
                  >
                    <Icon name="note" size={12} />
                    <span>노트</span>
                  </button>
                </div>
                <span className="text-[10px] text-zinc-400 whitespace-nowrap">
                  Enter 전송 · Shift+Enter 줄바꿈
                </span>
              </div>

              <div className="flex items-end gap-2 min-w-0">
                <textarea
                  ref={chatInputRef}
                  rows={2}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onPaste={handleChatPaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
                      e.preventDefault();
                      handleSendChat(e);
                    }
                  }}
                  placeholder="메시지 입력... (Ctrl+V 이미지 · 파일 드래그)"
                  className="flex-1 min-w-0 min-h-[42px] max-h-[120px] resize-none px-3 py-2 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark text-[13px] font-normal leading-relaxed text-zinc-900 dark:text-white placeholder:text-zinc-400 outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={
                    chatSending ||
                    (!chatInput.trim() &&
                      !chatImage &&
                      chatAttachments.length === 0 &&
                      !chatShareNoteRef)
                  }
                  className="px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                >
                  <Icon name="send" size={13} />
                  <span>{chatSending ? '전송 중' : '전송'}</span>
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
                  이 공유 방 및 그룹 노트 영구 삭제
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================
          MODAL 6: 채팅 이미지 / 움직이는 GIF 라이트박스 확대 보기
         ======================================================================== */}
      {lightboxMedia && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxMedia(null)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-zinc-900/90 text-white border border-white/10">
              <div className="flex items-center gap-2 min-w-0">
                {lightboxMedia.isGif && (
                  <span className="px-2 py-0.5 rounded bg-blue-600 text-[10px] font-extrabold shrink-0">
                    GIF
                  </span>
                )}
                <span className="text-xs font-bold truncate">{lightboxMedia.name || '이미지 미리보기'}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    handleSaveAttachment({
                      name: lightboxMedia.name || (lightboxMedia.isGif ? 'image.gif' : 'image.png'),
                      dataUrl: lightboxMedia.src
                    })
                  }
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Icon name="download" size={13} />
                  <span>파일 저장</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxMedia(null)}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                  aria-label="이미지 확대 닫기"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
            <img
              src={lightboxMedia.src}
              alt={lightboxMedia.name || '미리보기'}
              className="max-h-[78vh] max-w-full rounded-2xl object-contain shadow-2xl bg-black/40"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SharedNoteCard({
  note,
  isSelected,
  isDragging,
  dropPosition,
  canMoveUp,
  canMoveDown,
  sections = [],
  onToggleSelect,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onDropOnCard,
  onMoveStep,
  onMoveToSection,
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
  const isGifImage = Boolean(note.imageDataUrl && note.imageDataUrl.startsWith('data:image/gif'));

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOverCard}
      onDrop={onDropOnCard}
      className={`relative group bg-canvas-light dark:bg-canvas-dark rounded-xl border p-3.5 flex flex-col gap-2.5 transition-all hover:border-blue-500/50 ${
        isDragging
          ? 'opacity-50 scale-[0.98] border-blue-500'
          : isSelected
          ? 'ring-2 ring-blue-600 border-blue-600'
          : note.pinned
          ? 'border-l-4 border-l-blue-600 border-line-light dark:border-line-dark'
          : 'border-line-light dark:border-line-dark'
      }`}
    >
      {/* 드롭 삽입 위치 시각선 */}
      {dropPosition === 'before' && (
        <div className="absolute -top-1.5 left-2 right-2 h-1 rounded-full bg-blue-500 shadow-sm pointer-events-none" />
      )}
      {dropPosition === 'after' && (
        <div className="absolute -bottom-1.5 left-2 right-2 h-1 rounded-full bg-blue-500 shadow-sm pointer-events-none" />
      )}

      {/* 상단: 드래그 손잡이 + 체크박스 + 상태 배지 + 위/아래 이동 + 작성자 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-grab active:cursor-grabbing shrink-0"
            title="끌어서 카드 순서 또는 섹션 이동"
          >
            <Icon name="grip" size={13} />
          </span>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="w-3.5 h-3.5 accent-blue-600 rounded cursor-pointer shrink-0"
            title="병합/일괄 이동 선택"
          />
          {note.statusBadge && (
            <span
              className={`text-[11px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${
                STATUS_BADGE_STYLES[note.statusBadge] || ''
              }`}
            >
              {note.statusBadge}
            </span>
          )}
          {note.pinned && (
            <span className="text-blue-600 dark:text-blue-400 shrink-0" title="상단 고정됨">
              <Icon name="pin" size={12} />
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {(canMoveUp || canMoveDown) && onMoveStep && (
            <div className="flex items-center rounded-md border border-line-light dark:border-line-dark bg-surface-light dark:bg-surface-dark overflow-hidden opacity-85 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <button
                type="button"
                disabled={!canMoveUp}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveStep('up');
                }}
                title="위로 이동"
                aria-label="노트 카드 위로 이동"
                className="p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-25 cursor-pointer"
              >
                <Icon name="up" size={11} />
              </button>
              <button
                type="button"
                disabled={!canMoveDown}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveStep('down');
                }}
                title="아래로 이동"
                aria-label="노트 카드 아래로 이동"
                className="p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-25 border-l border-line-light dark:border-line-dark cursor-pointer"
              >
                <Icon name="down" size={11} />
              </button>
            </div>
          )}
          <UserAvatar user={note.author} size="sm" />
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 truncate max-w-[78px]">
            {note.author?.name}
          </span>
        </div>
      </div>

      {/* 제목 & 본문 요약 */}
      <div onClick={onView} className="cursor-pointer flex flex-col gap-1.5 min-w-0">
        <h4 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 line-clamp-2 leading-snug break-words [overflow-wrap:anywhere]">
          {note.title}
        </h4>
        {plain && (
          <p className="text-[13px] text-zinc-600 dark:text-zinc-300 line-clamp-3 leading-relaxed break-words [overflow-wrap:anywhere]">
            {plain}
          </p>
        )}
      </div>

      {/* 썸네일 이미지 / GIF */}
      {note.imageDataUrl && (
        <div className="relative cursor-pointer" onClick={onView}>
          <img
            src={note.imageDataUrl}
            alt="첨부 이미지"
            className="rounded-lg max-h-36 w-full object-cover border border-line-light dark:border-line-dark"
          />
          {isGifImage && (
            <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/75 text-white text-[10px] font-extrabold">
              GIF
            </span>
          )}
        </div>
      )}

      {/* 미니 체크리스트 프리뷰 */}
      {checklist.length > 0 && (
        <div className="p-2.5 rounded-lg bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px] font-bold text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <Icon name="checkSquare" size={12} />
              <span>체크리스트</span>
            </span>
            <span>
              {doneCount}/{checklist.length}
            </span>
          </div>
          {checklist.slice(0, 3).map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={Boolean(item.done)}
                onChange={() => onToggleCheck(item.id)}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              <span
                className={`truncate ${
                  item.done ? 'line-through text-zinc-400' : 'text-zinc-800 dark:text-zinc-200'
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
        <div className="flex flex-wrap gap-1.5">
          {note.tags.map((tag, i) => (
            <span
              key={i}
              className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-muted-light dark:bg-muted-dark text-zinc-600 dark:text-zinc-300"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* 섹션 빠른 변경 (WCAG 단일 클릭 대안) + 하단 액션 바 */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 pt-2.5 border-t border-line-light dark:border-line-dark text-xs font-semibold">
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={onSavePersonal}
            className="text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
            title="내 개인 노트로 저장"
          >
            <Icon name="download" size={12} />
            <span>내 노트로</span>
          </button>
          <button
            type="button"
            onClick={onShareInChat}
            className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
            title="채팅창에 이 노트 공유"
          >
            <Icon name="message" size={12} />
            <span>채팅공유</span>
          </button>
          {sections.length > 1 && onMoveToSection && (
            <select
              value={note.sectionId || 'idea'}
              onChange={(e) => onMoveToSection(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              title="섹션 이동"
              className="max-w-[96px] px-1.5 py-0.5 rounded-md bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 outline-none cursor-pointer"
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
          >
            <Icon name="edit" size={12} />
            <span>수정</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-zinc-500 hover:text-red-500 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
          >
            <Icon name="trash" size={12} />
            <span>삭제</span>
          </button>
        </div>
      </div>
    </div>
  );
}
