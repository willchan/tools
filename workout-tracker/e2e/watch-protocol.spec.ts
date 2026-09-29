import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Unit coverage for src/logic/watchProtocol.ts: the pure rules that decide
 * whether an Apple Watch tap event gets applied, and the display-ready
 * snapshot pushed back to the watch. See docs/adr/0002-apple-watch-remote.md.
 */

test.describe('watch protocol', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('setIdFor identifies the current set by workout, position and prescription', async ({ page }) => {
    const ids = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { setIdFor } = await import('/src/logic/watchProtocol.ts');
      const sets = [
        { exerciseId: 'squat', tmPercentage: 0.5, tmLiftId: 'squat', reps: 10, isAmrap: false },
        { exerciseId: 'squat', tmPercentage: 0.5, tmLiftId: 'squat', reps: 10, isAmrap: false },
      ];
      const ctx = createSessionContext(sets, new Map([['squat', 200]]), { restTimerSeconds: 90, intersperseAccessories: false });
      const s0 = createSession(sets, { intersperseAccessories: false, startedAt: 1000 });
      const otherWorkout = createSession(sets, { intersperseAccessories: false, startedAt: 2000 });
      const s1 = applySessionEvent(s0, { type: 'completeSet', at: 5, reps: 4 }, ctx).state;
      // Missing reps on the last set of the group splices in a bonus set
      // at the same index the next set would have had.
      const s2 = applySessionEvent(s1, { type: 'completeSet', at: 6, reps: 10 }, ctx).state;
      return {
        s0: setIdFor(s0),
        s0Again: setIdFor(createSession(sets, { intersperseAccessories: false, startedAt: 1000 })),
        other: setIdFor(otherWorkout),
        s1: setIdFor(s1),
        s2: setIdFor(s2),
        s2Index: s2.currentSetIndex,
        s2Bonus: s2.workoutSets[s2.currentSetIndex]?.isBonus,
      };
    });
    expect(ids.s0).toBe(ids.s0Again);
    expect(ids.other).not.toBe(ids.s0);
    expect(ids.s1).not.toBe(ids.s0);
    expect(ids.s2Index).toBe(2);
    expect(ids.s2Bonus).toBe(true);
    expect(ids.s2).not.toBe(ids.s1);
    expect(ids.s2).toContain('bonus');
  });

  test('setIdFor marks the end of the workout once every set is done', async ({ page }) => {
    const id = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { setIdFor } = await import('/src/logic/watchProtocol.ts');
      const sets = [{ exerciseId: 'pullup', tmPercentage: null, tmLiftId: null, reps: 10, isAmrap: false }];
      const ctx = createSessionContext(sets, new Map(), { restTimerSeconds: 90, intersperseAccessories: false });
      const s = applySessionEvent(createSession(sets, { intersperseAccessories: false, startedAt: 7 }), { type: 'completeSet', at: 8 }, ctx).state;
      return setIdFor(s);
    });
    expect(id).toBe('7/1/end');
  });

  test('checkWatchEvent applies a completeSet for the current set, at the tap time', async ({ page }) => {
    const verdict = await page.evaluate(async () => {
      const { createSession } = await import('/src/logic/workoutSession.ts');
      const { setIdFor, checkWatchEvent } = await import('/src/logic/watchProtocol.ts');
      const s = createSession(
        [{ exerciseId: 'squat', tmPercentage: 0.65, tmLiftId: 'squat', reps: 5, isAmrap: false }],
        { intersperseAccessories: false, startedAt: 1000 },
      );
      return checkWatchEvent(s, { v: 1, id: 'a', at: 3000, type: 'completeSet', setId: setIdFor(s), reps: 4 }, 9000);
    });
    expect(verdict).toEqual({ kind: 'apply', event: { type: 'completeSet', at: 3000, reps: 4 } });
  });

  test('checkWatchEvent clamps a tap time from a watch clock running ahead of the phone', async ({ page }) => {
    const verdict = await page.evaluate(async () => {
      const { createSession } = await import('/src/logic/workoutSession.ts');
      const { setIdFor, checkWatchEvent } = await import('/src/logic/watchProtocol.ts');
      const s = createSession(
        [{ exerciseId: 'squat', tmPercentage: 0.65, tmLiftId: 'squat', reps: 5, isAmrap: false }],
        { intersperseAccessories: false, startedAt: 1000 },
      );
      return checkWatchEvent(s, { v: 1, id: 'a', at: 12_000, type: 'completeSet', setId: setIdFor(s) }, 9000);
    });
    expect(verdict).toEqual({ kind: 'apply', event: { type: 'completeSet', at: 9000 } });
  });

  test('checkWatchEvent reports an already-applied id as a duplicate', async ({ page }) => {
    const verdict = await page.evaluate(async () => {
      const { createSession } = await import('/src/logic/workoutSession.ts');
      const { setIdFor, checkWatchEvent, recordAppliedEventId } = await import('/src/logic/watchProtocol.ts');
      const s0 = createSession(
        [{ exerciseId: 'squat', tmPercentage: 0.65, tmLiftId: 'squat', reps: 5, isAmrap: false }],
        { intersperseAccessories: false, startedAt: 1000 },
      );
      const s = recordAppliedEventId(s0, 'a');
      return checkWatchEvent(s, { v: 1, id: 'a', at: 3000, type: 'completeSet', setId: setIdFor(s) }, 9000);
    });
    expect(verdict).toEqual({ kind: 'duplicate' });
  });

  test('checkWatchEvent rejects a tap for a set the phone has moved past', async ({ page }) => {
    const verdicts = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { setIdFor, checkWatchEvent } = await import('/src/logic/watchProtocol.ts');
      const sets = [
        { exerciseId: 'squat', tmPercentage: 0.65, tmLiftId: 'squat', reps: 5, isAmrap: false },
        { exerciseId: 'squat', tmPercentage: 0.75, tmLiftId: 'squat', reps: 5, isAmrap: false },
      ];
      const ctx = createSessionContext(sets, new Map([['squat', 200]]), { restTimerSeconds: 90, intersperseAccessories: false });
      const s0 = createSession(sets, { intersperseAccessories: false, startedAt: 1000 });
      const oldSetId = setIdFor(s0);
      const s1 = applySessionEvent(s0, { type: 'completeSet', at: 2000 }, ctx).state;
      return {
        complete: checkWatchEvent(s1, { v: 1, id: 'b', at: 2500, type: 'completeSet', setId: oldSetId }, 9000),
        skip: checkWatchEvent(s1, { v: 1, id: 'c', at: 2500, type: 'skipRest', setId: oldSetId }, 9000),
        finish: checkWatchEvent(s1, { v: 1, id: 'd', at: 2500, type: 'finish', setId: setIdFor(s1) }, 9000),
      };
    });
    expect(verdicts.complete.kind).toBe('stale');
    expect(verdicts.skip.kind).toBe('stale');
    // Finishing is only allowed once the phone agrees every set is done.
    expect(verdicts.finish.kind).toBe('stale');
  });

  test('checkWatchEvent maps rest and finish taps', async ({ page }) => {
    const verdicts = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { setIdFor, checkWatchEvent } = await import('/src/logic/watchProtocol.ts');
      const sets = [
        { exerciseId: 'squat', tmPercentage: 0.65, tmLiftId: 'squat', reps: 5, isAmrap: false },
        { exerciseId: 'squat', tmPercentage: 0.75, tmLiftId: 'squat', reps: 5, isAmrap: false },
      ];
      const ctx = createSessionContext(sets, new Map([['squat', 200]]), { restTimerSeconds: 90, intersperseAccessories: false });
      const s1 = applySessionEvent(createSession(sets, { intersperseAccessories: false, startedAt: 1 }), { type: 'completeSet', at: 2 }, ctx).state;
      const s2 = applySessionEvent(s1, { type: 'completeSet', at: 3 }, ctx).state;
      return {
        skip: checkWatchEvent(s1, { v: 1, id: 'a', at: 5, type: 'skipRest', setId: setIdFor(s1) }, 9),
        adjust: checkWatchEvent(s1, { v: 1, id: 'b', at: 5, type: 'adjustRest', setId: setIdFor(s1), deltaSeconds: 30 }, 9),
        finish: checkWatchEvent(s2, { v: 1, id: 'c', at: 6, type: 'finish', setId: setIdFor(s2) }, 9),
      };
    });
    expect(verdicts.skip).toEqual({ kind: 'apply', event: { type: 'skipRest' } });
    expect(verdicts.adjust).toEqual({ kind: 'apply', event: { type: 'adjustRest', at: 5, deltaSeconds: 30 } });
    expect(verdicts.finish).toEqual({ kind: 'finish', at: 6 });
  });

  test('checkWatchEvent rejects malformed events', async ({ page }) => {
    const kinds = await page.evaluate(async () => {
      const { createSession } = await import('/src/logic/workoutSession.ts');
      const { setIdFor, checkWatchEvent } = await import('/src/logic/watchProtocol.ts');
      const s = createSession(
        [{ exerciseId: 'squat', tmPercentage: 0.65, tmLiftId: 'squat', reps: 5, isAmrap: false }],
        { intersperseAccessories: false, startedAt: 1000 },
      );
      const setId = setIdFor(s);
      const check = (e: Record<string, unknown>) =>
        checkWatchEvent(s, { v: 1, id: 'x', at: 2000, setId, ...e } as never, 9000).kind;
      return {
        futureVersion: check({ v: 2, type: 'completeSet' }),
        tooManyReps: check({ type: 'completeSet', reps: 6 }),
        negativeReps: check({ type: 'completeSet', reps: -1 }),
        fractionalReps: check({ type: 'completeSet', reps: 2.5 }),
        noDelta: check({ type: 'adjustRest' }),
        unknownType: check({ type: 'dance' }),
      };
    });
    expect(kinds).toEqual({
      futureVersion: 'invalid',
      tooManyReps: 'invalid',
      negativeReps: 'invalid',
      fractionalReps: 'invalid',
      noDelta: 'invalid',
      unknownType: 'invalid',
    });
  });

  test('recordAppliedEventId keeps a bounded, most-recent list', async ({ page }) => {
    const ids = await page.evaluate(async () => {
      const { createSession } = await import('/src/logic/workoutSession.ts');
      const { recordAppliedEventId, MAX_APPLIED_EVENT_IDS } = await import('/src/logic/watchProtocol.ts');
      let s = createSession([], { intersperseAccessories: false, startedAt: 0 });
      for (let i = 0; i < MAX_APPLIED_EVENT_IDS + 5; i++) s = recordAppliedEventId(s, `e${i}`);
      return { length: s.appliedEventIds.length, max: MAX_APPLIED_EVENT_IDS, first: s.appliedEventIds[0], last: s.appliedEventIds.at(-1) };
    });
    expect(ids.length).toBe(ids.max);
    expect(ids.first).toBe('e5');
    expect(ids.last).toBe(`e${ids.max + 4}`);
  });

  test('buildWatchSnapshot is display-ready and says how long to rest after this set', async ({ page }) => {
    const snaps = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { buildWatchSnapshot, setIdFor } = await import('/src/logic/watchProtocol.ts');
      const { getDefault531Template, getDefaultExercises } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const exercises = getDefaultExercises();
      const settings = { restTimerSeconds: 120, intersperseAccessories: true };
      const ctx = createSessionContext(sets, new Map([['squat', 225]]), settings);
      const s0 = createSession(sets, { intersperseAccessories: true, startedAt: 1000 });
      const s1 = applySessionEvent(s0, { type: 'completeSet', at: 5000 }, ctx).state; // leg-curl next, during rest
      return {
        first: buildWatchSnapshot(7, { session: s0, ctx, dayName: 'Squat Day', exercises }),
        second: buildWatchSnapshot(8, { session: s1, ctx, dayName: 'Squat Day', exercises }),
        idle: buildWatchSnapshot(9, null),
        setId0: setIdFor(s0),
      };
    });
    expect(snaps.first).toEqual({
      v: 1,
      seq: 7,
      status: 'active',
      workout: {
        dayName: 'Squat Day',
        setId: snaps.setId0,
        setNumber: 1,
        setTotal: 14,
        allSetsDone: false,
        exerciseName: 'Barbell Squat',
        weightLabel: '145 lbs',
        plateLabel: '45 + 5 per side',
        reps: 5,
        maxReps: 5,
        isAmrap: false,
        isBonus: false,
        restEndTime: null,
        restLocksDone: false,
        restAfterSetSeconds: 120,
      },
    });
    // An accessory done during a primary set's rest starts no rest of its own.
    expect(snaps.second.workout).toMatchObject({
      setNumber: 2,
      exerciseName: 'Leg Curl',
      weightLabel: 'BW / Custom',
      plateLabel: null,
      reps: 10,
      restEndTime: 125_000,
      restLocksDone: false,
      restAfterSetSeconds: null,
    });
    expect(snaps.idle).toEqual({ v: 1, seq: 9, status: 'idle', workout: null });
  });
});

