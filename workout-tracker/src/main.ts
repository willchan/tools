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

// Capacitor's native WKWebView delegate disables the pinch gesture
// recognizer the instant ANY zoom begins (scrollViewWillBeginZooming in
// its WebViewDelegationHandler) and never re-enables it — so a
// double-tap-to-zoom trips the same one-way disable and leaves pinch dead,
// with no way to zoom back out. Keeping this page's own viewport pinned to
// maximum-scale=1.0/user-scalable=no while native stops WKWebView from
// ever starting a zoom, so that delegate callback never fires.
// MainViewController.swift additionally clamps the scroll view's zoom
// range natively, before the page has even loaded, closing the gap
// between initial parse and this script running. Web/PWA users are left
// on the permissive viewport — pinch-to-zoom there is real accessibility
// functionality (WCAG 1.4.4) with no equivalent bug to work around.
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
