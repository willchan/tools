import type { TemplateSet } from '../db/types';

/**
 * Volume groups: a "volume group" is a run of accessory or BBB-style sets
 * sharing the same exercise, percentage, and reps. The group has a TOTAL
 * rep target (count × reps). If you fall short across the prescribed sets,
 * extra "bonus" sets are appended at the original per-set reps until the
 * total target is reached or the bonus cap is hit. Main 5/3/1 sets are
 * NOT volume — those use TM-based progression, not rep-total compensation.
 */

export interface VolumeGroup {
  /** Total rep target (sum of prescribed reps across the original sets). */
  target: number;
  /** Number of sets in the original template (used to cap bonus additions). */
  originalCount: number;
  /** Per-set rep prescription — bonus sets use this same value. */
  repsPerSet: number;
}

export function getVolumeGroupKey(set: TemplateSet): string | null {
  if (set.isAmrap) return null;
  if (set.tmPercentage !== null && set.tmPercentage > 0.5) return null;
  const pct = set.tmPercentage === null ? 'null' : String(set.tmPercentage);
  return `${set.exerciseId}|${pct}|${set.reps}`;
}

export function computeVolumeGroups(templateSets: TemplateSet[]): Map<string, VolumeGroup> {
  const groups = new Map<string, VolumeGroup>();
  for (const set of templateSets) {
    const key = getVolumeGroupKey(set);
    if (key === null) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.originalCount += 1;
      existing.target += set.reps;
    } else {
      groups.set(key, { target: set.reps, originalCount: 1, repsPerSet: set.reps });
    }
  }
  return groups;
}

export interface BonusSetDecision {
  shouldAdd: boolean;
  prescribedReps: number;
}

/**
 * After completing a set in a volume group, decide whether to append a
 * bonus set. We only add a bonus when:
 *   1. The group has no remaining scheduled sets.
 *   2. The cumulative actual reps still fall short of the group target.
 *   3. We haven't hit the bonus cap (originalCount more bonus sets — i.e.,
 *      the group can at most double in size).
 */
export function evaluateBonusSetNeed(
  groupKey: string,
  workoutSets: TemplateSet[],
  completedActualReps: number[],
  currentSetIndex: number,
  volumeGroups: Map<string, VolumeGroup>,
): BonusSetDecision {
  const group = volumeGroups.get(groupKey);
  if (!group) return { shouldAdd: false, prescribedReps: 0 };

  let cumulative = 0;
  let scheduledAhead = 0;
  let totalInGroup = 0;
  for (let i = 0; i < workoutSets.length; i++) {
    if (getVolumeGroupKey(workoutSets[i]) !== groupKey) continue;
    totalInGroup += 1;
    if (i < currentSetIndex) {
      cumulative += completedActualReps[i] ?? 0;
    } else {
      scheduledAhead += 1;
    }
  }

  if (scheduledAhead > 0) return { shouldAdd: false, prescribedReps: group.repsPerSet };
  if (cumulative >= group.target) return { shouldAdd: false, prescribedReps: group.repsPerSet };
  const maxTotal = group.originalCount * 2;
  if (totalInGroup >= maxTotal) return { shouldAdd: false, prescribedReps: group.repsPerSet };
  return { shouldAdd: true, prescribedReps: group.repsPerSet };
}

export interface VolumeProgress {
  cumulative: number;
  target: number;
}

/**
 * Cumulative reps completed so far in a volume group, alongside its total
 * target. Used to show the running deficit while grinding through bonus
 * sets, since it's easy to lose track of how much volume is still owed.
 */
export function computeVolumeProgress(
  groupKey: string,
  workoutSets: TemplateSet[],
  completedActualReps: number[],
  uptoIndex: number,
  volumeGroups: Map<string, VolumeGroup>,
): VolumeProgress | null {
  const group = volumeGroups.get(groupKey);
  if (!group) return null;

  let cumulative = 0;
  for (let i = 0; i < uptoIndex; i++) {
    if (getVolumeGroupKey(workoutSets[i]) !== groupKey) continue;
    cumulative += completedActualReps[i] ?? 0;
  }
  return { cumulative, target: group.target };
}

/**
 * Where to splice a newly-decided bonus set into the runtime sequence.
 *
 * Inserting an accessory make-up set immediately at currentSetIndex puts it
 * right after the set that just fell short, with no rest in between. When a
 * primary set is still coming up, we instead insert the bonus after that
 * primary set — its rest timer gives the user a chance to do the make-up
 * set during a break they were already taking, instead of back-to-back.
 * Non-accessory bonus sets (BBB) already get their own rest timer, so they
 * insert at currentSetIndex unchanged. Same if no primary set remains ahead.
 */
export function computeBonusInsertionIndex(
  workoutSets: TemplateSet[],
  currentSetIndex: number,
  isAccessory: boolean,
): number {
  if (!isAccessory) return currentSetIndex;
  for (let i = currentSetIndex; i < workoutSets.length; i++) {
    if (workoutSets[i].tmPercentage !== null) return i + 1;
  }
  return currentSetIndex;
}
