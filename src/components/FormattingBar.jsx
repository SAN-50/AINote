import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FONTS, FONT_SIZES } from '../constants';

export function FormattingBar({ editorRef, onFormatChange }) {
  const [isBoldOn, setIsBoldOn] = useState(false);
  const [isItalicOn, setIsItalicOn] = useState(false);
  const [isUnderlineOn, setIsUnderlineOn] = useState(false);
  const [currentFont, setCurrentFont] = useState('sans');
  const [currentSize, setCurrentSize] = useState('16');

  const checkState = useCallback(() => {
    try {
      const el = editorRef.current;
      if (!el) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      let node = selection.anchorNode;
      if (node && node.nodeType === 3) node = node.parentElement;
      if (!node || !el.contains(node)) return;

      setIsBoldOn(document.queryCommandState('bold'));
      setIsItalicOn(document.queryCommandState('italic'));
      setIsUnderlineOn(document.queryCommandState('underline'));

      const computedStyle = window.getComputedStyle(node);
      const fontFace = computedStyle.fontFamily.replace(/['"]/g, '').split(',')[0].trim();
      const matchedFont = FONTS.find((f) => f.css.toLowerCase().includes(fontFace.toLowerCase()));
      if (matchedFont) setCurrentFont(matchedFont.id);

      const fontSize = Math.round(parseFloat(computedStyle.fontSize)).toString();
      if (FONT_SIZES.includes(fontSize)) {
        setCurrentSize(fontSize);
      }
    } catch (_e) {
      // ignore selection state errors
    }
  }, [editorRef]);

  useEffect(() => {
    const el = editorRef.current;
    document.addEventListener('selectionchange', checkState);
    if (el) {
      el.addEventListener('keyup', checkState);
      el.addEventListener('mouseup', checkState);
    }
    return () => {
      document.removeEventListener('selectionchange', checkState);
      if (el) {
        el.removeEventListener('keyup', checkState);
        el.removeEventListener('mouseup', checkState);
      }
    };
  }, [checkState, editorRef]);

  const notifyContentUpdated = () => {
    if (onFormatChange && editorRef.current) {
      onFormatChange(editorRef.current.innerHTML);
    }
  };

  const exec = (cmd, val) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, val || null);
    notifyContentUpdated();
    setTimeout(checkState, 10);
  };

  const savedRange = useRef(null);
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    if (!savedRange.current) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange.current);
    return !savedRange.current.collapsed;
  };

  const applyFont = (fontId) => {
    const f = FONTS.find((x) => x.id === fontId);
    if (!f) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    restoreSelection();
    document.execCommand('fontName', false, f.css);
    setCurrentFont(fontId);
    notifyContentUpdated();
  };

  const applySize = (px) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    restoreSelection();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontSize', false, '7');
    const targets = el.querySelectorAll('font[size="7"], span[style*="font-size: xxx-large"]');
    targets.forEach((t) => {
      t.removeAttribute('size');
      t.style.fontSize = `${px}px`;
    });
    setCurrentSize(px);
    notifyContentUpdated();
  };

  const btnBase = 'px-2.5 py-1 rounded-lg text-sm font-bold border transition-all active:scale-95 flex items-center gap-1';
  const btnOn = 'bg-samsung-blue text-white border-samsung-blue shadow-md';
  const btnOff = 'bg-white dark:bg-[#2A2A2C] border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700';

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50/80 dark:bg-black/20 rounded-xl mb-3 border border-gray-100 dark:border-gray-800 shadow-sm transition-all relative z-50 flex-wrap">
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1">글꼴</span>
        <select
          value={currentFont}
          onMouseDown={saveSelection}
          onChange={(e) => applyFont(e.target.value)}
          className="bg-gray-100/80 dark:bg-[#2A2A2C]/80 border-none rounded-xl text-sm font-bold text-gray-800 dark:text-gray-200 cursor-pointer outline-none px-4 py-2.5 hover:bg-gray-200 dark:hover:bg-[#353538] transition-all min-w-[110px] shadow-sm"
        >
          {FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 mx-1 self-end mb-1" />

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1">스타일</span>
        <div className="flex gap-1">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec('bold');
            }}
            className={`${btnBase} font-extrabold ${isBoldOn ? btnOn : btnOff}`}
          >
            B
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec('italic');
            }}
            className={`${btnBase} italic ${isItalicOn ? btnOn : btnOff}`}
          >
            I
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              exec('underline');
            }}
            className={`${btnBase} underline ${isUnderlineOn ? btnOn : btnOff}`}
          >
            U
          </button>
        </div>
      </div>

      <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 mx-1 self-end mb-1" />

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1">크기</span>
        <select
          value={currentSize}
          onMouseDown={saveSelection}
          onChange={(e) => applySize(e.target.value)}
          className="bg-gray-100/80 dark:bg-[#2A2A2C]/80 border-none rounded-xl text-sm font-bold text-gray-800 dark:text-gray-200 cursor-pointer outline-none px-4 py-2.5 hover:bg-gray-200 dark:hover:bg-[#353538] transition-all min-w-[70px] shadow-sm"
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
