/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Noto Sans Tamil"', '"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'] },
      colors: {
        brand: { 50: '#fef2f2', 100: '#fee2e2', 500: '#dc2626', 600: '#b91c1c', 700: '#991b1b', 900: '#450a0a' },
        ink: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 500: '#64748b', 700: '#334155', 900: '#0f172a' },
      },
    },
  },
  plugins: [],
};
