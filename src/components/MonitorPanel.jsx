import React, { useState, useEffect } from 'react';
import { TEMP_TTL_MS } from '../constants';

export function getTempTimeInfo(addedAt) {
  const added = new Date(addedAt).getTime();
  const now = Date.now();
  const elapsed = now - added;
  const remaining = TEMP_TTL_MS - elapsed;

  if (remaining <= 0) {
    return { expired: true, expiringSoon: false, remaining: 0, percent: 0, label: '만료됨' };
  }

  const totalHours = Math.floor(remaining / (60 * 60 * 1000));
  const totalMins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  const percent = Math.max(0, Math.min(100, (remaining / TEMP_TTL_MS) * 100));
  const expiringSoon = remaining < 6 * 60 * 60 * 1000;

  return {
    expired: false,
    expiringSoon,
    remaining,
    percent,
    label: `${totalHours}시간 ${totalMins}분 남음`
  };
}

export function MonitorPanel({
  isMonitoring,
  onToggleMonitor,
  onCaptureNow,
  clipboardStatus,
  detectedClipboard,
  onSaveDetected,
  tempQueue,
  onSaveTempItem,
  onSaveAllTemp,
  onDeleteTempItem,
  onClearExpiredTemp
}) {
  const [detectedTags, setDetectedTags] = useState('');
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const handleSaveDetectedClick = () => {
    onSaveDetected(detectedTags);
    setDetectedTags('');
  };

  return (
    <section className="bg-surface-light dark:bg-surface-dark p-6 rounded-[20px] shadow-sm border border-line-light dark:border-line-dark flex flex-col gap-5 animate-modal">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 grid place-items-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-extrabold text-zinc-900 dark:text-gray-100">
              클립보드 자동 감지
            </h2>
            <p className="text-xs text-zinc-500 dark:text-gray-400">
              복사한 텍스트와 이미지를 실시간으로 감지하고 72시간 임시 보관함에 수집합니다.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMonitor}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
              isMonitoring
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isMonitoring ? 'bg-white animate-ping' : 'bg-white/70'}`} />
            <span>{isMonitoring ? '감지 중 (일시정지)' : '감지 시작'}</span>
          </button>
          <button
            type="button"
            onClick={onCaptureNow}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-muted-light dark:bg-muted-dark text-zinc-700 dark:text-gray-200 hover:bg-zinc-200/70 dark:hover:bg-white/10 border border-line-light dark:border-line-dark transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span>지금 읽기</span>
          </button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark text-zinc-700 dark:text-zinc-300 text-xs font-medium">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600 dark:text-blue-400 shrink-0">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>{clipboardStatus}</span>
      </div>

      {/* Detected Preview Card */}
      <div className="p-4 rounded-2xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span
            className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold ${
              detectedClipboard
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                : 'bg-muted-light dark:bg-muted-dark text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {detectedClipboard
              ? detectedClipboard.kind === 'image'
                ? '🖼️ 이미지 감지됨'
                : '📝 텍스트 감지됨'
              : '감지 대기 중'}
          </span>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {detectedClipboard
              ? `${new Date(detectedClipboard.detectedAt).toLocaleString('ko-KR')} 감지`
              : '최근 감지 기록이 없습니다.'}
          </span>
        </div>

        <h3 className="text-sm font-bold text-zinc-900 dark:text-gray-100 truncate">
          {detectedClipboard ? detectedClipboard.title : '새로 복사한 내용이 여기에 표시됩니다.'}
        </h3>

        {detectedClipboard?.imageDataUrl ? (
          <img
            src={detectedClipboard.imageDataUrl}
            alt="클립보드 이미지 미리보기"
            className="w-full max-h-48 object-contain rounded-xl bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark"
          />
        ) : (
          <p className="text-xs text-zinc-600 dark:text-gray-300 line-clamp-3 whitespace-pre-wrap break-words leading-relaxed">
            {detectedClipboard
              ? detectedClipboard.content
              : '텍스트나 이미지를 복사(Ctrl+C)하면 자동으로 미리보기가 나타납니다.'}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={detectedTags}
            onChange={(e) => setDetectedTags(e.target.value)}
            placeholder="#태그 추가 (쉼표로 구분)"
            className="flex-1 bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark rounded-xl px-3.5 py-2 text-xs text-zinc-800 dark:text-gray-100 outline-none focus:border-blue-600"
          />
          <button
            type="button"
            onClick={handleSaveDetectedClick}
            disabled={!detectedClipboard}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
          >
            노트에 저장
          </button>
        </div>
      </div>

      {/* 72h Temp Queue Section */}
      <div className="pt-4 border-t border-line-light dark:border-line-dark flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-extrabold text-zinc-900 dark:text-gray-100">
              임시 보관함
            </span>
            <span className="px-2 py-0.5 rounded-md bg-blue-600/10 text-blue-600 dark:text-blue-400 text-xs font-bold">
              {tempQueue.length}
            </span>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              72시간 후 자동 만료
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSaveAllTemp}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors"
            >
              모두 저장
            </button>
            <button
              type="button"
              onClick={onClearExpiredTemp}
              className="px-3 py-1.5 rounded-lg bg-muted-light dark:bg-muted-dark text-zinc-600 dark:text-zinc-300 hover:bg-red-600 hover:text-white text-xs font-semibold border border-line-light dark:border-line-dark transition-colors"
            >
              만료 항목 정리
            </button>
          </div>
        </div>

        {tempQueue.length === 0 ? (
          <div className="py-8 text-center text-zinc-400 border border-dashed border-line-light dark:border-line-dark rounded-2xl text-xs">
            수집된 임시 항목이 없습니다. 감지를 시작하고 복사해 보세요.
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
            {tempQueue.map((item) => {
              const info = getTempTimeInfo(item.addedAt);
              return (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-xl bg-canvas-light dark:bg-canvas-dark border border-line-light dark:border-line-dark flex flex-col gap-2 transition-colors ${
                    info.expired ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-2 py-0.5 rounded-md bg-muted-light dark:bg-muted-dark text-zinc-600 dark:text-zinc-300 text-[10px] font-bold shrink-0 border border-line-light dark:border-line-dark">
                        {item.kind === 'image' ? '이미지' : '텍스트'}
                      </span>
                      <span className="text-xs font-bold text-zinc-800 dark:text-gray-100 truncate">
                        {item.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSaveTempItem(item.id)}
                        className="px-2.5 py-1 rounded-lg bg-muted-light dark:bg-muted-dark hover:bg-blue-600 text-zinc-700 dark:text-zinc-200 hover:text-white text-[11px] font-bold border border-line-light dark:border-line-dark transition-colors"
                      >
                        저장
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTempItem(item.id)}
                        className="px-2 py-1 rounded-lg bg-muted-light dark:bg-muted-dark hover:bg-red-600 text-zinc-500 dark:text-zinc-400 hover:text-white text-[11px] font-semibold border border-line-light dark:border-line-dark transition-colors"
                      >
                        삭제
                      </button>
                    </div>
                  </div>

                  {item.imageDataUrl ? (
                    <img
                      src={item.imageDataUrl}
                      alt="임시 이미지"
                      className="max-h-20 object-contain rounded-lg bg-muted-light dark:bg-muted-dark self-start border border-line-light dark:border-line-dark"
                    />
                  ) : (
                    <p className="text-xs text-zinc-600 dark:text-gray-400 line-clamp-2 whitespace-pre-wrap break-words">
                      {item.content}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-0.5">
                    <span
                      className={`text-[11px] font-medium ${
                        info.expired
                          ? 'text-red-500'
                          : info.expiringSoon
                          ? 'text-amber-500'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      ⏱ {info.label}
                    </span>
                    <div className="w-24 h-1.5 bg-muted-light dark:bg-muted-dark rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          info.expired
                            ? 'bg-red-500'
                            : info.expiringSoon
                            ? 'bg-amber-500'
                            : 'bg-blue-600'
                        }`}
                        style={{ width: `${info.percent}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
