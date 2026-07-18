import { test, expect } from '@playwright/test';

/**
 * Volume rep-total compensation: when a volume exercise (BBB or accessory)
 * falls short of its total rep target across the prescribed sets, the app
 * appends bonus sets at the original per-set reps so the user can grind
 * out the missing volume. Main 5/3/1 sets are excluded — they use TM
 * progression, not rep totals.
 */

const SKIP_TIMER = '#skip-timer-btn';
const DONE = '[data-testid="done-set-btn"]';
const MISSED_TOGGLE = '[data-testid="missed-reps-toggle"]';
const STEPPER_DEC = '[data-testid="stepper-dec"]';
const STEPPER_VALUE = '[data-testid="stepper-value"]';

async function skipRestIfShown(page: import('@playwright/test').Page) {
  // The rest timer is hidden after the final set of a workout. Try to
  // skip it if it appears, but don't fail if it doesn't.
  try {
    await page.locator(SKIP_TIMER).waitFor({ state: 'visible', timeout: 500 });
    await page.click(SKIP_TIMER);
  } catch {
    /* no timer to skip */
  }
}

async function completeSet(page: import('@playwright/test').Page) {
  await page.click(DONE);
  await skipRestIfShown(page);
}

async function logSetWithReps(
  page: import('@playwright/test').Page,
  reps: number,
  prescribed: number,
) {
  if (reps < prescribed) {
    await page.click(MISSED_TOGGLE);
    for (let i = 0; i < prescribed - reps; i++) {
      await page.click(STEPPER_DEC);
    }
    await expect(page.locator(STEPPER_VALUE)).toHaveText(String(reps));
  }
  await page.click(DONE);
  await skipRestIfShown(page);
}

async function startSquatDay(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForSelector('#app');
  await page.click('#start-workout-btn');
  await page.waitForSelector('.workout-screen');
}

/** Complete all 3 main squat sets at full prescribed reps. */
async function completeMainSets(page: import('@playwright/test').Page) {
  await completeSet(page);
  await completeSet(page);
  await completeSet(page);
}

