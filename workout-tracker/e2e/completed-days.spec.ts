import { test, expect } from '@playwright/test';

/**
 * E2E tests for marking completed workout days on the home screen.
 * Days that have been completed in the current cycle+week should be
 * visually marked and disabled in the day picker.
 */

/** Complete all sets in a workout, skipping the rest timer between sets. */
async function completeAllSets(page: import('@playwright/test').Page, totalSets = 14) {
  for (let i = 0; i < totalSets; i++) {
    await page.click('[data-testid="done-set-btn"]');
    if (i < totalSets - 1) {
      await page.click('#skip-timer-btn');
    }
  }
}

test.describe('Completed Day Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('completed day button has completed class after finishing a workout', async ({ page }) => {
    // Initially on Squat Day (day 0), no days completed
    const dayPicker = page.locator('[data-testid="day-picker"]');
    const dayButtons = dayPicker.locator('.day-picker-btn');
    await expect(dayButtons).toHaveCount(4);

    // No buttons should be completed initially
    await expect(dayPicker.locator('.day-picker-btn.completed')).toHaveCount(0);

    // Start and complete the workout (Squat Day)
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await completeAllSets(page);
    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');

    // After completing Squat Day, state advances to Bench Day (day 1).
    // Squat Day button (day 0) should be marked as completed.
    const completedButtons = page.locator('[data-testid="day-picker"] .day-picker-btn.completed');
    await expect(completedButtons).toHaveCount(1);
    await expect(completedButtons.first()).toContainText('Squat');
  });

  test('completed day button is disabled', async ({ page }) => {
    // Complete Squat Day
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await completeAllSets(page);
    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');

    // The completed Squat Day button should be disabled
    const sqautBtn = page.locator('[data-testid="day-picker"] .day-picker-btn.completed');
    await expect(sqautBtn.first()).toBeDisabled();
  });

  test('multiple completed days are all marked', async ({ page }) => {
    // Complete Squat Day (day 0)
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await completeAllSets(page);
    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');

    // Complete Bench Day (day 1)
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await completeAllSets(page);
    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');

    // Both Squat and Bench should be marked completed
    const completedButtons = page.locator('[data-testid="day-picker"] .day-picker-btn.completed');
    await expect(completedButtons).toHaveCount(2);
  });

  test('visual snapshot of home screen with completed days', async ({ page }) => {
    // Complete Squat Day (day 0)
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await completeAllSets(page);
    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');

    // Complete Bench Day (day 1)
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await completeAllSets(page);
    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');

    // Snapshot with Squat and Bench completed, Deadlift active
    await expect(page).toHaveScreenshot('home-completed-days.png');
  });

  test('completed days reset when switching to a different week', async ({ page }) => {
    // Complete Squat Day in week 1
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await completeAllSets(page);
    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');

    // Squat should be completed in week 1
    await expect(page.locator('[data-testid="day-picker"] .day-picker-btn.completed')).toHaveCount(1);

    // Switch to week 2 (no completed days there)
    await page.click('.week-picker-btn:nth-child(2)');
    await expect(page.locator('.week-picker-btn.active')).toContainText('Week 2');

    // No days should be completed in week 2
    await expect(page.locator('[data-testid="day-picker"] .day-picker-btn.completed')).toHaveCount(0);
  });

  test('week picker preserves manually-selected day when re-clicking the active week', async ({ page }) => {
    // Complete Squat Day (day 0) — state advances to Bench Day (day 1)
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await completeAllSets(page);
    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');

    // Manually select Deadlift Day (day 2) via the day picker
    const dayPicker = page.locator('[data-testid="day-picker"]');
    const deadliftBtn = dayPicker.locator('.day-picker-btn:nth-child(3)');
    await deadliftBtn.click();
    await expect(deadliftBtn).toHaveClass(/active/);

    // Click the already-active Week 1 button — should NOT reset the day selection
    await page.click('.week-picker-btn:nth-child(1)');

    // Navigate away and back to force a fresh state read from IndexedDB
    await page.click('.nav-btn[data-route="history"]');
    await page.waitForSelector('.history-screen');
    await page.click('.nav-btn[data-route="home"]');
    await page.waitForSelector('.home-screen');

    // Deadlift Day (day 2) should still be active — the week button click must not reset it
    await expect(dayPicker.locator('.day-picker-btn.active')).toContainText('Deadlift');
  });

  test('week picker navigating to a different week shows first incomplete day', async ({ page }) => {
    // Complete Squat Day (day 0) — state advances to Bench Day (day 1)
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await completeAllSets(page);
    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');

    // Switch to Week 2 (no completions there) and back to Week 1
    await page.click('.week-picker-btn:nth-child(2)');
    await expect(page.locator('.week-picker-btn.active')).toContainText('Week 2');
    await page.click('.week-picker-btn:nth-child(1)');
    await expect(page.locator('.week-picker-btn.active')).toContainText('Week 1');

    // Week 1: Squat is done, so first incomplete is Bench Day (day 1)
    const dp = page.locator('[data-testid="day-picker"]');
    await expect(dp.locator('.day-picker-btn.active')).toContainText('Bench');
    await expect(dp.locator('.day-picker-btn.completed')).toHaveCount(1);
    await expect(dp.locator('.day-picker-btn.completed').first()).toContainText('Squat');
  });

  test('navigating to a fully-completed week shows it as complete without cascading forward', async ({ page }) => {
    test.setTimeout(60_000);
    // Complete all 4 days of week 1
    for (let i = 0; i < 4; i++) {
      await page.click('#start-workout-btn');
      await page.waitForSelector('.workout-screen');
      await completeAllSets(page);
      await page.click('#complete-workout-btn');
      await page.waitForSelector('.home-screen');
    }

    // After all 4 days, progression should have advanced to week 2
    await expect(page.locator('.cycle-info')).toContainText('Week 2');

    // Navigate back to week 1 via the week picker — all 4 days there are done
    await page.click('.week-picker-btn:nth-child(1)');

    // Navigate away and back to force a fresh render from the persisted state.
    await page.click('.nav-btn[data-route="history"]');
    await page.waitForSelector('.history-screen');
    await page.click('.nav-btn[data-route="home"]');
    await page.waitForSelector('.home-screen');

    // App should stay on week 1 (fully complete) rather than cascading forward to week 2.
    // The user intentionally navigated here; completeWorkout() handles true advancement.
    await expect(page.locator('.week-picker-btn.active')).toContainText('Week 1');
    await expect(page.locator('.cycle-info')).toContainText('Week 1');
    await expect(page.locator('[data-testid="day-picker"] .day-picker-btn.completed')).toHaveCount(4);
    // Start button is disabled when all days are complete
    await expect(page.locator('#start-workout-btn')).toBeDisabled();
  });
});
