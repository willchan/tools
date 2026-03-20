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
   * Bug: When the app is in the foreground, the SW backup timer fires a
   * notification first. Then fireTimerNotification() sends TIMER_DONE to the
   * SW, which shows a second notification — replacing the first. This creates
   * a visible "flicker": the notification appears, disappears, and reappears.
   *
   * Fix: fireTimerNotification() must NOT send TIMER_DONE to the SW.
   * The SW backup timer is the sole notification source; the main thread only
   * handles vibration and audio.
   */
  test('does not send TIMER_DONE to service worker when timer expires in foreground', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__swMessages = [];
      const origDescriptor = Object.getOwnPropertyDescriptor(
        ServiceWorker.prototype,
        'postMessage',
      );
      const origPostMessage = origDescriptor?.value;
      ServiceWorker.prototype.postMessage = function (msg: unknown) {
        (window as any).__swMessages.push(msg);
        if (origPostMessage) origPostMessage.call(this, msg);
      };

      (window as any).__vibrateCount = 0;
      Object.defineProperty(navigator, 'vibrate', {
        value: () => { (window as any).__vibrateCount++; return true; },
        writable: true,
        configurable: true,
      });
    });

    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Start a timer
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Reset message log and vibrate count after initial timer start
    await page.evaluate(() => {
      (window as any).__swMessages = [];
      (window as any).__vibrateCount = 0;
    });

    // Expire the timer via IndexedDB
    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({
        expectedEndTime: Date.now() - 1000,
        durationMs: 90000,
      });
    });

    // Wait for vibration (fireTimerNotification was called)
    await page.waitForFunction(() => (window as any).__vibrateCount > 0, null, { timeout: 5000 });

    // Give time for any extra messages to arrive
    await page.waitForTimeout(300);

    // The main thread must NOT send TIMER_DONE — the SW backup timer handles the notification
    const timerDoneMessages = await page.evaluate(() =>
      (window as any).__swMessages.filter((m: { type: string }) => m.type === 'TIMER_DONE'),
    );
    expect(timerDoneMessages).toHaveLength(0);
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

  /**
   * Bug: When the browser un-throttles a backgrounded page, many setInterval
   * ticks queue up and fire in rapid succession. Each async tick passes the
   * timerCompleting guard before any of them sets it (they all await
   * getTimerState() concurrently), so fireTimerNotification() is called
   * multiple times — producing 2nd, 3rd, 4th notifications one after another.
   *
   * Fix: check timerCompleting a second time synchronously inside the
   * `if (remaining <= 0)` block, after the async DB read, before acting.
   */
  test('fires notification exactly once when many ticks fire simultaneously (foreground-resume race)', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__vibrateCount = 0;
      Object.defineProperty(navigator, 'vibrate', {
        value: () => { (window as any).__vibrateCount++; return true; },
        writable: true,
        configurable: true,
      });
    });

    // Install a fake clock so we can advance time and trigger many interval
    // ticks at once, simulating a batch of queued-up callbacks on resume.
    await page.clock.install();

    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    await page.evaluate(() => { (window as any).__vibrateCount = 0; });

    // Expire the timer in IndexedDB
    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({
        expectedEndTime: Date.now() - 1000,
        durationMs: 90000,
      });
    });

    // Advance fake clock by 2 seconds — fires ~8 setInterval ticks at once.
    // All callbacks start before any async DB read completes, so timerCompleting
    // is still false when each one hits its first guard check.
    await page.clock.runFor(2000);

    // Wait (real time) for all the async DB reads to resolve
    await page.waitForTimeout(1000);

    const vibrateCount = await page.evaluate(() => (window as any).__vibrateCount);
    expect(vibrateCount).toBe(1);
  });
});
