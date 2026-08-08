import { openDB, type IDBPDatabase } from 'idb';
import type {
  Exercise,
  Template,
  ProgressionState,
  TrainingMax,
  WorkoutLog,
  TimerState,
  UserSettings,
  AppData,
  ActiveWorkout,
} from './types';
import { getDefaultExercises, getDefault531Template } from './defaults';
import { isAtOrAfter } from '../logic/progression';

const DB_NAME = 'workout-tracker';
const DB_VERSION = 2;

export type WorkoutDB = IDBPDatabase;

let dbPromise: Promise<WorkoutDB> | null = null;

export function getDB(): Promise<WorkoutDB> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('exercises', { keyPath: 'id' });
          db.createObjectStore('templates', { keyPath: 'id' });
          db.createObjectStore('trainingMaxes', { keyPath: 'exerciseId' });
          db.createObjectStore('history', { keyPath: 'id' });
          // Single-value stores
          db.createObjectStore('state');
          db.createObjectStore('timer');
        }
        if (oldVersion < 2) {
          const logs = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          logs.createIndex('timestamp', 'timestamp');
        }
      },
    });
  }
  return dbPromise;
}

/** Reset the cached DB promise (for testing). */
export function resetDB(): void {
  dbPromise = null;
}

// --- Exercises ---
export async function getAllExercises(): Promise<Exercise[]> {
  const db = await getDB();
  return db.getAll('exercises');
}

export async function putExercise(exercise: Exercise): Promise<void> {
  const db = await getDB();
  await db.put('exercises', exercise);
}

// --- Templates ---
export async function getAllTemplates(): Promise<Template[]> {
  const db = await getDB();
  return db.getAll('templates');
}

export async function getTemplate(id: string): Promise<Template | undefined> {
  const db = await getDB();
  return db.get('templates', id);
}

export async function putTemplate(template: Template): Promise<void> {
  const db = await getDB();
  await db.put('templates', template);
}

// --- Training Maxes ---
export async function getAllTrainingMaxes(): Promise<TrainingMax[]> {
  const db = await getDB();
  return db.getAll('trainingMaxes');
}

export async function getTrainingMax(exerciseId: string): Promise<TrainingMax | undefined> {
  const db = await getDB();
  return db.get('trainingMaxes', exerciseId);
}

// --- Progression State ---
export async function getState(): Promise<ProgressionState | undefined> {
  const db = await getDB();
  return db.get('state', 'current');
}

export async function putState(state: ProgressionState): Promise<void> {
  const db = await getDB();
  await db.put('state', state, 'current');
}

// --- Settings ---
const DEFAULT_SETTINGS: UserSettings = { restTimerSeconds: 90, intersperseAccessories: false };

export async function getSettings(): Promise<UserSettings> {
  const db = await getDB();
  const stored = await db.get('state', 'settings');
  return stored ? { ...DEFAULT_SETTINGS, ...stored } : { ...DEFAULT_SETTINGS };
}

export async function putSettings(settings: UserSettings): Promise<void> {
  const db = await getDB();
  await db.put('state', settings, 'settings');
}

// --- Timer ---
export async function getTimerState(): Promise<TimerState | null> {
  const db = await getDB();
  return (await db.get('timer', 'current')) ?? null;
}

export async function putTimerState(timer: TimerState | null): Promise<void> {
  const db = await getDB();
  if (timer) {
    await db.put('timer', timer, 'current');
  } else {
    await db.delete('timer', 'current');
  }
}

// --- Active Workout (in-progress persistence) ---
export async function getActiveWorkout(): Promise<ActiveWorkout | null> {
  const db = await getDB();
  return (await db.get('state', 'activeWorkout')) ?? null;
}

export async function putActiveWorkout(workout: ActiveWorkout | null): Promise<void> {
  const db = await getDB();
  if (workout) {
    await db.put('state', workout, 'activeWorkout');
  } else {
    await db.delete('state', 'activeWorkout');
  }
}

