import { isNativePlatform } from './platform';
import { log } from '../logic/logger';

const ACTIVITY_ID = 'workout-session';

export interface WorkoutActivityState {
  dayName: string;
  exerciseName: string;
  setIndex: number;
  setTotal: number;
  /** Absolute epoch ms the current rest timer ends at, or null if not resting. */
  restEndTime: number | null;
  /**
   * Absolute epoch ms the current rest timer started at, or null if not
   * resting. Paired with restEndTime so the widget can draw a depleting
   * progress ring around the app icon (full at the start of rest, empty at
   * the end) instead of a plain "resting: yes/no" indicator — restEndTime
   * alone isn't enough for that, since the ring needs both ends of a fixed
   * date range. See LiveActivityWidget.swift's restProgressRange().
   */
  restStartTime: number | null;
}

// Exported (rather than kept private to this module) so it's directly
// unit-testable the way isNativePlatform()/formatTime()/getRemainingMs()
// are elsewhere in this codebase — see e2e/native-platform.spec.ts's "Live
// Activity content state" suite.
export function toContentState(state: WorkoutActivityState): Record<string, string> {
  return {
    exerciseName: state.exerciseName,
    setProgress: `${state.setIndex}/${state.setTotal}`,
    restEndTime: state.restEndTime !== null ? String(state.restEndTime) : '',
    restStartTime: state.restStartTime !== null ? String(state.restStartTime) : '',
  };
}

// Capacitor plugin objects are Proxies whose `get` trap returns a function
// for *any* property access, including `then` — so a plugin object handed
// back across an async/Promise boundary (returned from an async function,
// or from a .then() callback) gets misdetected as a thenable and "resolved"
// by invoking its nonexistent `.then()`, throwing "not implemented". Each
// function below destructures the plugin from the import and calls a method
// on it in the same expression, rather than passing the plugin object itself
// through another await/then — see the isNativePlatform native-platform.spec
// regression this was caught by for the exact failure mode.

export async function startWorkoutActivity(state: WorkoutActivityState): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { LiveActivity } = await import('capacitor-live-activity');
    await LiveActivity.startActivity({
      id: ACTIVITY_ID,
      attributes: { dayName: state.dayName },
      contentState: toContentState(state),
    });
  } catch (err) {
    void log('warn', `live activity start failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function updateWorkoutActivity(state: WorkoutActivityState): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { LiveActivity } = await import('capacitor-live-activity');
    await LiveActivity.updateActivity({
      id: ACTIVITY_ID,
      contentState: toContentState(state),
    });
  } catch (err) {
    void log('warn', `live activity update failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function endWorkoutActivity(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { LiveActivity } = await import('capacitor-live-activity');
    await LiveActivity.endActivity({
      id: ACTIVITY_ID,
      contentState: { exerciseName: '', setProgress: '', restEndTime: '', restStartTime: '' },
      dismissalPolicy: 'immediate',
    });
  } catch (err) {
    void log('warn', `live activity end failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
