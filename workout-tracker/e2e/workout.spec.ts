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

  // --- Reps stepper ---

  test('non-AMRAP current set shows missed-reps toggle but not stepper', async ({ page }) => {
    const toggle = page.locator('[data-testid="missed-reps-toggle"]');
    const stepper = page.locator('[data-testid="reps-stepper"]');
    await expect(toggle).toBeVisible();
    await expect(stepper).toBeHidden();
  });

  test('clicking missed-reps toggle reveals the stepper', async ({ page }) => {
    await page.click('[data-testid="missed-reps-toggle"]');
    const stepper = page.locator('[data-testid="reps-stepper"]');
    await expect(stepper).toBeVisible();
  });

  test('stepper defaults to prescribed reps', async ({ page }) => {
    await page.click('[data-testid="missed-reps-toggle"]');
    // Week 1 first set: 5 prescribed reps
    await expect(page.locator('[data-testid="stepper-value"]')).toHaveText('5');
  });

  test('stepper minus decrements the rep count', async ({ page }) => {
    await page.click('[data-testid="missed-reps-toggle"]');
    await page.click('[data-testid="stepper-dec"]');
    await expect(page.locator('[data-testid="stepper-value"]')).toHaveText('4');
  });

  test('stepper minus does not go below 0', async ({ page }) => {
    await page.click('[data-testid="missed-reps-toggle"]');
    for (let i = 0; i < 10; i++) {
      await page.click('[data-testid="stepper-dec"]');
    }
    await expect(page.locator('[data-testid="stepper-value"]')).toHaveText('0');
  });

  test('stepper plus does not exceed prescribed reps on non-AMRAP set', async ({ page }) => {
    await page.click('[data-testid="missed-reps-toggle"]');
    // Already at prescribed (5); clicking + should stay at 5
    await page.click('[data-testid="stepper-inc"]');
    await expect(page.locator('[data-testid="stepper-value"]')).toHaveText('5');
  });

  test('completing a set with fewer reps records the reduced count', async ({ page }) => {
    await page.click('[data-testid="missed-reps-toggle"]');
    await page.click('[data-testid="stepper-dec"]'); // 5 → 4
    await page.click('[data-testid="done-set-btn"]');

    const firstCompleted = page.locator('.set-item.completed').first();
    await expect(firstCompleted.locator('.set-reps-done')).toContainText('4');
  });

  // --- AMRAP stepper ---

  test('AMRAP set shows reps stepper (always visible, no toggle)', async ({ page }) => {
    // Complete first two sets to reach the AMRAP set
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // Third set is AMRAP — stepper visible, no missed-reps toggle
    await expect(page.locator('[data-testid="reps-stepper"]')).toBeVisible();
    await expect(page.locator('[data-testid="missed-reps-toggle"]')).not.toBeVisible();
  });

  test('AMRAP stepper can exceed prescribed reps', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // Week 1 AMRAP set: 5 prescribed reps. Click + to go to 6.
    await page.click('[data-testid="stepper-inc"]');
    await expect(page.locator('[data-testid="stepper-value"]')).toHaveText('6');
  });

  test('can log custom reps for AMRAP set using stepper', async ({ page }) => {
    // Navigate to AMRAP set (3rd set)
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    // Click + three times: 5 → 6 → 7 → 8
    await page.click('[data-testid="stepper-inc"]');
    await page.click('[data-testid="stepper-inc"]');
    await page.click('[data-testid="stepper-inc"]');
    await page.click('[data-testid="done-set-btn"]');

    const completedSets = page.locator('.set-item.completed');
    await expect(completedSets).toHaveCount(3);
    await expect(completedSets.nth(2).locator('.set-reps-done')).toContainText('8');
  });

  // --- Complete workout button ---

  test('shows complete workout button after all sets', async ({ page }) => {
    test.setTimeout(60000);
    // Complete all 14 sets, skipping rest timer between each
    for (let i = 0; i < 14; i++) {
      await page.click('[data-testid="done-set-btn"]');
      // Skip rest timer if it appears (not shown after the last set)
      try {
        await page.locator('#skip-timer-btn').waitFor({ state: 'visible', timeout: 1000 });
        await page.click('#skip-timer-btn');
      } catch {
        // Timer not shown (last set completed)
      }
    }

    const completeBtn = page.locator('#complete-workout-btn');
    await expect(completeBtn).toBeVisible();
  });

  // --- Failure sheet ---

  test('completing workout without missed reps navigates home directly', async ({ page }) => {
    test.setTimeout(60000);
    for (let i = 0; i < 14; i++) {
      await page.click('[data-testid="done-set-btn"]');
      try {
        await page.locator('#skip-timer-btn').waitFor({ state: 'visible', timeout: 1000 });
        await page.click('#skip-timer-btn');
      } catch { /* last set */ }
    }
    await page.click('#complete-workout-btn');
    // Should go straight home, no failure sheet
    await expect(page.locator('#failure-sheet')).not.toBeAttached();
    await expect(page.locator('h1')).toHaveText('Workout Tracker');
  });

  test('completing workout with missed main set reps shows failure sheet', async ({ page }) => {
    test.setTimeout(60000);
    // Miss reps on first set (main set, non-AMRAP)
    await page.click('[data-testid="missed-reps-toggle"]');
    await page.click('[data-testid="stepper-dec"]'); // 5 → 4
    await page.click('[data-testid="done-set-btn"]');

    // Complete remaining 13 sets normally
    for (let i = 1; i < 14; i++) {
      try {
        await page.locator('#skip-timer-btn').waitFor({ state: 'visible', timeout: 1000 });
        await page.click('#skip-timer-btn');
      } catch { /* no timer */ }
      await page.click('[data-testid="done-set-btn"]');
    }

    await page.click('#complete-workout-btn');
    await expect(page.locator('#failure-sheet')).toBeVisible();
  });

  test('failure sheet skip navigates home', async ({ page }) => {
    test.setTimeout(60000);
    await page.click('[data-testid="missed-reps-toggle"]');
    await page.click('[data-testid="stepper-dec"]');
    await page.click('[data-testid="done-set-btn"]');
    for (let i = 1; i < 14; i++) {
      try {
        await page.locator('#skip-timer-btn').waitFor({ state: 'visible', timeout: 1000 });
        await page.click('#skip-timer-btn');
      } catch { /* no timer */ }
      await page.click('[data-testid="done-set-btn"]');
    }
    await page.click('#complete-workout-btn');
    await expect(page.locator('#failure-sheet')).toBeVisible();

    await page.click('#failure-skip-btn');
    await expect(page.locator('h1')).toHaveText('Workout Tracker');
  });

  test('failure sheet review TMs navigates to settings', async ({ page }) => {
    test.setTimeout(60000);
    await page.click('[data-testid="missed-reps-toggle"]');
    await page.click('[data-testid="stepper-dec"]');
    await page.click('[data-testid="done-set-btn"]');
    for (let i = 1; i < 14; i++) {
      try {
        await page.locator('#skip-timer-btn').waitFor({ state: 'visible', timeout: 1000 });
        await page.click('#skip-timer-btn');
      } catch { /* no timer */ }
      await page.click('[data-testid="done-set-btn"]');
    }
    await page.click('#complete-workout-btn');
    await expect(page.locator('#failure-sheet')).toBeVisible();

    await page.click('#failure-review-btn');
    await expect(page.locator('h1')).toHaveText('Settings');
  });

  test('back button returns to home', async ({ page }) => {
    await page.click('#back-btn');
    await expect(page.locator('h1')).toHaveText('Workout Tracker');
  });

  test('done button is disabled while rest timer is active', async ({ page }) => {
    // Complete first set to start rest timer
    await page.click('[data-testid="done-set-btn"]');

    // Timer should be visible
    const timer = page.locator('#rest-timer');
    await expect(timer).toBeVisible();

    // Done button should be disabled during rest
    const doneBtn = page.locator('[data-testid="done-set-btn"]');
    await expect(doneBtn).toBeDisabled();
  });

  test('done button re-enables after skipping rest timer', async ({ page }) => {
    // Complete first set to start rest timer
    await page.click('[data-testid="done-set-btn"]');

    // Skip the timer
    await page.click('#skip-timer-btn');

    // Done button should be enabled again
    const doneBtn = page.locator('[data-testid="done-set-btn"]');
    await expect(doneBtn).toBeEnabled();
  });

  test('rest timer stays visible when scrolling (sticky)', async ({ page }) => {
    // Complete first set to start rest timer
    await page.click('[data-testid="done-set-btn"]');

    const timer = page.locator('#rest-timer');
    await expect(timer).toBeVisible();

    // Scroll to the bottom of the page
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);

    // Timer should still be visible in viewport
    await expect(timer).toBeInViewport();
  });

  test('visual snapshot of workout screen', async ({ page }) => {
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('workout-screen.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
