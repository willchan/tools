import { test, expect } from '@playwright/test';

/**
 * Smoke tests for the iOS-native code paths in src/native/* and their call
 * sites (notifications.ts, workout.ts, settings.ts, otaUpdate.ts).
 *
 * These run in a plain browser, not a real Capacitor/WKWebView shell, so
 * they can't verify actual ActivityKit/UNUserNotificationCenter behavior —
 * that needs a real device or the iOS Simulator (see ios.yml). What they
 * verify is the wiring: that Capacitor.isNativePlatform() being true drives
 * our code down the native branch, and that branch calls each plugin with
 * the right arguments at the right moments.
 *
 * The technique: window.CapacitorCustomPlatform is Capacitor's own supported
 * override for forcing getPlatform()/isNativePlatform() without a real
 * native bridge (see @capacitor/core's createCapacitor()). With no real
 * bridge, each plugin falls through to its own "web" JS implementation
 * (registered as the `web` key passed to registerPlugin) — those web
 * implementations are real code from the installed packages, not something
 * we wrote, so a passing test here also exercises the actual dependency.
 */

test.describe('Native platform detection', () => {
  test('Capacitor reports the native platform when CapacitorCustomPlatform is set', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'ios' };
    });
    await page.goto('/');
    await page.waitForSelector('#app');

    const isNative = await page.evaluate(async () => {
      const { isNativePlatform } = await import('/src/native/platform.ts');
      return isNativePlatform();
    });
    expect(isNative).toBe(true);
  });

  test('isNativePlatform is false without the override (web/PWA path unchanged)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');

    const isNative = await page.evaluate(async () => {
      const { isNativePlatform } = await import('/src/native/platform.ts');
      return isNativePlatform();
    });
    expect(isNative).toBe(false);
  });
});

test.describe('Capacitor iOS zoom config', () => {
  // The double-tap-zoom-gets-stuck bug (see CAPBridgeViewController.swift's
  // prepareWebView: `if !configuration.zoomingEnabled { aWebView.scrollView
  // .delegate = delegationHandler }`) is a Capacitor bridge-wiring issue,
  // not something reachable from page JS or observable in a
  // Chromium-driven Playwright browser — there's no real WKWebView here to
  // assert scroll-view/gesture-recognizer state against, and this project
  // has no Swift test target. The only thing verifiable outside an actual
  // Simulator/device run is that the config flag which controls that
  // wiring is set correctly; regressing this to false (or removing it)
  // silently reintroduces the bug natively with nothing else here to catch
  // it. See capacitor.config.ts for the full mechanism writeup.
  test('ios.zoomEnabled stays true', async () => {
    const { default: config } = await import('../capacitor.config');
    expect(config.ios?.zoomEnabled).toBe(true);
  });
});

