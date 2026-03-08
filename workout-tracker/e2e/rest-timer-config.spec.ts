import { test, expect } from '@playwright/test';

/**
 * TDD: Configurable rest timer duration.
 */

test.describe('Rest Timer Configuration', () => {
  test.describe('Settings UI', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#app');
      await page.click('.nav-btn[data-route="settings"]');
      await page.waitForSelector('.settings-screen');
    });

    test('shows rest timer duration input with default 90 seconds', async ({ page }) => {
      const input = page.locator('[data-testid="rest-timer-input"]');
      await expect(input).toBeVisible();
      await expect(input).toHaveValue('90');
    });

    test('can update rest timer duration and save', async ({ page }) => {
      const input = page.locator('[data-testid="rest-timer-input"]');
      await input.fill('120');
      await page.click('#save-settings-btn');

      // Button should show confirmation
      await expect(page.locator('#save-settings-btn')).toHaveText('Saved!');

      // Navigate away and back to verify persistence
      await page.click('.nav-btn[data-route="home"]');
      await page.waitForSelector('.home-screen');
      await page.click('.nav-btn[data-route="settings"]');
      await page.waitForSelector('.settings-screen');

      await expect(page.locator('[data-testid="rest-timer-input"]')).toHaveValue('120');
    });
  });

  test.describe('Workout Integration', () => {
    test('rest timer uses configured duration', async ({ page }) => {
      // First set rest timer to 120 seconds
      await page.goto('/');
      await page.waitForSelector('#app');
      await page.click('.nav-btn[data-route="settings"]');
      await page.waitForSelector('.settings-screen');

      const input = page.locator('[data-testid="rest-timer-input"]');
      await input.fill('120');
      await page.click('#save-settings-btn');
      await expect(page.locator('#save-settings-btn')).toHaveText('Saved!');

      // Navigate to workout
      await page.click('.nav-btn[data-route="home"]');
      await page.waitForSelector('.home-screen');
      await page.click('#start-workout-btn');
      await page.waitForSelector('.workout-screen');

      // Complete a set to start rest timer
      await page.click('[data-testid="done-set-btn"]');

      const timer = page.locator('#rest-timer');
      await expect(timer).toBeVisible();

      // Timer should show 2:00 (120 seconds), not 1:30 (90 seconds)
      const timerValue = page.locator('#timer-value');
      await expect(timerValue).toHaveText('2:00');
    });
  });
});
