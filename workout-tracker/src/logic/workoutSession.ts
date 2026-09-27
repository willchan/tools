import type {
  CompletedSet,
  ProgressionState,
  TemplateSet,
  TimerState,
  UserSettings,
  WorkoutLog,
} from '../db/types';
import { calculateWorkingWeight } from './calculator';
import {
  computeBonusInsertionIndex,
  computeOwedReps,
  computeVolumeGroups,
  computeVolumeProgress,
  evaluateBonusSetNeed,
  findRemovableBonusSetIndex,
  getVolumeGroupKey,
} from './volume';
import type { VolumeGroup } from './volume';

/**
 * The in-workout state machine, as a pure, DOM-free reducer.
 *
 * Every in-workout action goes through applySessionEvent(), whether it came
 * from a tap on the phone (src/ui/workout.ts) or from the Apple Watch
 * (src/native/watch.ts). That's what keeps the two from diverging: the watch
 * ports none of these rules, it only reports taps. See
 * docs/adr/0002-apple-watch-remote.md.
 *
 * Nothing here reads the clock. Events carry their own `at` timestamp (the
 * moment of the tap, which for a watch event can be well before the phone
 * gets to apply it), so completed-set times and rest end times reflect when
 * the user actually acted.
 */

export interface SessionState {
  startedAt: number;
  /** Effective set sequence: intersperse applied, bonus sets included. */
  workoutSets: TemplateSet[];
  completedSets: CompletedSet[];
  currentSetIndex: number;
  /** The rest timer, or null when not resting. */
  timer: TimerState | null;
  /**
   * Whether the running rest should keep the next set's Done disabled.
   * False while resting in interspersed mode when an accessory is next, so
   * it can be done during the primary lift's rest.
   */
  restLocksDone: boolean;
  /** Ids of watch events already applied, for idempotent redelivery. */
  appliedEventIds: string[];
}

export interface SessionContext {
  /** Rep-total targets, derived from the template day, not the runtime sequence. */
  volumeGroups: Map<string, VolumeGroup>;
  tmMap: Map<string, number>;
  intersperseAccessories: boolean;
  restTimerSeconds: number;
}

export type SessionEvent =
  /** `reps` defaults to the set's prescription (owedReps for a bonus set). */
  | { type: 'completeSet'; at: number; reps?: number }
  | { type: 'editSet'; index: number; reps: number }
  | { type: 'skipRest' }
  | { type: 'adjustRest'; at: number; deltaSeconds: number }
  /** The rest timer ran out on its own. */
  | { type: 'restExpired' };

export interface SessionResult {
  state: SessionState;
  /** True when this event started a new rest period (state.timer is new). */
  restStarted: boolean;
}

export function createSessionContext(
  daySets: TemplateSet[],
  tmMap: Map<string, number>,
  settings: UserSettings,
): SessionContext {
  return {
    volumeGroups: computeVolumeGroups(daySets),
    tmMap,
    intersperseAccessories: settings.intersperseAccessories,
    restTimerSeconds: settings.restTimerSeconds,
  };
}

export function createSession(
  daySets: TemplateSet[],
  opts: { intersperseAccessories: boolean; startedAt: number },
): SessionState {
  return {
    startedAt: opts.startedAt,
    workoutSets: opts.intersperseAccessories ? intersperseSets(daySets) : [...daySets],
    completedSets: [],
    currentSetIndex: 0,
    timer: null,
    restLocksDone: false,
    appliedEventIds: [],
  };
}

export function getSetWeight(set: TemplateSet, tmMap: Map<string, number>): number {
  if (set.tmPercentage === null || set.tmLiftId === null) return 0;
  const tm = tmMap.get(set.tmLiftId);
  if (!tm) return 0;
  return calculateWorkingWeight(tm, set.tmPercentage);
}

/**
 * Reps a set is actually asking for. A bonus set may owe fewer than a normal
 * set of its exercise (see reconcileVolumeGroup).
 */
export function getEffectiveReps(set: TemplateSet): number {
  return set.owedReps ?? set.reps;
}

export function applySessionEvent(state: SessionState, event: SessionEvent, ctx: SessionContext): SessionResult {
  switch (event.type) {
    case 'completeSet':
      return completeSet(state, event.at, event.reps, ctx);
    case 'editSet':
      return { state: editSet(state, event.index, event.reps, ctx), restStarted: false };
    case 'skipRest':
    case 'restExpired':
      return { state: { ...state, timer: null, restLocksDone: false }, restStarted: false };
    case 'adjustRest':
      return { state: adjustRest(state, event.at, event.deltaSeconds), restStarted: false };
  }
}

