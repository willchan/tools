import { test, expect } from '@playwright/test';

/**
 * TDD Loop 2: History screen E2E tests.
 */

test.describe('Workout History', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('shows empty state when no workouts completed', async ({ page }) => {
    await page.click('.nav-btn[data-route="history"]');
    await page.waitForSelector('.history-screen');

    const empty = page.locator('[data-testid="history-empty"]');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No workouts completed');
  });

  test('shows history after completing a workout', async ({ page }) => {
    // Complete a full workout (all 14 sets)
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    for (let i = 0; i < 14; i++) {
      await page.click('[data-testid="done-set-btn"]');
      const skipBtn = page.locator('#skip-timer-btn');
      if (await skipBtn.isVisible()) {
        await skipBtn.click();
      }
    }

    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');

    // Navigate to history
    await page.click('.nav-btn[data-route="history"]');
    await page.waitForSelector('.history-screen');

    const list = page.locator('[data-testid="history-list"]');
    await expect(list).toBeVisible();

    const cards = list.locator('.history-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator('h3')).toContainText('Squat Day');
  });

  test('state advances after completing a workout', async ({ page }) => {
    // Complete a full workout
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    for (let i = 0; i < 14; i++) {
      await page.click('[data-testid="done-set-btn"]');
      const skipBtn = page.locator('#skip-timer-btn');
      if (await skipBtn.isVisible()) {
        await skipBtn.click();
      }
    }

    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');

    // Home should now show the next day (Bench Day)
    const card = page.locator('[data-testid="next-workout-card"]');
    await expect(card.locator('.day-name')).toContainText('Bench Day');
  });
});
