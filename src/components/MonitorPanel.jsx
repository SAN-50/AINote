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

  // Refresh countdown every 60s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const handleSaveDetectedClick = () => {
    onSaveDetected(detectedTags);
    setDetectedTags('');
  };

  return (
    <section className="bg-white/80 dark:bg-samsung-darkcard/85 backdrop-blur-xl p-6 rounded-3xl shadow-lg border border-gray-200/60 dark:border-samsung-border flex flex-col gap-5 animate-modal">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">클립보드 자동 감지</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              복사한 텍스트와 이미지를 실시간으로 감지하고 72시간 임시 보관함에 수집합니다.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onToggleMonitor}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-sm ${
              isMonitoring
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-gradient-to-r from-samsung-blue to-purple-600 text-white hover:opacity-95'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isMonitoring ? 'bg-white animate-ping' : 'bg-white/70'}`} />
            <span>{isMonitoring ? '감지 중 (일시정지)' : '감지 시작'}</span>
          </button>
          <button
            type="button"
            onClick={onCaptureNow}
            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-gray-100 dark:bg-[#2A2A2C] text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#353538] border border-gray-200/60 dark:border-gray-700 transition-all flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span>지금 읽기</span>
          </button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-samsung-blue/10 dark:bg-samsung-blue/15 text-samsung-blue dark:text-blue-300 text-xs font-semibold">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>{clipboardStatus}</span>
      </div>

      {/* Detected Preview Card */}
      <div className="p-4 rounded-2xl bg-gray-50/90 dark:bg-[#222226] border border-gray-200/70 dark:border-gray-800 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
              detectedClipboard
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            {detectedClipboard
              ? detectedClipboard.kind === 'image'
                ? '🖼️ 이미지 감지됨'
                : '📝 텍스트 감지됨'
              : '감지 대기 중'}
          </span>
          <span className="text-[11px] text-gray-400">
            {detectedClipboard
              ? `${new Date(detectedClipboard.detectedAt).toLocaleString('ko-KR')} 감지`
              : '최근 감지 기록이 없습니다.'}
          </span>
        </div>

        <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">
          {detectedClipboard ? detectedClipboard.title : '새로 복사한 내용이 여기에 표시됩니다.'}
        </h3>

        {detectedClipboard?.imageDataUrl ? (
          <img
            src={detectedClipboard.imageDataUrl}
            alt="클립보드 이미지 미리보기"
            className="w-full max-h-52 object-contain rounded-xl bg-black/5 dark:bg-black/30 border border-gray-200 dark:border-gray-700"
          />
        ) : (
          <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-3 whitespace-pre-wrap break-words">
            {detectedClipboard ? detectedClipboard.content : '텍스트나 이미지를 복사(Ctrl+C)하면 자동으로 미리보기가 나타납니다.'}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={detectedTags}
            onChange={(e) => setDetectedTags(e.target.value)}
            placeholder="태그 추가 (쉼표로 구분, 예: 업무, 중요)"
            className="flex-1 bg-white dark:bg-[#2A2A2C] border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2 text-xs text-gray-800 dark:text-gray-100 outline-none focus:ring-2 focus:ring-samsung-blue"
          />
          <button
            type="button"
            onClick={handleSaveDetectedClick}
            disabled={!detectedClipboard}
            className="px-4 py-2 rounded-xl bg-samsung-blue text-white text-xs font-bold hover:bg-blue-600 disabled:opacity-40 transition-all shrink-0"
          >
            노트에 바로 저장
          </button>
        </div>
      </div>

      {/* 72h Temp Queue Section */}
      <div className="pt-3 border-t border-gray-200/60 dark:border-gray-800 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-extrabold text-gray-900 dark:text-white">
              임시 저장 목록
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-samsung-blue/15 text-samsung-blue dark:text-blue-400 text-xs font-bold">
              {tempQueue.length}개
            </span>
            <span className="text-[11px] text-gray-400">
              (72시간 후 자동 만료)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSaveAllTemp}
              className="px-3 py-1.5 rounded-lg bg-samsung-blue text-white text-xs font-bold hover:bg-blue-600 transition-colors"
            >
              모두 저장
            </button>
            <button
              type="button"
              onClick={onClearExpiredTemp}
              className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white text-xs font-bold transition-colors"
            >
              만료 항목 삭제
            </button>
          </div>
        </div>

        {tempQueue.length === 0 ? (
          <div className="py-8 text-center text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-2xl text-xs">
            아직 수집된 임시 클립이 없습니다. 감지를 켜고 텍스트나 이미지를 복사해 보세요!
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
            {tempQueue.map((item) => {
              const info = getTempTimeInfo(item.addedAt);
              return (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-2xl bg-gray-50 dark:bg-[#222226] border border-gray-200/70 dark:border-gray-800 flex flex-col gap-2 transition-all ${
                    info.expired ? 'opacity-50 border-red-500/30' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                          item.kind === 'image'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-samsung-blue/15 text-samsung-blue dark:text-blue-400'
                        }`}
                      >
                        {item.kind === 'image' ? '이미지' : '텍스트'}
                      </span>
                      <span className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">
                        {item.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSaveTempItem(item.id)}
                        className="px-2.5 py-1 rounded-lg bg-samsung-blue/10 hover:bg-samsung-blue text-samsung-blue hover:text-white text-[11px] font-bold transition-colors"
                        title="영구 노트로 저장"
                      >
                        저장
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTempItem(item.id)}
                        className="px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white text-[11px] font-bold transition-colors"
                        title="삭제"
                      >
                        삭제
                      </button>
                    </div>
                  </div>

                  {item.imageDataUrl ? (
                    <img
                      src={item.imageDataUrl}
                      alt="임시 이미지"
                      className="max-h-20 object-contain rounded-lg bg-black/5 dark:bg-black/30 self-start"
                    />
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 whitespace-pre-wrap break-words">
                      {item.content}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span
                      className={`text-[11px] font-semibold ${
                        info.expired
                          ? 'text-red-500'
                          : info.expiringSoon
                          ? 'text-amber-500'
                          : 'text-gray-400'
                      }`}
                    >
                      ⏱ {info.label}
                    </span>
                    <div className="w-28 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          info.expired
                            ? 'bg-red-500'
                            : info.expiringSoon
                            ? 'bg-amber-500'
                            : 'bg-gradient-to-r from-samsung-blue to-purple-500'
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
