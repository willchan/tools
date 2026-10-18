import type { Exercise, TemplateSet } from '../db/types';
import { calculatePlates, formatPlates } from './calculator';
import { resolveExerciseName } from './exerciseName';
import { applySessionEvent, getEffectiveReps, getSetWeight } from './workoutSession';
import { computeVolumeProgress, getVolumeGroupKey } from './volume';
import type { VolumeGroup } from './volume';
import type { SessionContext, SessionEvent, SessionState } from './workoutSession';

/**
 * The phone ↔ Apple Watch protocol, as pure functions.
 *
 * Phone → watch: a numbered, display-ready WatchSnapshot. The watch keeps
 * only the highest `seq` it has seen and renders it as-is. It knows no
 * workout rules, so everything it shows (including how long to rest after
 * the current set) is computed here.
 *
 * Watch → phone: WatchEvent taps. Each has an idempotency `id`, the `setId`
 * of the snapshot it was tapped against, and the watch's `at` timestamp.
 * checkWatchEvent() decides whether a tap is applied, ignored as a duplicate,
 * or rejected as stale.
 *
 * See docs/adr/0002-apple-watch-remote.md. The Swift side mirrors these types
 * in ios/App/AppLogic; bump WATCH_PROTOCOL_VERSION on any incompatible change.
 */

export const WATCH_PROTOCOL_VERSION = 1;

/** Applied-event ids kept per workout. Far more than the taps in one workout. */
export const MAX_APPLIED_EVENT_IDS = 500;

/** Upper bound on reps for an AMRAP set, matching the phone's stepper. */
const AMRAP_MAX_REPS = 999;

export type WatchEventType = 'start' | 'completeSet' | 'skipRest' | 'adjustRest' | 'finish';

export interface WatchEvent {
  v: number;
  /** Idempotency id, unique per tap. */
  id: string;
  /** Epoch ms of the tap, on the watch's clock. */
  at: number;
  type: WatchEventType;
  /** The snapshot's setId the tap was made against. Required except for start. */
  setId?: string;
  /** completeSet: reps done. Defaults to the prescription. */
  reps?: number;
  /** adjustRest: seconds to add (negative to shorten). */
  deltaSeconds?: number;
}

export type WatchEventVerdict =
  | { kind: 'apply'; event: SessionEvent }
  | { kind: 'finish'; at: number }
  | { kind: 'duplicate' }
  | { kind: 'stale'; reason: string }
  | { kind: 'invalid'; reason: string };

/**
 * Identifies the current set: which workout, which position, and what the
 * set prescribes. A tap is only applied if its setId still matches, so a tap
 * for a set the phone has since moved past (or that an edit replaced, e.g.
 * a bonus set appearing or disappearing) can't complete a different set.
 * Once every set is done this is `${startedAt}/${index}/end`, which is what a
 * finish tap must carry.
 */
export function setIdFor(state: SessionState): string {
  const index = state.currentSetIndex;
  const set = state.workoutSets[index];
  if (!set) return `${state.startedAt}/${index}/end`;
  const parts = [
    set.exerciseId,
    set.tmPercentage ?? 'na',
    getEffectiveReps(set),
    set.isAmrap ? 'amrap' : '',
    set.isBonus ? 'bonus' : '',
  ];
  return `${state.startedAt}/${index}/${parts.join(':')}`;
}

/** Most reps a completeSet may report for the current set. */
export function maxRepsFor(state: SessionState): number {
  const set = state.workoutSets[state.currentSetIndex];
  if (!set) return 0;
  return set.isAmrap ? AMRAP_MAX_REPS : getEffectiveReps(set);
}

/**
 * Decide what to do with an in-workout watch tap (anything but `start`,
 * which src/native/watch.ts handles before a session exists). `now` is the
 * phone's clock: a watch clock running ahead is clamped to it, so a skewed
 * clock can't stretch a rest period or future-date a set.
 */
