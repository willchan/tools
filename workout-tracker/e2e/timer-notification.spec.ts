import { test, expect } from '@playwright/test';

/**
 * Regression tests for rest timer notification bugs:
 * 1. Duplicate notifications when browser resumes from suspension
 * 2. Missing notification when page re-renders with an already-expired timer
 */
test.describe('Rest Timer Notification Reliability', () => {
  /**
   * Bug: When the page re-renders and finds an expired timer in IndexedDB,
   * the timer was silently cleared without firing a notification.
   */
  test('fires notification when re-rendering with an already-expired timer', async ({ page }) => {
    // Install vibrate counter that persists across navigations
    await page.addInitScript(() => {
      (window as any).__vibrateCount = 0;
      Object.defineProperty(navigator, 'vibrate', {
        value: () => { (window as any).__vibrateCount++; return true; },
        writable: true,
        configurable: true,
      });
    });

    await page.goto('/');
    await page.waitForSelector('#app');

    // Start a workout
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Complete a set to trigger the timer, then skip it
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // Seed an already-expired timer into IndexedDB
    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({
        expectedEndTime: Date.now() - 5000, // expired 5s ago
        durationMs: 90000,
      });
    });

    // Reload — the recovery code should find the expired timer and notify
    await page.reload();
    await page.waitForSelector('.workout-screen');

    // Wait for the recovery code to fire notification
    await page.waitForFunction(() => (window as any).__vibrateCount > 0, null, { timeout: 5000 });

    const vibrateCount = await page.evaluate(() => (window as any).__vibrateCount);
    expect(vibrateCount).toBe(1);

    // Timer should be hidden (cleaned up)
    await expect(page.locator('#rest-timer')).toBeHidden();
  });

  /**
   * Bug: When browser resumes from suspension, multiple queued setInterval
   * ticks fire simultaneously. Each async tick reads the timer before any
   * clears it, causing duplicate fireTimerNotification() calls.
   */
  test('fires notification exactly once when timer expires (no duplicates)', async ({ page }) => {
    // Install vibrate counter that persists across navigations
    await page.addInitScript(() => {
      (window as any).__vibrateCount = 0;
      Object.defineProperty(navigator, 'vibrate', {
        value: () => { (window as any).__vibrateCount++; return true; },
        writable: true,
        configurable: true,
      });
    });

    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Complete a set — this starts a real rest timer
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Reset count after the click (done button itself may trigger vibration on some configs)
    await page.evaluate(() => { (window as any).__vibrateCount = 0; });

    // Mutate the timer in IndexedDB to expire it
    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({
        expectedEndTime: Date.now() - 1000, // already expired
        durationMs: 90000,
      });
    });

    // Wait for the interval to pick up the expired timer and notify
    await page.waitForFunction(() => (window as any).__vibrateCount > 0, null, { timeout: 5000 });

    // Give extra time for any duplicate ticks to fire
    await page.waitForTimeout(500);

    const vibrateCount = await page.evaluate(() => (window as any).__vibrateCount);
    expect(vibrateCount).toBe(1);

    // Timer should show expired state (active countdown stopped)
    await expect(page.locator('[data-testid="timer-expired"]')).toBeVisible();
  });
});
