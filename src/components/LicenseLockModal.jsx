import React, { useState, useRef, useEffect } from 'react';
import { IconLock, IconClose } from './Icons';

// 1. 잠금 화면 모달 (비밀번호 입력하여 잠금 해제)
export function PasswordLockScreen({ isLocked, onVerify }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isLocked && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 180);
    }
  }, [isLocked]);

  if (!isLocked) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) return;
    const res = await onVerify(password);
    const ok = typeof res === 'object' ? Boolean(res?.ok) : Boolean(res);
    if (ok) {
      setPassword('');
      setError(false);
      setErrorMessage('');
    } else {
      setError(true);
      setErrorMessage(
        (typeof res === 'object' && res?.error) ||
          '비밀번호가 일치하지 않습니다. 다시 시도해 주세요.'
      );
      setShakeKey((k) => k + 1);
      setPassword('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-[#0a0a0f] overflow-hidden select-none">
      {/* Animated Orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="w-[360px] h-[360px] rounded-full bg-[#5b6cf0] blur-[80px] opacity-35 absolute -top-20 -left-16 animate-pulse" />
        <div className="w-[300px] h-[300px] rounded-full bg-[#8b5cf6] blur-[80px] opacity-35 absolute -bottom-16 -right-10 animate-pulse" />
        <div className="w-[220px] h-[220px] rounded-full bg-[#44c77d] blur-[80px] opacity-20 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>

      {/* Lock Card */}
      <div className="relative z-10 w-[min(410px,calc(100%-32px))] p-9 bg-[#14141c]/85 backdrop-blur-2xl border border-white/10 rounded-[28px] shadow-2xl flex flex-col animate-modal">
        <div className="flex items-center gap-3.5 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2B65F3] to-[#8b5cf6] text-white grid place-items-center shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/40">
              Private Workspace
            </span>
            <h2 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#7b8af8] to-[#a78bfa]">
              나무 노트
            </h2>
          </div>
        </div>

        <div className="h-px bg-white/10 mb-7" />

        <form onSubmit={handleSubmit} className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 text-white/60 grid place-items-center mb-1">
            <IconLock />
          </div>
          <h3 className="text-lg font-bold text-white/95">잠금 화면</h3>
          <p className="text-xs text-white/45 mb-2">
            설정한 비밀번호를 입력하여 잠금을 해제하세요.
          </p>

          <div className="flex items-center w-full rounded-2xl bg-white/5 border border-white/10 focus-within:border-[#5b6cf0]/60 focus-within:ring-2 focus-within:ring-[#5b6cf0]/20 overflow-hidden transition-all">
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(false);
              }}
              placeholder="비밀번호 입력"
              autoComplete="off"
              className="flex-1 bg-transparent px-4 py-3.5 text-sm text-white outline-none placeholder-white/30 tracking-wider"
            />
            <button
              type="submit"
              className="w-12 h-12 m-0.5 rounded-xl bg-gradient-to-br from-[#5b6cf0] to-[#8b5cf6] text-white grid place-items-center hover:opacity-90 active:scale-95 transition-all shrink-0"
              title="잠금 해제"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {error && (
            <p key={shakeKey} className="text-xs text-red-400 font-semibold mt-1 animate-bounce">
              {errorMessage || '비밀번호가 일치하지 않습니다. 다시 시도해 주세요.'}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

// 2. 비밀번호 설정 / 변경 / 해제 모달
export function PasswordSetupModal({
  isOpen,
  onClose,
  hasPassword,
  lockOnStartup,
  onSavePassword,
  onRemovePassword
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [startupCheck, setStartupCheck] = useState(Boolean(lockOnStartup));
  const [errorMsg, setErrorMsg] = useState('');
  const [mode, setMode] = useState('set'); // 'set' | 'remove'

  useEffect(() => {
    if (isOpen) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStartupCheck(hasPassword ? Boolean(lockOnStartup) : true);
      setErrorMsg('');
      setMode('set');
    }
  }, [isOpen, hasPassword, lockOnStartup]);

  if (!isOpen) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (mode === 'remove') {
      if (!currentPassword) {
        setErrorMsg('현재 비밀번호를 입력해 주세요.');
        return;
      }
      const res = await onRemovePassword(currentPassword);
      if (res?.ok) {
        onClose();
      } else {
        setErrorMsg(res?.error || '비밀번호 해제에 실패했습니다.');
      }
      return;
    }

    if (hasPassword && !currentPassword) {
      setErrorMsg('현재 비밀번호를 입력해 주세요.');
      return;
    }
    if (!newPassword || newPassword.trim().length < 2) {
      setErrorMsg('새 비밀번호를 2자 이상 입력해 주세요.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('새 비밀번호와 확인 비밀번호가 일치하지 않습니다.');
      return;
    }

    const res = await onSavePassword({
      currentPassword,
      newPassword,
      lockOnStartup: startupCheck
    });
    if (res?.ok) {
      onClose();
    } else {
      setErrorMsg(res?.error || '비밀번호 설정에 실패했습니다.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#1C1C23] w-full max-w-md rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 flex flex-col gap-4 animate-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
            🔒 {hasPassword ? '비밀번호 관리' : '비밀번호 잠금 설정'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <IconClose />
          </button>
        </div>

        {hasPassword && (
          <div className="flex rounded-xl bg-gray-100 dark:bg-[#2A2A32] p-1">
            <button
              type="button"
              onClick={() => {
                setMode('set');
                setErrorMsg('');
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                mode === 'set'
                  ? 'bg-white dark:bg-samsung-blue text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500'
              }`}
            >
              비밀번호 변경
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('remove');
                setErrorMsg('');
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                mode === 'remove'
                  ? 'bg-red-500 text-white shadow-sm'
                  : 'text-gray-500'
              }`}
            >
              비밀번호 해제(삭제)
            </button>
          </div>
        )}

        <form onSubmit={handleSave} className="flex flex-col gap-3">
          {hasPassword && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-gray-500 dark:text-gray-400">
                현재 비밀번호
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="현재 비밀번호 입력"
                className="w-full px-3.5 py-2.5 rounded-xl bg-gray-100 dark:bg-[#25252E] text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-samsung-blue"
              />
            </div>
          )}

          {mode === 'set' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400">
                  {hasPassword ? '새 비밀번호' : '사용할 비밀번호'}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="비밀번호 입력 (2자 이상)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-100 dark:bg-[#25252E] text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-samsung-blue"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400">
                  비밀번호 확인
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="비밀번호 다시 입력"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-100 dark:bg-[#25252E] text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-samsung-blue"
                />
              </div>

              <label className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-black/25 border border-gray-100 dark:border-gray-800 cursor-pointer mt-1">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                    앱 시작 시 자동으로 잠그기
                  </span>
                  <span className="text-[11px] text-gray-400">
                    프로그램을 켤 때마다 비밀번호 입력
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={startupCheck}
                  onChange={(e) => setStartupCheck(e.target.checked)}
                  className="w-4 h-4 accent-samsung-blue"
                />
              </label>
            </>
          )}

          {errorMsg && (
            <p className="text-xs text-red-500 font-bold">{errorMsg}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              취소
            </button>
            <button
              type="submit"
              className={`px-6 py-2.5 rounded-xl text-xs font-bold text-white shadow-md ${
                mode === 'remove'
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-gradient-to-r from-samsung-blue to-purple-600 hover:opacity-95'
              }`}
            >
              {mode === 'remove' ? '비밀번호 해제' : '저장하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
