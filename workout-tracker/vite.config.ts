import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function resolveCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const commit = resolveCommit();
const buildTime = new Date().toISOString();

export default defineConfig({
  base: './',
  define: {
    __APP_COMMIT__: JSON.stringify(commit),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  build: {
    minify: false,
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