function completeSet(
  state: SessionState,
  at: number,
  reps: number | undefined,
  ctx: SessionContext,
): SessionResult {
  const set = state.workoutSets[state.currentSetIndex];
  if (!set) return { state, restStarted: false };

  // "Done, unedited" and the missed-reps comparison measure against the
  // effective prescription, not the full per-set count.
  const effectiveReps = getEffectiveReps(set);
  const completed: CompletedSet = {
    exerciseId: set.exerciseId,
    prescribedReps: effectiveReps,
    actualReps: reps ?? effectiveReps,
    weight: getSetWeight(set, ctx.tmMap),
    isAmrap: set.isAmrap,
    timestamp: at,
  };

  let next: SessionState = {
    ...state,
    workoutSets: [...state.workoutSets],
    completedSets: [...state.completedSets, completed],
    currentSetIndex: state.currentSetIndex + 1,
  };

  // If the completed set was in a volume group and the cumulative reps still
  // fall short of the target, a bonus set is spliced in.
  const groupKey = getVolumeGroupKey(set);
  if (groupKey) reconcileVolumeGroup(next, groupKey, ctx.volumeGroups);

  if (next.currentSetIndex >= next.workoutSets.length) {
    return { state: next, restStarted: false };
  }

  const startRest = (): SessionState => ({
    ...next,
    timer: { expectedEndTime: at + ctx.restTimerSeconds * 1000, durationMs: ctx.restTimerSeconds * 1000 },
    restLocksDone: true,
  });

  if (!ctx.intersperseAccessories) {
    return { state: startRest(), restStarted: true };
  }

  const isCompletedPrimary = set.tmPercentage !== null;
  if (isCompletedPrimary) {
    // Rest after a primary set. If an accessory is next, leave Done usable
    // so it can be done during this rest.
    const isNextAccessory = next.workoutSets[next.currentSetIndex].tmPercentage === null;
    next = startRest();
    if (isNextAccessory) next.restLocksDone = false;
    return { state: next, restStarted: true };
  }

  // After an accessory: no new rest. If the primary set's rest is still
  // running, the next set waits for it.
  if (next.timer && next.timer.expectedEndTime - at > 0) {
    next.restLocksDone = true;
  }
  return { state: next, restStarted: false };
}

function editSet(state: SessionState, index: number, reps: number, ctx: SessionContext): SessionState {
  const existing = state.completedSets[index];
  if (!existing || index >= state.currentSetIndex) return state;
  const next: SessionState = {
    ...state,
    workoutSets: [...state.workoutSets],
    completedSets: state.completedSets.map((s, i) => (i === index ? { ...s, actualReps: reps } : s)),
  };
  const groupKey = getVolumeGroupKey(state.workoutSets[index]);
  if (groupKey) reconcileVolumeGroup(next, groupKey, ctx.volumeGroups);
  return next;
}

function adjustRest(state: SessionState, at: number, deltaSeconds: number): SessionState {
  if (!state.timer) return state;
  const deltaMs = deltaSeconds * 1000;
  const expectedEndTime = state.timer.expectedEndTime + deltaMs;
  if (expectedEndTime <= at) {
    return { ...state, timer: null, restLocksDone: false };
  }
  return { ...state, timer: { expectedEndTime, durationMs: state.timer.durationMs + deltaMs } };
}

/**
 * Single chokepoint for keeping a volume group's bonus sets in sync with
 * completedSets. Called both when a set is originally marked done and
 * whenever a past set's reps are edited, so a correction can retroactively
 * drop a now-unneeded pending bonus set or add one that a downward edit
 * newly requires — instead of the decision only ever being made once.
 *
 * Mutates `state.workoutSets` in place; callers pass a state whose
 * workoutSets array they've already copied.
 */
