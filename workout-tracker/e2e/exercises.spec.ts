import { test, expect } from '@playwright/test';

/**
 * TDD: Exercise list — dragon flags appear in exercise dropdowns.
 */

test.describe('Exercise Choices', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('.nav-btn[data-route="templates"]');
    await page.waitForSelector('.templates-screen');
    await page.click('.edit-template-btn');
    await page.waitForSelector('.template-edit-screen');
  });

  test('dragon flags appear in the exercise dropdown', async ({ page }) => {
    // Open any exercise select on the first day
    const select = page.locator('.set-exercise-select').first();
    await expect(select).toBeVisible();

    const options = select.locator('option');
    const allText = await options.allTextContents();
    expect(allText.some(t => t.toLowerCase().includes('dragon flag'))).toBeTruthy();
  });
});
