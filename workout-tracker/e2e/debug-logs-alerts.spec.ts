import { test, expect } from '@playwright/test';

/**
 * Alerting + instrumentation: surface novel errors to the user via a badge on
 * the Settings nav and a banner inside Settings, and ensure interesting
 * lifecycle events get logged so exports are useful.
 */

test.describe('Debug Log Alerts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.evaluate(async () => {
      const { clearLogs, markErrorsSeen } = await import('/src/logic/logger.ts');
      await clearLogs();
      await markErrorsSeen();
    });
  });

  test('settings nav shows a badge when new errors exist', async ({ page }) => {
    await page.evaluate(async () => {
      const { log } = await import('/src/logic/logger.ts');
      await log('error', 'oops');
    });
    // Re-render home so the nav picks up the new badge.
    await page.click('.nav-btn[data-route="templates"]');
    await page.waitForSelector('.templates-screen');
    await page.click('.nav-btn[data-route="home"]');
    await page.waitForSelector('.home-screen');

    const badge = page.locator('.nav-btn[data-route="settings"] [data-testid="nav-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1');
  });

  test('badge dedupes repeated errors with the same message', async ({ page }) => {
    await page.evaluate(async () => {
      const { log } = await import('/src/logic/logger.ts');
      await log('error', 'same');
      await log('error', 'same');
      await log('error', 'different');
    });
    await page.click('.nav-btn[data-route="templates"]');
    await page.waitForSelector('.templates-screen');

    const badge = page.locator('.nav-btn[data-route="settings"] [data-testid="nav-badge"]');
    await expect(badge).toHaveText('2');
  });

  test('badge ignores info/warn entries', async ({ page }) => {
    await page.evaluate(async () => {
      const { log } = await import('/src/logic/logger.ts');
      await log('info', 'hello');
      await log('warn', 'careful');
    });
    await page.click('.nav-btn[data-route="templates"]');
    await page.waitForSelector('.templates-screen');

    const badge = page.locator('.nav-btn[data-route="settings"] [data-testid="nav-badge"]');
    await expect(badge).toHaveCount(0);
  });

  test('badge clears after visiting Settings', async ({ page }) => {
    await page.evaluate(async () => {
      const { log } = await import('/src/logic/logger.ts');
      await log('error', 'oops');
    });
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');
    await page.click('.nav-btn[data-route="home"]');
    await page.waitForSelector('.home-screen');

    const badge = page.locator('.nav-btn[data-route="settings"] [data-testid="nav-badge"]');
    await expect(badge).toHaveCount(0);
  });

  test('Settings shows a new-errors banner with the messages', async ({ page }) => {
    await page.evaluate(async () => {
      const { log } = await import('/src/logic/logger.ts');
      await log('error', 'something exploded');
    });
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');

    const banner = page.locator('[data-testid="new-errors-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('something exploded');
  });
});

test.describe('Lifecycle Logging', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.evaluate(async () => {
      const { clearLogs } = await import('/src/logic/logger.ts');
      await clearLogs();
    });
  });

  async function readLogs(page: import('@playwright/test').Page) {
    return page.evaluate(async () => {
      const { getAllLogs } = await import('/src/logic/logger.ts');
      return getAllLogs();
    });
  }

  test('logs workout start', async ({ page }) => {
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    const logs = await readLogs(page);
    expect(logs.some((l) => l.level === 'info' && l.message === 'workout started')).toBe(true);
  });

  test('logs workout abandon', async ({ page }) => {
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await page.click('#abandon-workout-btn');
    await page.click('#abandon-confirm-yes');
    await page.waitForSelector('.home-screen');

    const logs = await readLogs(page);
    expect(logs.some((l) => l.message === 'workout abandoned')).toBe(true);
  });

  test('logs data export', async ({ page }) => {
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');
    const downloadPromise = page.waitForEvent('download');
    await page.click('#export-btn');
    await downloadPromise;

    const logs = await readLogs(page);
    expect(logs.some((l) => l.message === 'data exported')).toBe(true);
  });
});

test.describe('Swallowed-catch Logging', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.evaluate(async () => {
      const { clearLogs } = await import('/src/logic/logger.ts');
      await clearLogs();
    });
  });

  test('wake lock failure logs a warning', async ({ page }) => {
    // Stub the wakeLock API to reject, then trigger a workout (which requests it).
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).wakeLock = {
        request: () => Promise.reject(new Error('stubbed wakelock failure')),
      };
    });
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const { getAllLogs } = await import('/src/logic/logger.ts');
          const logs = await getAllLogs();
          return logs.some(
            (l) => l.level === 'warn' && l.message.toLowerCase().includes('wake lock'),
          );
        }),
      )
      .toBe(true);
  });
});
