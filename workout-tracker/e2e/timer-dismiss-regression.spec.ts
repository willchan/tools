import { test, expect } from '@playwright/test';

/**
 * Regression tests: pressing Done while the "Time's Up!" expired banner is
 * still visible should start a new rest timer. The stale auto-dismiss
 * setTimeout and click handler from the previous expired banner must be
 * cancelled so they don't hide the brand-new active timer.
 */
test.describe('Timer dismiss regression', () => {
  /**
   * Primary regression: the stale click-dismiss handler registered by
   * showTimerExpired must be removed when a new timer starts. Before the
   * fix, clicking the timer element after pressing Done while "Time's Up!"
   * was visible would invoke the old dismiss callback and hide the active timer.
   */
  test("clicking the timer while a new timer is running does not dismiss it when Done was pressed during \"Time's Up!\"", async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Complete set 1 to start the rest timer.
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Force the timer into an already-expired state.
    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({ expectedEndTime: Date.now() - 1000, durationMs: 90000 });
    });

    // Wait for the "Time's Up!" UI state (interval detects expiry within 250 ms).
    await page.waitForSelector('[data-testid="timer-expired"]', { timeout: 5000 });

    // ── REPRO: click Done while the expired banner is still up ──
    await page.click('[data-testid="done-set-btn"]');

    // Wait for new timer setup: startRestTimer calls setDoneButtonDisabled(true).
    await expect(page.locator('[data-testid="done-set-btn"]')).toBeDisabled({ timeout: 3000 });

    // Expired-state attributes should have been cleared when the new timer started.
    await expect(page.locator('[data-testid="timer-expired"]')).not.toBeAttached();

    // Timer bar must be visible showing a countdown.
    await expect(page.locator('#rest-timer')).toBeVisible();
    await expect(page.locator('#timer-value')).not.toHaveText("Time's Up!");

    // Clicking the timer element must NOT hide it.
    // Without the fix, the stale click-dismiss handler from the old "Time's Up!"
    // banner is still registered and would call dismiss(), hiding the timer.
    await page.click('#rest-timer');
    await expect(page.locator('#rest-timer')).toBeVisible();
  });

  /**
   * Secondary regression: the stale 10-second auto-dismiss setTimeout must be
   * cancelled when startRestTimer is called. Without the fix the old dismiss()
   * fires ~10 s after the expired banner appeared and hides the active timer.
   *
   * Uses page.clock to avoid a 10-second real-time wait.
   * runFor(300) fires only the single T+250 interval tick that detects expiry,
   * avoiding a concurrent-callback race that would arise from runFor(500).
   */
  test("the 10-second auto-dismiss from \"Time's Up!\" is cancelled when Done starts a new timer", async ({
    page,
  }) => {
    await page.clock.install();

    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Complete set 1 to start the rest timer.
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Force the timer into an already-expired state.
    await page.evaluate(async () => {
      const { putTimerState } = await import('/src/db/database.ts');
      await putTimerState({ expectedEndTime: Date.now() - 1000, durationMs: 90000 });
    });

    // Advance the fake clock just enough to fire the T+250 interval tick.
    await page.clock.runFor(300);

    // Wait for the "Time's Up!" UI state to appear.
    await page.waitForSelector('[data-testid="timer-expired"]', { timeout: 5000 });

    // ── REPRO: click Done while the expired banner is still up ──
    await page.click('[data-testid="done-set-btn"]');

    // Wait for new timer setup to complete.
    await expect(page.locator('[data-testid="done-set-btn"]')).toBeDisabled({ timeout: 3000 });

    // Timer bar must be visible and not in expired state.
    await expect(page.locator('#rest-timer')).toBeVisible();
    await expect(page.locator('[data-testid="timer-expired"]')).not.toBeAttached();

    // Fast-forward past the 10-second auto-dismiss window.
    // Without the fix, the stale setTimeout fires dismiss() and hides the timer.
    await page.clock.runFor(11000);

    // Timer must STILL be visible — the stale dismiss was cancelled.
    await expect(page.locator('#rest-timer')).toBeVisible();
    await expect(page.locator('#timer-value')).not.toHaveText("Time's Up!");
  });
});
