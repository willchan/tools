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
    // which iOS can suspend before it elapses. Once scheduled, this lives in
    // the OS's own notification center, independent of this JS module — it
    // survives a page reload or the app being backgrounded/evicted, which is
    // exactly why fireTimerNotification() below queries the OS directly
    // (getPending/getDeliveredNotifications) rather than trusting an
    // in-memory "did schedule() succeed" flag that a reload would reset.
    void import('@capacitor/local-notifications')
      .then(({ LocalNotifications }) => {
        // The fixed id means a *delivered* entry from the previous rest
        // timer is still sitting in getDeliveredNotifications() — the OS
        // doesn't clear it just because a new one is scheduled, and nothing
        // else in this codebase ever calls
        // remove(All)DeliveredNotifications(). Left alone, that stale entry
        // would permanently satisfy fireTimerNotification()'s "did the OS
        // already alert" check for every timer after the first one that
        // ever actually delivered — including ones whose schedule() below
        // fails, silencing the fallback cue that failure case exists to
        // trigger. Clear it so a later delivered-notification match can
        // only mean *this* timer fired. This app only ever has this one
        // kind of notification, so clearing all delivered ones (rather
        // than filtering by id, which the plugin's types awkwardly require
        // a title/body for) is equivalent and simpler.
        //
        // Deliberately NOT awaited before schedule() below: it only needs
        // to land sometime before this timer's own eventual
        // fireTimerNotification() check (90+ seconds away), not before
        // scheduling. Gating schedule() behind it previously delayed the
        // moment this notification actually became pending/cancellable —
        // long enough that a cancelBackgroundTimerNotification() call
        // fired immediately after (e.g. skip-timer-btn, or this same test)
        // could complete *before* schedule() had run, cancelling nothing
        // and leaving the notification to fire anyway. Best-effort: if
        // this rejects, log it — a silently-swallowed failure here is
        // exactly what would leave the stale-entry problem it exists to
        // prevent.
        void LocalNotifications.removeAllDeliveredNotifications().catch((err: unknown) => {
          void log(
            'warn',
            `clearing stale delivered timer notification failed: ${errString(err)}`,
          );
        });
        return LocalNotifications.schedule({
          notifications: [
            {
              id: NATIVE_TIMER_NOTIFICATION_ID,
              title: 'Rest Timer Complete',
              body: 'Time for your next set!',
              schedule: { at: new Date(expectedEndTime) },
              sound: 'timer-done.wav',
            },
          ],
        });
      })
      .catch((err: unknown) => {
        void log(
          'warn',
          `native timer notification schedule failed: ${errString(err)}`,
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

export async function cancelBackgroundTimerNotification(): Promise<void> {
  if (isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.cancel({ notifications: [{ id: NATIVE_TIMER_NOTIFICATION_ID }] });
    } catch (err) {
      void log(
        'warn',
        `native timer notification cancel failed: ${errString(err)}`,
      );
    }
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
      `audio context unavailable: ${errString(err)}`,
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
      `audio resume failed: ${errString(err)}`,
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

/**
 * Fires the client-side rest-timer alert (haptic + beep, and/or a browser
 * Notification), skipping it where an OS/SW notification already covers the
 * same expiry. Returns whether the caller should still call
 * cancelBackgroundTimerNotification() afterward — see the native branch's
 * comment for why that isn't simply "always".
 */
export async function fireTimerNotification(): Promise<boolean> {
  if (isNativePlatform()) {
    // The native branch scheduled a real OS local notification for this
    // exact expiry (see scheduleBackgroundTimerNotification) — it has its
    // own sound (timer-done.wav) and system-default alert vibration, and it
    // fires from the OS clock regardless of whether this JS is even running.
    // Playing our own haptic + beep unconditionally on top of that produced
    // a guaranteed double alert on every timer completion. Check whether the
    // OS notification will actually alert the user first; only fall back to
    // our own cue when it won't. This queries the OS's own notification
    // center directly (getPending/getDeliveredNotifications) rather than an
    // in-memory "did schedule() succeed" flag — a flag like that resets on
    // every page reload, but the OS-scheduled notification itself survives
    // one (it's owned by iOS, not this JS), so a flag would wrongly report
    // "no OS alert coming" for a rest timer that outlives a reload and cause
    // exactly the double-alert this fix exists to prevent. Checking permission
    // alone isn't enough either — schedule() can still reject (transient
    // bridge error), which permission being granted wouldn't catch.
    let osWillAlert = false;
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const status = await LocalNotifications.checkPermissions();
      if (status.display === 'granted') {
        // allSettled, not all: a transient failure in *one* of these must
        // not discard whatever the *other* one already proved. Promise.all
        // would reject the whole pair on the first failure, falling back to
        // osWillAlert=false (and firing our own cue) even when the
        // surviving result alone was enough to show the OS will alert.
        const [pendingResult, deliveredResult] = await Promise.allSettled([
          LocalNotifications.getPending(),
          LocalNotifications.getDeliveredNotifications(),
        ]);
        if (pendingResult.status === 'rejected') {
          void log('warn', `native getPending failed: ${errString(pendingResult.reason)}`);
        }
        if (deliveredResult.status === 'rejected') {
          void log('warn', `native getDeliveredNotifications failed: ${errString(deliveredResult.reason)}`);
        }
        const isOurs = (n: { id: number }) => n.id === NATIVE_TIMER_NOTIFICATION_ID;
        osWillAlert =
          (pendingResult.status === 'fulfilled' && pendingResult.value.notifications.some(isOurs)) ||
          (deliveredResult.status === 'fulfilled' && deliveredResult.value.notifications.some(isOurs));
      }
    } catch (err) {
      // Covers checkPermissions() above — getPending()/getDeliveredNotifications()
      // failures are handled per-call above via allSettled.
      void log('warn', `native OS-alert-state check failed: ${errString(err)}`);
    }

    if (osWillAlert) {
      // Trusting the OS to alert — do NOT also cancel it below.
      // "pending" means it hasn't fired yet but will imminently (its
      // scheduled time has already passed); cancelling it now would
      // silently prevent it from ever firing, leaving nothing to alert the
      // user at all. "delivered" means it already fired; cancel() only
      // affects pending requests anyway, so it'd be a no-op, but skipping
      // it also skips an unnecessary native bridge round trip that would
      // otherwise widen the window for the next rest timer's own schedule()
      // call to race against it (see notifyTimerExpired's comment).
      return false;
    }

    // navigator.vibrate is unimplemented in WebKit, so the native app gets
    // real Taptic Engine feedback here instead of the (silently no-op)
    // call in the web branch below.
    void import('@capacitor/haptics')
      .then(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Success }))
      .catch((err: unknown) => {
        void log('warn', `haptics failed: ${errString(err)}`);
      });
    playBeepPattern();
    // Nothing is confirmed pending/delivered for this timer (permission
    // denied, the OS state check itself failed, or schedule() never
    // actually landed) — cancel whatever might still be lingering so it
    // can't surface a late, redundant alert on top of the cue just fired.
    return true;
  }

  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }

  playBeepPattern();

  if ('Notification' in window && Notification.permission === 'granted') {
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
    } else {
      // Fallback for the rare case where no service worker is controlling
      // the page (e.g. very first load before activation).
      new Notification('Rest Timer Complete', {
        body: 'Time for your next set!',
        icon: './icons/icon-192.png',
        tag: 'rest-timer',
      });
    }
  }

  // Web/PWA: the SW's own firedForEndTime dedupe (see sw.js) already
  // collapses a redundant setTimeout-vs-TIMER_DONE firing for the *same*
  // timer, so cancelling the SW's pending setTimeout here is just tidying
  // up a call that's already safe either way — always do it, preserving the
  // existing tested behavior (e2e/timer-visibility-reconcile.spec.ts's
  // "stale SW-side background timer must be cancelled").
  return true;
}

function errString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
