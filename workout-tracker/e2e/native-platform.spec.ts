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

test.describe('Native rest-timer notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'ios' };
      (window as unknown as { __notificationCalls: unknown[] }).__notificationCalls = [];
      class FakeNotification {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
        constructor(title: string, options?: { body?: string; tag?: string }) {
          (window as unknown as { __notificationCalls: unknown[] }).__notificationCalls.push({
            title,
            ...options,
          });
        }
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
      const { scheduleBackgroundTimerNotification, cancelBackgroundTimerNotification } = await import(
        '/src/ui/notifications.ts'
      );
      scheduleBackgroundTimerNotification(Date.now() + 300);
      // A real "skip" click can never land in the same microtask as the
      // schedule call that preceded it — give the plugin's (fire-and-forget)
      // first-load promise chain a moment to settle before cancelling, same
      // as real usage, rather than racing both against the same await.
      await new Promise((resolve) => setTimeout(resolve, 50));
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
      fireTimerNotification();
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
