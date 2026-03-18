function postToSW(message: Record<string, unknown>): void {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
  }
}

export function scheduleBackgroundTimerNotification(expectedEndTime: number): void {
  postToSW({ type: 'TIMER_START', expectedEndTime });
}

export function cancelBackgroundTimerNotification(): void {
  postToSW({ type: 'TIMER_CANCEL' });
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function fireTimerNotification(): void {
  // Vibrate the device (works even without notification permission)
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }

  // Play a multi-beep audio pattern for attention
  try {
    const ctx = new AudioContext();
    ctx.resume().then(() => {
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
    });
  } catch {
    // AudioContext may not be available
  }

  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Try service worker notification first (works in background)
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'TIMER_DONE',
    });
    return;
  }

  // Fallback to regular notification
  new Notification('Rest Timer Complete', {
    body: 'Time for your next set!',
    icon: './icons/icon-192.png',
    tag: 'rest-timer',
  });
}
