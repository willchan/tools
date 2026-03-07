import { test, expect } from '@playwright/test';

/**
 * E2E tests for batch-editing accessory exercises across weeks.
 *
 * When an accessory set (tmPercentage === null) is edited, the change
 * should propagate to the matching day (same mainLiftId) in all other weeks.
 * TM-based fields (TM%, AMRAP) must never propagate.
 */

test.describe('Accessory Batch Edit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('.nav-btn[data-route="templates"]');
    await page.waitForSelector('.templates-screen');
    await page.click('.edit-template-btn');
    await page.waitForSelector('.template-edit-screen');
  });

  test('changing accessory exercise propagates to same day in other weeks', async ({ page }) => {
    // In the default 5/3/1 BBB template, Squat Day (day 0) has:
    //   sets 0-2: main working sets (TM-based)
    //   sets 3-7: BBB sets (TM-based)
    //   sets 8-10: Leg Curl x3 (accessory, no TM)
    //   sets 11-13: Hanging Leg Raise x3 (accessory, no TM)
    //
    // Change the exercise on set 8 (first Leg Curl) in week 0
    // and verify it propagated to week 1 and week 2's Squat Day set 8.

    const week0Set8 = page.locator('[data-testid="set-row-0-0-8"] .set-exercise-select');
    await week0Set8.selectOption('lat-pulldown');

    // Verify week 1, day 0, set 8 also changed
    const week1Set8 = page.locator('[data-testid="set-row-1-0-8"] .set-exercise-select');
    await expect(week1Set8).toHaveValue('lat-pulldown');

    // Verify week 2, day 0, set 8 also changed
    const week2Set8 = page.locator('[data-testid="set-row-2-0-8"] .set-exercise-select');
    await expect(week2Set8).toHaveValue('lat-pulldown');
  });

  test('changing accessory reps propagates to same day in other weeks', async ({ page }) => {
    // Change reps on set 8 (first Leg Curl accessory) in week 0
    const week0Set8Reps = page.locator('[data-testid="set-row-0-0-8"] .set-reps-input');
    await week0Set8Reps.fill('15');
    await week0Set8Reps.dispatchEvent('change');

    // Verify propagation
    const week1Set8Reps = page.locator('[data-testid="set-row-1-0-8"] .set-reps-input');
    await expect(week1Set8Reps).toHaveValue('15');

    const week2Set8Reps = page.locator('[data-testid="set-row-2-0-8"] .set-reps-input');
    await expect(week2Set8Reps).toHaveValue('15');
  });

  test('changing TM-based set does NOT propagate to other weeks', async ({ page }) => {
    // Set 0 is the first main working set (65% TM in week 0, 70% in week 1)
    // Change reps on week 0's main set - should NOT affect other weeks
    const week0Set0Reps = page.locator('[data-testid="set-row-0-0-0"] .set-reps-input');
    const week1Set0Reps = page.locator('[data-testid="set-row-1-0-0"] .set-reps-input');

    // Record original value in week 1
    const originalWeek1Reps = await week1Set0Reps.inputValue();

    await week0Set0Reps.fill('8');
    await week0Set0Reps.dispatchEvent('change');

    // Week 1 should still have its original reps
    await expect(week1Set0Reps).toHaveValue(originalWeek1Reps);
  });

  test('accessory sets show linked indicator', async ({ page }) => {
    // Accessory sets should have a visual indicator that they're linked across weeks
    const linkedIndicator = page.locator('[data-testid="set-row-0-0-8"] .linked-indicator');
    await expect(linkedIndicator).toBeVisible();
  });

  test('removing an accessory set propagates to other weeks', async ({ page }) => {
    // Count accessory sets in week 1 before removal
    const week1Sets = page.locator('[data-testid^="set-row-1-0-"]');
    const countBefore = await week1Sets.count();

    // Remove set 8 (first accessory) in week 0
    await page.click('[data-testid="set-row-0-0-8"] .remove-set-btn');

    // Week 1 should also have one fewer set
    const week1SetsAfter = page.locator('[data-testid^="set-row-1-0-"]');
    await expect(week1SetsAfter).toHaveCount(countBefore - 1);
  });

  test('adding an accessory set propagates to other weeks', async ({ page }) => {
    // Count sets in week 1, day 0 before adding
    const week1Sets = page.locator('[data-testid^="set-row-1-0-"]');
    const countBefore = await week1Sets.count();

    // Add a set to week 0, day 0
    const addSetBtns = page.locator('.add-set-btn[data-week="0"][data-day="0"]');
    await addSetBtns.click();

    // Week 1 should also have one more set
    const week1SetsAfter = page.locator('[data-testid^="set-row-1-0-"]');
    await expect(week1SetsAfter).toHaveCount(countBefore + 1);
  });
});
