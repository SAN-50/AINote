import React, { useState, useRef, useEffect } from 'react';
import { IconLock } from './Icons';

export function LicenseLockModal({ isLocked, onVerify }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isLocked && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isLocked]);

  if (!isLocked) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    const success = await onVerify(code.trim());
    if (success) {
      setCode('');
      setError(false);
    } else {
      setError(true);
      setShakeKey((k) => k + 1);
      setCode('');
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
      <div className="relative z-10 w-[min(420px,calc(100%-32px))] p-9 bg-[#14141c]/80 backdrop-blur-2xl border border-white/10 rounded-[28px] shadow-2xl flex flex-col animate-modal">
        <div className="flex items-center gap-3.5 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2B65F3] to-[#8b5cf6] text-white grid place-items-center shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/40">
              Smart Note & Clipboard
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
          <h3 className="text-lg font-bold text-white/95">라이센스 인증</h3>
          <p className="text-sm text-white/45 mb-2">
            이 앱을 사용하려면 라이센스 코드를 입력하세요.
          </p>

          <div className="flex items-center w-full rounded-2xl bg-white/5 border border-white/10 focus-within:border-[#5b6cf0]/60 focus-within:ring-2 focus-within:ring-[#5b6cf0]/20 overflow-hidden transition-all">
            <input
              ref={inputRef}
              type="password"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError(false);
              }}
              placeholder="라이센스 코드 입력"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent px-4 py-3.5 text-sm text-white outline-none placeholder-white/30 tracking-wider"
            />
            <button
              type="submit"
              className="w-12 h-12 m-0.5 rounded-xl bg-gradient-to-br from-[#5b6cf0] to-[#8b5cf6] text-white grid place-items-center hover:opacity-90 active:scale-95 transition-all shrink-0"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {error && (
            <p key={shakeKey} className="text-xs text-red-400 font-semibold mt-1 animate-bounce">
              잘못된 라이센스 코드입니다. 다시 시도하세요.
            </p>
          )}
        </form>

        <p className="text-center text-[11px] text-white/25 mt-7">
          © 2026 나무 노트 (TreeNote × TreeClip)
        </p>
      </div>
    </div>
  );
}
