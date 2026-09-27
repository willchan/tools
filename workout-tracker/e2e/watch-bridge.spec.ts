import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Wiring tests for the Apple Watch remote (src/native/watch.ts and its call
 * sites in src/ui/workout.ts), driven through our own WatchBridge Capacitor
 * plugin's web implementation (src/native/watchBridgeWeb.ts). That
 * implementation stands in for the native side: it records every snapshot
 * pushed to the watch, keeps a pending-event queue that only an ack drains
 * (like the native disk queue), and has a test-only emit() that plays a tap
 * arriving from the watch. See docs/adr/0002-apple-watch-remote.md.
 *
 * As in native-platform.spec.ts, window.CapacitorCustomPlatform forces
 * Capacitor.isNativePlatform() so the native code paths run.
 */

interface Snapshot {
  seq: number;
  status: 'idle' | 'active';
  workout: null | {
    setId: string;
    setNumber: number;
    setTotal: number;
    allSetsDone: boolean;
    restEndTime: number | null;
    restAfterSetSeconds: number | null;
  };
}

interface Recorded {
  snapshots: Snapshot[];
  acks: string[];
  pending: { id: string }[];
  startWatchAppCalls: number;
}

async function forceNative(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'ios' };
  });
}

async function recorded(page: Page): Promise<Recorded> {
  return page.evaluate(async () => {
    const { WatchBridge } = await import('/src/native/watchBridge.ts');
    return (WatchBridge as unknown as { getRecorded(): Promise<Recorded> }).getRecorded();
  });
}

async function emit(page: Page, event: Record<string, unknown>, deliver = true) {
  await page.evaluate(
    async ([e, d]) => {
      const { WatchBridge } = await import('/src/native/watchBridge.ts');
      await (WatchBridge as unknown as { emit(o: unknown): Promise<void> }).emit({ event: e, deliver: d });
    },
    [event, deliver] as const,
  );
}

async function latestSnapshot(page: Page, minSeq = 0): Promise<Snapshot> {
  let snap: Snapshot | undefined;
  await expect
    .poll(async () => {
      const r = await recorded(page);
      snap = r.snapshots.at(-1);
      return snap && snap.seq > minSeq ? snap.status : 'none';
    })
    .not.toBe('none');
  return snap!;
}

async function activeWorkout(page: Page) {
  return page.evaluate(async () => {
    const { getActiveWorkout } = await import('/src/db/database.ts');
    return getActiveWorkout();
  });
}

async function timerState(page: Page) {
  return page.evaluate(async () => {
    const { getTimerState } = await import('/src/db/database.ts');
    return getTimerState();
  });
}

async function startWorkout(page: Page) {
  await page.goto('/');
  await page.waitForSelector('#start-workout-btn');
  await page.click('#start-workout-btn');
  await page.waitForSelector('.workout-screen');
}

test.describe('Apple Watch bridge — web (non-native)', () => {
  test('the PWA pushes nothing to the watch', async ({ page }) => {
    await startWorkout(page);
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('[data-testid="set-1"]')).toHaveClass(/current/);
    const r = await recorded(page);
    expect(r.snapshots).toEqual([]);
    expect(r.startWatchAppCalls).toBe(0);
  });
});

