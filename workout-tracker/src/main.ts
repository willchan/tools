import './style.css';
import { seedDefaults } from './db/database';
import { registerRoute, startRouter } from './ui/router';
import { renderHome } from './ui/home';
import { renderWorkout } from './ui/workout';
import { renderTemplates, renderTemplateEdit } from './ui/templates';
import { renderHistory } from './ui/history';
import { renderSettings } from './ui/settings';
import { installGlobalErrorHandlers, log, pruneOldLogs } from './logic/logger';
import { installSwTimerLogging } from './ui/notifications';
import { checkForOtaUpdate } from './native/otaUpdate';
import { isNativePlatform } from './native/platform';

installGlobalErrorHandlers();
installSwTimerLogging();
void checkForOtaUpdate();

// The Capacitor-wrapped iOS WKWebView ships with its pinch gesture
// recognizer disabled, so a double-tap-to-zoom (still reachable via the
// permissive viewport below) has no way to be reversed by pinching back
// out. Lock zoom only inside that native shell — ordinary mobile browser
// and installed-PWA users keep pinch-to-zoom, which iOS/Android rely on
// for accessibility (WCAG 1.4.4).
if (isNativePlatform()) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
    );
}

const app = document.getElementById('app')!;

// Register routes
registerRoute('home', () => renderHome(app));
registerRoute('workout', () => renderWorkout(app));
registerRoute('templates', () => renderTemplates(app));
registerRoute('template-edit', (params) => renderTemplateEdit(app, params));
registerRoute('history', () => renderHistory(app));
registerRoute('settings', () => renderSettings(app));

// Initialize
async function init() {
  await seedDefaults();
  await pruneOldLogs();
  const notifPermission = 'Notification' in window ? Notification.permission : 'unsupported';
  const swController = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  await log(
    'info',
    'app started',
    `commit=${__APP_COMMIT__} buildTime=${__BUILD_TIME__} notificationPermission=${notifPermission} swController=${swController}`,
  );
  // Scraped by .github/workflows/ios.yml's Simulator smoke test (via
  // `simctl launch --console-pty` under `script`, which picks up console.*
  // calls forwarded through Capacitor's iOS bridge) to confirm the WKWebView
  // actually loaded and ran this bundle inside the native shell, not just
  // that Xcode compiled it.
  console.log('WORKOUT_TRACKER_APP_READY');
  startRouter();
}

init();

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      await log(
        'error',
        `service worker registration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}
