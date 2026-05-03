import type { ProgressionState, Template, WorkoutLog, TMAdjustment } from '../db/types';
import { getTMIncrement } from './calculator';

export interface AmrapResult {
  hit: boolean;
  actualReps: number;
  prescribedReps: number;
}

/**
 * For each main lift, find the latest AMRAP set across the cycle's history
 * and report whether the prescribed rep target was met. Lifts with no AMRAP
 * record default to a miss (hit=false, reps=0).
 */
export function evaluateCycleAmraps(
  cycleHistory: WorkoutLog[],
  mainLiftIds: string[],
): Record<string, AmrapResult> {
  const sorted = [...cycleHistory].sort((a, b) => a.completedAt - b.completedAt);
  const out: Record<string, AmrapResult> = {};

  for (const liftId of mainLiftIds) {
    let latest: { actualReps: number; prescribedReps: number } | null = null;
    for (const log of sorted) {
      for (const set of log.sets) {
        if (set.isAmrap && set.exerciseId === liftId) {
          latest = { actualReps: set.actualReps, prescribedReps: set.prescribedReps };
        }
      }
    }
    if (latest === null) {
      out[liftId] = { hit: false, actualReps: 0, prescribedReps: 0 };
    } else {
      out[liftId] = {
        hit: latest.actualReps >= latest.prescribedReps,
        actualReps: latest.actualReps,
        prescribedReps: latest.prescribedReps,
      };
    }
  }

  return out;
}

/**
 * Combine candidate TM bumps with AMRAP performance to produce concrete
 * TMAdjustment records. Misses produce a held entry (appliedIncrement = 0,
 * newTrainingMax = previous).
 */
export function buildTMAdjustments(
  candidateBumps: Array<{ exerciseId: string; increment: number }>,
  amrapResults: Record<string, AmrapResult>,
  currentTMs: Map<string, number>,
): TMAdjustment[] {
  return candidateBumps.map((bump) => {
    const amrap = amrapResults[bump.exerciseId] ?? {
      hit: false,
      actualReps: 0,
      prescribedReps: 0,
    };
    const previous = currentTMs.get(bump.exerciseId) ?? 0;
    const applied = amrap.hit ? bump.increment : 0;
    return {
      exerciseId: bump.exerciseId,
      previousTrainingMax: previous,
      newTrainingMax: previous + applied,
      appliedIncrement: applied,
      hitTarget: amrap.hit,
      amrapReps: amrap.actualReps,
      prescribedReps: amrap.prescribedReps,
    };
  });
}

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