test.describe('Native rest-timer notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'ios' };
      (window as unknown as { __notificationCalls: unknown[] }).__notificationCalls = [];
      // Extends the real EventTarget (rather than a bare class) because
      // @capacitor/local-notifications' web fallback calls
      // addEventListener('click'/'show'/'close', ...) on every constructed
      // Notification before recording it as delivered — a bare stub without
      // that method throws there, silently short-circuiting before the
      // delivered-notifications bookkeeping this suite's tests rely on. It
      // also calls .close() on each when clearing delivered notifications
      // (removeAllDeliveredNotifications), so that's stubbed too.
      class FakeNotification extends EventTarget {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
        title: string;
        body?: string;
        tag?: string;
        constructor(title: string, options?: { body?: string; tag?: string }) {
          super();
          this.title = title;
          this.body = options?.body;
          this.tag = options?.tag;
          (window as unknown as { __notificationCalls: unknown[] }).__notificationCalls.push({
            title,
            ...options,
          });
        }
        close() {}
      }
      (window as unknown as { Notification: unknown }).Notification = FakeNotification;
    });
  });

  test('schedules an absolute-time local notification via @capacitor/local-notifications', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');

    await page.evaluate(async () => {
      const { scheduleBackgroundTimerNotification } = await import('/src/ui/notifications.ts');
      scheduleBackgroundTimerNotification(Date.now() + 50);
    });

    await page.waitForFunction(
      () => (window as unknown as { __notificationCalls: unknown[] }).__notificationCalls.length > 0,
    );

    const calls = await page.evaluate(
      () => (window as unknown as { __notificationCalls: { title: string; body: string; tag: string }[] }).__notificationCalls,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].title).toBe('Rest Timer Complete');
    expect(calls[0].body).toBe('Time for your next set!');
  });

  test('cancelling before the fire time prevents the notification', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');

    await page.evaluate(async () => {
      const { requestNotificationPermission, scheduleBackgroundTimerNotification, cancelBackgroundTimerNotification } =
        await import('/src/ui/notifications.ts');

      // Capacitor's registerPlugin lazily loads a plugin's web implementation
      // on first call, caching the instance only once that load resolves. Two
      // calls into the SAME plugin fired close together, before that first
      // load resolves, can each see "not loaded yet" and construct their own
      // separate instance — so schedule() and cancel() would silently act on
      // different LocalNotificationsWeb objects. A fixed delay between them
      // is a race, not a fix (it was too short on WebKit in CI); await a
      // real call through the same plugin first so its singleton is already
      // cached by the time schedule/cancel run. (Can't import the npm
      // package directly here — page.evaluate() isn't Vite-transformed, so
      // bare specifiers don't resolve; only our own /src/... modules do.)
      await requestNotificationPermission();

      scheduleBackgroundTimerNotification(Date.now() + 300);
      cancelBackgroundTimerNotification();
    });

    await page.waitForTimeout(500);

    const calls = await page.evaluate(
      () => (window as unknown as { __notificationCalls: unknown[] }).__notificationCalls,
    );
    expect(calls).toHaveLength(0);
  });

  test('requestNotificationPermission goes through LocalNotifications.requestPermissions', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');

    const granted = await page.evaluate(async () => {
      const { requestNotificationPermission } = await import('/src/ui/notifications.ts');
      return requestNotificationPermission();
    });
    expect(granted).toBe(true);
  });

  /**
   * Regression test: fireTimerNotification() used to play the client-side
   * haptic + Web Audio beep unconditionally on native, on top of the OS
   * local notification scheduled by scheduleBackgroundTimerNotification()
   * (which has its own sound + system alert vibration and fires from the OS
   * clock, not this JS). notifyTimerExpired() only tries to cancel that
   * scheduled notification *after* detecting expiry — at or after the same
   * instant the OS notification is due — so the cancel essentially never
   * won the race, and every timer completion produced two audible/haptic
   * alerts. When the OS will actually alert — permission granted (this
   * suite's beforeEach sets up) *and* the notification for this specific
   * timer was actually scheduled — the client-side cue must be skipped.
   */
  test('skips the client-side haptic/beep when the OS notification will already alert', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __vibrateCalls: unknown[] }).__vibrateCalls = [];
      Object.defineProperty(window.navigator, 'vibrate', {
        value: (pattern: number | number[]) => {
          (window as unknown as { __vibrateCalls: unknown[] }).__vibrateCalls.push(pattern);
          return true;
        },
        configurable: true,
      });

      (window as unknown as { __oscillatorCount: number }).__oscillatorCount = 0;
      const OrigAudioContext = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
      if (OrigAudioContext) {
        class TrackedAudioContext extends OrigAudioContext {
          createOscillator(...args: Parameters<AudioContext['createOscillator']>) {
            (window as unknown as { __oscillatorCount: number }).__oscillatorCount++;
            return super.createOscillator(...args);
          }
        }
        (window as unknown as { AudioContext: typeof AudioContext }).AudioContext =
          TrackedAudioContext as unknown as typeof AudioContext;
      }
    });

    await page.goto('/');
    await page.waitForSelector('#app');

    await page.evaluate(async () => {
      const { requestNotificationPermission, scheduleBackgroundTimerNotification, fireTimerNotification } =
        await import('/src/ui/notifications.ts');
      // Real usage always schedules before a timer can expire — fireTimerNotification()
      // only treats the OS as "will alert" once that schedule() call actually
      // resolved. Load the plugin singleton first (see the "cancelling before the
      // fire time" test above for why), then schedule far enough out that it won't
      // itself fire during this test, and give its internal promise chain a tick to
      // resolve before asking whether the OS will alert.
      await requestNotificationPermission();
      scheduleBackgroundTimerNotification(Date.now() + 60_000);
      // scheduleBackgroundTimerNotification() is fire-and-forget — give its
      // internal import()+schedule() chain time to actually land in the
      // plugin's pending list before asking whether the OS will alert.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await fireTimerNotification();
    });

    // Give a wrongly-unconditional haptics/beep call a chance to fire.
    await page.waitForTimeout(300);

    const vibrateCalls = await page.evaluate(
      () => (window as unknown as { __vibrateCalls: unknown[] }).__vibrateCalls,
    );
    const oscillatorCount = await page.evaluate(
      () => (window as unknown as { __oscillatorCount: number }).__oscillatorCount,
    );
    expect(vibrateCalls).toHaveLength(0);
    expect(oscillatorCount).toBe(0);
  });

  /**
   * Regression test: fireTimerNotification()'s "will the OS alert" check
   * uses getDeliveredNotifications() to detect that a timer's notification
   * already fired — but the OS never clears a delivered entry just because
   * a new timer starts, and this codebase's fixed notification id means the
   * *previous* timer's delivered entry would otherwise still be sitting
   * there. Left unhandled, that stale entry would permanently satisfy the
   * check for every later timer — including one whose own schedule() call
   * failed — leaving a fully silent expiry (no OS notification, and the
   * client-side fallback wrongly skipped too, since it'd wrongly conclude
   * the OS already alerted). scheduleBackgroundTimerNotification() must
   * clear any stale delivered entry before scheduling the new one.
   *
   * This asserts the clearing mechanism itself, via
   * window.Capacitor.Plugins.LocalNotifications — reachable directly once
   * our own import() below has triggered Capacitor's core to cache it
   * there, unlike a fresh bare `import('@capacitor/local-notifications')`
   * from page.evaluate() (not Vite-transformed, so bare specifiers don't
   * resolve; see the "cancelling before the fire time" test above). Simply
   * *reading* through the plugin proxy this way works fine — it's only
   * property *writes* (e.g. overriding a method) the proxy's `get` trap
   * ignores, always regenerating the real method wrapper regardless.
   */
  test('scheduling a new timer clears a stale delivered notification from a previous one', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');

    await page.evaluate(async () => {
      const { requestNotificationPermission, scheduleBackgroundTimerNotification } =
        await import('/src/ui/notifications.ts');
      await requestNotificationPermission();
      // Timer 1: schedule for the very near future so it actually fires and
      // lands in the OS's delivered-notifications list for real.
      scheduleBackgroundTimerNotification(Date.now() + 50);
    });

    // Let timer 1 actually deliver.
    await page.waitForFunction(
      () => (window as unknown as { __notificationCalls: unknown[] }).__notificationCalls.length > 0,
    );

    const deliveredAfterTimer1 = await page.evaluate(async () => {
      const LocalNotifications = (
        window as unknown as {
          Capacitor: { Plugins: { LocalNotifications: { getDeliveredNotifications: () => Promise<{ notifications: unknown[] }> } } };
        }
      ).Capacitor.Plugins.LocalNotifications;
      return (await LocalNotifications.getDeliveredNotifications()).notifications.length;
    });
    expect(deliveredAfterTimer1).toBeGreaterThan(0);

    await page.evaluate(async () => {
      const { scheduleBackgroundTimerNotification } = await import('/src/ui/notifications.ts');
      // Timer 2 — far enough out that it won't itself fire during this test.
      scheduleBackgroundTimerNotification(Date.now() + 60_000);
      // scheduleBackgroundTimerNotification() is fire-and-forget; give its
      // internal clear-then-schedule chain time to actually run.
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    const deliveredAfterTimer2Scheduled = await page.evaluate(async () => {
      const LocalNotifications = (
        window as unknown as {
          Capacitor: { Plugins: { LocalNotifications: { getDeliveredNotifications: () => Promise<{ notifications: unknown[] }> } } };
        }
      ).Capacitor.Plugins.LocalNotifications;
      return (await LocalNotifications.getDeliveredNotifications()).notifications.length;
    });
    expect(deliveredAfterTimer2Scheduled).toBe(0);
  });
});

