import { test, expect } from '@playwright/test';

/**
 * TDD: Intersperse accessories option when starting a workout.
 */

test.describe('Intersperse Accessories', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('shows intersperse accessories checkbox on home screen', async ({ page }) => {
    const checkbox = page.locator('[data-testid="intersperse-checkbox"]');
    await expect(checkbox).toBeVisible();
    // Should be unchecked by default
    await expect(checkbox).not.toBeChecked();
  });

  test('normal workout has accessories grouped at end', async ({ page }) => {
    // Start workout without intersperse
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Default order: 3 main (squat) + 5 BBB (squat) + 3 leg-curl + 3 hanging-leg-raise
    // Sets 0-7 should be squat (main + BBB)
    for (let i = 0; i < 8; i++) {
      const exercise = page.locator(`[data-testid="set-${i}"] .set-exercise`);
      await expect(exercise).toContainText('squat');
    }
    // Sets 8-10 should be leg-curl
    for (let i = 8; i < 11; i++) {
      const exercise = page.locator(`[data-testid="set-${i}"] .set-exercise`);
      await expect(exercise).toContainText('leg-curl');
    }
    // Sets 11-13 should be hanging-leg-raise
    for (let i = 11; i < 14; i++) {
      const exercise = page.locator(`[data-testid="set-${i}"] .set-exercise`);
      await expect(exercise).toContainText('hanging-leg-raise');
    }
  });

  test('interspersed workout alternates accessories between primary sets', async ({ page }) => {
    // Enable intersperse
    await page.locator('[data-testid="intersperse-checkbox"]').check();
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // With intersperse: primary sets (8) interleaved with accessory sets (6)
    // Expected: P0, A0, P1, A1, P2, A2, P3, A3, P4, A4, P5, A5, P6, P7
    // (8 primary + 6 accessory = 14 total, accessories fill gaps after each primary)

    // First set should still be a primary (squat)
    await expect(page.locator('[data-testid="set-0"] .set-exercise')).toContainText('squat');

    // Second set should be an accessory (leg-curl or hanging-leg-raise)
    const secondExercise = await page.locator('[data-testid="set-1"] .set-exercise').textContent();
    expect(secondExercise === 'leg-curl' || secondExercise === 'hanging-leg-raise').toBeTruthy();

    // Third set should be primary again (squat)
    await expect(page.locator('[data-testid="set-2"] .set-exercise')).toContainText('squat');

    // Total set count should still be 14
    await expect(page.locator('.set-item')).toHaveCount(14);
  });

  test('intersperse preference persists across page loads', async ({ page }) => {
    // Enable intersperse
    await page.locator('[data-testid="intersperse-checkbox"]').check();

    // Wait for the setting to be saved to IndexedDB
    await page.waitForTimeout(200);

    // Reload page
    await page.reload();
    await page.waitForSelector('#app');

    // Checkbox should still be checked
    await expect(page.locator('[data-testid="intersperse-checkbox"]')).toBeChecked();
  });
});
