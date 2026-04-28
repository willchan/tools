import { log } from '../logic/logger';

let wakeLock: WakeLockSentinel | null = null;
let wakeLockActive = false;

export async function requestWakeLock(): Promise<void> {
  wakeLockActive = true;
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch (err) {
    void log(
      'warn',
      `wake lock request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function releaseWakeLock(): void {
  wakeLockActive = false;
  const sentinel = wakeLock;
  wakeLock = null;
  // iOS Safari has been observed to reject release() with AbortError when
  // the system has already auto-released the sentinel (notably across
  // visibility changes). Treat it as best-effort cleanup so a stray
  // rejection doesn't surface as an unhandled rejection.
  sentinel?.release().catch((err) => {
    void log(
      'warn',
      `wake lock release failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

// Re-acquire wake lock when page becomes visible again
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && wakeLock === null && wakeLockActive) {
    await requestWakeLock();
  }
});
