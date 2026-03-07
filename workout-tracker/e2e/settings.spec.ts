import { test, expect } from '@playwright/test';

/**
 * TDD Loop 2: Settings screen E2E tests.
 */

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');
  });

  test('shows settings screen with title', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Settings');
  });

  test('displays training max inputs for 4 main lifts', async ({ page }) => {
    const tmForm = page.locator('[data-testid="tm-form"]');
    await expect(tmForm).toBeVisible();

    // Check each main lift has an input
    for (const lift of ['squat', 'bench', 'deadlift', 'ohp']) {
      const input = page.locator(`[data-testid="tm-input-${lift}"]`);
      await expect(input).toBeVisible();
    }
  });

  test('shows default training max values', async ({ page }) => {
    await expect(page.locator('[data-testid="tm-input-squat"]')).toHaveValue('225');
    await expect(page.locator('[data-testid="tm-input-bench"]')).toHaveValue('185');
    await expect(page.locator('[data-testid="tm-input-deadlift"]')).toHaveValue('275');
    await expect(page.locator('[data-testid="tm-input-ohp"]')).toHaveValue('115');
  });

  test('can update and save training maxes', async ({ page }) => {
    const squatInput = page.locator('[data-testid="tm-input-squat"]');
    await squatInput.fill('250');
    await page.click('#save-tm-btn');

    // Button should show confirmation
    await expect(page.locator('#save-tm-btn')).toHaveText('Saved!');

    // Navigate away and back to verify persistence
    await page.click('.nav-btn[data-route="home"]');
    await page.waitForSelector('.home-screen');
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');

    await expect(page.locator('[data-testid="tm-input-squat"]')).toHaveValue('250');
  });

  test('has export data button', async ({ page }) => {
    const exportBtn = page.locator('#export-btn');
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toHaveText('Export Data (JSON)');
  });

  test('has import data button', async ({ page }) => {
    const importBtn = page.locator('#import-btn');
    await expect(importBtn).toBeVisible();
  });

  test('has enable notifications button', async ({ page }) => {
    const notifBtn = page.locator('#enable-notif-btn');
    await expect(notifBtn).toBeVisible();
  });

  test('visual snapshot of settings screen', async ({ page }) => {
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('settings-screen.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