test.describe('Volume deficit — unit logic', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('main 5/3/1 sets have no volume group key', async ({ page }) => {
    const keys = await page.evaluate(async () => {
      const { getVolumeGroupKey } = await import('/src/logic/volume.ts');
      return [
        getVolumeGroupKey({ exerciseId: 'squat', tmPercentage: 0.65, tmLiftId: 'squat', reps: 5, isAmrap: false }),
        getVolumeGroupKey({ exerciseId: 'squat', tmPercentage: 0.85, tmLiftId: 'squat', reps: 5, isAmrap: true }),
        getVolumeGroupKey({ exerciseId: 'squat', tmPercentage: 0.5, tmLiftId: 'squat', reps: 10, isAmrap: false }),
        getVolumeGroupKey({ exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false }),
      ];
    });
    expect(keys[0]).toBeNull(); // main set
    expect(keys[1]).toBeNull(); // amrap
    expect(keys[2]).not.toBeNull(); // BBB
    expect(keys[3]).not.toBeNull(); // accessory
  });

  test('computeVolumeGroups sums reps and counts per group', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeVolumeGroups } = await import('/src/logic/volume.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const t = getDefault531Template();
      const squatDay = t.weeks[0].days[0];
      const groups = computeVolumeGroups(squatDay.sets);
      return Array.from(groups.entries());
    });
    // Squat day volume groups: BBB squat 50% x5x10 = 50 (count 5),
    // leg-curl null x3x10 = 30 (count 3), hanging-leg-raise null x3x15 = 45 (count 3).
    const map = new Map(result);
    expect(map.get('squat|0.5|10')).toEqual({ target: 50, originalCount: 5, repsPerSet: 10 });
    expect(map.get('leg-curl|null|10')).toEqual({ target: 30, originalCount: 3, repsPerSet: 10 });
    expect(map.get('hanging-leg-raise|null|15')).toEqual({ target: 45, originalCount: 3, repsPerSet: 15 });
    expect(map.size).toBe(3);
  });

  test('evaluateBonusSetNeed says no while sets remain in the group', async ({ page }) => {
    const decision = await page.evaluate(async () => {
      const { evaluateBonusSetNeed, computeVolumeGroups } = await import('/src/logic/volume.ts');
      const sets = [
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
      ];
      const groups = computeVolumeGroups(sets);
      return evaluateBonusSetNeed('pullup|null|10', sets, [5], 1, groups);
    });
    expect(decision.shouldAdd).toBe(false);
  });

  test('evaluateBonusSetNeed adds when last scheduled set leaves deficit', async ({ page }) => {
    const decision = await page.evaluate(async () => {
      const { evaluateBonusSetNeed, computeVolumeGroups } = await import('/src/logic/volume.ts');
      const sets = [
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
      ];
      const groups = computeVolumeGroups(sets);
      return evaluateBonusSetNeed('pullup|null|10', sets, [10, 10, 5], 3, groups);
    });
    expect(decision.shouldAdd).toBe(true);
    expect(decision.prescribedReps).toBe(10);
  });

  test('evaluateBonusSetNeed does not add once target is met', async ({ page }) => {
    const decision = await page.evaluate(async () => {
      const { evaluateBonusSetNeed, computeVolumeGroups } = await import('/src/logic/volume.ts');
      const sets = [
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
      ];
      const groups = computeVolumeGroups(sets);
      return evaluateBonusSetNeed('pullup|null|10', sets, [10, 10, 10], 3, groups);
    });
    expect(decision.shouldAdd).toBe(false);
  });

  test('computeBonusInsertionIndex places accessory bonus after the next primary set', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeBonusInsertionIndex } = await import('/src/logic/volume.ts');
      // P0 A0 P1 A1 P2 ... — just completed A0 (index 1), currentSetIndex is 2 (P1).
      const sets = [
        { exerciseId: 'squat', tmPercentage: 0.65, tmLiftId: 'squat', reps: 5, isAmrap: false },
        { exerciseId: 'leg-curl', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
        { exerciseId: 'squat', tmPercentage: 0.75, tmLiftId: 'squat', reps: 5, isAmrap: false },
        { exerciseId: 'leg-curl', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
      ];
      return computeBonusInsertionIndex(sets, 2, true);
    });
    // Should land after P1 (index 2), i.e. index 3 — not immediately at index 2.
    expect(result).toBe(3);
  });

  test('computeBonusInsertionIndex falls back to immediate insertion when no primary set remains', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeBonusInsertionIndex } = await import('/src/logic/volume.ts');
      const sets = [
        { exerciseId: 'leg-curl', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
        { exerciseId: 'leg-curl', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
      ];
      return computeBonusInsertionIndex(sets, 1, true);
    });
    expect(result).toBe(1);
  });

  test('computeBonusInsertionIndex is a no-op for non-accessory (BBB/main) bonus sets', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { computeBonusInsertionIndex } = await import('/src/logic/volume.ts');
      const sets = [
        { exerciseId: 'squat', tmPercentage: 0.5, tmLiftId: 'squat', reps: 10, isAmrap: false },
        { exerciseId: 'leg-curl', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
        { exerciseId: 'squat', tmPercentage: 0.5, tmLiftId: 'squat', reps: 10, isAmrap: false },
      ];
      return computeBonusInsertionIndex(sets, 1, false);
    });
    expect(result).toBe(1);
  });

  test('evaluateBonusSetNeed stops once bonus cap (2× original count) is reached', async ({ page }) => {
    const decision = await page.evaluate(async () => {
      const { evaluateBonusSetNeed, computeVolumeGroups } = await import('/src/logic/volume.ts');
      // Original template: 3 sets. With 3 bonus sets already added we're at 6 (the cap).
      const original = [
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
      ];
      const groups = computeVolumeGroups(original);
      const runtime = [
        ...original,
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false, isBonus: true },
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false, isBonus: true },
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false, isBonus: true },
      ];
      // All 6 done, only 18 reps total (3 per set). Deficit of 12 remains but we're capped.
      return evaluateBonusSetNeed('pullup|null|10', runtime, [3, 3, 3, 3, 3, 3], 6, groups);
    });
    expect(decision.shouldAdd).toBe(false);
  });
});

