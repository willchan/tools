import type { TimerState } from '../db/types';

const DEFAULT_REST_SECONDS = 90;

/**
 * Create a new timer state based on the current time.
 * This approach is resilient to background tab suspension:
 * we store the expected end time, so even if the browser pauses
 * the JS timer, we can recalculate remaining time on wake.
 */
export function createTimerState(restSeconds: number = DEFAULT_REST_SECONDS): TimerState {
  const durationMs = restSeconds * 1000;
  return {
    expectedEndTime: Date.now() + durationMs,
    durationMs,
  };
}

/**
 * Get remaining time in milliseconds. Negative means timer has expired.
 */
export function getRemainingMs(timer: TimerState): number {
  return timer.expectedEndTime - Date.now();
}

/**
 * Format remaining milliseconds as MM:SS.
 */
export function formatTime(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
