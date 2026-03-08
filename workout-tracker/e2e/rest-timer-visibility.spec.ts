import { test, expect } from '@playwright/test';

/**
 * TDD: Rest timer should be the most prominent element during rest.
 * It should overlay the header so it cannot be occluded.
 */
test.describe('Rest Timer Visibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
  });

  test('rest timer covers the header area when active', async ({ page }) => {
    // Complete first set to trigger rest timer
    await page.click('[data-testid="done-set-btn"]');

    const timer = page.locator('#rest-timer');
    await expect(timer).toBeVisible();

    // Timer should be at the very top of the viewport (covering the header)
    const timerBox = await timer.boundingBox();
    expect(timerBox).not.toBeNull();
    expect(timerBox!.y).toBeLessThanOrEqual(10); // At or near top of viewport
  });

  test('rest timer has a large, prominent countdown display', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    const timerValue = page.locator('#timer-value');
    await expect(timerValue).toBeVisible();

    // Timer value font size should be large (at least 2.5rem = 40px)
    const fontSize = await timerValue.evaluate((el) => {
      return parseFloat(getComputedStyle(el).fontSize);
    });
    expect(fontSize).toBeGreaterThanOrEqual(40);
  });

  test('rest timer has higher z-index than the header', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    const timerZ = await page.locator('#rest-timer').evaluate((el) => {
      return parseInt(getComputedStyle(el).zIndex || '0', 10);
    });
    const headerZ = await page.locator('.app-header').evaluate((el) => {
      return parseInt(getComputedStyle(el).zIndex || '0', 10);
    });

    expect(timerZ).toBeGreaterThan(headerZ);
  });

  test('rest timer spans the full width of the app', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    const timer = page.locator('#rest-timer');
    await expect(timer).toBeVisible();

    const timerBox = await timer.boundingBox();
    const appBox = await page.locator('#app').boundingBox();

    expect(timerBox).not.toBeNull();
    expect(appBox).not.toBeNull();
    // Timer should be nearly full-width (within a few pixels for border/padding)
    expect(timerBox!.width).toBeGreaterThanOrEqual(appBox!.width - 2);
  });

  test('skip button remains accessible on the rest timer overlay', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');

    const skipBtn = page.locator('#skip-timer-btn');
    await expect(skipBtn).toBeVisible();
    await expect(skipBtn).toBeInViewport();

    // Clicking skip still works
    await skipBtn.click();
    await expect(page.locator('#rest-timer')).toBeHidden();
  });

  test('rest timer visual snapshot', async ({ page }) => {
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    await expect(page).toHaveScreenshot('rest-timer-overlay.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
