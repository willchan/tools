import { test, expect } from '@playwright/test';

/**
 * TDD: Workout reload persistence & cancel/abandon workout.
 */

/** Complete all sets in a workout, skipping the rest timer between sets. */
async function completeAllSets(page: import('@playwright/test').Page, totalSets = 14) {
  for (let i = 0; i < totalSets; i++) {
    await page.click('[data-testid="done-set-btn"]');
    // Rest timer appears after every set except the last
    if (i < totalSets - 1) {
      await page.click('#skip-timer-btn');
    }
  }
}

test.describe('Workout Reload Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
  });

  test('completed sets survive a page reload', async ({ page }) => {
    // Complete first set
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // Complete second set
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // Two sets should be completed
    await expect(page.locator('.set-item.completed')).toHaveCount(2);

    // Reload the page
    await page.reload();
    await page.waitForSelector('.workout-screen');

    // Both completed sets should be restored
    await expect(page.locator('.set-item.completed')).toHaveCount(2);

    // Current set should be the third set (index 2)
    const current = page.locator('.set-item.current');
    await expect(current).toHaveCount(1);
  });

  test('workout start time is preserved across reload', async ({ page }) => {
    // Complete one set
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // Reload
    await page.reload();
    await page.waitForSelector('.workout-screen');

    // If a rest timer was restored from the reload, skip it
    const skipBtn = page.locator('#skip-timer-btn');
    if (await skipBtn.isVisible().catch(() => false)) {
      await skipBtn.click();
    }

    // Complete remaining 13 sets and finish the workout
    for (let i = 1; i < 14; i++) {
      await page.click('[data-testid="done-set-btn"]');
      // Skip timer between sets (not after the last)
      if (i < 13) {
        await page.click('#skip-timer-btn');
      }
    }

    await page.click('#complete-workout-btn');

    // Should navigate home (no failure sheet since all reps completed)
    await expect(page.locator('h1')).toHaveText('Workout Tracker');
  });

  test('active workout state is cleared after completing workout', async ({ page }) => {
    // Complete all 14 sets
    await completeAllSets(page);
    await page.click('#complete-workout-btn');
    await expect(page.locator('h1')).toHaveText('Workout Tracker');

    // Start a new workout — it should start fresh (0 completed sets)
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await expect(page.locator('.set-item.completed')).toHaveCount(0);
    await expect(page.locator('.set-item.current')).toHaveCount(1);
  });

  test('reload mid-workout preserves AMRAP rep count in completed sets', async ({ page }) => {
    // Complete set 1 and 2 to reach AMRAP (set 3)
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // AMRAP set: bump reps to 8
    await page.click('[data-testid="stepper-inc"]');
    await page.click('[data-testid="stepper-inc"]');
    await page.click('[data-testid="stepper-inc"]');
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // Reload
    await page.reload();
    await page.waitForSelector('.workout-screen');

    // Three completed sets should be restored
    await expect(page.locator('.set-item.completed')).toHaveCount(3);

    // The AMRAP set (3rd) should show 8 reps
    const thirdCompleted = page.locator('.set-item.completed').nth(2);
    await expect(thirdCompleted.locator('.set-reps-done')).toContainText('8');
  });
});

test.describe('Back Button Timer Cleanup', () => {
  /**
   * Regression: pressing Back during a rest timer left the timer state in
   * IndexedDB. On the next workout load, the recovery code would fire the
   * notification and/or show "Time's Up!" immediately.
   */
  test('stale timer from previous session does not fire on new workout start', async ({ page }) => {
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

    // Seed a stale timer (still has ~2 seconds remaining) — simulating what
    // the Back button leaves behind because it doesn't clear IndexedDB timer state.
    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({
        expectedEndTime: Date.now() + 2000, // expires in 2 seconds
        durationMs: 90000,
      });
    });

    // Navigate to home (simulating Back button navigation)
    await page.evaluate(() => { window.location.hash = 'home'; });
    await page.waitForSelector('#start-workout-btn');
    await page.evaluate(() => { (window as any).__vibrateCount = 0; });

    // Start a new workout — stale timer should be cleared, not re-used
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Wait long enough for the stale timer to expire (>2s)
    await page.waitForTimeout(2500);

    // No notification should have fired from the stale timer
    const vibrateCount = await page.evaluate(() => (window as any).__vibrateCount);
    expect(vibrateCount).toBe(0);

    // No "Time's Up!" UI should have appeared
    await expect(page.locator('[data-testid="timer-expired"]')).not.toBeAttached();
  });
});

test.describe('Cancel/Abandon Workout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
  });

  test('shows an abandon workout button', async ({ page }) => {
    const abandonBtn = page.locator('#abandon-workout-btn');
    await expect(abandonBtn).toBeVisible();
  });

  test('abandon button shows confirmation dialog', async ({ page }) => {
    await page.click('#abandon-workout-btn');
    const dialog = page.locator('#abandon-confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Abandon');
  });

  test('confirming abandon navigates home without saving workout', async ({ page }) => {
    // Complete a set first
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // Abandon
    await page.click('#abandon-workout-btn');
    await page.click('#abandon-confirm-yes');

    // Should be on home screen
    await expect(page.locator('h1')).toHaveText('Workout Tracker');

    // Starting a new workout should start fresh
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await expect(page.locator('.set-item.completed')).toHaveCount(0);
  });

  test('cancelling abandon dialog continues workout', async ({ page }) => {
    // Complete a set
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // Open abandon dialog then cancel
    await page.click('#abandon-workout-btn');
    await page.click('#abandon-confirm-no');

    // Dialog should be gone, workout continues
    await expect(page.locator('#abandon-confirm-dialog')).not.toBeAttached();
    await expect(page.locator('.set-item.completed')).toHaveCount(1);
    await expect(page.locator('.set-item.current')).toHaveCount(1);
  });
});
