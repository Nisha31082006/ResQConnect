import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The single .env lives in the project root (one level up).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '');
  const target = `http://localhost:${env.PORT || 5000}`;
  return {
    // VITE_BASE=./ builds assets with relative URLs so the app works under any path prefix.
    base: env.VITE_BASE || '/',
    plugins: [react()],
    envDir: '..',
    server: {
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/socket.io': { target, ws: true, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['src/test-setup.ts'],
    },
  } as never;
});
