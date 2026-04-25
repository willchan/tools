import { test, expect } from '@playwright/test';

/**
 * Regression tests for two foreground-timer bugs:
 * 1. The page used to post `TIMER_DONE` to the SW *and* the SW had its own
 *    pre-scheduled `setTimeout` from `TIMER_START`. Both called
 *    `self.registration.showNotification()`, surfacing a duplicate
 *    notification on Android even though they shared the same tag.
 * 2. The beep was created via `new AudioContext()` only at the moment the
 *    timer expired (often 90+ seconds after the last user gesture). Chrome's
 *    autoplay policy then suspended the context and `resume()` was rejected,
 *    so no sound played. The fix is to prime an `AudioContext` synchronously
 *    inside the click handler that starts the rest timer.
 */
test.describe('Foreground rest-timer notification & sound', () => {
  test('SW dedupes when both setTimeout and TIMER_DONE arrive for the same timer', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications']);

    await page.addInitScript(() => {
      (window as unknown as { __notificationShownCount: number }).__notificationShownCount = 0;
      navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
        if ((e.data as { type?: string } | undefined)?.type === 'TIMER_NOTIFICATION_SHOWN') {
          (window as unknown as { __notificationShownCount: number }).__notificationShownCount++;
        }
      });
    });

    await page.goto('/');
    await page.waitForSelector('#app');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 5000,
    });

    // Schedule a SW background timer that fires in 100ms.
    await page.evaluate(() => {
      navigator.serviceWorker.controller!.postMessage({
        type: 'TIMER_START',
        expectedEndTime: Date.now() + 100,
      });
    });

    // Wait for the SW setTimeout to fire its notification.
    await page.waitForFunction(
      () => (window as unknown as { __notificationShownCount: number }).__notificationShownCount > 0,
      null,
      { timeout: 3000 },
    );

    // Now simulate the legacy page->SW TIMER_DONE message. The SW must dedupe
    // since it already fired a notification for this scheduled timer.
    await page.evaluate(() => {
      navigator.serviceWorker.controller!.postMessage({ type: 'TIMER_DONE' });
    });

    // Give any duplicate a chance to fire.
    await page.waitForTimeout(400);

    const count = await page.evaluate(
      () => (window as unknown as { __notificationShownCount: number }).__notificationShownCount,
    );
    expect(count).toBe(1);
  });

  test('foreground timer expiration shows exactly one system notification end-to-end', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications']);

    await page.addInitScript(() => {
      (window as unknown as { __notificationShownCount: number }).__notificationShownCount = 0;
      navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
        if ((e.data as { type?: string } | undefined)?.type === 'TIMER_NOTIFICATION_SHOWN') {
          (window as unknown as { __notificationShownCount: number }).__notificationShownCount++;
        }
      });
    });

    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 5000,
    });

    // Use a 1-second rest timer so it actually completes during the test.
    await page.evaluate(async () => {
      const { putSettings, getSettings } = await import('/src/db/database.ts');
      const s = await getSettings();
      await putSettings({ ...s, restTimerSeconds: 1 });
    });

    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    await page.waitForFunction(
      () => (window as unknown as { __notificationShownCount: number }).__notificationShownCount > 0,
      null,
      { timeout: 5000 },
    );
    // Wait extra so any duplicate has time to surface.
    await page.waitForTimeout(700);

    const count = await page.evaluate(
      () => (window as unknown as { __notificationShownCount: number }).__notificationShownCount,
    );
    expect(count).toBe(1);
  });

  test('AudioContext is created synchronously during the Done-set click (user gesture)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __audioCtxCreatedCount: number }).__audioCtxCreatedCount = 0;
      const OrigAudioContext = (window as unknown as { AudioContext?: typeof AudioContext })
        .AudioContext;
      if (!OrigAudioContext) return;
      class TrackedAudioContext extends OrigAudioContext {
        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          super(...args);
          (window as unknown as { __audioCtxCreatedCount: number }).__audioCtxCreatedCount++;
        }
      }
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext =
        TrackedAudioContext;
    });

    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Reset any pre-existing audio context creations so we measure the click only.
    await page.evaluate(() => {
      (window as unknown as { __audioCtxCreatedCount: number }).__audioCtxCreatedCount = 0;
    });

    // The Done click is the user gesture that schedules the rest timer.
    // The audio context must be created during this click so beeps can play
    // later when the timer expires (browsers gate AudioContext.resume() on a
    // recent user gesture).
    await page.click('[data-testid="done-set-btn"]');

    const count = await page.evaluate(
      () => (window as unknown as { __audioCtxCreatedCount: number }).__audioCtxCreatedCount,
    );
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
