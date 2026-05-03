import { test, expect } from '@playwright/test';

/**
 * TDD Loop 1: State progression tests.
 * Tests advancing through days, weeks, and cycles.
 */

test.describe('Progression State Machine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('advances to next day within same week', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { advanceState } = await import('/src/logic/progression.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const template = getDefault531Template();

      return advanceState(
        { templateId: '531-bbb', cycle: 1, weekIndex: 0, dayIndex: 0 },
        template
      );
    });

    expect(result.newState.dayIndex).toBe(1);
    expect(result.newState.weekIndex).toBe(0);
    expect(result.newState.cycle).toBe(1);
    expect(result.tmBumps).toBeNull();
  });

  test('advances to next week after last day', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { advanceState } = await import('/src/logic/progression.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const template = getDefault531Template();

      // Day index 3 is the last day (0-indexed, 4 days total)
      return advanceState(
        { templateId: '531-bbb', cycle: 1, weekIndex: 0, dayIndex: 3 },
        template
      );
    });

    expect(result.newState.dayIndex).toBe(0);
    expect(result.newState.weekIndex).toBe(1);
    expect(result.newState.cycle).toBe(1);
    expect(result.tmBumps).toBeNull();
  });

  test('starts new cycle after last week and returns TM bumps', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { advanceState } = await import('/src/logic/progression.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const template = getDefault531Template();

      // Week 2 (index), Day 3 (last day of last week)
      return advanceState(
        { templateId: '531-bbb', cycle: 1, weekIndex: 2, dayIndex: 3 },
        template
      );
    });

    expect(result.newState.dayIndex).toBe(0);
    expect(result.newState.weekIndex).toBe(0);
    expect(result.newState.cycle).toBe(2);

    // Should have TM bumps for all 4 main lifts
    expect(result.tmBumps).not.toBeNull();
    expect(result.tmBumps!.length).toBe(4);

    // Verify correct increments
    const squatBump = result.tmBumps!.find((b: any) => b.exerciseId === 'squat');
    const benchBump = result.tmBumps!.find((b: any) => b.exerciseId === 'bench');
    expect(squatBump!.increment).toBe(10); // Lower body
    expect(benchBump!.increment).toBe(5);  // Upper body
  });

  test('progresses through an entire 3-week cycle correctly', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { advanceState } = await import('/src/logic/progression.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const template = getDefault531Template();

      let state = { templateId: '531-bbb', cycle: 1, weekIndex: 0, dayIndex: 0 };
      let tmBumpsReceived = false;
      let totalAdvances = 0;

      // 3 weeks × 4 days = 12 workouts per cycle
      for (let i = 0; i < 12; i++) {
        const res = advanceState(state, template);
        state = res.newState;
        totalAdvances++;
        if (res.tmBumps) tmBumpsReceived = true;
      }

      return { state, tmBumpsReceived, totalAdvances };
    });

    expect(result.totalAdvances).toBe(12);
    expect(result.tmBumpsReceived).toBe(true);
    expect(result.state.cycle).toBe(2);
    expect(result.state.weekIndex).toBe(0);
    expect(result.state.dayIndex).toBe(0);
  });
});

