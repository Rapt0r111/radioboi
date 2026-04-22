// Путь: /apps/web/postcss.config.mjs
// Обязателен для Tailwind CSS v4 в Next.js (webpack/turbopack).
// Без этого файла директива @import "tailwindcss" не обработается.

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
