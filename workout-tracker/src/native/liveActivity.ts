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
}

function toContentState(state: WorkoutActivityState): Record<string, string> {
  return {
    exerciseName: state.exerciseName,
    setProgress: `${state.setIndex}/${state.setTotal}`,
    restEndTime: state.restEndTime !== null ? String(state.restEndTime) : '',
  };
}

async function loadPlugin() {
  const { LiveActivity } = await import('capacitor-live-activity');
  return LiveActivity;
}

export async function startWorkoutActivity(state: WorkoutActivityState): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const LiveActivity = await loadPlugin();
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
    const LiveActivity = await loadPlugin();
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
    const LiveActivity = await loadPlugin();
    await LiveActivity.endActivity({
      id: ACTIVITY_ID,
      contentState: { exerciseName: '', setProgress: '', restEndTime: '' },
      dismissalPolicy: 'immediate',
    });
  } catch (err) {
    void log('warn', `live activity end failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
