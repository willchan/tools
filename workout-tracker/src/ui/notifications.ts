export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function fireTimerNotification(): void {
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
