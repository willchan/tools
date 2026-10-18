import { isNativePlatform } from './platform';
import { log } from '../logic/logger';
import { getActiveWorkout } from '../db/database';

// Static JSON manifest published by .github/workflows/deploy.yml alongside
// the PWA build. GitHub Pages only serves plain GETs, which is why this
// drives @capgo/capacitor-updater manually (fetch + download + set) instead
// of relying on the plugin's built-in updateUrl/autoUpdate polling, which
// expects a POST-based update-check API.
const UPDATE_MANIFEST_URL = 'https://willchan.github.io/tools/ota/workout-tracker/update.json';

interface OtaManifest {
  version: string;
  url: string;
}

export async function checkForOtaUpdate(): Promise<void> {
  if (!isNativePlatform()) return;

  const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
  // Tell the plugin the just-launched bundle is good; otherwise it rolls
  // back to the previous bundle after its appReadyTimeout.
  await CapacitorUpdater.notifyAppReady();

  try {
    const res = await fetch(UPDATE_MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const manifest = (await res.json()) as OtaManifest;

    const { bundle } = await CapacitorUpdater.current();
    if (!manifest.version || manifest.version === bundle.version) return;

    // Applying an update reloads the WebView. Launched in the background (by
    // a watch tap or a watch-started workout), that reload doesn't finish
    // until the app is opened: a blank screen, and the page loses whatever it
    // hadn't saved yet. Mid-workout it would interrupt the workout. Either
    // way, leave it for the next launch.
    const reason =
      document.visibilityState === 'hidden' ? 'background' : (await getActiveWorkout()) ? 'workout' : null;
    if (reason) {
      await log('info', 'ota update deferred', `version=${manifest.version} reason=${reason}`);
      return;
    }

    const next = await CapacitorUpdater.download({ url: manifest.url, version: manifest.version });
    await CapacitorUpdater.set({ id: next.id });
    await log('info', 'ota update applied', `version=${manifest.version}`);
  } catch (err) {
    await log('warn', `ota update check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
