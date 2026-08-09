import { defineConfig, devices } from '@playwright/test';

// Full-suite files run on all 3 projects because they exercise something
// genuinely engine- or viewport-dependent: real browser/device APIs (wake
// lock, page visibility, notifications, AudioContext autoplay policy, the
// service worker) where Chromium and WebKit behavior differs, or a
// toHaveScreenshot() visual snapshot, which is viewport-dependent by
// definition. Everything else asserts on IndexedDB state and DOM text/values
// rather than layout or device APIs, so running it identically on 3 engines
// three times over checks the same thing three times — those specs run on
// chromium only. See mobile-chrome/iphone-webkit's `testMatch` below.
const crossProjectSpecs = [
  'pwa.spec.ts',
  'native-platform.spec.ts',
  'wakelock.spec.ts',
  'background-timer.spec.ts',
  'timer.spec.ts',
  'timer-completion-attention.spec.ts',
  'timer-dismiss-regression.spec.ts',
  'timer-foreground-fix.spec.ts',
  'timer-visibility-reconcile.spec.ts',
  'timer-audio-resume-rejection.spec.ts',
  'timer-notification.spec.ts',
  'rest-timer-visibility.spec.ts',
  'workout.spec.ts',
  'home.spec.ts',
  'safe-area.spec.ts',
  'completed-days.spec.ts',
  'settings.spec.ts',
  'templates.spec.ts',
];

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
      testMatch: crossProjectSpecs,
    },
    {
      name: 'iphone-webkit',
      use: { ...devices['iPhone 15'] },
      testMatch: crossProjectSpecs,
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:5173',
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
  },
});