function reconcileVolumeGroup(state: SessionState, groupKey: string, volumeGroups: Map<string, VolumeGroup>): void {
  const { workoutSets, currentSetIndex } = state;
  const actualReps = state.completedSets.map((s) => s.actualReps);

  const group = volumeGroups.get(groupKey);
  const progress = computeVolumeProgress(groupKey, workoutSets, actualReps, currentSetIndex, volumeGroups);
  const pendingBonusIndex = findRemovableBonusSetIndex(groupKey, workoutSets, currentSetIndex);

  if (progress && progress.cumulative >= progress.target) {
    if (pendingBonusIndex !== null) {
      workoutSets.splice(pendingBonusIndex, 1);
    }
    return;
  }

  // A bonus set may already be pending (not yet completed) for this group.
  // Its owedReps was computed from the deficit at the moment it was added —
  // if a since-edited earlier set changed that deficit without fully
  // closing it, keep the pending bonus in sync instead of leaving it stale
  // (both the displayed prescription and the reps-stepper cap derive from
  // this value, so a stale owedReps can under- or over-prescribe it).
  if (group && progress && pendingBonusIndex !== null) {
    workoutSets[pendingBonusIndex] = {
      ...workoutSets[pendingBonusIndex],
      owedReps: computeOwedReps(group, progress.cumulative),
    };
    return;
  }

  const decision = evaluateBonusSetNeed(groupKey, workoutSets, actualReps, currentSetIndex, volumeGroups);
  if (decision.shouldAdd) {
    const groupSet = workoutSets.find((s) => getVolumeGroupKey(s) === groupKey);
    if (!groupSet) return;
    const isAccessory = groupSet.tmPercentage === null;
    const insertIndex = computeBonusInsertionIndex(workoutSets, currentSetIndex, isAccessory);
    workoutSets.splice(insertIndex, 0, {
      exerciseId: groupSet.exerciseId,
      tmPercentage: groupSet.tmPercentage,
      tmLiftId: groupSet.tmLiftId,
      // `reps` stays at the group's normal per-set value (not the owed
      // amount) so this bonus set still resolves to the same volume
      // group — getVolumeGroupKey folds `reps` into the group identity.
      reps: groupSet.reps,
      owedReps: decision.prescribedReps,
      isAmrap: false,
      isBonus: true,
    });
  }
}

export interface WorkoutFailures {
  mainFailed: Array<{ exerciseId: string; got: number; prescribed: number }>;
  bbbFailed: Array<{ exerciseId: string; got: number; target: number }>;
}

export function detectFailures(state: SessionState, volumeGroups: Map<string, VolumeGroup>): WorkoutFailures {
  const { workoutSets, completedSets } = state;
  const mainFailed: WorkoutFailures['mainFailed'] = [];
  const bbbFailed: WorkoutFailures['bbbFailed'] = [];

  // Main 5/3/1 sets are evaluated per-set (TM is the feedback loop).
  // AMRAP sets have no upper cap, but missing the prescribed minimum
  // still counts as a failure per Wendler's rules.
  workoutSets.forEach((set, i) => {
    const completed = completedSets[i];
    if (!completed) return;
    if (completed.actualReps >= set.reps) return;
    if (set.tmPercentage === null) return;
    if (set.tmPercentage <= 0.5) return;
    mainFailed.push({ exerciseId: set.exerciseId, got: completed.actualReps, prescribed: set.reps });
  });

  // BBB volume groups are evaluated against the group's TOTAL rep target.
  // Bonus sets are already factored in via cumulative actualReps, so a
  // user who grinds out 50 reps across 7 sets reads as a success.
  type GroupTotal = { exerciseId: string; cumulative: number; target: number };
  const groupTotals = new Map<string, GroupTotal>();
  for (const [groupKey, group] of volumeGroups) {
    const firstSet = workoutSets.find((s) => getVolumeGroupKey(s) === groupKey);
    if (!firstSet || firstSet.tmPercentage === null) continue;
    groupTotals.set(groupKey, { exerciseId: firstSet.exerciseId, cumulative: 0, target: group.target });
  }
  workoutSets.forEach((s, i) => {
    const k = getVolumeGroupKey(s);
    if (k === null) return;
    const g = groupTotals.get(k);
    if (!g) return;
    g.cumulative += completedSets[i]?.actualReps ?? 0;
  });
  for (const g of groupTotals.values()) {
    if (g.cumulative < g.target) {
      bbbFailed.push({ exerciseId: g.exerciseId, got: g.cumulative, target: g.target });
    }
  }

  return { mainFailed, bbbFailed };
}

export function buildWorkoutLog(
  state: SessionState,
  position: ProgressionState,
  dayName: string,
  completedAt: number,
): WorkoutLog {
  return {
    id: `workout-${completedAt}`,
    templateId: position.templateId,
    cycle: position.cycle,
    weekIndex: position.weekIndex,
    dayIndex: position.dayIndex,
    dayName,
    sets: state.completedSets,
    startedAt: state.startedAt,
    completedAt,
  };
}

/**
 * Intersperse accessory sets between primary (main + BBB) sets.
 * Primary sets keep their order; accessories are inserted one at a time
 * after each primary set until all accessories are placed.
 */
export function intersperseSets(sets: TemplateSet[]): TemplateSet[] {
  const primary: TemplateSet[] = [];
  const accessory: TemplateSet[] = [];

  for (const set of sets) {
    if (set.tmPercentage !== null) {
      primary.push(set);
    } else {
      accessory.push(set);
    }
  }

  const result: TemplateSet[] = [];
  let accIdx = 0;

  for (const p of primary) {
    result.push(p);
    if (accIdx < accessory.length) {
      result.push(accessory[accIdx++]);
    }
  }

  // Any remaining accessories go at the end
  while (accIdx < accessory.length) {
    result.push(accessory[accIdx++]);
  }

  return result;
}
