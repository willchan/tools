import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { build } from 'vite';

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

type Logic = { probe(eventJSON: string, now: number): string };

function load(): Logic {
  const context = createContext({});
  runInContext(source, context);
  return runInContext('WorkoutLogic', context) as Logic;
}

test.describe('workout logic bundle', () => {
  test('is unminified so crash reports stay readable', () => {
    expect(source).toContain('function checkWatchEvent(');
    expect(source).toContain('function applySessionEvent(');
  });

  test('runs with no DOM: the probe applies a tap and answers with the next snapshot', () => {
    const now = 1_792_270_000_000;
    const tap = { v: 1, id: 'tap-1', at: now - 150, type: 'completeSet', setId: 'from-the-watch', reps: 5 };
    const result = JSON.parse(load().probe(JSON.stringify(tap), now));

    expect(result.verdict).toBe('apply');
    expect(result.snapshot.v).toBe(1);
    expect(result.snapshot.seq).toBe(now);
    expect(result.snapshot.status).toBe('active');
    expect(result.snapshot.workout.setNumber).toBe(2);
    expect(result.snapshot.workout.restEndTime).toBeGreaterThan(now - 150);
  });

  test('the same tap gives the same answer: the probe keeps no state between taps', () => {
    const logic = load();
    const tap = JSON.stringify({ v: 1, id: 'tap-1', at: 10, type: 'completeSet', setId: 'x' });
    expect(logic.probe(tap, 20)).toBe(logic.probe(tap, 20));
  });

  test('reports a tap it cannot read instead of throwing', () => {
    const result = JSON.parse(load().probe(JSON.stringify({ v: 99, id: 'old', at: 1, type: 'completeSet' }), 2));
    expect(result.verdict).toBe('invalid');
    expect(result.snapshot.status).toBe('active');
  });
});