test.describe('Apple Watch bridge — native', () => {
  test.beforeEach(async ({ page }) => {
    await forceNative(page);
  });

  test('starting a workout on the phone starts the watch app and pushes an active snapshot', async ({ page }) => {
    await startWorkout(page);
    const snap = await latestSnapshot(page);
    expect(snap.status).toBe('active');
    expect(snap.workout).toMatchObject({ setNumber: 1, setTotal: 14, allSetsDone: false, restEndTime: null });
    expect((await recorded(page)).startWatchAppCalls).toBe(1);
  });

  test('a phone tap pushes a fresh snapshot with a higher seq', async ({ page }) => {
    await startWorkout(page);
    const first = await latestSnapshot(page);
    await page.click('[data-testid="done-set-btn"]');
    const next = await latestSnapshot(page, first.seq);
    expect(next.workout?.setNumber).toBe(2);
    expect(next.workout?.restEndTime).not.toBeNull();
  });

  test('a watch completeSet is applied at the tap time, committed, acked, and echoed back', async ({ page }) => {
    await startWorkout(page);
    const snap = await latestSnapshot(page);
    const at = Date.now() - 2000;
    await emit(page, { v: 1, id: 'tap-1', at, type: 'completeSet', setId: snap.workout!.setId, reps: 4 });

    await expect(page.locator('[data-testid="set-1"]')).toHaveClass(/current/);
    await expect(page.locator('#rest-timer')).toBeVisible();
    await expect(page.locator('[data-testid="done-set-btn"]')).toBeDisabled();

    const aw = await activeWorkout(page);
    expect(aw?.completedSets).toHaveLength(1);
    expect(aw?.completedSets[0]).toMatchObject({ actualReps: 4, prescribedReps: 5, timestamp: at });
    expect(aw?.appliedEventIds).toEqual(['tap-1']);
    expect(await timerState(page)).toEqual({ expectedEndTime: at + 90_000, durationMs: 90_000 });

    await expect.poll(async () => (await recorded(page)).acks).toEqual(['tap-1']);
    expect((await recorded(page)).pending).toEqual([]);
    const after = await latestSnapshot(page, snap.seq);
    expect(after.workout).toMatchObject({ setNumber: 2, restEndTime: at + 90_000 });
  });

  test('a redelivered tap is applied only once', async ({ page }) => {
    await startWorkout(page);
    const snap = await latestSnapshot(page);
    const tap = { v: 1, id: 'tap-dup', at: Date.now(), type: 'completeSet', setId: snap.workout!.setId };
    await emit(page, tap);
    await expect.poll(async () => (await recorded(page)).acks).toEqual(['tap-dup']);
    await emit(page, tap);
    await expect.poll(async () => (await recorded(page)).acks).toEqual(['tap-dup', 'tap-dup']);

    const aw = await activeWorkout(page);
    expect(aw?.completedSets).toHaveLength(1);
    await expect(page.locator('[data-testid="set-1"]')).toHaveClass(/current/);
  });

  test('a tap for a set the phone already moved past is rejected, acked, and answered with a fresh snapshot', async ({
    page,
  }) => {
    await startWorkout(page);
    const before = await latestSnapshot(page);
    await page.click('[data-testid="done-set-btn"]');
    const afterPhoneTap = await latestSnapshot(page, before.seq);

    await emit(page, { v: 1, id: 'late', at: Date.now(), type: 'completeSet', setId: before.workout!.setId });
    await expect.poll(async () => (await recorded(page)).acks).toEqual(['late']);

    expect((await activeWorkout(page))?.completedSets).toHaveLength(1);
    const answer = await latestSnapshot(page, afterPhoneTap.seq);
    expect(answer.workout?.setId).toBe(afterPhoneTap.workout?.setId);

    const logs = await page.evaluate(async () => {
      const { getAllLogs } = await import('/src/logic/logger.ts');
      return getAllLogs();
    });
    expect(logs.some((l) => l.message === 'watch event' && l.context?.includes('outcome=stale'))).toBe(true);
  });

  test('each applied tap logs native-received vs JS-applied times', async ({ page }) => {
    await startWorkout(page);
    const snap = await latestSnapshot(page);
    await emit(page, { v: 1, id: 'tap-lat', at: Date.now() - 500, type: 'completeSet', setId: snap.workout!.setId });
    await expect.poll(async () => (await recorded(page)).acks).toEqual(['tap-lat']);

    const entry = await page.evaluate(async () => {
      const { getAllLogs } = await import('/src/logic/logger.ts');
      return (await getAllLogs()).find((l) => l.message === 'watch event');
    });
    expect(entry?.context).toMatch(/type=completeSet id=tap-lat outcome=applied/);
    expect(entry?.context).toMatch(/tapAt=\d+ nativeReceivedAt=\d+ jsAppliedAt=\d+ queueMs=\d+ tapToApplyMs=\d+/);
  });

  test('skipRest from the watch ends the rest on the phone', async ({ page }) => {
    await startWorkout(page);
    const first = await latestSnapshot(page);
    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();
    const resting = await latestSnapshot(page, first.seq);

    await emit(page, { v: 1, id: 'skip-1', at: Date.now(), type: 'skipRest', setId: resting.workout!.setId });

    await expect(page.locator('#rest-timer')).toBeHidden();
    await expect(page.locator('[data-testid="done-set-btn"]')).toBeEnabled();
    expect(await timerState(page)).toBeNull();
    expect((await activeWorkout(page))?.appliedEventIds).toEqual(['skip-1']);
  });

  test('adjustRest from the watch moves the phone rest end time', async ({ page }) => {
    await startWorkout(page);
    const first = await latestSnapshot(page);
    await page.click('[data-testid="done-set-btn"]');
    const resting = await latestSnapshot(page, first.seq);
    const endBefore = resting.workout!.restEndTime!;

    await emit(page, { v: 1, id: 'adj-1', at: Date.now(), type: 'adjustRest', setId: resting.workout!.setId, deltaSeconds: 30 });
    await expect.poll(async () => (await timerState(page))?.expectedEndTime).toBe(endBefore + 30_000);
    const after = await latestSnapshot(page, resting.seq);
    expect(after.workout?.restEndTime).toBe(endBefore + 30_000);
  });

  test('finish from the watch completes the workout and the watch goes idle', async ({ page }) => {
    await startWorkout(page);
    let snap = await latestSnapshot(page);
    // Every set from the watch, each tapped against the snapshot it last saw.
    for (let i = 0; i < 14; i++) {
      await emit(page, { v: 1, id: `set-${i}`, at: Date.now(), type: 'completeSet', setId: snap.workout!.setId });
      snap = await latestSnapshot(page, snap.seq);
    }
    expect(snap.workout?.allSetsDone).toBe(true);
    const finishAt = Date.now() - 1000;
    await emit(page, { v: 1, id: 'fin', at: finishAt, type: 'finish', setId: snap.workout!.setId });

    await page.waitForSelector('#start-workout-btn');
    const history = await page.evaluate(async () => {
      const { getAllHistory } = await import('/src/db/database.ts');
      return getAllHistory();
    });
    expect(history).toHaveLength(1);
    expect(history[0].completedAt).toBe(finishAt);
    expect(history[0].sets).toHaveLength(14);
    expect(await activeWorkout(page)).toBeNull();
    const idle = await latestSnapshot(page, snap.seq);
    expect(idle.status).toBe('idle');
    await expect.poll(async () => (await recorded(page)).acks.at(-1)).toBe('fin');

    // A redelivered finish after the workout is gone is harmless.
    await emit(page, { v: 1, id: 'fin', at: finishAt, type: 'finish', setId: snap.workout!.setId });
    await expect.poll(async () => (await recorded(page)).acks.filter((a) => a === 'fin')).toHaveLength(2);
    expect(
      await page.evaluate(async () => {
        const { getAllHistory } = await import('/src/db/database.ts');
        return (await getAllHistory()).length;
      }),
    ).toBe(1);
  });

  test('starting from the watch opens the workout on the phone without relaunching the watch app', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await emit(page, { v: 1, id: 'start-1', at: Date.now(), type: 'start' });

    await page.waitForSelector('.workout-screen');
    const snap = await latestSnapshot(page);
    expect(snap.status).toBe('active');
    const r = await recorded(page);
    expect(r.startWatchAppCalls).toBe(0);
    expect(r.acks).toContain('start-1');
  });

  test('a watch tap while the phone is on another screen resumes the workout there', async ({ page }) => {
    await startWorkout(page);
    const first = await latestSnapshot(page);
    await page.click('[data-testid="done-set-btn"]');
    const second = await latestSnapshot(page, first.seq);
    await page.click('#skip-timer-btn');
    await page.click('#back-btn');
    await page.waitForSelector('#start-workout-btn');

    await emit(page, { v: 1, id: 'from-home', at: Date.now(), type: 'completeSet', setId: second.workout!.setId });

    await page.waitForSelector('.workout-screen');
    await expect(page.locator('[data-testid="set-2"]')).toHaveClass(/current/);
    expect((await activeWorkout(page))?.completedSets).toHaveLength(2);
    // Only the phone's own start launched the watch app, not this resume.
    expect((await recorded(page)).startWatchAppCalls).toBe(1);
  });

  test('starting from the watch while the phone shows the last workout\'s missed-reps sheet opens the next one', async ({
    page,
  }) => {
    await startWorkout(page);
    let snap = await latestSnapshot(page);
    for (let i = 0; i < 14; i++) {
      const reps = i === 0 ? 3 : undefined; // miss a main set → failure sheet
      await emit(page, { v: 1, id: `set-${i}`, at: Date.now(), type: 'completeSet', setId: snap.workout!.setId, reps });
      snap = await latestSnapshot(page, snap.seq);
    }
    await emit(page, { v: 1, id: 'fin', at: Date.now(), type: 'finish', setId: snap.workout!.setId });
    await expect(page.locator('#failure-sheet')).toBeVisible();
    const idle = await latestSnapshot(page, snap.seq);
    expect(idle.status).toBe('idle');

    await emit(page, { v: 1, id: 'start-next', at: Date.now(), type: 'start' });

    await expect(page.locator('.app-header h1')).toHaveText('Bench Day');
    await expect(page.locator('#failure-sheet')).toHaveCount(0);
    const next = await latestSnapshot(page, idle.seq);
    expect(next.status).toBe('active');
    expect((next.workout as unknown as { dayName: string }).dayName).toBe('Bench Day');
  });

  test('a watch tap with no workout in progress is acked and answered with an idle snapshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await emit(page, { v: 1, id: 'orphan', at: Date.now(), type: 'completeSet', setId: '1/0/x' });

    await expect.poll(async () => (await recorded(page)).acks).toEqual(['orphan']);
    const snap = await latestSnapshot(page);
    expect(snap.status).toBe('idle');
    await expect(page.locator('#start-workout-btn')).toBeVisible();
    expect(await activeWorkout(page)).toBeNull();
  });

  test('taps queued natively while JS was suspended are drained when the page becomes visible', async ({ page }) => {
    await startWorkout(page);
    const snap = await latestSnapshot(page);
    // Queued on the native side only; no listener delivery (JS suspended).
    await emit(page, { v: 1, id: 'queued', at: Date.now(), type: 'completeSet', setId: snap.workout!.setId }, false);
    expect((await recorded(page)).pending.map((e) => e.id)).toEqual(['queued']);
    expect(await activeWorkout(page)).toBeNull();

    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    await expect(page.locator('[data-testid="set-1"]')).toHaveClass(/current/);
    await expect.poll(async () => (await recorded(page)).pending).toEqual([]);
    expect((await activeWorkout(page))?.appliedEventIds).toEqual(['queued']);
  });

  test('a phone tap and a watch tap on the same set complete it only once', async ({ page }) => {
    await startWorkout(page);
    const snap = await latestSnapshot(page);
    // Deliver the watch tap and click Done in the same task, before either
    // has re-rendered the screen: whichever commits second is for a set
    // that's already done and must be dropped.
    await page.evaluate(
      async ([setId]) => {
        const { WatchBridge } = await import('/src/native/watchBridge.ts');
        const done = document.querySelector('[data-testid="done-set-btn"]') as HTMLButtonElement;
        await (WatchBridge as unknown as { emit(o: unknown): Promise<void> }).emit({
          event: { v: 1, id: 'race', at: Date.now(), type: 'completeSet', setId },
          deliver: true,
        });
        done.click();
      },
      [snap.workout!.setId] as const,
    );
    await expect(page.locator('[data-testid="set-1"]')).toHaveClass(/current/);
    await expect.poll(async () => (await recorded(page)).acks).toEqual(['race']);
    // Give a wrongly-applied second completion time to land.
    await page.waitForTimeout(300);
    expect((await activeWorkout(page))?.completedSets).toHaveLength(1);
  });
});

