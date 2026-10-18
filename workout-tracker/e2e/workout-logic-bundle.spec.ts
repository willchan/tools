import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { build } from 'vite';
import { answerWatchEvents, encodeWatchShadow, setIdFor } from '../src/logic/watchProtocol';
import { createSession, createSessionContext } from '../src/logic/workoutSession';
import { getDefault531Template, getDefaultExercises } from '../src/db/defaults';

/**
 * The workout reducer as one plain script, for the iOS app to run in
 * JavaScriptCore when a watch tap arrives while the WebView is suspended
 * (docs/adr/0002-apple-watch-remote.md, "Background taps"). JavaScriptCore
 * has no DOM, no `window` and no module loader, so the bundle is built and
 * run here the same way: an IIFE evaluated in an empty context.
 */

let source = '';

test.beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'workout-logic-'));
  try {
    await build({ configFile: 'vite.logic.config.ts', logLevel: 'silent', build: { outDir } });
    source = readFileSync(join(outDir, 'workout-logic.js'), 'utf8');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

type Logic = { answer(shadowJSON: string, eventsJSON: string, seq: number, now: number): string };

function load(): Logic {
  const context = createContext({});
  runInContext(source, context);
  return runInContext('WorkoutLogic', context) as Logic;
}

function squatDay() {
  const sets = getDefault531Template().weeks[0].days[0].sets;
  const ctx = createSessionContext(sets, new Map([['squat', 225]]), { restTimerSeconds: 120, intersperseAccessories: false });
  const session = createSession(sets, { intersperseAccessories: false, startedAt: 1000 });
  return { session, ctx, dayName: 'Squat Day', exercises: getDefaultExercises() };
}

test.describe('workout logic bundle', () => {
  test('is unminified so crash reports stay readable', () => {
    expect(source).toContain('function checkWatchEvent(');
    expect(source).toContain('function applySessionEvent(');
  });

  test('runs with no DOM and answers taps exactly like the TypeScript it was built from', () => {
    const shadow = encodeWatchShadow(squatDay());
    const events = [
      { v: 1, id: 'tap-1', at: 40_000, type: 'completeSet' as const, setId: setIdFor(squatDay().session), reps: 5 },
    ];
    const answered = JSON.parse(load().answer(JSON.stringify(shadow), JSON.stringify(events), 77, 50_000));

    expect(answered).toEqual(answerWatchEvents(shadow, events, 77, 50_000));
    expect(answered.verdicts).toEqual(['apply']);
    expect(answered.snapshot.workout.setNumber).toBe(2);
  });

  test('keeps no state between calls', () => {
    const logic = load();
    const shadow = JSON.stringify(encodeWatchShadow(squatDay()));
    const events = JSON.stringify([{ v: 1, id: 'a', at: 10, type: 'completeSet', setId: setIdFor(squatDay().session) }]);
    expect(logic.answer(shadow, events, 1, 20)).toBe(logic.answer(shadow, events, 1, 20));
  });
});
