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

  /**
   * Regression test for the rest-timer notification race that caused CI
   * flakiness: fireTimerNotification() used to assume the SW's own
   * TIMER_START setTimeout had already fired and skip notifying it, then
   * cancelBackgroundTimerNotification() was called *before* that skipped
   * notification — so if the SW's setTimeout hadn't actually fired yet, the
   * cancel silenced the only pending trigger and no notification ever
   * showed. The fix: on expiry, always post TIMER_DONE to the SW (which
   * dedupes against its own setTimeout via firedForEndTime), and only cancel
   * afterward.
   */
  test('foreground expiry posts TIMER_DONE to the SW before TIMER_CANCEL', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications']);

    await page.addInitScript(() => {
      // Set up the message spy first, unconditionally — everything below
      // this line must run even if the Notification stubbing that follows
      // doesn't apply, or waitForFunction below sees __swMessages as
      // undefined instead of an (empty-then-growing) array.
      (window as unknown as { __swMessages: Array<{ type: string }> }).__swMessages = [];
      const origDescriptor = Object.getOwnPropertyDescriptor(ServiceWorker.prototype, 'postMessage');
      const origPostMessage = origDescriptor?.value;
      ServiceWorker.prototype.postMessage = function (msg: unknown) {
        (window as unknown as { __swMessages: Array<{ type: string }> }).__swMessages.push(
          msg as { type: string },
        );
        if (origPostMessage) origPostMessage.call(this, msg);
      };

      // context.grantPermissions() backs the permission store the browser
      // consults for a *new* Notification.requestPermission() call, but
      // doesn't reliably flip the already-read-only `Notification.permission`
      // getter in every browser engine this suite runs against. Stub it
      // directly so this test exercises fireTimerNotification()'s actual
      // `Notification.permission !== 'granted'` branch deterministically,
      // the same way the app would behave once a real user has granted it.
      // Guarded: WebKit's headless test config doesn't expose a global
      // `Notification` at all, so referencing it unguarded would throw here
      // and abort the rest of this script — including the spy above.
      if (typeof Notification !== 'undefined') {
        Object.defineProperty(Notification, 'permission', {
          value: 'granted',
          configurable: true,
        });
      }
    });

    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 5000,
    });

    // fireTimerNotification() gates its whole SW-notification branch on
    // `'Notification' in window` — some WebKit test builds expose no global
    // Notification constructor at all, so there's nothing for the stub above
    // to grant and TIMER_DONE is never requested from the page in that
    // environment (same as the app's own real behavior there). Skip rather
    // than assert a false failure when that's the case.
    const hasNotificationApi = await page.evaluate(() => 'Notification' in window);
    test.skip(!hasNotificationApi, 'No Notification API in this browser engine/build');

    await page.evaluate(async () => {
      const { putSettings, getSettings } = await import('/src/db/database.ts');
      const s = await getSettings();
      await putSettings({ ...s, restTimerSeconds: 1 });
    });

    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Wait for the timer to expire and both messages to have been posted.
    await page.waitForFunction(
      () =>
        (window as unknown as { __swMessages: Array<{ type: string }> }).__swMessages.filter(
          (m) => m.type === 'TIMER_DONE' || m.type === 'TIMER_CANCEL',
        ).length >= 2,
      null,
      { timeout: 5000 },
    );

    const messages = await page.evaluate(
      () => (window as unknown as { __swMessages: Array<{ type: string }> }).__swMessages,
    );
    const doneIndex = messages.findIndex((m) => m.type === 'TIMER_DONE');
    // Search for the cancel that accompanies expiry *after* TIMER_DONE — an
    // unrelated TIMER_CANCEL is sent on initial mount (clearing any stale
    // timer from a previous test/session) and would otherwise give a false
    // pass by sitting before TIMER_START in the message log.
    const cancelIndex = messages.findIndex(
      (m, i) => i > doneIndex && m.type === 'TIMER_CANCEL',
    );

    expect(doneIndex).toBeGreaterThanOrEqual(0);
    expect(cancelIndex).toBeGreaterThan(doneIndex);
  });
});
