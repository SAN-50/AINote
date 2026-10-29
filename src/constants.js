export const CATEGORIES = [
  '📝 일반',
  '📁 업무',
  '🎈 개인',
  '💻 코드',
  '🔗 링크',
  '📋 템플릿',
  '🖼️ 이미지',
  '📎 파일',
  '💡 아이디어',
  '✅ 할일'
];

export const FILTER_CATEGORIES = ['🌐 전체', ...CATEGORIES];

export const CONTENT_TYPE_TABS = [
  { id: 'all', label: '전체' },
  { id: 'text', label: '📝 텍스트' },
  { id: 'image', label: '🖼️ 이미지' },
  { id: 'file', label: '📎 파일' },
  { id: 'link', label: '🔗 링크' }
];

export const FONTS = [
  { id: 'sans', name: '기본 고딕', css: '"Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI", sans-serif' },
  { id: 'serif', name: '명조체', css: '"Batang", "Georgia", serif' },
  { id: 'pen', name: '손글씨', css: '"Gungsuh", "Comic Sans MS", cursive' },
  { id: 'jua', name: '둥근체', css: '"Malgun Gothic", sans-serif' }
];

export const FONT_SIZES = ['12', '14', '16', '18', '20', '24', '28', '32', '36'];

export const TEMP_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
