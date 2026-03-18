import { test, expect } from '@playwright/test';

/**
 * Tests for timer completion attention-grabbing behavior.
 * When the rest timer expires in the foreground, the app should:
 * 1. Show a visible "Time's Up" expired state instead of silently hiding
 * 2. Flash/pulse the timer bar to grab attention
 * 3. Play a louder, multi-beep audio pattern
 */
test.describe('Timer Completion Attention', () => {
  test('shows expired state with "Time\'s Up" text when timer completes', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Complete a set to start a timer
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Mutate the timer to expire immediately
    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({
        expectedEndTime: Date.now() - 1000,
        durationMs: 90000,
      });
    });

    // Wait for timer to detect expiry — it should show "Time's Up" text
    await page.waitForSelector('[data-testid="timer-expired"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="timer-expired"]')).toBeVisible();
    await expect(page.locator('#timer-value')).toHaveText("Time's Up!");
  });

  test('timer expired state has flashing CSS animation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({
        expectedEndTime: Date.now() - 1000,
        durationMs: 90000,
      });
    });

    await page.waitForSelector('[data-testid="timer-expired"]', { timeout: 5000 });

    // The expired timer should have a CSS animation applied
    const animationName = await page.locator('#rest-timer').evaluate((el) => {
      return getComputedStyle(el).animationName;
    });
    expect(animationName).not.toBe('none');
  });

  test('expired timer auto-dismisses after a few seconds', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({
        expectedEndTime: Date.now() - 1000,
        durationMs: 90000,
      });
    });

    await page.waitForSelector('[data-testid="timer-expired"]', { timeout: 5000 });
    // Should auto-dismiss within 10 seconds
    await expect(page.locator('#rest-timer')).toBeHidden({ timeout: 12000 });
  });

  test('tapping expired timer dismisses it immediately', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({
        expectedEndTime: Date.now() - 1000,
        durationMs: 90000,
      });
    });

    await page.waitForSelector('[data-testid="timer-expired"]', { timeout: 5000 });
    // Tapping the timer should dismiss it
    await page.click('#rest-timer');
    await expect(page.locator('#rest-timer')).toBeHidden({ timeout: 1000 });
  });

  test('plays multi-beep audio pattern on timer completion', async ({ page }) => {
    // Spy on AudioContext to count oscillator starts
    await page.addInitScript(() => {
      (window as any).__oscStartCount = 0;
      const OrigAudioContext = window.AudioContext;
      (window as any).AudioContext = class extends OrigAudioContext {
        createOscillator() {
          const osc = super.createOscillator();
          const origStart = osc.start.bind(osc);
          osc.start = (...args: any[]) => {
            (window as any).__oscStartCount++;
            return origStart(...args);
          };
          return osc;
        }
      };
    });

    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Reset count after set completion (in case anything triggered audio)
    await page.evaluate(() => { (window as any).__oscStartCount = 0; });

    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({
        expectedEndTime: Date.now() - 1000,
        durationMs: 90000,
      });
    });

    // Wait for notification to fire
    await page.waitForSelector('[data-testid="timer-expired"]', { timeout: 5000 });
    // Give time for all beeps to play
    await page.waitForTimeout(1500);

    const oscCount = await page.evaluate(() => (window as any).__oscStartCount);
    // Should play at least 3 beeps for attention
    expect(oscCount).toBeGreaterThanOrEqual(3);
  });
});