test.describe('AMRAP-gated TM bumps', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('evaluateCycleAmraps reports hit/miss per lift using latest AMRAP in cycle', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { evaluateCycleAmraps } = await import('/src/logic/progression.ts');

      const log = (
        weekIndex: number,
        exerciseId: string,
        prescribedReps: number,
        actualReps: number,
        completedAt: number,
      ) => ({
        id: `${exerciseId}-${weekIndex}`,
        templateId: '531-bbb',
        cycle: 1,
        weekIndex,
        dayIndex: 0,
        dayName: 'X',
        startedAt: completedAt - 1,
        completedAt,
        sets: [
          {
            exerciseId,
            prescribedReps,
            actualReps,
            weight: 0,
            isAmrap: true,
            timestamp: completedAt,
          },
        ],
      });

      const cycleHistory = [
        log(0, 'squat', 5, 6, 100),
        log(1, 'squat', 3, 5, 200),
        log(2, 'squat', 1, 3, 300), // hit (>=1)
        log(2, 'bench', 1, 0, 310), // missed
        log(0, 'deadlift', 5, 5, 110), // only week-1 AMRAP exists, hit
        // ohp: no logs
      ];

      return evaluateCycleAmraps(cycleHistory, ['squat', 'bench', 'deadlift', 'ohp']);
    });

    expect(result.squat).toEqual({ hit: true, actualReps: 3, prescribedReps: 1 });
    expect(result.bench).toEqual({ hit: false, actualReps: 0, prescribedReps: 1 });
    expect(result.deadlift).toEqual({ hit: true, actualReps: 5, prescribedReps: 5 });
    // No AMRAP record → default to hit (user generally hits prescribed).
    expect(result.ohp).toEqual({ hit: true, actualReps: 0, prescribedReps: 0 });
  });

  test('buildTMAdjustments only applies bump when AMRAP was hit', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { buildTMAdjustments } = await import('/src/logic/progression.ts');

      const candidateBumps = [
        { exerciseId: 'squat', increment: 10 },
        { exerciseId: 'bench', increment: 5 },
        { exerciseId: 'deadlift', increment: 10 },
        { exerciseId: 'ohp', increment: 5 },
      ];

      const amrapResults = {
        squat: { hit: true, actualReps: 3, prescribedReps: 1 },
        bench: { hit: false, actualReps: 0, prescribedReps: 1 },
        deadlift: { hit: true, actualReps: 5, prescribedReps: 5 },
        ohp: { hit: false, actualReps: 0, prescribedReps: 0 },
      };

      const currentTMs = new Map([
        ['squat', 225],
        ['bench', 185],
        ['deadlift', 275],
        ['ohp', 115],
      ]);

      return buildTMAdjustments(candidateBumps, amrapResults, currentTMs);
    });

    expect(result).toHaveLength(4);
    const byId = Object.fromEntries(result.map((a: any) => [a.exerciseId, a]));

    expect(byId.squat.hitTarget).toBe(true);
    expect(byId.squat.appliedIncrement).toBe(10);
    expect(byId.squat.previousTrainingMax).toBe(225);
    expect(byId.squat.newTrainingMax).toBe(235);

    expect(byId.bench.hitTarget).toBe(false);
    expect(byId.bench.appliedIncrement).toBe(0);
    expect(byId.bench.previousTrainingMax).toBe(185);
    expect(byId.bench.newTrainingMax).toBe(185);

    expect(byId.deadlift.hitTarget).toBe(true);
    expect(byId.deadlift.appliedIncrement).toBe(10);
    expect(byId.deadlift.newTrainingMax).toBe(285);

    expect(byId.ohp.hitTarget).toBe(false);
    expect(byId.ohp.appliedIncrement).toBe(0);
  });
});

