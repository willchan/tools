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

installGlobalErrorHandlers();
installSwTimerLogging();

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
  await log('info', 'app started', `commit=${__APP_COMMIT__} buildTime=${__BUILD_TIME__}`);
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
