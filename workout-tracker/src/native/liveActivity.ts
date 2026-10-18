import { isNativePlatform } from './platform';
import { log } from '../logic/logger';
import type { LiveActivityPlugin } from 'capacitor-live-activity';

const ACTIVITY_ID = 'workout-session';

export interface WorkoutActivityState {
  dayName: string;
  exerciseName: string;
  setIndex: number;
  setTotal: number;
  /** Absolute epoch ms the current rest timer ends at, or null if not resting. */
  restEndTime: number | null;
}

function toContentState(state: WorkoutActivityState): Record<string, string> {
  return {
    exerciseName: state.exerciseName,
    setProgress: `${state.setIndex}/${state.setTotal}`,
    restEndTime: state.restEndTime !== null ? String(state.restEndTime) : '',
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
    await startWorkoutActivityWith(LiveActivity, state);
  } catch (err) {
    void log('warn', `live activity start failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type LiveActivityApi = Pick<
  LiveActivityPlugin,
  'listActivities' | 'isRunning' | 'endActivity' | 'startActivity' | 'updateActivity'
>;

/** ActivityKit states (as the plugin names them) of a card still on screen. */
const ON_SCREEN_STATES = new Set(['active', 'stale', 'pending']);
const ADOPT_POLL_MS = 100;
const ADOPT_POLLS = 20;

/**
 * Start this workout's card, replacing one left on screen from before a
 * relaunch (e.g. the app was killed mid-workout). The plugin only tracks a
 * surviving card once its own async init has adopted it, and silently
 * ignores updates for a card it doesn't track; starting another card under
 * the same id before then would orphan the first one, frozen on the lock
 * screen. So wait for the adoption, end that card, then start a fresh one
 * (whose static dayName may differ). Exported for tests.
 */
export async function startWorkoutActivityWith(plugin: LiveActivityApi, state: WorkoutActivityState): Promise<void> {
  const { items } = await plugin.listActivities();
  const onScreen = items.some((item) => item.id === ACTIVITY_ID && ON_SCREEN_STATES.has(item.state));
  if (onScreen) {
    let adopted = false;
    for (let i = 0; i < ADOPT_POLLS && !adopted; i++) {
      adopted = (await plugin.isRunning({ id: ACTIVITY_ID })).value;
      if (!adopted) await new Promise((resolve) => setTimeout(resolve, ADOPT_POLL_MS));
    }
    if (!adopted) {
      // Never adopted: a second card would orphan it. Updating at least
      // keeps it current if the plugin picks it up later.
      await plugin.updateActivity({ id: ACTIVITY_ID, contentState: toContentState(state) });
      return;
    }
    await plugin.endActivity({
      id: ACTIVITY_ID,
      contentState: { exerciseName: '', setProgress: '', restEndTime: '' },
      dismissalPolicy: 'immediate',
    });
  }
  await plugin.startActivity({
    id: ACTIVITY_ID,
    attributes: { dayName: state.dayName },
    contentState: toContentState(state),
  });
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
      contentState: { exerciseName: '', setProgress: '', restEndTime: '' },
      dismissalPolicy: 'immediate',
    });
  } catch (err) {
    void log('warn', `live activity end failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