test.describe('Cycle completion UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('history card shows TM adjustments banner when log includes them', async ({ page }) => {
    await page.evaluate(async () => {
      const { putWorkoutLog } = await import('/src/db/database.ts');
      await putWorkoutLog({
        id: 'seed-bump-log',
        templateId: '531-bbb',
        cycle: 1,
        weekIndex: 2,
        dayIndex: 3,
        dayName: 'OHP Day',
        sets: [],
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
        tmAdjustments: [
          {
            exerciseId: 'squat',
            previousTrainingMax: 225,
            newTrainingMax: 235,
            appliedIncrement: 10,
            hitTarget: true,
            amrapReps: 6,
            prescribedReps: 1,
          },
          {
            exerciseId: 'bench',
            previousTrainingMax: 185,
            newTrainingMax: 185,
            appliedIncrement: 0,
            hitTarget: false,
            amrapReps: 0,
            prescribedReps: 1,
          },
        ],
      });
    });

    await page.click('.nav-btn[data-route="history"]');
    await page.waitForSelector('.history-screen');

    const banner = page.locator('[data-testid="tm-adjustments"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Cycle 1 complete');
    await expect(banner).toContainText('squat');
    await expect(banner).toContainText('225 → 235');
    await expect(banner).toContainText('bench');
    await expect(banner).toContainText('held');
  });

  test('cycle-ending workout applies bumps only for AMRAP hits and surfaces sheet', async ({ page }) => {
    // Seed: state at the LAST day of the LAST week (OHP Day, Week 3).
    // Pre-log Week-3 AMRAPs for the other lifts so the cycle has prior records.
    await page.evaluate(async () => {
      const { putState, putWorkoutLog, putTrainingMax } = await import('/src/db/database.ts');
      await putState({ templateId: '531-bbb', cycle: 1, weekIndex: 2, dayIndex: 3 });

      const baseTime = Date.now() - 7 * 86400_000;
      const seed = (
        weekIndex: number,
        dayIndex: number,
        dayName: string,
        exerciseId: string,
        prescribedReps: number,
        actualReps: number,
      ) => ({
        id: `seed-${exerciseId}-w${weekIndex}`,
        templateId: '531-bbb',
        cycle: 1,
        weekIndex,
        dayIndex,
        dayName,
        sets: [
          {
            exerciseId,
            prescribedReps,
            actualReps,
            weight: 200,
            isAmrap: true,
            timestamp: baseTime,
          },
        ],
        startedAt: baseTime,
        completedAt: baseTime + 1000,
      });

      // Week 3 AMRAPs (5/3/1 week, prescribed 1):
      await putWorkoutLog(seed(2, 0, 'Squat Day', 'squat', 1, 5)); // hit
      await putWorkoutLog(seed(2, 1, 'Bench Day', 'bench', 1, 0)); // missed
      await putWorkoutLog(seed(2, 2, 'Deadlift Day', 'deadlift', 1, 3)); // hit

      // Reset known starting TMs
      await putTrainingMax({ exerciseId: 'squat', weight: 225 });
      await putTrainingMax({ exerciseId: 'bench', weight: 185 });
      await putTrainingMax({ exerciseId: 'deadlift', weight: 275 });
      await putTrainingMax({ exerciseId: 'ohp', weight: 115 });
    });

    await page.reload();
    await page.waitForSelector('#app');

    // Start the cycle-ending OHP workout
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');

    // Day has 14 sets (3 main + 5 BBB + 6 accessory). Last main set (idx 2) is AMRAP.
    // Complete sets 0-13. Skip rest timer between sets.
    for (let i = 0; i < 14; i++) {
      // For the AMRAP set (i=2), we hit prescribed reps (default reps=1, default value already 1)
      await page.click('[data-testid="done-set-btn"]');
      if (i < 13) await page.click('#skip-timer-btn');
    }

    await page.click('#complete-workout-btn');

    const sheet = page.locator('[data-testid="cycle-complete-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Cycle 1 complete');
    await expect(sheet).toContainText('squat');
    await expect(sheet).toContainText('+10');
    await expect(sheet).toContainText('bench');
    await expect(sheet).toContainText('held');

    await page.click('[data-testid="cycle-complete-dismiss"]');

    // Verify TMs in the database: squat/deadlift/ohp bumped, bench held.
    const tms = await page.evaluate(async () => {
      const { getAllTrainingMaxes } = await import('/src/db/database.ts');
      const all = await getAllTrainingMaxes();
      return Object.fromEntries(all.map((t) => [t.exerciseId, t.weight]));
    });
    expect(tms.squat).toBe(235);
    expect(tms.bench).toBe(185);
    expect(tms.deadlift).toBe(285);
    expect(tms.ohp).toBe(120);
  });
});
