import { log } from '../logic/logger';

function postToSW(message: Record<string, unknown>): void {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
  }
}

export function scheduleBackgroundTimerNotification(expectedEndTime: number): void {
  postToSW({ type: 'TIMER_START', expectedEndTime });
  const delayMs = expectedEndTime - Date.now();
  void log(
    'info',
    'rest timer scheduled',
    `expectedEndTime=${expectedEndTime} delayMs=${delayMs} swControlled=${!!('serviceWorker' in navigator && navigator.serviceWorker.controller)}`,
  );
}

export function cancelBackgroundTimerNotification(): void {
  postToSW({ type: 'TIMER_CANCEL' });
}

/**
 * Listen for the SW broadcast when it actually fires the rest-timer
 * notification, and log the latency vs the original expected time. Useful
 * for diagnosing iOS PWA cases where the SW is suspended in the background.
 */
export function installSwTimerLogging(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'TIMER_NOTIFICATION_SHOWN') return;
    const firedAt = typeof data.firedAt === 'number' ? data.firedAt : Date.now();
    const expectedEndTime = typeof data.expectedEndTime === 'number' ? data.expectedEndTime : null;
    const lateByMs = expectedEndTime !== null ? firedAt - expectedEndTime : null;
    void log(
      'info',
      'rest timer notification shown',
      `firedAt=${firedAt} expectedEndTime=${expectedEndTime} lateByMs=${lateByMs}`,
    );
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

// Cached AudioContext, created at user-gesture time so beeps can play later
// without being blocked by Chrome's autoplay policy.
let audioCtx: AudioContext | null = null;

export function primeAudioContext(): void {
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    if (!audioCtx) audioCtx = new Ctor();
    void audioCtx.resume();
  } catch (err) {
    void log(
      'warn',
      `audio context unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function playBeepPattern(): void {
  if (!audioCtx) {
    // No primed context — try a best-effort fallback. May be silent if the
    // browser's autoplay policy gates resume() without a recent gesture.
    primeAudioContext();
  }
  if (!audioCtx) return;
  const ctx = audioCtx;
  void ctx.resume();
  const beepCount = 3;
  const beepDuration = 0.2;
  const gapDuration = 0.15;
  for (let i = 0; i < beepCount; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.7;
    const startTime = ctx.currentTime + i * (beepDuration + gapDuration);
    osc.start(startTime);
    osc.stop(startTime + beepDuration);
  }
}

export function fireTimerNotification(): void {
  // Vibrate the device (works even without notification permission)
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }

  playBeepPattern();

  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // The SW's TIMER_START already scheduled a system notification, so we do
  // NOT post TIMER_DONE here — that would cause a duplicate notification on
  // platforms (notably Android) where same-tag notifications still surface
  // twice when shown back-to-back.
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) return;

  // Fallback for the rare case where no service worker is controlling the
  // page (e.g. very first load before activation).
  new Notification('Rest Timer Complete', {
    body: 'Time for your next set!',
    icon: './icons/icon-192.png',
    tag: 'rest-timer',
  });
}
