import type { ProgressionState, Template } from '../db/types';
import { getTMIncrement } from './calculator';

export interface AdvanceResult {
  newState: ProgressionState;
  /** If a new cycle started, returns exercise IDs needing TM bumps with increments. */
  tmBumps: Array<{ exerciseId: string; increment: number }> | null;
}

/**
 * Advance the progression state after completing a workout day.
 * Moves to next day, or next week, or next cycle.
 */
export function advanceState(
  current: ProgressionState,
  template: Template
): AdvanceResult {
  const week = template.weeks[current.weekIndex];
  if (!week) {
    return { newState: current, tmBumps: null };
  }

  let nextDay = current.dayIndex + 1;
  let nextWeek = current.weekIndex;
  let nextCycle = current.cycle;
  let tmBumps: AdvanceResult['tmBumps'] = null;

  if (nextDay >= week.days.length) {
    // Move to next week
    nextDay = 0;
    nextWeek = current.weekIndex + 1;

    if (nextWeek >= template.weeks.length) {
      // Cycle complete — bump TMs and start new cycle
      nextWeek = 0;
      nextCycle = current.cycle + 1;

      // Collect unique main lift IDs from template days
      const mainLifts = new Set<string>();
      for (const w of template.weeks) {
        for (const d of w.days) {
          mainLifts.add(d.mainLiftId);
        }
      }

      tmBumps = Array.from(mainLifts).map((exerciseId) => ({
        exerciseId,
        increment: getTMIncrement(exerciseId),
      }));
    }
  }

  return {
    newState: {
      templateId: current.templateId,
      cycle: nextCycle,
      weekIndex: nextWeek,
      dayIndex: nextDay,
    },
    tmBumps,
  };
}

/**
 * Is `a` at or beyond `b` in progression order (cycle, then week, then day)?
 * Only meaningful within the same template — progression through a different
 * program isn't comparable, so callers should check `templateId` separately.
 */
export function isAtOrAfter(a: ProgressionState, b: ProgressionState): boolean {
  if (a.cycle !== b.cycle) return a.cycle > b.cycle;
  if (a.weekIndex !== b.weekIndex) return a.weekIndex > b.weekIndex;
  return a.dayIndex >= b.dayIndex;
}