test.describe('Native haptics', () => {
  test('fireTimerNotification triggers Haptics instead of the (no-op) navigator.vibrate path', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'ios' };
      (window as unknown as { __vibrateCalls: unknown[] }).__vibrateCalls = [];
      Object.defineProperty(window.navigator, 'vibrate', {
        value: (pattern: number | number[]) => {
          (window as unknown as { __vibrateCalls: unknown[] }).__vibrateCalls.push(pattern);
          return true;
        },
        configurable: true,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#app');

    await page.evaluate(async () => {
      const { fireTimerNotification } = await import('/src/ui/notifications.ts');
      await fireTimerNotification();
    });

    await page.waitForFunction(
      () => (window as unknown as { __vibrateCalls: unknown[] }).__vibrateCalls.length > 0,
    );
    const calls = await page.evaluate(() => (window as unknown as { __vibrateCalls: unknown[] }).__vibrateCalls);
    // Haptics.notification({ type: Success }) -> HapticsWeb's Success pattern
    expect(calls[0]).toEqual([35, 65, 21]);
  });
});

test.describe('Native Live Activity wiring', () => {
  test('starting, completing a set, and leaving the workout drives the Live Activity lifecycle', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'ios' };
    });
    const consoleMessages: string[] = [];
    page.on('console', (msg) => consoleMessages.push(msg.text()));

    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // capacitor-live-activity's web shim (real dependency code, not ours)
    // logs a distinctive warning per method — a lightweight, real signal
    // that our code actually called startActivity/updateActivity/endActivity.
    await expect
      .poll(() => consoleMessages.some((m) => m.includes('LiveActivity: startActivity')))
      .toBe(true);

    await page.click('[data-testid="done-set-btn"]');
    await expect
      .poll(() => consoleMessages.some((m) => m.includes('LiveActivity: updateActivity')))
      .toBe(true);

    // The rest timer banner is position:fixed over the header while active
    // (see .rest-timer in style.css), covering #back-btn — same as a real
    // user, dismiss it first rather than fighting the overlay.
    await page.click('#skip-timer-btn');
    await page.click('#back-btn');
    await expect
      .poll(() => consoleMessages.some((m) => m.includes('LiveActivity: endActivity')))
      .toBe(true);
  });
});