export function checkWatchEvent(state: SessionState, event: WatchEvent, now: number): WatchEventVerdict {
  if (event.v !== WATCH_PROTOCOL_VERSION) {
    return { kind: 'invalid', reason: `unsupported protocol version ${event.v}` };
  }
  if (state.appliedEventIds.includes(event.id)) return { kind: 'duplicate' };

  const at = Math.min(event.at, now);
  const isCurrentSet = event.setId === setIdFor(state);

  switch (event.type) {
    case 'completeSet': {
      if (event.reps !== undefined) {
        const { reps } = event;
        if (!Number.isInteger(reps) || reps < 0 || reps > maxRepsFor(state)) {
          return { kind: 'invalid', reason: `reps ${reps} out of range` };
        }
      }
      if (!isCurrentSet) return { kind: 'stale', reason: 'set already moved past' };
      const applied: SessionEvent = { type: 'completeSet', at };
      if (event.reps !== undefined) applied.reps = event.reps;
      return { kind: 'apply', event: applied };
    }
    case 'skipRest':
      if (!isCurrentSet) return { kind: 'stale', reason: 'set already moved past' };
      return { kind: 'apply', event: { type: 'skipRest' } };
    case 'adjustRest':
      if (typeof event.deltaSeconds !== 'number' || !Number.isFinite(event.deltaSeconds)) {
        return { kind: 'invalid', reason: 'adjustRest without deltaSeconds' };
      }
      if (!isCurrentSet) return { kind: 'stale', reason: 'set already moved past' };
      return { kind: 'apply', event: { type: 'adjustRest', at, deltaSeconds: event.deltaSeconds } };
    case 'finish':
      if (!isCurrentSet || state.currentSetIndex < state.workoutSets.length) {
        return { kind: 'stale', reason: 'phone has sets left to do' };
      }
      return { kind: 'finish', at };
    default:
      return { kind: 'invalid', reason: `unexpected event type ${String(event.type)}` };
  }
}

/** Record an applied event id, keeping only the most recent ones. */
export function recordAppliedEventId(state: SessionState, id: string): SessionState {
  const ids = [...state.appliedEventIds, id];
  return { ...state, appliedEventIds: ids.slice(Math.max(0, ids.length - MAX_APPLIED_EVENT_IDS)) };
}

export interface WatchWorkoutView {
  dayName: string;
  /** Echo back in every tap made against this snapshot. */
  setId: string;
  /** 1-based position of the current set, capped at setTotal. */
  setNumber: number;
  setTotal: number;
  /** Every set is done: show Finish instead of Done. */
  allSetsDone: boolean;
  exerciseName: string;
  weightLabel: string;
  plateLabel: string | null;
  /** Prescribed reps (default for the watch's rep picker). */
  reps: number;
  /** Upper bound for the rep picker. */
  maxReps: number;
  isAmrap: boolean;
  isBonus: boolean;
  /** Epoch ms the current rest ends, or null when not resting. */
  restEndTime: number | null;
  /** Whether Done stays disabled until restEndTime. */
  restLocksDone: boolean;
  /**
   * Rest the watch should count down locally, right after Done is tapped on
   * the current set, before the phone's next snapshot arrives. Null means
   * completing this set starts no rest.
   */
  restAfterSetSeconds: number | null;
  /**
   * For a set with a rep-total target (accessories, BBB): reps done so far
   * in its group and the target, as the phone shows ("x/y reps so far").
   * Null for sets without one (main sets, AMRAP).
   */
  volume: { done: number; target: number } | null;
}

export interface WatchSnapshot {
  v: number;
  /** Increases with every snapshot; the watch drops any older than it has. */
  seq: number;
  status: 'idle' | 'active';
  workout: WatchWorkoutView | null;
}

export interface WatchSnapshotSource {
  session: SessionState;
  ctx: SessionContext;
  dayName: string;
  exercises: Exercise[];
}

export function buildWatchSnapshot(seq: number, source: WatchSnapshotSource | null): WatchSnapshot {
  if (!source) return { v: WATCH_PROTOCOL_VERSION, seq, status: 'idle', workout: null };
  const { session, ctx, dayName, exercises } = source;
  const set = session.workoutSets[session.currentSetIndex];
  const setTotal = session.workoutSets.length;

  const weight = set ? getSetWeight(set, ctx.tmMap) : 0;
  const plates = weight > 0 ? calculatePlates(weight).plates : [];

  // Ask the reducer itself what completing this set would do, so the watch
  // never needs its own copy of the rest rules.
  const preview = set ? applySessionEvent(session, { type: 'completeSet', at: 0 }, ctx) : null;

  return {
    v: WATCH_PROTOCOL_VERSION,
    seq,
    status: 'active',
    workout: {
      dayName,
      setId: setIdFor(session),
      setNumber: Math.min(session.currentSetIndex + 1, setTotal),
      setTotal,
      allSetsDone: !set,
      exerciseName: set ? resolveExerciseName(set.exerciseId, exercises) : '',
      weightLabel: !set ? '' : weight > 0 ? `${weight} lbs` : 'BW / Custom',
      plateLabel: plates.length > 0 ? `${formatPlates(plates)} per side` : null,
      reps: set ? getEffectiveReps(set) : 0,
      maxReps: maxRepsFor(session),
      isAmrap: set?.isAmrap ?? false,
      isBonus: set?.isBonus ?? false,
      restEndTime: session.timer?.expectedEndTime ?? null,
      restLocksDone: session.timer ? session.restLocksDone : false,
      restAfterSetSeconds: preview?.restStarted ? ctx.restTimerSeconds : null,
      volume: set ? volumeFor(session, set, ctx) : null,
    },
  };
}

