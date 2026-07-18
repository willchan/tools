import { test, expect } from '@playwright/test';

/**
 * Regression: home shouldn't show a "next workout" that's ahead of actual
 * progress when there's an empty earlier week in the same cycle.
 *
 * Reported scenario: user finished cycle 4 week 1 (4 workouts in weekIndex 0
 * of the reordered template). The persisted progression state ended up
 * pointing at the very last workout of the cycle (week 3 / Squat Day) with
 * no logged work for weeks 2 or 3. The home blindly displayed that stale
 * position; the user expected "Week 2 / OHP Day" (the actual next workout).
 */
test('home self-heals when state skips an empty earlier week in the cycle', async ({ page }) => {
  await page.goto('/');
  // Wait for full app init (seedDefaults + render) before touching IndexedDB
  await page.waitForSelector('#start-workout-btn');

  await page.evaluate(async () => {
    const { importAll } = await import('/src/db/database.ts');
    const { getDefault531Template, getDefaultExercises } = await import('/src/db/defaults.ts');

    // User's template has days reordered to [OHP, Deadlift, Bench, Squat].
    const template = getDefault531Template();
    for (const week of template.weeks) week.days.reverse();

    // Synthesize cycle 4 week 0 history (all 4 days completed).
    const dayNames = ['OHP Day', 'Deadlift Day', 'Bench Day', 'Squat Day'];
    const history = dayNames.map((dayName, dayIdx) => ({
      id: `workout-c4w0d${dayIdx}`,
      templateId: '531-bbb',
      cycle: 4,
      weekIndex: 0,
      dayIndex: dayIdx,
      dayName,
      sets: [],
      startedAt: 1778000000000 + dayIdx * 86400000,
      completedAt: 1778000000000 + dayIdx * 86400000 + 3600000,
    }));

    await importAll({
      exercises: getDefaultExercises(),
      templates: [template],
      // Stale state pointing past actual progress.
      state: { templateId: '531-bbb', cycle: 4, weekIndex: 2, dayIndex: 3 },
      trainingMaxes: [
        { exerciseId: 'squat', weight: 220 },
        { exerciseId: 'bench', weight: 150 },
        { exerciseId: 'deadlift', weight: 235 },
        { exerciseId: 'ohp', weight: 105 },
      ],
      history,
      timerState: null,
      settings: { restTimerSeconds: 120, intersperseAccessories: false },
    });
  });
  await page.reload();
  await page.waitForSelector('.home-screen');

  // Home should self-heal and surface the actual next workout: Week 2 / OHP Day.
  await expect(page.locator('.cycle-info')).toContainText('Week 2');
  await expect(page.locator('.day-name')).toContainText('OHP');

  // The persisted state should be corrected too.
  const state = await page.evaluate(async () => {
    const { getState } = await import('/src/db/database.ts');
    return getState();
  });
  expect(state).toMatchObject({ cycle: 4, weekIndex: 1, dayIndex: 0 });
});

/**
 * Regression guard: the snap-back must NOT fire when the user intentionally
 * navigates forward via the week picker to the immediate next week. Only an
 * EMPTY earlier week in the same cycle (a "gap") should trigger correction.
 */
test('home preserves forward navigation by one week when no gap exists', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#app');

  // After completing the first day of week 1, navigate to week 2 via the
  // picker. The state ends at (cycle 1, week 1, day 0) — there is no empty
  // earlier week, so the home should respect the navigation.
  await page.click('#start-workout-btn');
  await page.waitForSelector('.workout-screen');
  const totalSets = await page.locator('.set-item').count();
  for (let i = 0; i < totalSets; i++) {
    await page.click('[data-testid="done-set-btn"]');
    if (i < totalSets - 1) await page.click('#skip-timer-btn');
  }
  await page.click('#complete-workout-btn');
  await page.waitForSelector('.home-screen');

  await page.click('.week-picker-btn:nth-child(2)');
  await expect(page.locator('.week-picker-btn.active')).toContainText('Week 2');
});
