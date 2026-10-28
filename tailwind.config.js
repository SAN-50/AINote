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
          blue: '#2B65F3',
          dark: '#111111',
          darkcard: '#1C1C1E',
          border: '#333333'
        }
      },
      fontFamily: {
        sans: ['"Malgun Gothic"', '"Apple SD Gothic Neo"', '"Segoe UI"', 'sans-serif'],
        serif: ['"Batang"', '"Georgia"', 'serif'],
        pen: ['"Gungsuh"', '"Comic Sans MS"', 'cursive'],
        jua: ['"Malgun Gothic"', 'sans-serif']
      }
    }
  },
  plugins: []
};