function volumeFor(session: SessionState, set: TemplateSet, ctx: SessionContext): WatchWorkoutView['volume'] {
  const key = getVolumeGroupKey(set);
  if (!key) return null;
  const progress = computeVolumeProgress(
    key,
    session.workoutSets,
    session.completedSets.map((c) => c.actualReps),
    session.currentSetIndex,
    ctx.volumeGroups,
  );
  return progress ? { done: progress.cumulative, target: progress.target } : null;
}

/**
 * Everything the native side needs to answer a watch tap while the WebView
 * is suspended (ADR 0002, "Background taps"): a `WatchSnapshotSource` as
 * plain JSON. The WebView pushes one with every snapshot; the iOS app runs
 * `answerWatchEvents` over it in JavaScriptCore.
 */
export interface WatchShadow {
  v: number;
  session: SessionState;
  ctx: {
    volumeGroups: [string, VolumeGroup][];
    tmMap: [string, number][];
    intersperseAccessories: boolean;
    restTimerSeconds: number;
  };
  dayName: string;
  /** Only the exercises this workout uses. */
  exercises: Exercise[];
}

export function encodeWatchShadow(source: WatchSnapshotSource): WatchShadow {
  const { session, ctx, dayName } = source;
  const used = new Set(session.workoutSets.map((set) => set.exerciseId));
  return {
    v: WATCH_PROTOCOL_VERSION,
    session,
    ctx: {
      volumeGroups: [...ctx.volumeGroups.entries()],
      tmMap: [...ctx.tmMap.entries()],
      intersperseAccessories: ctx.intersperseAccessories,
      restTimerSeconds: ctx.restTimerSeconds,
    },
    dayName,
    exercises: source.exercises.filter((e) => used.has(e.id)),
  };
}

export function decodeWatchShadow(shadow: WatchShadow): WatchSnapshotSource {
  return {
    session: shadow.session,
    ctx: {
      volumeGroups: new Map(shadow.ctx.volumeGroups),
      tmMap: new Map(shadow.ctx.tmMap),
      intersperseAccessories: shadow.ctx.intersperseAccessories,
      restTimerSeconds: shadow.ctx.restTimerSeconds,
    },
    dayName: shadow.dayName,
    exercises: shadow.exercises,
  };
}

/** What became of each tap in `answerWatchEvents`. */
export type WatchAnswerVerdict = WatchEventVerdict['kind'] | 'skipped';

/**
 * Apply queued taps, in order, to a shadow the way the workout screen does
 * (workout.ts `handleEvent`), and build the snapshot that answers them. A
 * tap the WebView has already applied is a duplicate, so the whole native
 * queue can be passed. `start` is skipped: it opens a workout, which only
 * the WebView does. Finish answers with idle.
 */
export function answerWatchEvents(
  shadow: WatchShadow,
  events: WatchEvent[],
  seq: number,
  now: number,
): { snapshot: WatchSnapshot; verdicts: WatchAnswerVerdict[] } {
  const source = decodeWatchShadow(shadow);
  let session = source.session;
  let finished = false;
  const verdicts: WatchAnswerVerdict[] = [];
  for (const event of events) {
    if (event.type === 'start' || finished) {
      verdicts.push('skipped');
      continue;
    }
    const verdict = checkWatchEvent(session, event, now);
    if (verdict.kind === 'apply') {
      session = recordAppliedEventId(applySessionEvent(session, verdict.event, source.ctx).state, event.id);
    } else if (verdict.kind === 'finish') {
      finished = true;
    }
    verdicts.push(verdict.kind);
  }
  return {
    snapshot: buildWatchSnapshot(seq, finished ? null : { ...source, session }),
    verdicts,
  };
}
