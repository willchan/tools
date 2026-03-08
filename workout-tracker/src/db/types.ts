/** Canonical data model — the entire DB can be exported as a single JSON object. */

export interface Exercise {
  id: string;
  name: string;
  category: 'barbell' | 'dumbbell' | 'bodyweight' | 'machine' | 'cable';
  muscleGroup: 'chest' | 'back' | 'shoulders' | 'legs' | 'arms' | 'core' | 'full-body';
}

/** A single set prescription within a workout day template. */
export interface TemplateSet {
  exerciseId: string;
  /** Percentage of Training Max (e.g., 0.65 = 65%). null for accessories with fixed weight. */
  tmPercentage: number | null;
  /** Which core lift's TM to use. null for accessories. */
  tmLiftId: string | null;
  reps: number;
  /** Whether this is an AMRAP (As Many Reps As Possible) set. */
  isAmrap: boolean;
}

export interface TemplateDay {
  id: string;
  name: string; // e.g., "Squat Day"
  mainLiftId: string; // The primary lift for this day
  sets: TemplateSet[];
}

export interface TemplateWeek {
  id: string;
  name: string; // e.g., "Week 1 (5s)"
  days: TemplateDay[];
}

export interface Template {
  id: string;
  name: string;
  weeks: TemplateWeek[];
  /** Number of weeks before TM increases (typically matches weeks.length). */
  cycleLength: number;
}

export interface TrainingMax {
  exerciseId: string;
  weight: number; // in lbs
}

export interface ProgressionState {
  templateId: string;
  cycle: number;
  weekIndex: number;
  dayIndex: number;
}

export interface CompletedSet {
  exerciseId: string;
  prescribedReps: number;
  actualReps: number;
  weight: number;
  isAmrap: boolean;
  timestamp: number;
}

export interface WorkoutLog {
  id: string;
  templateId: string;
  cycle: number;
  weekIndex: number;
  dayIndex: number;
  dayName: string;
  sets: CompletedSet[];
  startedAt: number;
  completedAt: number;
}

/** Timer state persisted for resilient rest timer. */
export interface TimerState {
  expectedEndTime: number;
  durationMs: number;
}

/** User-configurable settings. */
export interface UserSettings {
  restTimerSeconds: number;
  intersperseAccessories: boolean;
}

/** In-progress workout state, persisted for reload resilience. */
export interface ActiveWorkout {
  templateId: string;
  cycle: number;
  weekIndex: number;
  dayIndex: number;
  completedSets: CompletedSet[];
  currentSetIndex: number;
  startedAt: number;
}

/** Full export shape for sync. */
export interface AppData {
  exercises: Exercise[];
  templates: Template[];
  state: ProgressionState;
  trainingMaxes: TrainingMax[];
  history: WorkoutLog[];
  timerState: TimerState | null;
  settings?: UserSettings;
}
