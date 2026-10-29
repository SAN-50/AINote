/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        samsung: {
          blue: '#2563EB',
          dark: '#0F1014',
          darkcard: '#1C1E26',
          border: '#2A2D3A'
        },
        canvas: {
          light: '#F6F5F2',
          dark: '#0F1014'
        },
        sidebar: {
          light: '#EFECE6',
          dark: '#15161C'
        },
        surface: {
          light: '#FFFFFF',
          dark: '#1C1E26'
        },
        muted: {
          light: '#F1F0EC',
          dark: '#252833'
        },
        line: {
          light: '#E4E2DD',
          dark: '#2A2D3A'
        }
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', '"Malgun Gothic"', '"Apple SD Gothic Neo"', '"Segoe UI"', 'sans-serif'],
        serif: ['"Noto Serif KR"', '"Batang"', 'Georgia', 'serif'],
        pen: ['"Gungsuh"', '"Comic Sans MS"', 'cursive'],
        jua: ['"Malgun Gothic"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'D2Coding', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
};
