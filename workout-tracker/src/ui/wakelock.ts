let wakeLock: WakeLockSentinel | null = null;

export async function requestWakeLock(): Promise<void> {
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
  wakeLock?.release();
  wakeLock = null;
}

// Re-acquire wake lock when page becomes visible again
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && wakeLock === null) {
    // Only re-request if we had one before (i.e., during active workout)
    // The workout screen will call requestWakeLock() itself
  }
});
