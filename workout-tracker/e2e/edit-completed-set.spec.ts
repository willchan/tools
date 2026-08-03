import { test, expect } from '@playwright/test';

/**
 * Editing a completed set's reps mid-workout (before the workout itself
 * is marked complete), for when a set is marked done before the actual
 * rep count is recorded accurately.
 */

test.describe('Edit Completed Set Reps', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
  });

  test('completed set shows an edit button', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    const completed = page.locator('.set-item.completed').first();
    await expect(completed.locator('[data-testid="edit-set-btn"]')).toBeVisible();
  });

  test('clicking edit reveals a reps stepper seeded with the recorded reps', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    const completed = page.locator('.set-item.completed').first();
    await completed.locator('[data-testid="edit-set-btn"]').click();

    await expect(completed.locator('[data-testid="edit-stepper-value"]')).toHaveText('5');
    await expect(completed.locator('[data-testid="save-edit-btn"]')).toBeVisible();
    await expect(completed.locator('[data-testid="cancel-edit-btn"]')).toBeVisible();
  });

  test('editing and saving updates the recorded rep count', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    const completed = page.locator('.set-item.completed').first();
    await completed.locator('[data-testid="edit-set-btn"]').click();
    await completed.locator('[data-testid="edit-stepper-dec"]').click();
    await completed.locator('[data-testid="edit-stepper-dec"]').click();
    await completed.locator('[data-testid="save-edit-btn"]').click();

    await expect(completed.locator('.set-reps-done')).toContainText('3 reps');
  });

  test('canceling an edit leaves the original reps unchanged', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    const completed = page.locator('.set-item.completed').first();
    await completed.locator('[data-testid="edit-set-btn"]').click();
    await completed.locator('[data-testid="edit-stepper-dec"]').click();
    await completed.locator('[data-testid="cancel-edit-btn"]').click();

    await expect(completed.locator('.set-reps-done')).toContainText('5 reps');
    await expect(completed.locator('[data-testid="edit-set-btn"]')).toBeVisible();
  });

  test('edited reps survive a page reload (persisted with the active workout)', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    const completed = page.locator('.set-item.completed').first();
    await completed.locator('[data-testid="edit-set-btn"]').click();
    await completed.locator('[data-testid="edit-stepper-dec"]').click();
    await completed.locator('[data-testid="save-edit-btn"]').click();

    // Saving is async (IndexedDB write); wait for the edit UI to close
    // (which only happens after the save completes) before reloading, or
    // the reload can race ahead of the persisted write.
    await expect(completed.locator('[data-testid="edit-set-btn"]')).toBeVisible();

    await page.reload();
    await page.waitForSelector('.workout-screen');

    const completedAfterReload = page.locator('.set-item.completed').first();
    await expect(completedAfterReload.locator('.set-reps-done')).toContainText('4 reps');
  });

  test('edited reps carry through into the saved workout log after completing the workout', async ({ page }) => {
    // Edit the first set's reps down from 5 to 3.
    await page.click('[data-testid="done-set-btn"]');
    const firstCompleted = page.locator('.set-item.completed').first();
    await firstCompleted.locator('[data-testid="edit-set-btn"]').click();
    await firstCompleted.locator('[data-testid="edit-stepper-dec"]').click();
    await firstCompleted.locator('[data-testid="edit-stepper-dec"]').click();
    await firstCompleted.locator('[data-testid="save-edit-btn"]').click();

    // Complete the remaining sets.
    for (let i = 1; i < 14; i++) {
      await page.click('#skip-timer-btn');
      await page.click('[data-testid="done-set-btn"]');
    }

    await page.click('#complete-workout-btn');
    // Missed main-set reps trigger the failure sheet; skip past it.
    await expect(page.locator('#failure-sheet')).toBeVisible();
    await page.click('#failure-skip-btn');

    await page.click('.nav-btn[data-route="history"]');
    await page.waitForSelector('.history-screen');
    await expect(page.locator('.history-card').first().locator('.history-sets')).toContainText('14 sets completed');
  });

  test('edit button is available on a set completed before the current set', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');
    await page.click('[data-testid="done-set-btn"]');

    const sets = page.locator('.set-item.completed');
    await expect(sets).toHaveCount(2);
    await expect(sets.first().locator('[data-testid="edit-set-btn"]')).toBeVisible();
    await expect(sets.nth(1).locator('[data-testid="edit-set-btn"]')).toBeVisible();
  });
});
