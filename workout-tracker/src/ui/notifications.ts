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

  // Play a short beep sound as audio feedback
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
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
