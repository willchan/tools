import type { Exercise } from '../db/types';

/**
 * Human-readable display name for an exercise, looked up from the exercise
 * catalog. TemplateSet only carries exerciseId — a kebab-case slug like
 * "hanging-leg-raise" — so anything showing exercise names to a person
 * (currently: the Live Activity, see src/native/liveActivity.ts) needs this
 * instead of the raw id. Falls back to the id itself if the catalog doesn't
 * have an entry for it (e.g. a stale/removed exercise still referenced by
 * an old template).
 */
export function resolveExerciseName(exerciseId: string, exercises: Exercise[]): string {
  return exercises.find((e) => e.id === exerciseId)?.name ?? exerciseId;
}