// --- Atomic multi-store writes ---
//
// Each of these bundles a logically-single user action's writes into one
// IndexedDB transaction. That matters because a page that's backgrounded and
// killed mid-flight (routine on iOS PWAs) aborts an in-progress transaction
// entirely — none of its writes land, including ones "issued" earlier in the
// same transaction. Doing the same writes as separate transactions (the
// previous approach) meant an interruption between them could leave the app
// with, e.g., a workout logged to history but the progression pointer never
// advanced, or a deleted template with the active-template pointer still
// referencing it. Bundling them means an interruption leaves the *previous*
// consistent state fully intact and retryable, instead of a partial one.

/** Data needed to atomically finish a workout: log it, advance progression,
 *  apply any cycle-end TM bumps, and clear the timer/active-workout records. */
export interface CompleteWorkoutData {
  log: WorkoutLog;
  /** Progression state the just-finished workout would naturally advance to.
   *  Not written blindly — see completeWorkoutAtomic's doc comment. */
  candidateState: ProgressionState;
  /** Training max values tied to `candidateState` representing a cycle
   *  rollover, if any. Only applied if `candidateState` is actually adopted. */
  tmBumps?: TrainingMax[];
}

/**
 * Finishing a workout normally advances progression by exactly one step from
 * wherever it was. But a workout can be finished "late" — resumed from a
 * stale activeWorkout conflict (see workout.ts) — after progression has
 * already moved further ahead in the meantime (e.g. the user manually
 * overrode their position, possibly from another tab). Blindly writing
 * `candidateState` in that case would silently regress progress the user
 * already made, and applying `tmBumps` alongside it would bump training
 * maxes for a cycle rollover that isn't actually being recorded.
 *
 * So the persisted position is only ever moved to `candidateState` if that's
 * at or beyond whatever is *actually* currently persisted — read from within
 * this same transaction, not a snapshot the caller might be holding onto
 * from earlier in a long workout session, so no concurrent write from
 * another tab can race between the read and this write either. A different
 * `templateId` entirely (the user switched their active template while the
 * now-finishing workout was still open) is never "further along" — there's
 * no meaningful ordering across two different programs — so it's treated
 * the same as a regression: the currently active template wins.
 */
export async function completeWorkoutAtomic(data: CompleteWorkoutData): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['history', 'state', 'trainingMaxes', 'timer'], 'readwrite');
  await tx.objectStore('history').put(data.log);

  const current = (await tx.objectStore('state').get('current')) as ProgressionState | undefined;
  const advances =
    !current ||
    (current.templateId === data.candidateState.templateId && isAtOrAfter(data.candidateState, current));
  await tx.objectStore('state').put(advances ? data.candidateState : current, 'current');
  if (advances) {
    for (const tm of data.tmBumps ?? []) {
      await tx.objectStore('trainingMaxes').put(tm);
    }
  }

  await tx.objectStore('state').delete('activeWorkout');
  await tx.objectStore('timer').delete('current');
  await tx.done;
}

/** Delete a template and, if it was the active one, repoint progression state
 *  at a remaining template — as a single atomic operation. */
export async function deleteTemplateAtomic(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['templates', 'state'], 'readwrite');
  await tx.objectStore('templates').delete(id);
  const state = (await tx.objectStore('state').get('current')) as ProgressionState | undefined;
  if (state?.templateId === id) {
    const remaining = (await tx.objectStore('templates').getAll()) as Template[];
    await tx.objectStore('state').put({ ...state, templateId: remaining[0]?.id ?? '' }, 'current');
  }
  await tx.done;
}

/** Save a template and, if provided, activate it — as a single atomic operation. */
export async function saveTemplateAtomic(template: Template, activateState?: ProgressionState): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['templates', 'state'], 'readwrite');
  await tx.objectStore('templates').put(template);
  if (activateState) {
    await tx.objectStore('state').put(activateState, 'current');
  }
  await tx.done;
}

/** Write a batch of training maxes as a single atomic operation, so a
 *  multi-lift save (or reset) can't land only some of the lifts. */
