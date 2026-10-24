/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2022' },
  // trystero поставляется готовым ESM-бандлом — деп-оптимизатор его не переваривает
  optimizeDeps: { exclude: ['trystero'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
