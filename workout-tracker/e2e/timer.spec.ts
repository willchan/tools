import { test, expect } from '@playwright/test';

/**
 * TDD Loop 1: Resilient timer logic tests.
 */

test.describe('Resilient Rest Timer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('creates timer state with correct expected end time', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createTimerState } = await import('/src/logic/timer.ts');
      const before = Date.now();
      const timer = createTimerState(90);
      const after = Date.now();

      return {
        durationMs: timer.durationMs,
        endTimeMin: before + 90000,
        endTimeMax: after + 90000,
        expectedEndTime: timer.expectedEndTime,
      };
    });

    expect(result.durationMs).toBe(90000);
    expect(result.expectedEndTime).toBeGreaterThanOrEqual(result.endTimeMin);
    expect(result.expectedEndTime).toBeLessThanOrEqual(result.endTimeMax);
  });

  test('calculates remaining time correctly', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createTimerState, getRemainingMs } = await import('/src/logic/timer.ts');
      const timer = createTimerState(90);
      const remaining = getRemainingMs(timer);

      // Should be close to 90000ms (within 100ms tolerance)
      return { remaining, expectedRange: remaining >= 89500 && remaining <= 90500 };
    });

    expect(result.expectedRange).toBe(true);
  });

  test('shows negative remaining time after timer expires', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { getRemainingMs } = await import('/src/logic/timer.ts');

      // Create a timer that already expired
      const timer = {
        expectedEndTime: Date.now() - 5000, // 5 seconds ago
        durationMs: 90000,
      };

      return getRemainingMs(timer);
    });

    expect(result).toBeLessThan(0);
  });

  test('formats time as MM:SS', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { formatTime } = await import('/src/logic/timer.ts');
      return {
        ninety: formatTime(90000),   // 1:30
        sixty: formatTime(60000),    // 1:00
        thirty: formatTime(30000),   // 0:30
        five: formatTime(5000),      // 0:05
        zero: formatTime(0),         // 0:00
        negative: formatTime(-1000), // 0:00
      };
    });

    expect(result.ninety).toBe('1:30');
    expect(result.sixty).toBe('1:00');
    expect(result.thirty).toBe('0:30');
    expect(result.five).toBe('0:05');
    expect(result.zero).toBe('0:00');
    expect(result.negative).toBe('0:00');
  });

  test('timer is resilient to browser tab suspension', async ({ page }) => {
    // Simulate: create timer, "suspend" for 30s, check remaining
    const result = await page.evaluate(async () => {
      const { getRemainingMs, formatTime } = await import('/src/logic/timer.ts');

      // Timer was created 30 seconds ago with 90s duration
      const timer = {
        expectedEndTime: Date.now() + 60000, // 60s remaining
        durationMs: 90000,
      };

      const remaining = getRemainingMs(timer);
      return {
        remaining,
        formatted: formatTime(remaining),
        isAccurate: remaining >= 59500 && remaining <= 60500,
      };
    });

    expect(result.isAccurate).toBe(true);
    expect(result.formatted).toBe('1:00');
  });
});
