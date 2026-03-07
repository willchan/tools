import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    minify: false,
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
