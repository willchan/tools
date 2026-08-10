import { test, expect } from '@playwright/test';

/**
 * Regression test for the iOS PWA case surfaced in a real user's exported
 * debug log: the app was backgrounded for several minutes with a rest timer
 * running. iOS suspended the page's main thread (freezing the polling
 * `setInterval` that normally catches an expired timer), so the only signal
 * of expiry was the service worker's own background `setTimeout` firing
 * ~2.5 minutes late once the OS resumed the app. The page must not rely
 * solely on its polling interval — it should reconcile the timer state
 * immediately when `visibilitychange` reports the page visible again.
 */
test.describe('Rest timer reconciliation on visibilitychange', () => {
  test('catches an already-expired timer on resume even if the polling interval never ran', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications']);

    // Neuter setInterval so the app's periodic polling can never catch the
    // expired timer on its own. This simulates a frozen/suspended background
    // tab where the main thread's timers don't run — the only remaining path
    // that should catch the expiry is reconciliation on visibilitychange.
    await page.addInitScript(() => {
      window.setInterval = (() => 0) as unknown as typeof window.setInterval;
    });

    await page.addInitScript(() => {
      (window as unknown as { __swMessages: Array<{ type: string }> }).__swMessages = [];
      const origDescriptor = Object.getOwnPropertyDescriptor(ServiceWorker.prototype, 'postMessage');
      const origPostMessage = origDescriptor?.value;
      ServiceWorker.prototype.postMessage = function (msg: { type: string }) {
        (window as unknown as { __swMessages: Array<{ type: string }> }).__swMessages.push(msg);
        if (origPostMessage) origPostMessage.call(this, msg);
      };
    });

    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 5000,
    });

    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();
    await expect(page.locator('[data-testid="done-set-btn"]')).toBeDisabled();

    // Force the saved timer into the past directly, then hide the page —
    // simulating the OS suspending the app mid-rest.
    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({ expectedEndTime: Date.now() - 1000, durationMs: 90000 });
    });

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // With polling neutered, nothing should catch the expiry yet.
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="timer-expired"]')).not.toBeAttached();

    // The tab becomes visible again — the app must reconcile immediately
    // rather than waiting on the (neutered) polling interval.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForSelector('[data-testid="timer-expired"]', { timeout: 2000 });
    await expect(page.locator('[data-testid="done-set-btn"]')).toBeEnabled();

    // The stale SW-side background timer must be cancelled so it can't fire
    // a duplicate/late notification on top of the reconciled one.
    await page.waitForFunction(
      () =>
        (window as unknown as { __swMessages: Array<{ type: string }> }).__swMessages.some(
          (m) => m.type === 'TIMER_CANCEL',
        ),
      null,
      { timeout: 2000 },
    );
  });

  /**
   * Each expiry detector (the 250ms poll, the resumed-timer recovery
   * interval, and this visibilitychange reconciler) independently does
   * `await getTimerState()` before deciding to act. Racing wall-clock
   * timing against the *poll* to prove that isn't reliable — whether a
   * second detector's read lands before the first one's write depends on
   * scheduling details that don't reproduce deterministically. Dispatching
   * `visibilitychange` twice back-to-back with no `await` in between forces
   * the same shape of race deterministically: both onVisibilityReconcile
   * invocations start their `getTimerState()` read in the same tick, before
   * either has had a chance to write the timer back to null. Without a
   * shared guard, both would proceed to call notifyTimerExpired(),
   * doubling the alert.
   */
  test('two overlapping reconcile invocations for the same expiry alert only once', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __vibrateCount: number }).__vibrateCount = 0;
      Object.defineProperty(navigator, 'vibrate', {
        value: () => {
          (window as unknown as { __vibrateCount: number }).__vibrateCount++;
          return true;
        },
        writable: true,
        configurable: true,
      });
    });

    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Reset the count after the click — Done's own audio-priming can vibrate
    // on some configs, and that's not what this test is measuring.
    await page.evaluate(() => {
      (window as unknown as { __vibrateCount: number }).__vibrateCount = 0;
    });

    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({ expectedEndTime: Date.now() - 1000, durationMs: 90000 });
    });

    // Two dispatches, back-to-back, with no await between them: both
    // listener invocations begin their async getTimerState() read in the
    // same synchronous turn, before either can have written the timer back
    // to null yet.
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForFunction(
      () => (window as unknown as { __vibrateCount: number }).__vibrateCount > 0,
      null,
      { timeout: 3000 },
    );
    // Give a wrongly-unguarded second invocation time to also fire.
    await page.waitForTimeout(500);

    const count = await page.evaluate(() => (window as unknown as { __vibrateCount: number }).__vibrateCount);
    expect(count).toBe(1);
  });
});
