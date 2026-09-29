import { test, expect } from '@playwright/test';

/**
 * Unit coverage for src/logic/workoutSession.ts: the pure, DOM-free reducer
 * that every in-workout action goes through, whether it comes from a phone
 * tap (src/ui/workout.ts) or an Apple Watch event (src/native/watch.ts).
 * See docs/adr/0002-apple-watch-remote.md.
 *
 * Squat Day, week 1 of the default template:
 *   0-2  squat main (65/75/85%, 5/5/5+, last is AMRAP)
 *   3-7  squat BBB 5x10 @ 50%
 *   8-10 leg-curl 3x10 (accessory)
 *   11-13 hanging-leg-raise 3x15 (accessory)
 * Default squat TM is 225.
 */

test.describe('workoutSession reducer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('createSession builds the effective set sequence, with or without interspersing', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createSession } = await import('/src/logic/workoutSession.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const plain = createSession(sets, { intersperseAccessories: false, startedAt: 1000 });
      const mixed = createSession(sets, { intersperseAccessories: true, startedAt: 1000 });
      return {
        plain: plain.workoutSets.map((s) => s.exerciseId),
        mixed: mixed.workoutSets.map((s) => s.exerciseId),
        rest: {
          startedAt: plain.startedAt,
          currentSetIndex: plain.currentSetIndex,
          completedSets: plain.completedSets,
          timer: plain.timer,
          restLocksDone: plain.restLocksDone,
          appliedEventIds: plain.appliedEventIds,
        },
      };
    });
    expect(result.plain).toEqual([
      'squat', 'squat', 'squat', 'squat', 'squat', 'squat', 'squat', 'squat',
      'leg-curl', 'leg-curl', 'leg-curl', 'hanging-leg-raise', 'hanging-leg-raise', 'hanging-leg-raise',
    ]);
    expect(result.mixed.slice(0, 4)).toEqual(['squat', 'leg-curl', 'squat', 'leg-curl']);
    expect(result.mixed).toHaveLength(14);
    expect(result.rest).toEqual({
      startedAt: 1000,
      currentSetIndex: 0,
      completedSets: [],
      timer: null,
      restLocksDone: false,
      appliedEventIds: [],
    });
  });

  test('completeSet records the set at the event timestamp and starts rest from that time', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const ctx = createSessionContext(sets, new Map([['squat', 225]]), { restTimerSeconds: 90, intersperseAccessories: false });
      const s0 = createSession(sets, { intersperseAccessories: false, startedAt: 1000 });
      const { state, restStarted } = applySessionEvent(s0, { type: 'completeSet', at: 50_000 }, ctx);
      return { state, restStarted };
    });
    expect(result.restStarted).toBe(true);
    expect(result.state.currentSetIndex).toBe(1);
    expect(result.state.completedSets).toEqual([
      // 65% of 225 = 146.25 → rounded to 145
      { exerciseId: 'squat', prescribedReps: 5, actualReps: 5, weight: 145, isAmrap: false, timestamp: 50_000 },
    ]);
    expect(result.state.timer).toEqual({ expectedEndTime: 50_000 + 90_000, durationMs: 90_000 });
    expect(result.state.restLocksDone).toBe(true);
  });

  test('completeSet uses explicit reps when given', async ({ page }) => {
    const completed = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const ctx = createSessionContext(sets, new Map([['squat', 225]]), { restTimerSeconds: 90, intersperseAccessories: false });
      const s0 = createSession(sets, { intersperseAccessories: false, startedAt: 1000 });
      return applySessionEvent(s0, { type: 'completeSet', at: 2000, reps: 3 }, ctx).state.completedSets[0];
    });
    expect(completed.actualReps).toBe(3);
    expect(completed.prescribedReps).toBe(5);
  });

  test('completeSet does not mutate its input state', async ({ page }) => {
    const unchanged = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const ctx = createSessionContext(sets, new Map([['squat', 225]]), { restTimerSeconds: 90, intersperseAccessories: false });
      let s = createSession(sets, { intersperseAccessories: false, startedAt: 1000 });
      // Walk to the last BBB set, then miss reps so a bonus set is spliced in.
      for (let i = 0; i < 7; i++) s = applySessionEvent(s, { type: 'completeSet', at: 2000 + i }, ctx).state;
      const before = JSON.stringify(s);
      applySessionEvent(s, { type: 'completeSet', at: 9000, reps: 2 }, ctx);
      return JSON.stringify(s) === before;
    });
    expect(unchanged).toBe(true);
  });

  test('missing BBB reps on the last set of the group splices in a bonus set owing the deficit', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const ctx = createSessionContext(sets, new Map([['squat', 225]]), { restTimerSeconds: 90, intersperseAccessories: false });
      let s = createSession(sets, { intersperseAccessories: false, startedAt: 1000 });
      for (let i = 0; i < 7; i++) s = applySessionEvent(s, { type: 'completeSet', at: 2000 + i }, ctx).state;
      s = applySessionEvent(s, { type: 'completeSet', at: 9000, reps: 4 }, ctx).state;
      return { length: s.workoutSets.length, current: s.workoutSets[s.currentSetIndex], index: s.currentSetIndex };
    });
    expect(result.length).toBe(15);
    expect(result.index).toBe(8);
    expect(result.current).toMatchObject({ exerciseId: 'squat', isBonus: true, owedReps: 6, reps: 10 });
  });

  test('completing the final set starts no rest', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const sets = [
        { exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false },
      ];
      const ctx = createSessionContext(sets, new Map(), { restTimerSeconds: 90, intersperseAccessories: false });
      const s0 = createSession(sets, { intersperseAccessories: false, startedAt: 1000 });
      return applySessionEvent(s0, { type: 'completeSet', at: 2000 }, ctx);
    });
    expect(result.restStarted).toBe(false);
    expect(result.state.timer).toBeNull();
    expect(result.state.currentSetIndex).toBe(1);
  });

  test('interspersed: a primary set starts rest but leaves Done unlocked when an accessory is next', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const settings = { restTimerSeconds: 60, intersperseAccessories: true };
      const ctx = createSessionContext(sets, new Map([['squat', 225]]), settings);
      const s0 = createSession(sets, { intersperseAccessories: true, startedAt: 1000 });
      // squat (primary) → leg-curl (accessory) next
      const r1 = applySessionEvent(s0, { type: 'completeSet', at: 10_000 }, ctx);
      // leg-curl done while the squat rest is still running → Done locked, timer untouched
      const r2 = applySessionEvent(r1.state, { type: 'completeSet', at: 20_000 }, ctx);
      // another accessory done after the rest already ended → nothing to lock
      const r3 = applySessionEvent(
        { ...r1.state, timer: null, restLocksDone: false },
        { type: 'completeSet', at: 20_000 },
        ctx,
      );
      return {
        r1: { restStarted: r1.restStarted, timer: r1.state.timer, locks: r1.state.restLocksDone },
        r2: { restStarted: r2.restStarted, timer: r2.state.timer, locks: r2.state.restLocksDone },
        r3: { restStarted: r3.restStarted, timer: r3.state.timer, locks: r3.state.restLocksDone },
      };
    });
    expect(result.r1).toEqual({ restStarted: true, timer: { expectedEndTime: 70_000, durationMs: 60_000 }, locks: false });
    expect(result.r2).toEqual({ restStarted: false, timer: { expectedEndTime: 70_000, durationMs: 60_000 }, locks: true });
    expect(result.r3).toEqual({ restStarted: false, timer: null, locks: false });
  });

  test('skipRest and restExpired clear the timer and unlock Done', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const ctx = createSessionContext(sets, new Map([['squat', 225]]), { restTimerSeconds: 90, intersperseAccessories: false });
      const s1 = applySessionEvent(createSession(sets, { intersperseAccessories: false, startedAt: 0 }), { type: 'completeSet', at: 1000 }, ctx).state;
      const skipped = applySessionEvent(s1, { type: 'skipRest' }, ctx).state;
      const expired = applySessionEvent(s1, { type: 'restExpired' }, ctx).state;
      return {
        skipped: { timer: skipped.timer, locks: skipped.restLocksDone, index: skipped.currentSetIndex },
        expired: { timer: expired.timer, locks: expired.restLocksDone, index: expired.currentSetIndex },
      };
    });
    expect(result.skipped).toEqual({ timer: null, locks: false, index: 1 });
    expect(result.expired).toEqual({ timer: null, locks: false, index: 1 });
  });

  test('adjustRest moves the rest end time, and ends rest if moved into the past', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const ctx = createSessionContext(sets, new Map([['squat', 225]]), { restTimerSeconds: 90, intersperseAccessories: false });
      const s0 = createSession(sets, { intersperseAccessories: false, startedAt: 0 });
      const s1 = applySessionEvent(s0, { type: 'completeSet', at: 1000 }, ctx).state; // rest ends at 91_000
      const longer = applySessionEvent(s1, { type: 'adjustRest', at: 5000, deltaSeconds: 30 }, ctx).state;
      const shorter = applySessionEvent(s1, { type: 'adjustRest', at: 5000, deltaSeconds: -30 }, ctx).state;
      const over = applySessionEvent(s1, { type: 'adjustRest', at: 80_000, deltaSeconds: -30 }, ctx).state;
      const noRest = applySessionEvent(s0, { type: 'adjustRest', at: 5000, deltaSeconds: 30 }, ctx).state;
      return {
        longer: longer.timer,
        shorter: shorter.timer,
        over: { timer: over.timer, locks: over.restLocksDone },
        noRest: noRest.timer,
      };
    });
    expect(result.longer).toEqual({ expectedEndTime: 121_000, durationMs: 120_000 });
    expect(result.shorter).toEqual({ expectedEndTime: 61_000, durationMs: 60_000 });
    expect(result.over).toEqual({ timer: null, locks: false });
    expect(result.noRest).toBeNull();
  });

  test('editSet corrects a completed set and drops a pending bonus set the edit makes unnecessary', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const ctx = createSessionContext(sets, new Map([['squat', 225]]), { restTimerSeconds: 90, intersperseAccessories: false });
      let s = createSession(sets, { intersperseAccessories: false, startedAt: 0 });
      for (let i = 0; i < 7; i++) s = applySessionEvent(s, { type: 'completeSet', at: 1000 + i }, ctx).state;
      s = applySessionEvent(s, { type: 'completeSet', at: 9000, reps: 4 }, ctx).state; // bonus owed 6
      const withBonus = s.workoutSets.length;
      s = applySessionEvent(s, { type: 'editSet', index: 7, reps: 10 }, ctx).state;
      return { withBonus, after: s.workoutSets.length, edited: s.completedSets[7].actualReps, index: s.currentSetIndex };
    });
    expect(result).toEqual({ withBonus: 15, after: 14, edited: 10, index: 8 });
  });

  test('detectFailures flags missed main sets and short BBB volume', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent, detectFailures } = await import('/src/logic/workoutSession.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const ctx = createSessionContext(sets, new Map([['squat', 225]]), { restTimerSeconds: 90, intersperseAccessories: false });
      let s = createSession(sets, { intersperseAccessories: false, startedAt: 0 });
      s = applySessionEvent(s, { type: 'completeSet', at: 1, reps: 3 }, ctx).state; // missed main set
      while (s.currentSetIndex < s.workoutSets.length) {
        s = applySessionEvent(s, { type: 'completeSet', at: 2, reps: 0 }, ctx).state;
      }
      return detectFailures(s, ctx.volumeGroups);
    });
    expect(result.mainFailed[0]).toEqual({ exerciseId: 'squat', got: 3, prescribed: 5 });
    expect(result.bbbFailed).toEqual([{ exerciseId: 'squat', got: 0, target: 50 }]);
  });

  test('buildWorkoutLog stamps completion with the event time', async ({ page }) => {
    const log = await page.evaluate(async () => {
      const { createSession, buildWorkoutLog } = await import('/src/logic/workoutSession.ts');
      const s = createSession(
        [{ exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false }],
        { intersperseAccessories: false, startedAt: 1000 },
      );
      return buildWorkoutLog(s, { templateId: 't', cycle: 2, weekIndex: 1, dayIndex: 3 }, 'OHP Day', 5000);
    });
    expect(log).toEqual({
      id: 'workout-5000',
      templateId: 't',
      cycle: 2,
      weekIndex: 1,
      dayIndex: 3,
      dayName: 'OHP Day',
      sets: [],
      startedAt: 1000,
      completedAt: 5000,
    });
  });
});
