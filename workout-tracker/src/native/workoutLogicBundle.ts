/**
 * Entry point of the JavaScriptCore bundle (vite.logic.config.ts): the same
 * reducer the WebView runs, for the iOS app to run natively when a watch tap
 * arrives while the WebView is suspended. See
 * docs/adr/0002-apple-watch-remote.md, "Background taps".
 *
 * Everything reachable from here must run without a DOM: JavaScriptCore has
 * no `window`, `document`, IndexedDB or timers.
 */
import { getDefault531Template, getDefaultExercises } from '../db/defaults';
import {
  buildWatchSnapshot,
  checkWatchEvent,
  recordAppliedEventId,
  setIdFor,
} from '../logic/watchProtocol';
import type { WatchEvent, WatchSnapshotSource } from '../logic/watchProtocol';
import { applySessionEvent, createSession, createSessionContext } from '../logic/workoutSession';

export { applySessionEvent, buildWatchSnapshot, checkWatchEvent, recordAppliedEventId };

/** A fixed Squat Day session (default template, week 1) for probe(). */
function probeSource(): WatchSnapshotSource {
  const day = getDefault531Template().weeks[0].days[0];
  const exercises = getDefaultExercises();
  const settings = { restTimerSeconds: 90, intersperseAccessories: false };
  const tmMap = new Map(exercises.map((e) => [e.id, 200]));
  return {
    session: createSession(day.sets, { intersperseAccessories: false, startedAt: 1_000 }),
    ctx: createSessionContext(day.sets, tmMap, settings),
    dayName: day.name,
    exercises,
  };
}

/**
 * The background-tap experiment: run a real watch tap through the reducer
 * against a fixed session and build the snapshot the watch would get, so
 * the app can measure whether it can answer a tap natively, in time, while
 * the phone is locked. The answer is measured, never sent: the fixed session
 * isn't the user's workout. Takes and returns JSON, the simplest thing to
 * pass across JavaScriptCore.
 */
export function probe(eventJSON: string, now: number): string {
  const event = JSON.parse(eventJSON) as WatchEvent;
  const source = probeSource();
  const { session, ctx } = source;
  // Aim the tap at the fixed session's current set, so it takes the apply
  // path a real tap would.
  const aimed: WatchEvent = { ...event, type: 'completeSet', setId: setIdFor(session) };
  delete aimed.reps;
  const verdict = checkWatchEvent(session, aimed, now);
  const next =
    verdict.kind === 'apply'
      ? recordAppliedEventId(applySessionEvent(session, verdict.event, ctx).state, event.id)
      : session;
  return JSON.stringify({
    verdict: verdict.kind,
    snapshot: buildWatchSnapshot(now, { ...source, session: next }),
  });
}
