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
});
