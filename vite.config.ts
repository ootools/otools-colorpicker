import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { otoolsTauriShimPlugin } from 'otools-plugin-sdk/vite';

export default defineConfig({
  base: './',
  plugins: [vue(), otoolsTauriShimPlugin()],
  server: { host: '127.0.0.1', port: 5994, strictPort: true },
  // scripts/*.test.mjs 用 node:test（CI 里单独跑），不要交给 vitest。
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
