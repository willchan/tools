import { test, expect } from '@playwright/test';

/**
 * Build identifiers (commit hash + build time) injected via Vite `define`
 * so log exports identify exactly which deployed bundle produced them.
 */

test.describe('Build Version', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
  });

  test('exposes a commit hash and build time globally', async ({ page }) => {
    const info = await page.evaluate(() => ({
      commit: (globalThis as unknown as { __APP_COMMIT__?: string }).__APP_COMMIT__,
      buildTime: (globalThis as unknown as { __BUILD_TIME__?: string }).__BUILD_TIME__,
    }));
    expect(typeof info.commit).toBe('string');
    expect(info.commit?.length).toBeGreaterThan(0);
    expect(typeof info.buildTime).toBe('string');
    expect(info.buildTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('logs commit on app start', async ({ page }) => {
    await page.evaluate(async () => {
      const { clearLogs } = await import('/src/logic/logger.ts');
      await clearLogs();
    });
    await page.reload();
    await page.waitForSelector('#start-workout-btn');

    const logs = await page.evaluate(async () => {
      const { getAllLogs } = await import('/src/logic/logger.ts');
      return getAllLogs();
    });
    const startLog = logs.find((l) => l.message === 'app started');
    expect(startLog).toBeDefined();
    expect(startLog?.context).toMatch(/commit=/);
  });

  test('log export payload includes commit and buildTime', async ({ page }) => {
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');

    // Capture the download and parse it.
    const downloadPromise = page.waitForEvent('download');
    await page.click('#export-logs-btn');
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    expect(typeof payload.commit).toBe('string');
    expect(payload.commit.length).toBeGreaterThan(0);
    expect(typeof payload.buildTime).toBe('string');
  });
});