/**
 * The Swift side mirrors WatchEvent and WatchSnapshot as Codable types in
 * ios/App/AppLogic, and its XCTests round-trip these JSON fixtures. This
 * checks the same files against the TS, so a field renamed, made optional or
 * given a new value on either side fails one suite or the other. Regenerate a
 * snapshot fixture from the `actual` value printed on failure.
 */
test.describe('watch protocol — Swift fixtures', () => {
  const fixtureDir = fileURLToPath(new URL('../ios/App/AppLogic/Tests/AppLogicTests/Fixtures/', import.meta.url));
  const fixture = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(`${fixtureDir}${name}`, 'utf8')) as Record<string, unknown>;

  const EVENT_KEYS = ['v', 'id', 'at', 'type', 'setId', 'reps', 'deltaSeconds'];
  const EVENT_FIXTURES = [
    'event-start.json',
    'event-complete-set.json',
    'event-complete-set-default-reps.json',
    'event-skip-rest.json',
    'event-adjust-rest.json',
    'event-finish.json',
  ];

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('snapshot fixtures are exactly what buildWatchSnapshot produces', async ({ page }) => {
    const snaps = await page.evaluate(async () => {
      const { createSession, createSessionContext, applySessionEvent } = await import('/src/logic/workoutSession.ts');
      const { buildWatchSnapshot } = await import('/src/logic/watchProtocol.ts');
      const { getDefault531Template, getDefaultExercises } = await import('/src/db/defaults.ts');
      const sets = getDefault531Template().weeks[0].days[0].sets;
      const exercises = getDefaultExercises();
      const ctx = createSessionContext(sets, new Map([['squat', 225]]), { restTimerSeconds: 120, intersperseAccessories: true });
      const s0 = createSession(sets, { intersperseAccessories: true, startedAt: 1759100000000 });
      const s1 = applySessionEvent(s0, { type: 'completeSet', at: 1759100060000 }, ctx).state;
      return {
        first: buildWatchSnapshot(1759100000001, { session: s0, ctx, dayName: 'Squat Day', exercises }),
        resting: buildWatchSnapshot(1759100060001, { session: s1, ctx, dayName: 'Squat Day', exercises }),
        idle: buildWatchSnapshot(1759100120001, null),
      };
    });
    expect(snaps.first).toEqual(fixture('snapshot-active-first-set.json'));
    expect(snaps.resting).toEqual(fixture('snapshot-active-resting.json'));
    expect(snaps.idle).toEqual(fixture('snapshot-idle.json'));
  });

  test('event fixtures are well-formed WatchEvents the phone accepts', async ({ page }) => {
    const events = EVENT_FIXTURES.map((name) => ({ name, event: fixture(name) }));
    for (const { name, event } of events) {
      for (const key of Object.keys(event)) expect(EVENT_KEYS, `${name}: unexpected key ${key}`).toContain(key);
      expect(event.v, name).toBe(1);
    }
    expect(Object.keys(fixture('event-start.json')).sort()).toEqual(['at', 'id', 'type', 'v']);

    const verdicts = await page.evaluate(async (evs) => {
      const { createSession } = await import('/src/logic/workoutSession.ts');
      const { checkWatchEvent, setIdFor } = await import('/src/logic/watchProtocol.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const s0 = createSession(getDefault531Template().weeks[0].days[0].sets, {
        intersperseAccessories: true,
        startedAt: 1759100000000,
      });
      return {
        setId: setIdFor(s0),
        kinds: evs
          .filter(({ event }) => event.type !== 'start')
          .map(({ name, event }) => ({
            name,
            kind: checkWatchEvent(s0, event as never, 1759200000000).kind,
          })),
      };
    }, events);
    // The fixtures carry the setId of the snapshot fixture's first set, so
    // everything but finish (sets left to do) applies to it.
    expect(fixture('event-complete-set.json').setId).toBe(verdicts.setId);
    expect(verdicts.kinds).toEqual([
      { name: 'event-complete-set.json', kind: 'apply' },
      { name: 'event-complete-set-default-reps.json', kind: 'apply' },
      { name: 'event-skip-rest.json', kind: 'apply' },
      { name: 'event-adjust-rest.json', kind: 'apply' },
      { name: 'event-finish.json', kind: 'stale' },
    ]);
  });

  test('the received-event fixture is a WatchEvent plus receivedAt, as handed to JS', async () => {
    const received = fixture('received-event-complete-set.json');
    const { receivedAt, ...event } = received;
    expect(typeof receivedAt).toBe('number');
    expect(event).toEqual(fixture('event-complete-set.json'));
  });
});
