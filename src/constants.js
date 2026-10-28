export const CATEGORIES = [
  '📝 일반',
  '📁 업무',
  '🎈 개인',
  '💻 코드',
  '🔗 링크',
  '📋 템플릿',
  '🖼️ 이미지',
  '💡 아이디어',
  '✅ 할일'
];

export const FILTER_CATEGORIES = ['🌐 전체', ...CATEGORIES];

export const FONTS = [
  { id: 'sans', name: '기본 고딕', css: '"Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI", sans-serif' },
  { id: 'serif', name: '명조체', css: '"Batang", "Georgia", serif' },
  { id: 'pen', name: '손글씨', css: '"Gungsuh", "Comic Sans MS", cursive' },
  { id: 'jua', name: '둥근체', css: '"Malgun Gothic", sans-serif' }
];

export const FONT_SIZES = ['12', '14', '16', '18', '20', '24', '28', '32', '36'];

export const TEMP_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
