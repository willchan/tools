let wakeLock: WakeLockSentinel | null = null;
let wakeLockActive = false;

export async function requestWakeLock(): Promise<void> {
  wakeLockActive = true;
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch {
    // Wake Lock request failed (e.g., low battery, not supported)
  }
}

export function releaseWakeLock(): void {
  wakeLockActive = false;
  wakeLock?.release();
  wakeLock = null;
}

// Re-acquire wake lock when page becomes visible again
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && wakeLock === null && wakeLockActive) {
    await requestWakeLock();
  }
});
