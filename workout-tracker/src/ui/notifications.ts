import { log } from '../logic/logger';
import { isNativePlatform } from '../native/platform';

function postToSW(message: Record<string, unknown>): void {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
  }
}

// Fixed id: only one rest timer is ever active at a time, so a new schedule
// call always supersedes (and a cancel always targets) the same notification.
const NATIVE_TIMER_NOTIFICATION_ID = 1;

export function scheduleBackgroundTimerNotification(expectedEndTime: number): void {
  if (isNativePlatform()) {
    // Native local notifications are scheduled with an absolute fire time —
    // the OS wakes the app for this, unlike the SW setTimeout path below,
    // which iOS can suspend before it elapses.
    void import('@capacitor/local-notifications')
      .then(({ LocalNotifications }) =>
        LocalNotifications.schedule({
          notifications: [
            {
              id: NATIVE_TIMER_NOTIFICATION_ID,
              title: 'Rest Timer Complete',
              body: 'Time for your next set!',
              schedule: { at: new Date(expectedEndTime) },
              sound: 'timer-done.wav',
            },
          ],
        }),
      )
      .catch((err: unknown) => {
        void log(
          'warn',
          `native timer notification schedule failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  } else {
    postToSW({ type: 'TIMER_START', expectedEndTime });
  }
  const delayMs = expectedEndTime - Date.now();
  void log(
    'info',
    'rest timer scheduled',
    `expectedEndTime=${expectedEndTime} delayMs=${delayMs} swControlled=${!!('serviceWorker' in navigator && navigator.serviceWorker.controller)}`,
  );
}

export function cancelBackgroundTimerNotification(): void {
  if (isNativePlatform()) {
    void import('@capacitor/local-notifications')
      .then(({ LocalNotifications }) =>
        LocalNotifications.cancel({ notifications: [{ id: NATIVE_TIMER_NOTIFICATION_ID }] }),
      )
      .catch((err: unknown) => {
        void log(
          'warn',
          `native timer notification cancel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  } else {
    postToSW({ type: 'TIMER_CANCEL' });
  }
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
  if (isNativePlatform()) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const status = await LocalNotifications.requestPermissions();
    return status.display === 'granted';
  }

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
    resumeAudioContext(audioCtx);
  } catch (err) {
    void log(
      'warn',
      `audio context unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// AudioContext.resume() returns a promise that rejects on iOS WebKit when the
// audio session is interrupted — e.g. resuming from a long background — with
// "Failed to start the audio device". The surrounding try/catch can't catch an
// async rejection, so handle it here. The OS notification + vibration still
// alert the user, so a silent beep is acceptable; we just log it as a warning
// instead of letting it surface as an unhandled rejection.
function resumeAudioContext(ctx: AudioContext): void {
  void ctx.resume().catch((err: unknown) => {
    void log(
      'warn',
      `audio resume failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

function playBeepPattern(): void {
  if (!audioCtx) {
    // No primed context — try a best-effort fallback. May be silent if the
    // browser's autoplay policy gates resume() without a recent gesture.
    primeAudioContext();
  }
  if (!audioCtx) return;
  const ctx = audioCtx;
  resumeAudioContext(ctx);
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
  if (isNativePlatform()) {
    // navigator.vibrate is unimplemented in WebKit, so the native app gets
    // real Taptic Engine feedback here instead of the (silently no-op) call
    // in the web branch below.
    void import('@capacitor/haptics')
      .then(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Success }))
      .catch((err: unknown) => {
        void log('warn', `haptics failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  } else if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }

  playBeepPattern();

  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Route through the SW rather than assuming its TIMER_START setTimeout
  // already fired. That's a race, not a guarantee: the page's own expiry
  // detection (a 250ms poll, or the visibilitychange/reload reconcilers)
  // can notice expiry before the SW's setTimeout does, especially under
  // CPU contention (e.g. parallel CI workers) that delays one clock or the
  // other unpredictably. If we skipped this call on the assumption the SW
  // already notified, and it hadn't, no notification would ever fire.
  // TIMER_DONE is always safe to send — the SW's firedForEndTime dedupe
  // (see sw.js) collapses this with an already-fired (or still-pending)
  // setTimeout into a single notification either way, which is exactly
  // what "SW dedupes when both setTimeout and TIMER_DONE arrive for the
  // same timer" in e2e/timer-foreground-fix.spec.ts asserts.
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    postToSW({ type: 'TIMER_DONE' });
    return;
  }

  // Fallback for the rare case where no service worker is controlling the
  // page (e.g. very first load before activation).
  new Notification('Rest Timer Complete', {
    body: 'Time for your next set!',
    icon: './icons/icon-192.png',
    tag: 'rest-timer',
  });
}