test.describe('Apple Watch bridge — parity', () => {
  test('a watch completeSet leaves IndexedDB identical to the same phone tap', async ({ browser }) => {
    const fixedNow = new Date('2026-09-27T10:00:00Z');

    async function run(viaWatch: boolean) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await forceNative(page);
      await page.clock.setFixedTime(fixedNow);
      await startWorkout(page);
      const snap = await latestSnapshot(page);
      if (viaWatch) {
        await emit(page, { v: 1, id: 'parity', at: fixedNow.getTime(), type: 'completeSet', setId: snap.workout!.setId });
        await expect.poll(async () => (await recorded(page)).acks).toEqual(['parity']);
      } else {
        await page.click('[data-testid="done-set-btn"]');
      }
      await expect(page.locator('[data-testid="set-1"]')).toHaveClass(/current/);
      const dump = await page.evaluate(async () => {
        const { getDB } = await import('/src/db/database.ts');
        const db = await getDB();
        const read = async (store: string) => {
          const keys = await db.getAllKeys(store);
          const values = await db.getAll(store);
          return keys.map((k, i) => [k, values[i]]);
        };
        return {
          state: await read('state'),
          timer: await read('timer'),
          history: await read('history'),
          trainingMaxes: await read('trainingMaxes'),
        };
      });
      await context.close();
      return dump;
    }

    const ui = await run(false);
    const watch = await run(true);

    const strip = (dump: typeof ui) => ({
      ...dump,
      state: dump.state.map(([k, v]) => {
        if (k !== 'activeWorkout') return [k, v];
        const { appliedEventIds, ...rest } = v as { appliedEventIds?: string[] };
        void appliedEventIds;
        return [k, rest];
      }),
    });
    const watchAw = watch.state.find(([k]) => k === 'activeWorkout')?.[1] as { appliedEventIds?: string[] };
    expect(watchAw.appliedEventIds).toEqual(['parity']);
    expect(strip(watch)).toEqual(strip(ui));
  });
});
