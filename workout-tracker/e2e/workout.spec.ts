import { test, expect } from '@playwright/test';

/**
 * TDD Loop 2: Workout flow E2E tests.
 */

test.describe('Workout Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    // Navigate to workout
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
  });

  test('shows workout day header with cycle info', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Squat Day');
    await expect(page.locator('.workout-meta')).toContainText('Cycle 1');
  });

  test('displays all sets for the workout day', async ({ page }) => {
    const sets = page.locator('.set-item');
    // Week 1 Squat Day: 3 main + 5 BBB + 3 leg curl + 3 hanging leg raise = 14
    await expect(sets).toHaveCount(14);
  });

  test('highlights the current set', async ({ page }) => {
    const currentSet = page.locator('.set-item.current');
    await expect(currentSet).toHaveCount(1);
    await expect(currentSet.locator('.set-exercise')).toContainText('squat');
  });

  test('shows done button on current set', async ({ page }) => {
    const doneBtn = page.locator('[data-testid="done-set-btn"]');
    await expect(doneBtn).toBeVisible();
  });

  test('shows working weight and plate breakdown', async ({ page }) => {
    const currentSet = page.locator('.set-item.current');
    // Week 1 first set: 225 TM × 65% = 145 lbs
    await expect(currentSet.locator('.set-weight')).toContainText('145 lbs');
    await expect(currentSet.locator('.plate-info')).toContainText('per side');
  });

  test('advances to next set when Done is clicked', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    // First set should now be completed
    const completed = page.locator('.set-item.completed');
    await expect(completed).toHaveCount(1);

    // New current set should be the second set
    const current = page.locator('.set-item.current');
    // Week 1 second set: 225 TM × 75% = 170 lbs
    await expect(current.locator('.set-weight')).toContainText('170 lbs');
  });

  test('shows rest timer after completing a set', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    const timer = page.locator('#rest-timer');
    await expect(timer).toBeVisible();
    await expect(timer.locator('#timer-value')).toContainText(':');
  });

  test('can skip the rest timer', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    const timer = page.locator('#rest-timer');
    await expect(timer).toBeVisible();

    await page.click('#skip-timer-btn');
    await expect(timer).toBeHidden();
  });

  test('AMRAP set shows reps input on the third main set', async ({ page }) => {
    // Complete first two sets to reach the AMRAP set
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // Third set should be AMRAP
    const amrapInput = page.locator('[data-testid="amrap-input"]');
    await expect(amrapInput).toBeVisible();
  });

  test('can input custom reps for AMRAP set', async ({ page }) => {
    // Navigate to AMRAP set (3rd set)
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    const amrapInput = page.locator('[data-testid="amrap-input"]');
    await amrapInput.fill('8');
    await page.click('[data-testid="done-set-btn"]');

    // Set should be completed with 8 reps shown
    const completedSets = page.locator('.set-item.completed');
    await expect(completedSets).toHaveCount(3);
  });

  test('shows complete workout button after all sets', async ({ page }) => {
    // Complete all 14 sets
    for (let i = 0; i < 14; i++) {
      await page.click('[data-testid="done-set-btn"]');
      const skipBtn = page.locator('#skip-timer-btn');
      if (await skipBtn.isVisible()) {
        await skipBtn.click();
      }
    }

    const completeBtn = page.locator('#complete-workout-btn');
    await expect(completeBtn).toBeVisible();
  });

  test('back button returns to home', async ({ page }) => {
    await page.click('#back-btn');
    await expect(page.locator('h1')).toHaveText('Workout Tracker');
  });

  test('visual snapshot of workout screen', async ({ page }) => {
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('workout-screen.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
