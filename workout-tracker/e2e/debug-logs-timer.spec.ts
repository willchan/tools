import { test, expect } from '@playwright/test';

/**
 * Diagnostic logging for the iOS PWA "notification fires only on foreground"
 * issue. The hypothesis is that iOS suspends the service worker's setTimeout
 * while the PWA is backgrounded; these logs let us see the gap.
 */

test.describe('Timer Diagnostic Logging', () => {
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

  test('logs visibility transitions', async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const logs = await readLogs(page);
    expect(logs.some((l) => l.message === 'visibility: hidden')).toBe(true);
    expect(logs.some((l) => l.message === 'visibility: visible')).toBe(true);
  });

  test('page logs when scheduling a background timer', async ({ page }) => {
    await page.evaluate(async () => {
      const { scheduleBackgroundTimerNotification } = await import('/src/ui/notifications.ts');
      scheduleBackgroundTimerNotification(Date.now() + 90_000);
    });

    const logs = await readLogs(page);
    const entry = logs.find((l) => l.message === 'rest timer scheduled');
    expect(entry).toBeDefined();
    expect(entry?.context).toMatch(/expectedEndTime/);
  });

  test('page logs notification receipt with latency', async ({ page }) => {
    // Simulate the SW broadcasting that it just fired the notification.
    await page.evaluate(() => {
      const expectedEndTime = Date.now() - 5000; // pretend it was due 5s ago
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'TIMER_NOTIFICATION_SHOWN', expectedEndTime, firedAt: Date.now() },
        }),
      );
    });

    const logs = await readLogs(page);
    const entry = logs.find((l) => l.message === 'rest timer notification shown');
    expect(entry).toBeDefined();
    expect(entry?.context).toMatch(/lateByMs/);
  });
});
