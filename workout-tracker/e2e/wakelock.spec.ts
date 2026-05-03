import { test, expect } from '@playwright/test';

test.describe('Wake Lock', () => {
  test('requests wake lock on workout screen and re-acquires after visibility change', async ({ page }) => {
    // Mock the Wake Lock API before navigating
    await page.addInitScript(() => {
      const calls: string[] = [];
      (window as any).__wakeLockCalls = calls;

      function createSentinel() {
        const sentinel = {
          released: false,
          type: 'screen' as const,
          _listeners: [] as Array<() => void>,
          addEventListener(_event: string, cb: () => void) {
            sentinel._listeners.push(cb);
          },
          removeEventListener() {},
          release() {
            sentinel.released = true;
            for (const cb of sentinel._listeners) cb();
            return Promise.resolve();
          },
          onrelease: null,
          dispatchEvent: () => true,
        };
        return sentinel;
      }

      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: (_type: string) => {
            calls.push('request');
            const sentinel = createSentinel();
            (window as any).__currentWakeLockSentinel = sentinel;
            return Promise.resolve(sentinel);
          },
        },
        configurable: true,
      });
    });

    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Verify initial wake lock was requested
    const callsAfterInit = await page.evaluate(() => (window as any).__wakeLockCalls.length);
    expect(callsAfterInit).toBeGreaterThanOrEqual(1);

    // Simulate page becoming hidden then visible (as happens when switching apps on iOS).
    // When the page goes hidden, the browser releases the wake lock sentinel automatically.
    await page.evaluate(() => {
      // Release the current sentinel (simulates browser behavior on hide)
      const sentinel = (window as any).__currentWakeLockSentinel;
      if (sentinel) sentinel.release();

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Simulate becoming visible again — should re-acquire
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Wait briefly for the async re-request
    await page.waitForTimeout(100);

    const callsAfterReacquire = await page.evaluate(() => (window as any).__wakeLockCalls.length);
    expect(callsAfterReacquire).toBeGreaterThanOrEqual(2);
  });

  test('does not re-acquire wake lock after it has been explicitly released', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[] = [];
      (window as any).__wakeLockCalls = calls;

      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: (_type: string) => {
            calls.push('request');
            const sentinel = {
              released: false,
              type: 'screen' as const,
              _listeners: [] as Array<() => void>,
              addEventListener(_event: string, cb: () => void) {
                this._listeners.push(cb);
              },
              removeEventListener() {},
              release() {
                this.released = true;
                for (const cb of this._listeners) cb();
                return Promise.resolve();
              },
              onrelease: null,
              dispatchEvent: () => true,
            };
            return Promise.resolve(sentinel);
          },
        },
        configurable: true,
      });
    });

    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    const callsBeforeBack = await page.evaluate(() => (window as any).__wakeLockCalls.length);

    // Navigate away (releases wake lock explicitly)
    await page.click('#back-btn');
    await page.waitForSelector('h1');

    // Simulate visibility change — should NOT re-acquire
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(100);

    const callsAfterBack = await page.evaluate(() => (window as any).__wakeLockCalls.length);
    expect(callsAfterBack).toBe(callsBeforeBack);
  });

  test('release() rejection (e.g. AbortError on iOS) does not surface as unhandled rejection', async ({ page }) => {
    // iOS Safari has been observed to reject WakeLockSentinel.release() with
    // an AbortError when the system has already auto-released the sentinel
    // (e.g., due to a visibility change). Our explicit release call must
    // swallow that rejection so it doesn't pollute the error log.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: (_type: string) => {
            const sentinel = {
              type: 'screen' as const,
              addEventListener() {},
              removeEventListener() {},
              release() {
                return Promise.reject(
                  new DOMException('The operation was aborted.', 'AbortError'),
                );
              },
              onrelease: null,
              dispatchEvent: () => true,
            };
            return Promise.resolve(sentinel);
          },
        },
        configurable: true,
      });

      (window as any).__unhandled = [] as string[];
      window.addEventListener('unhandledrejection', (e) => {
        const reason = (e as PromiseRejectionEvent).reason;
        (window as any).__unhandled.push(
          reason && typeof reason === 'object' && 'name' in reason
            ? String((reason as { name: unknown }).name)
            : String(reason),
        );
      });
    });

    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Triggers releaseWakeLock(), which calls sentinel.release() — the
    // mock above makes that promise reject with AbortError.
    await page.click('#back-btn');
    await page.waitForSelector('h1');

    // Give the microtask queue a tick so any unhandled rejection would fire.
    await page.waitForTimeout(100);

    const unhandled = await page.evaluate(() => (window as any).__unhandled as string[]);
    expect(unhandled).not.toContain('AbortError');

    // And no AbortError should have been written to the persistent log either.
    const errorLogs = await page.evaluate(async () => {
      const { getAllLogs } = await import('/src/logic/logger.ts');
      const logs = await getAllLogs();
      return logs.filter((l) => l.level === 'error').map((l) => l.message);
    });
    expect(errorLogs.some((m) => m.includes('AbortError'))).toBe(false);
  });
});
