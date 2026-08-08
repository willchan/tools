import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // GitHub-hosted ubuntu-latest runners give public repos 4 vCPUs; match
  // workers to that so CI doesn't leave half the runner idle. Locally, let
  // Playwright pick a default based on the dev machine's own core count.
  workers: process.env.CI ? 4 : undefined,
  reporter: 'html',
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://localhost:5173',
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'iphone-webkit',
      use: { ...devices['iPhone 15'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:5173',
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
  },
});