export async function putTrainingMaxesAtomic(tms: TrainingMax[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('trainingMaxes', 'readwrite');
  for (const tm of tms) {
    await tx.objectStore('trainingMaxes').put(tm);
  }
  await tx.done;
}

// --- History ---
export async function getAllHistory(): Promise<WorkoutLog[]> {
  const db = await getDB();
  return db.getAll('history');
}

export async function putWorkoutLog(log: WorkoutLog): Promise<void> {
  const db = await getDB();
  await db.put('history', log);
}

export async function deleteWorkoutLog(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('history', id);
}

// --- Full Export / Import ---
export async function exportAll(): Promise<AppData> {
  const [exercises, templates, state, trainingMaxes, history, timerState, settings, activeWorkout] =
    await Promise.all([
      getAllExercises(),
      getAllTemplates(),
      getState(),
      getAllTrainingMaxes(),
      getAllHistory(),
      getTimerState(),
      getSettings(),
      getActiveWorkout(),
    ]);
  return {
    exercises,
    templates,
    state: state ?? { templateId: '', cycle: 1, weekIndex: 0, dayIndex: 0 },
    trainingMaxes,
    history,
    timerState,
    settings,
    activeWorkout,
  };
}

export async function importAll(data: AppData): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['exercises', 'templates', 'trainingMaxes', 'history', 'state', 'timer'],
    'readwrite'
  );

  // Clear existing data
  await Promise.all([
    tx.objectStore('exercises').clear(),
    tx.objectStore('templates').clear(),
    tx.objectStore('trainingMaxes').clear(),
    tx.objectStore('history').clear(),
    tx.objectStore('state').clear(),
    tx.objectStore('timer').clear(),
  ]);

  // Write new data
  for (const e of data.exercises) await tx.objectStore('exercises').put(e);
  for (const t of data.templates) await tx.objectStore('templates').put(t);
  for (const tm of data.trainingMaxes) await tx.objectStore('trainingMaxes').put(tm);
  for (const h of data.history) await tx.objectStore('history').put(h);
  await tx.objectStore('state').put(data.state, 'current');
  if (data.timerState) {
    await tx.objectStore('timer').put(data.timerState, 'current');
  }
  if (data.settings) {
    await tx.objectStore('state').put(data.settings, 'settings');
  }
  if (data.activeWorkout) {
    await tx.objectStore('state').put(data.activeWorkout, 'activeWorkout');
  }

  await tx.done;
}

// --- Seed defaults if empty ---
// Runs as a single readwrite transaction so a concurrently-created importAll()
// transaction (e.g. a test seeding IndexedDB right after page load) can't
// interleave with this "read empty -> write defaults" check-then-act and get
// clobbered by it — same-scope IndexedDB transactions run in creation order,
// so whichever transaction is created first now fully completes before the
// other's operations execute.
export async function seedDefaults(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['exercises', 'templates', 'state', 'trainingMaxes'], 'readwrite');
  const exercisesStore = tx.objectStore('exercises');
  const templatesStore = tx.objectStore('templates');
  const stateStore = tx.objectStore('state');
  const trainingMaxesStore = tx.objectStore('trainingMaxes');

  const [exercises, templates] = await Promise.all([exercisesStore.getAll(), templatesStore.getAll()]);

  const defaults = getDefaultExercises();
  if (exercises.length === 0) {
    for (const e of defaults) await exercisesStore.put(e);
  } else {
    // Add any missing default exercises (e.g. newly added exercises like Dragon Flag)
    const existingIds = new Set(exercises.map((e) => e.id));
    for (const e of defaults) {
      if (!existingIds.has(e.id)) await exercisesStore.put(e);
    }
  }

  if (templates.length === 0) {
    const tmpl = getDefault531Template();
    await templatesStore.put(tmpl);

    // Set default state
    const state = await stateStore.get('current');
    if (!state) {
      await stateStore.put(
        { templateId: tmpl.id, cycle: 1, weekIndex: 0, dayIndex: 0 },
        'current'
      );
    }

    // Set default training maxes for the 4 main lifts
    const tms = await trainingMaxesStore.getAll();
    if (tms.length === 0) {
      const defaultTMs: TrainingMax[] = [
        { exerciseId: 'squat', weight: 225 },
        { exerciseId: 'bench', weight: 185 },
        { exerciseId: 'deadlift', weight: 275 },
        { exerciseId: 'ohp', weight: 115 },
      ];
      for (const tm of defaultTMs) await trainingMaxesStore.put(tm);
    }
  }

  await tx.done;
}
