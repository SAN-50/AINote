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

  const btnBase =
    'w-7 h-7 rounded-lg text-xs font-bold transition-colors flex items-center justify-center select-none';
  const btnOn = 'bg-blue-600 text-white shadow-sm';
  const btnOff =
    'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-white/10';

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted-light dark:bg-muted-dark rounded-xl border border-line-light dark:border-line-dark flex-wrap">
      <select
        value={currentFont}
        onMouseDown={saveSelection}
        onChange={(e) => applyFont(e.target.value)}
        aria-label="글꼴 선택"
        className="bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark rounded-lg text-xs font-semibold text-zinc-800 dark:text-zinc-200 cursor-pointer outline-none px-2.5 py-1 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors"
      >
        {FONTS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>

      <select
        value={currentSize}
        onMouseDown={saveSelection}
        onChange={(e) => applySize(e.target.value)}
        aria-label="글자 크기 선택"
        className="bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark rounded-lg text-xs font-semibold text-zinc-800 dark:text-zinc-200 cursor-pointer outline-none px-2 py-1 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors"
      >
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>
            {s}px
          </option>
        ))}
      </select>

      <div className="w-px h-4 bg-line-light dark:bg-line-dark mx-1" />

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            exec('bold');
          }}
          title="굵게 (Ctrl+B)"
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
          title="기울임 (Ctrl+I)"
          className={`${btnBase} italic font-serif ${isItalicOn ? btnOn : btnOff}`}
        >
          I
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            exec('underline');
          }}
          title="밑줄 (Ctrl+U)"
          className={`${btnBase} underline ${isUnderlineOn ? btnOn : btnOff}`}
        >
          U
        </button>
      </div>
    </div>
  );
}