test.describe('Volume deficit — workout flow', () => {
  test.beforeEach(async ({ page }) => {
    await startSquatDay(page);
  });

  test('hitting all 5 BBB sets at 10 reps lands on first leg curl (no bonus)', async ({ page }) => {
    await completeMainSets(page);
    // 5 BBB sets at prescribed 10
    for (let i = 0; i < 5; i++) await completeSet(page);
    await expect(page.locator('.set-item.current .set-exercise')).toContainText('leg-curl');
    await expect(page.locator('.set-item')).toHaveCount(14);
  });

  test('missing reps mid-BBB does not immediately add a bonus set', async ({ page }) => {
    await completeMainSets(page);
    // BBB 1: log 6/10
    await logSetWithReps(page, 6, 10);
    // Next set is BBB 2 (squat, prescribed 10 — no bump)
    await expect(page.locator('.set-item.current .set-exercise')).toContainText('squat');
    await expect(page.locator('.set-item.current .set-prescription')).toContainText('10 reps');
    await expect(page.locator('.set-item')).toHaveCount(14);
  });

  test('missing reps in the last BBB set adds a bonus set at original reps', async ({ page }) => {
    await completeMainSets(page);
    // BBB 1-4 at full
    for (let i = 0; i < 4; i++) await completeSet(page);
    // BBB 5: log 6/10. Total = 46 < 50.
    await logSetWithReps(page, 6, 10);

    // A bonus BBB squat set should be the new current set.
    const current = page.locator('.set-item.current');
    await expect(current.locator('.set-exercise')).toContainText('squat');
    await expect(current.locator('.set-prescription')).toContainText('10');
    await expect(current.locator('.set-prescription')).toContainText('bonus');
    // One bonus set added — total grew from 14 to 15.
    await expect(page.locator('.set-item')).toHaveCount(15);
  });

  test('bonus sets keep getting appended until BBB total is reached', async ({ page }) => {
    await completeMainSets(page);
    // BBB 1-4 at 0 reps each. Total = 0.
    for (let i = 0; i < 4; i++) await logSetWithReps(page, 0, 10);
    // BBB 5 at 10 reps. Total = 10. Bonus 1 appears.
    await completeSet(page);

    // Cycle through bonuses, doing 10 reps each. Need 4 more to reach 50.
    for (let i = 0; i < 4; i++) {
      await expect(page.locator('.set-item.current .set-exercise')).toContainText('squat');
      await expect(page.locator('.set-item.current')).toHaveAttribute('data-bonus', 'true');
      await completeSet(page);
    }

    // Volume target met. Next set is leg curl.
    await expect(page.locator('.set-item.current .set-exercise')).toContainText('leg-curl');
  });

  test('accessory deficit also triggers a bonus set', async ({ page }) => {
    await completeMainSets(page);
    // 5 BBB at full
    for (let i = 0; i < 5; i++) await completeSet(page);
    // Leg-curl set 1 & 2 at full (10/10)
    await completeSet(page);
    await completeSet(page);
    // Leg-curl set 3: log 5/10. Total = 25 < 30.
    await logSetWithReps(page, 5, 10);

    const current = page.locator('.set-item.current');
    await expect(current.locator('.set-exercise')).toContainText('leg-curl');
    await expect(current.locator('.set-prescription')).toContainText('bonus');
  });

  test('missing reps on a main 5/3/1 set does not append a bonus set', async ({ page }) => {
    // First main set: prescribed 5, log 3.
    await logSetWithReps(page, 3, 5);

    // Next current set is main set 2 (squat 75%), not a bonus. Total set count unchanged.
    const current = page.locator('.set-item.current');
    await expect(current.locator('.set-exercise')).toContainText('squat');
    await expect(current).not.toHaveAttribute('data-bonus', 'true');
    await expect(page.locator('.set-item')).toHaveCount(14);
  });

  test('hitting volume target via bonus sets does not show a BBB failure on the sheet', async ({ page }) => {
    await completeMainSets(page);
    // BBB 1-4 at full, BBB 5 short (6/10) → bonus appears
    for (let i = 0; i < 4; i++) await completeSet(page);
    await logSetWithReps(page, 6, 10);
    // Bonus: do 4 reps. Total = 50.
    await logSetWithReps(page, 4, 10);
    // Continue accessories at full
    for (let i = 0; i < 6; i++) await completeSet(page);

    // Complete workout — no failures expected (BBB reached 50 total)
    await page.click('#complete-workout-btn');
    await expect(page.locator('#failure-sheet')).not.toBeAttached();
  });

  test('bonus sets stop once 2× original count is hit; remaining deficit shows on failure sheet', async ({ page }) => {
    await completeMainSets(page);
    // BBB 1-4 at 0 reps each (4 sets, 0 total)
    for (let i = 0; i < 4; i++) await logSetWithReps(page, 0, 10);
    // BBB 5: 0 reps. Total = 0. Add bonus 1.
    await logSetWithReps(page, 0, 10);
    // Bonus 1-5: 0 reps each. After bonus 5, total sets = 10 (5 original + 5 bonus) = 2× cap → no more bonus.
    for (let i = 0; i < 5; i++) {
      await expect(page.locator('.set-item.current')).toHaveAttribute('data-bonus', 'true');
      await logSetWithReps(page, 0, 10);
    }
    // Next set should be the first accessory (leg-curl), not another bonus.
    await expect(page.locator('.set-item.current .set-exercise')).toContainText('leg-curl');

    // Finish accessories at full
    for (let i = 0; i < 6; i++) await completeSet(page);

    await page.click('#complete-workout-btn');
    // BBB hit 0/50 — failure sheet should list it as a volume-target shortfall.
    await expect(page.locator('#failure-sheet')).toBeVisible();
    await expect(page.locator('.failure-list')).toContainText('0/50');
    await expect(page.locator('.failure-list')).toContainText('volume target');
  });

  test('bonus sets persist across a reload', async ({ page }) => {
    await completeMainSets(page);
    for (let i = 0; i < 4; i++) await completeSet(page);
    await logSetWithReps(page, 6, 10);

    // Bonus set is currently visible.
    await expect(page.locator('.set-item.current')).toHaveAttribute('data-bonus', 'true');
    await expect(page.locator('.set-item')).toHaveCount(15);

    // Reload — should resume with the bonus set still in the sequence.
    await page.reload();
    await page.waitForSelector('.workout-screen');

    await expect(page.locator('.set-item')).toHaveCount(15);
    await expect(page.locator('.set-item.current')).toHaveAttribute('data-bonus', 'true');
    await expect(page.locator('.set-item.current .set-exercise')).toContainText('squat');
  });
});