test.describe('Native data export', () => {
  test('export writes a file via Filesystem and opens the native share sheet', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'ios' };
      (window as unknown as { __shareCalls: unknown[] }).__shareCalls = [];
      (window.navigator as unknown as { share: (data: unknown) => Promise<void> }).share = async (data: unknown) => {
        (window as unknown as { __shareCalls: unknown[] }).__shareCalls.push(data);
      };
    });
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');

    await page.click('#export-btn');

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __shareCalls: unknown[] }).__shareCalls.length))
      .toBeGreaterThan(0);

    const [call] = await page.evaluate(
      () => (window as unknown as { __shareCalls: { title: string; url: string }[] }).__shareCalls,
    );
    expect(call.title).toMatch(/^workout-data-\d{4}-\d{2}-\d{2}\.json$/);
    expect(call.url).toBeTruthy();

    // Button text shouldn't flip to the failure state on a successful share.
    await expect(page.locator('#export-btn')).toHaveText('Export Data (JSON)');
  });

  test('a Share failure surfaces "Export Failed" instead of silently swallowing the error', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'ios' };
      (window.navigator as unknown as { share: (data: unknown) => Promise<void> }).share = async () => {
        throw new Error('share sheet unavailable');
      };
    });
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');

    await page.click('#export-btn');

    await expect(page.locator('#export-btn')).toHaveText('Export Failed');
  });
});

test.describe('Native OTA update check', () => {
  test('checks the self-hosted manifest and applies an update via CapacitorUpdater', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'ios' };
      // Mock at the JS fetch layer rather than page.route(): this repo's
      // dev/CI network policy doesn't guarantee real reachability to
      // arbitrary external hosts, and otaUpdate.ts's target URL is a fixed
      // module constant (not injectable), so intercepting the actual
      // network request isn't reliable — patching window.fetch is.
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === 'https://willchan.github.io/tools/ota/workout-tracker/update.json') {
          return new Response(JSON.stringify({ version: 'test-version', url: 'https://example.com/dist.zip' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return originalFetch(input, init);
      };
    });
    const consoleMessages: string[] = [];
    page.on('console', (msg) => consoleMessages.push(msg.text()));

    await page.goto('/');
    await page.waitForSelector('#app');

    await page.evaluate(async () => {
      const { checkForOtaUpdate } = await import('/src/native/otaUpdate.ts');
      await checkForOtaUpdate();
    });

    // CapacitorUpdaterWeb (real dependency code) logs these distinctive
    // warnings from download()/set() — confirming our version comparison
    // (manifest version vs. the web fallback's always-empty current bundle
    // version) decided to proceed with an update.
    await expect
      .poll(() => consoleMessages.some((m) => m.includes('Cannot download version in web')))
      .toBe(true);
    expect(consoleMessages.some((m) => m.includes('Cannot set active bundle in web'))).toBe(true);
  });
});
