import './style.css';
import { seedDefaults } from './db/database';
import { registerRoute, startRouter } from './ui/router';
import { renderHome } from './ui/home';
import { renderWorkout } from './ui/workout';
import { renderTemplates, renderTemplateEdit } from './ui/templates';
import { renderHistory } from './ui/history';
import { renderSettings } from './ui/settings';

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
  startRouter();
}

init();

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch {
      // SW registration failed
    }
  });
}
