import DOMPurify from 'dompurify';
import { FONTS, FONT_SIZES } from '../constants';

const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 'span', 'font', 'br', 'div', 'p'];
const ALLOWED_ATTR = ['style', 'size', 'face'];

// Filter inline style attribute to only allow safe font-family and font-size values
function sanitizeStyleValue(styleString) {
  if (!styleString || typeof styleString !== 'string') return '';
  const safeParts = [];
  const declarations = styleString.split(';');

  for (const decl of declarations) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    const val = decl.slice(colonIdx + 1).trim();

    if (prop === 'font-size') {
      const match = val.match(/^(\d{1,2})px$/i);
      if (match && FONT_SIZES.includes(match[1])) {
        safeParts.push(`font-size: ${match[1]}px`);
      }
    } else if (prop === 'font-family') {
      const cleanedVal = val.replace(/['"]/g, '').toLowerCase();
      const matchedFont = FONTS.find((f) =>
        f.css
          .replace(/['"]/g, '')
          .toLowerCase()
          .split(',')
          .some((token) => cleanedVal.includes(token.trim()))
      );
      if (matchedFont) {
        safeParts.push(`font-family: ${matchedFont.css}`);
      }
    } else if (prop === 'font-weight' && (val === 'bold' || val === '700')) {
      safeParts.push('font-weight: bold');
    } else if (prop === 'font-style' && val === 'italic') {
      safeParts.push('font-style: italic');
    } else if (prop === 'text-decoration' && val.includes('underline')) {
      safeParts.push('text-decoration: underline');
    }
  }

  return safeParts.join('; ');
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.hasAttribute && node.hasAttribute('style')) {
    const cleanStyle = sanitizeStyleValue(node.getAttribute('style'));
    if (cleanStyle) {
      node.setAttribute('style', cleanStyle);
    } else {
      node.removeAttribute('style');
    }
  }
  if (node.hasAttribute && node.hasAttribute('size')) {
    const sizeVal = node.getAttribute('size');
    if (!/^[1-7]$/.test(sizeVal)) {
      node.removeAttribute('size');
    }
  }
});

export function sanitizeNoteHtml(dirtyHtml) {
  if (!dirtyHtml || typeof dirtyHtml !== 'string') return '';
  return DOMPurify.sanitize(dirtyHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false
  });
}

// Inert DOMParser never executes <img onerror> or <script> tags during plain-text extraction
const sharedParser = new DOMParser();

export function getPlainText(html) {
  if (!html || typeof html !== 'string') return '';
  try {
    const doc = sharedParser.parseFromString(html, 'text/html');
    return (doc.body.textContent || '').replace(/\u00a0/g, ' ').trim();
  } catch (_e) {
    return '';
  }
}

export function escapePlainTextToHtml(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

export function normalizeContentToSafeHtml(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') return '';
  const hasKnownTag = /<\/?(b|strong|i|em|u|span|font|br|div|p)\b/i.test(rawContent);
  if (!hasKnownTag) {
    return escapePlainTextToHtml(rawContent);
  }
  return sanitizeNoteHtml(rawContent);
}
