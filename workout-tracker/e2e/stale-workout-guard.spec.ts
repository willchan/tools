import { test, expect, type Page } from '@playwright/test';

/**
 * Regression: `activeWorkout` is a single global IndexedDB slot, not scoped
 * per day. If a workout is interrupted and left in progress, then the user
 * navigates to a *different* day (e.g. manually overriding position) and
 * starts a new workout there, the very first set logged silently overwrites
 * whatever was sitting in that slot — permanently losing the stuck workout
 * with no warning.
 *
 * Fix: when a persisted `activeWorkout` exists for a different
 * day/week/cycle/template than the one about to be started, block with a
 * choice (finish it / discard it) before any new workout can start. A
 * matching activeWorkout (the normal reload-resume case) must be unaffected.
 *
 * Default template day order (see defaults.ts): 0 Squat, 1 Bench, 2 Deadlift, 3 OHP.
 */

async function seedStaleDeadliftWorkout(page: Page, currentDayIndex: number) {
  await page.evaluate(async (dayIdx) => {
    const { getState, putState, putActiveWorkout } = await import('/src/db/database.ts');
    const state = await getState();
    await putState({ ...state!, dayIndex: dayIdx });
    await putActiveWorkout({
      templateId: state!.templateId,
      cycle: state!.cycle,
      weekIndex: state!.weekIndex,
      dayIndex: 2, // Deadlift Day — deliberately different from `dayIdx`
      completedSets: [
        { exerciseId: 'deadlift', prescribedReps: 5, actualReps: 5, weight: 135, isAmrap: false, timestamp: Date.now() },
        { exerciseId: 'deadlift', prescribedReps: 5, actualReps: 5, weight: 155, isAmrap: false, timestamp: Date.now() },
      ],
      currentSetIndex: 2,
      startedAt: Date.now() - 60_000,
    });
  }, currentDayIndex);
}

test.describe('Stale active-workout conflict guard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
  });

  test('starting a workout for a different day than the stuck one shows a blocking choice', async ({ page }) => {
    await seedStaleDeadliftWorkout(page, 1); // current position: Bench Day
    await page.reload();
    await page.waitForSelector('#start-workout-btn');

    await page.click('#start-workout-btn');

    await expect(page.locator('[data-testid="stale-workout-dialog"]')).toBeVisible();
    await expect(page.locator('[data-testid="stale-workout-dialog"]')).toContainText('Deadlift Day');
    await expect(page.locator('[data-testid="stale-workout-dialog"]')).toContainText('2');
    // The intended (Bench) workout screen must not have rendered underneath.
    await expect(page.locator('.workout-screen')).not.toBeAttached();
  });

  test('discarding the stuck workout clears it and starts the intended one fresh', async ({ page }) => {
    await seedStaleDeadliftWorkout(page, 1); // current position: Bench Day
    await page.reload();
    await page.waitForSelector('#start-workout-btn');

    await page.click('#start-workout-btn');
    await page.click('[data-testid="stale-workout-discard-btn"]');

    await page.waitForSelector('.workout-screen');
    await expect(page.locator('h1')).toHaveText('Bench Day');
    await expect(page.locator('.set-item.completed')).toHaveCount(0);

    const activeWorkout = await page.evaluate(async () => {
      const { getActiveWorkout } = await import('/src/db/database.ts');
      return getActiveWorkout();
    });
    expect(activeWorkout).toBeNull();
  });

  test('finishing the stuck workout resumes it instead of the intended one', async ({ page }) => {
    await seedStaleDeadliftWorkout(page, 1); // current position: Bench Day
    await page.reload();
    await page.waitForSelector('#start-workout-btn');

    await page.click('#start-workout-btn');
    await page.click('[data-testid="stale-workout-resume-btn"]');

    await page.waitForSelector('.workout-screen');
    await expect(page.locator('h1')).toHaveText('Deadlift Day');
    await expect(page.locator('.set-item.completed')).toHaveCount(2);
  });

  test('a matching activeWorkout (normal reload-resume) shows no dialog', async ({ page }) => {
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await page.click('[data-testid="done-set-btn"]');
    await page.click('#skip-timer-btn');

    await page.reload();
    await page.waitForSelector('.workout-screen');

    await expect(page.locator('[data-testid="stale-workout-dialog"]')).not.toBeAttached();
    await expect(page.locator('.set-item.completed')).toHaveCount(1);
  });

  test('finishing a stuck workout never regresses progression past where the user has since navigated', async ({
    page,
  }) => {
    // Squat Day (index 0) gets stuck in progress, then the user manually
    // navigates ahead to OHP Day (index 3) via the day picker — a deliberate,
    // more recent decision than wherever the stuck workout happened to be.
    await page.evaluate(async () => {
      const { getState, putState, putActiveWorkout } = await import('/src/db/database.ts');
      const state = await getState();
      await putActiveWorkout({
        templateId: state!.templateId,
        cycle: state!.cycle,
        weekIndex: state!.weekIndex,
        dayIndex: 0, // Squat Day, stuck with nothing logged yet
        completedSets: [],
        currentSetIndex: 0,
        startedAt: Date.now() - 60_000,
      });
      await putState({ ...state!, dayIndex: 3 }); // manually navigated to OHP Day
    });
    await page.reload();
    await page.waitForSelector('#start-workout-btn');
    await expect(page.locator('.day-name')).toContainText('OHP');

    await page.click('#start-workout-btn');
    await page.click('[data-testid="stale-workout-resume-btn"]');
    await page.waitForSelector('.workout-screen');
    await expect(page.locator('h1')).toHaveText('Squat Day');

    // Finish every set of the resumed Squat Day workout. The done-click
    // handler asynchronously starts a rest timer (disabling Done until it's
    // skipped), so an instantaneous isVisible() check on the skip button
    // right after clicking races that handler; wait for either the skip
    // button or the complete-workout button to actually appear instead.
    const completeBtn = page.locator('#complete-workout-btn');
    const skipBtn = page.locator('#skip-timer-btn');
    while (!(await completeBtn.isVisible().catch(() => false))) {
      await page.click('[data-testid="done-set-btn"]');
      await Promise.race([
        skipBtn.waitFor({ state: 'visible' }).catch(() => {}),
        completeBtn.waitFor({ state: 'visible' }).catch(() => {}),
      ]);
      if (await skipBtn.isVisible().catch(() => false)) {
        await skipBtn.click();
      }
    }
    await completeBtn.click();

    // advanceState(Squat) would naturally produce "Bench Day" (index 1) — but
    // the user's manual position (OHP, index 3) is further along and must win.
    const finalState = await page.evaluate(async () => {
      const { getState } = await import('/src/db/database.ts');
      return getState();
    });
    expect(finalState?.dayIndex).toBe(3);

    // The workout itself must still be recorded — only the progression
    // pointer is protected from regressing, not the historical fact.
    const history = await page.evaluate(async () => {
      const { getAllHistory } = await import('/src/db/database.ts');
      return getAllHistory();
    });
    expect(history.some((h) => h.dayName === 'Squat Day')).toBe(true);
  });
});
