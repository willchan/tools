import { test, expect } from '@playwright/test';

/**
 * Regression coverage for the multi-store atomic write helpers in database.ts.
 *
 * Each of these bundles a logically-single user action (complete a workout,
 * delete a template, save a template, batch-save training maxes) into one
 * IndexedDB transaction, instead of the previous separate-transactions-per-
 * write approach that let a mid-flight interruption (e.g. an iOS PWA getting
 * backgrounded and killed) leave the app with a partial write — the actual
 * incident that motivated this: a completed workout's history entry landed
 * while the progression-state advance and active-workout cleanup didn't.
 *
 * The first test below proves the underlying mechanism these helpers rely
 * on: an aborted IndexedDB transaction rolls back EVERY write already made
 * through it, not just the one that failed. (Note this only holds for
 * request-level failures — e.g. ConstraintError from add() on a duplicate
 * key — not for usage errors like a put() missing its keyPath, which throw
 * synchronously before a request/transaction involvement even exists and so
 * don't abort anything already queued.) The remaining tests then confirm
 * each helper actually bundles its writes into one transaction rather than
 * silently issuing them as several.
 */
test.describe('Atomic multi-store writes', () => {
  test('an aborted IndexedDB transaction rolls back every write made through it', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');

    const result = await page.evaluate(async () => {
      const { getDB, getAllTrainingMaxes } = await import('/src/db/database.ts');
      const db = await getDB();

      let threw = false;
      try {
        const tx = db.transaction('trainingMaxes', 'readwrite');
        // This write would succeed on its own...
        await tx.objectStore('trainingMaxes').put({ exerciseId: 'test-lift-rollback-proof', weight: 111 });
        // ...but add() on a key that already exists (seeded 'bench') is a
        // genuine async ConstraintError, which aborts the whole transaction.
        await tx.objectStore('trainingMaxes').add({ exerciseId: 'bench', weight: 999 });
        await tx.done;
      } catch {
        threw = true;
      }

      const all = await getAllTrainingMaxes();
      return { threw, survived: all.some((tm) => tm.exerciseId === 'test-lift-rollback-proof') };
    });

    expect(result.threw).toBe(true);
    // The first write, though individually valid, was rolled back along with
    // the failing second one — proof the transaction is all-or-nothing.
    expect(result.survived).toBe(false);
  });

  test('completeWorkoutAtomic bundles history, progression, TM bumps, and cleanup in one transaction', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await page.click('[data-testid="done-set-btn"]');

    const result = await page.evaluate(async () => {
      const { getState, getAllHistory, getTimerState, getActiveWorkout, completeWorkoutAtomic } = await import(
        '/src/db/database.ts'
      );

      const before = await getState();
      await completeWorkoutAtomic({
        log: {
          id: 'workout-test-atomic-happy',
          templateId: before!.templateId,
          cycle: before!.cycle,
          weekIndex: before!.weekIndex,
          dayIndex: before!.dayIndex,
          dayName: 'Test Day',
          sets: [],
          startedAt: Date.now(),
          completedAt: Date.now(),
        },
        candidateState: { ...before!, dayIndex: before!.dayIndex + 1 },
        tmBumps: [{ exerciseId: 'bench', weight: 321 }],
      });

      const history = await getAllHistory();
      return {
        historyHasLog: history.some((h) => h.id === 'workout-test-atomic-happy'),
        state: await getState(),
        timerState: await getTimerState(),
        activeWorkout: await getActiveWorkout(),
      };
    });

    expect(result.historyHasLog).toBe(true);
    expect(result.state?.dayIndex).toBe(1);
    expect(result.timerState).toBeNull();
    expect(result.activeWorkout).toBeNull();
  });

  test('completeWorkoutAtomic never regresses progression and suppresses TM bumps when it would', async ({
    page,
  }) => {
    // Regression: finishing a workout that was resumed from a stale
    // activeWorkout conflict computes its "next" position from wherever that
    // stuck workout was — which can be *behind* wherever progression already
    // stood (e.g. the user manually navigated further ahead in the
    // meantime). The persisted position must never move backward as a side
    // effect of finishing an old workout, and a TM bump tied to a cycle
    // rollover that's being discarded must not be applied either — applying
    // it while not persisting the state that "caused" it would silently
    // bump training maxes with no corresponding progression change.
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');

    const result = await page.evaluate(async () => {
      const { getState, putState, getAllTrainingMaxes, completeWorkoutAtomic } = await import(
        '/src/db/database.ts'
      );

      const before = await getState();
      // Progression already advanced ahead of the workout we're about to
      // (belatedly) complete — e.g. via a manual override in another tab.
      await putState({ ...before!, cycle: 2, weekIndex: 0, dayIndex: 0 });
      const tmsBefore = await getAllTrainingMaxes();

      await completeWorkoutAtomic({
        log: {
          id: 'workout-test-no-regress',
          templateId: before!.templateId,
          cycle: before!.cycle,
          weekIndex: before!.weekIndex,
          dayIndex: before!.dayIndex,
          dayName: 'Test Day',
          sets: [],
          startedAt: Date.now(),
          completedAt: Date.now(),
        },
        // Behind the cycle-2 position already persisted above.
        candidateState: { ...before!, cycle: 1, weekIndex: 0, dayIndex: 1 },
        tmBumps: [{ exerciseId: 'bench', weight: 999 }],
      });

      return { state: await getState(), tmsBefore, tmsAfter: await getAllTrainingMaxes() };
    });

    expect(result.state).toMatchObject({ cycle: 2, weekIndex: 0, dayIndex: 0 });
    expect(result.tmsAfter).toEqual(result.tmsBefore);
  });

  test('completeWorkoutAtomic never overwrites a since-switched-to different template', async ({ page }) => {
    // Regression: a workout started under one template, finished belatedly
    // (e.g. resumed from a stale activeWorkout conflict) after the user has
    // since switched their active template entirely, must not revert that
    // switch — there's no meaningful "further along" comparison across two
    // different templates, so the currently active one always wins.
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');

    const result = await page.evaluate(async () => {
      const { getState, putTemplate, saveTemplateAtomic, completeWorkoutAtomic } = await import(
        '/src/db/database.ts'
      );

      const originalState = await getState();
      await putTemplate({ id: 'other-template', name: 'Other', weeks: [], cycleLength: 0 });
      // Switch the active template — a deliberate, more recent choice.
      const switchedState = { templateId: 'other-template', cycle: 1, weekIndex: 0, dayIndex: 0 };
      await saveTemplateAtomic({ id: 'other-template', name: 'Other', weeks: [], cycleLength: 0 }, switchedState);

      await completeWorkoutAtomic({
        log: {
          id: 'workout-test-different-template',
          templateId: originalState!.templateId,
          cycle: originalState!.cycle,
          weekIndex: originalState!.weekIndex,
          dayIndex: originalState!.dayIndex,
          dayName: 'Test Day',
          sets: [],
          startedAt: Date.now(),
          completedAt: Date.now(),
        },
        // Belongs to the OLD template, not the one now active.
        candidateState: { ...originalState!, dayIndex: originalState!.dayIndex + 1 },
      });

      return { state: await getState(), switchedState };
    });

    expect(result.state).toEqual(result.switchedState);
  });

  test('deleteTemplateAtomic deletes the template and repoints active state together', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');

    const result = await page.evaluate(async () => {
      const { getState, getTemplate, putTemplate, deleteTemplateAtomic } = await import('/src/db/database.ts');

      await putTemplate({ id: 'extra-template', name: 'Extra', weeks: [], cycleLength: 0 });
      const before = await getState();

      await deleteTemplateAtomic(before!.templateId);

      const deletedTemplate = await getTemplate(before!.templateId);
      const after = await getState();
      return { deletedTemplate, after, deletedId: before!.templateId };
    });

    expect(result.deletedTemplate).toBeUndefined();
    expect(result.after?.templateId).toBe('extra-template');
    expect(result.after?.templateId).not.toBe(result.deletedId);
  });

  test('saveTemplateAtomic activates a brand-new template atomically', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');

    const result = await page.evaluate(async () => {
      const { getState, getTemplate, saveTemplateAtomic } = await import('/src/db/database.ts');

      const newTemplate = { id: 'new-template', name: 'New', weeks: [], cycleLength: 0 };
      const newState = { templateId: 'new-template', cycle: 1, weekIndex: 0, dayIndex: 0 };
      await saveTemplateAtomic(newTemplate, newState);

      const savedTemplate = await getTemplate('new-template');
      const state = await getState();
      return { savedTemplate, state };
    });

    expect(result.savedTemplate).toMatchObject({ id: 'new-template', name: 'New' });
    expect(result.state).toEqual({ templateId: 'new-template', cycle: 1, weekIndex: 0, dayIndex: 0 });
  });

  test('putTrainingMaxesAtomic writes a whole batch as one operation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');

    const result = await page.evaluate(async () => {
      const { getAllTrainingMaxes, putTrainingMaxesAtomic } = await import('/src/db/database.ts');

      await putTrainingMaxesAtomic([
        { exerciseId: 'bench', weight: 555 },
        { exerciseId: 'squat', weight: 666 },
      ]);

      const all = await getAllTrainingMaxes();
      return {
        bench: all.find((tm) => tm.exerciseId === 'bench')?.weight,
        squat: all.find((tm) => tm.exerciseId === 'squat')?.weight,
      };
    });

    expect(result.bench).toBe(555);
    expect(result.squat).toBe(666);
  });
});
