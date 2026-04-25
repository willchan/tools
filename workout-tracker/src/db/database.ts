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

export async function deleteTemplate(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('templates', id);
}

// --- Training Maxes ---
export async function getAllTrainingMaxes(): Promise<TrainingMax[]> {
  const db = await getDB();
  return db.getAll('trainingMaxes');
}

export async function putTrainingMax(tm: TrainingMax): Promise<void> {
  const db = await getDB();
  await db.put('trainingMaxes', tm);
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

// --- History ---
export async function getAllHistory(): Promise<WorkoutLog[]> {
  const db = await getDB();
  return db.getAll('history');
}

export async function putWorkoutLog(log: WorkoutLog): Promise<void> {
  const db = await getDB();
  await db.put('history', log);
}

// --- Full Export / Import ---
export async function exportAll(): Promise<AppData> {
  const [exercises, templates, state, trainingMaxes, history, timerState, settings] = await Promise.all([
    getAllExercises(),
    getAllTemplates(),
    getState(),
    getAllTrainingMaxes(),
    getAllHistory(),
    getTimerState(),
    getSettings(),
  ]);
  return {
    exercises,
    templates,
    state: state ?? { templateId: '', cycle: 1, weekIndex: 0, dayIndex: 0 },
    trainingMaxes,
    history,
    timerState,
    settings,
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

  await tx.done;
}

// --- Seed defaults if empty ---
export async function seedDefaults(): Promise<void> {
  const exercises = await getAllExercises();
  const defaults = getDefaultExercises();
  if (exercises.length === 0) {
    for (const e of defaults) await putExercise(e);
  } else {
    // Add any missing default exercises (e.g. newly added exercises like Dragon Flag)
    const existingIds = new Set(exercises.map((e) => e.id));
    for (const e of defaults) {
      if (!existingIds.has(e.id)) await putExercise(e);
    }
  }

  const templates = await getAllTemplates();
  if (templates.length === 0) {
    const tmpl = getDefault531Template();
    await putTemplate(tmpl);

    // Set default state
    const state = await getState();
    if (!state) {
      await putState({
        templateId: tmpl.id,
        cycle: 1,
        weekIndex: 0,
        dayIndex: 0,
      });
    }

    // Set default training maxes for the 4 main lifts
    const tms = await getAllTrainingMaxes();
    if (tms.length === 0) {
      const defaultTMs: TrainingMax[] = [
        { exerciseId: 'squat', weight: 225 },
        { exerciseId: 'bench', weight: 185 },
        { exerciseId: 'deadlift', weight: 275 },
        { exerciseId: 'ohp', weight: 115 },
      ];
      for (const tm of defaultTMs) await putTrainingMax(tm);
    }
  }
}
