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

    // Wait for the async IndexedDB write triggered by the change event to complete
    await page.waitForFunction(async () => {
      const { openDB } = await import('/src/db/database.ts' as any).catch(() => ({ openDB: null }));
      // Fallback: read directly from IndexedDB
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open('workout-tracker');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('state', 'readonly');
          const store = tx.objectStore('state');
          const getReq = store.get('settings');
          getReq.onsuccess = () => {
            const settings = getReq.result;
            resolve(settings?.intersperseAccessories === true);
          };
          getReq.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      });
    });

    // Reload page
    await page.reload();
    await page.waitForSelector('#app');

    // Checkbox should still be checked
    await expect(page.locator('[data-testid="intersperse-checkbox"]')).toBeChecked();
  });

  test('interspersed: done button stays enabled for accessory set after primary', async ({ page }) => {
    await page.locator('[data-testid="intersperse-checkbox"]').check();
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Complete first primary set — rest timer should start
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Now on an accessory set — done button should be ENABLED despite timer running
    const doneBtn = page.locator('[data-testid="done-set-btn"]');
    await expect(doneBtn).toBeEnabled();
  });

  test('interspersed: done button disables after accessory if timer still running', async ({ page }) => {
    await page.locator('[data-testid="intersperse-checkbox"]').check();
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Complete primary set (timer starts)
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Complete accessory set while timer still running
    await page.click('[data-testid="done-set-btn"]');

    // Now on next primary set — done button should be DISABLED (timer still going)
    const doneBtn = page.locator('[data-testid="done-set-btn"]');
    await expect(doneBtn).toBeDisabled();
  });

  test('interspersed: accessory make-up set is inserted after the next primary set, not immediately', async ({ page }) => {
    // With intersperse, sequence is: P0 A0(leg-curl1) P1 A1(leg-curl2) P2 A2(leg-curl3) P3 A3(hangleg1) ...
    // Missing reps on leg-curl3 (the last scheduled leg-curl) triggers a bonus leg-curl set.
    // It should land AFTER the next primary set (P3), not immediately before it —
    // so the user gets to rest during P3 instead of grinding the make-up set back-to-back.
    await page.locator('[data-testid="intersperse-checkbox"]').check();
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    const DONE = '[data-testid="done-set-btn"]';
    const SKIP_TIMER = '#skip-timer-btn';
    const MISSED_TOGGLE = '[data-testid="missed-reps-toggle"]';
    const STEPPER_DEC = '[data-testid="stepper-dec"]';

    async function skipRestIfShown() {
      try {
        await page.locator(SKIP_TIMER).waitFor({ state: 'visible', timeout: 500 });
        await page.click(SKIP_TIMER);
      } catch {
        /* no timer to skip */
      }
    }

    // P0 (main squat set 1)
    await page.click(DONE);
    await skipRestIfShown();
    // A0 (leg-curl 1) — full reps
    await page.click(DONE);
    // P1 (main squat set 2)
    await page.click(DONE);
    await skipRestIfShown();
    // A1 (leg-curl 2) — full reps
    await page.click(DONE);
    // P2 (main squat set 3)
    await page.click(DONE);
    await skipRestIfShown();

    // A2 (leg-curl 3) — miss reps to trigger a bonus set (total was 20/30, this brings it short of 30).
    await page.click(MISSED_TOGGLE);
    for (let i = 0; i < 5; i++) await page.click(STEPPER_DEC);
    await page.click(DONE);

    // Next set should be P3 (a BBB squat set), NOT the bonus leg-curl.
    const current = page.locator('.set-item.current');
    await expect(current.locator('.set-exercise')).toContainText('squat');
    await expect(current).not.toHaveAttribute('data-bonus', 'true');

    // Complete P3 — rest timer starts.
    await page.click(DONE);
    await expect(page.locator('#rest-timer')).toBeVisible();

    // The bonus leg-curl set should now be current, slotted in right after P3.
    const afterP3 = page.locator('.set-item.current');
    await expect(afterP3.locator('.set-exercise')).toContainText('leg-curl');
    await expect(afterP3).toHaveAttribute('data-bonus', 'true');
    // Done button should stay enabled so the user can do the make-up set during P3's rest.
    await expect(page.locator(DONE)).toBeEnabled();
  });

  test('interspersed: no new rest timer after completing accessory set', async ({ page }) => {
    await page.locator('[data-testid="intersperse-checkbox"]').check();
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Complete primary set (timer starts — default 90s = "1:30")
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Wait for the timer to tick at least once (value changes from initial "1:30")
    await expect(page.locator('#timer-value')).not.toHaveText('1:30');

    // Record the current timer value before completing accessory
    const timerBefore = await page.locator('#timer-value').textContent();

    // Complete accessory set — timer should NOT reset
    await page.click('[data-testid="done-set-btn"]');

    // Timer should still be visible (continuing from previous rest)
    await expect(page.locator('#rest-timer')).toBeVisible();

    // Timer should NOT have reset to full duration (1:30).
    // It should show something <= what it was before (still counting down).
    const timerAfter = await page.locator('#timer-value').textContent();
    expect(timerAfter).not.toBe('1:30');
  });
});
