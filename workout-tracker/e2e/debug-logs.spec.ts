import { test, expect } from '@playwright/test';

/**
 * Debug Logs: persistent in-IndexedDB logging for diagnosing issues.
 * Logs are pruned after 7 days. Settings exposes a UI to export them.
 */

test.describe('Debug Logs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    // Reset the logs store between tests so counts are deterministic.
    await page.evaluate(async () => {
      const { clearLogs } = await import('/src/logic/logger.ts');
      await clearLogs();
    });
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');
  });

  test('settings shows a Debug Logs section', async ({ page }) => {
    const section = page.locator('[data-testid="debug-logs"]');
    await expect(section).toBeVisible();
    await expect(section.locator('h2')).toHaveText('Debug Logs');
  });

  test('shows current log count', async ({ page }) => {
    // Add a couple logs.
    await page.evaluate(async () => {
      const { log } = await import('/src/logic/logger.ts');
      await log('info', 'first');
      await log('warn', 'second');
    });

    // Re-render settings so count refreshes.
    await page.click('.nav-btn[data-route="home"]');
    await page.waitForSelector('.home-screen');
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');

    const count = page.locator('[data-testid="log-count"]');
    await expect(count).toContainText('2');
  });

  test('export logs button triggers a JSON download', async ({ page }) => {
    await page.evaluate(async () => {
      const { log } = await import('/src/logic/logger.ts');
      await log('error', 'boom', 'extra context');
    });

    const downloadPromise = page.waitForEvent('download');
    await page.click('#export-logs-btn');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^workout-logs-\d{4}-\d{2}-\d{2}\.json$/);
  });

  test('clear logs button empties the store', async ({ page }) => {
    await page.evaluate(async () => {
      const { log } = await import('/src/logic/logger.ts');
      await log('info', 'first');
    });

    page.once('dialog', (d) => d.accept());
    await page.click('#clear-logs-btn');

    const remaining = await page.evaluate(async () => {
      const { getAllLogs } = await import('/src/logic/logger.ts');
      return (await getAllLogs()).length;
    });
    expect(remaining).toBe(0);
  });

  test('captures unhandled errors via global handler', async ({ page }) => {
    // Trigger an uncaught error from page context.
    await page.evaluate(() => {
      window.dispatchEvent(
        new ErrorEvent('error', {
          message: 'synthetic boom',
          filename: 'test.ts',
          lineno: 1,
          colno: 1,
          error: new Error('synthetic boom'),
        }),
      );
    });

    // Give the async log write time to flush.
    await expect.poll(async () =>
      page.evaluate(async () => {
        const { getAllLogs } = await import('/src/logic/logger.ts');
        const logs = await getAllLogs();
        return logs.some((l) => l.level === 'error' && l.message.includes('synthetic boom'));
      })
    ).toBe(true);
  });

  test('prunes entries older than 7 days', async ({ page }) => {
    // Insert one ancient log and one fresh log, then prune.
    const after = await page.evaluate(async () => {
      const { log, pruneOldLogs, getAllLogs } = await import('/src/logic/logger.ts');
      const { getDB } = await import('/src/db/database.ts');

      // Fresh entry via normal API.
      await log('info', 'fresh');

      // Ancient entry written directly so we control the timestamp.
      const db = await getDB();
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      await db.add('logs', {
        timestamp: eightDaysAgo,
        level: 'info',
        message: 'ancient',
      });

      await pruneOldLogs();
      return (await getAllLogs()).map((l) => l.message);
    });

    expect(after).toContain('fresh');
    expect(after).not.toContain('ancient');
  });
});
