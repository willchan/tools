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

/**
 * Choose where to splice a bonus set into the workout sequence.
 *
 * In non-intersperse mode we insert immediately at `currentSetIndex` so
 * the bonus follows the same-exercise group it belongs to.
 *
 * In intersperse mode we preserve the alternating primary/accessory
 * cadence: skip ahead to the next set of the OPPOSITE type and insert
 * after it. If none remain ahead, append at the end.
 */
export function pickBonusInsertIndex(
  bonusSet: TemplateSet,
  workoutSets: TemplateSet[],
  currentSetIndex: number,
  intersperseMode: boolean,
): number {
  if (!intersperseMode) return currentSetIndex;
  const isBonusPrimary = bonusSet.tmPercentage !== null;
  for (let i = currentSetIndex; i < workoutSets.length; i++) {
    const isOpposite = isBonusPrimary
      ? workoutSets[i].tmPercentage === null
      : workoutSets[i].tmPercentage !== null;
    if (isOpposite) return i + 1;
  }
  return workoutSets.length;
}
