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
});
