import {
  getAllTrainingMaxes,
  putTrainingMax,
  exportAll,
  importAll,
  getAllExercises,
  getState,
  putState,
  getAllTemplates,
  getSettings,
  putSettings,
} from '../db/database';
import type { ProgressionState } from '../db/types';
import { navigate, type Route } from './router';
import { requestNotificationPermission } from './notifications';
import { getAllLogs, clearLogs } from '../logic/logger';

export async function renderSettings(container: HTMLElement): Promise<void> {
  const tms = await getAllTrainingMaxes();
  const exercises = await getAllExercises();
  const state = await getState();
  const templates = await getAllTemplates();
  const settings = await getSettings();
  const logs = await getAllLogs();
  const template = templates.find((t) => t.id === state?.templateId);

  container.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <button id="back-btn" class="btn btn-text">&larr; Back</button>
    <h1>Settings</h1>
  `;
  container.appendChild(header);

  const main = document.createElement('main');
  main.className = 'settings-screen';

  // Training Maxes section
  const tmSection = document.createElement('section');
  tmSection.innerHTML = `<h2>Training Maxes</h2>`;
  const tmForm = document.createElement('div');
  tmForm.className = 'tm-form';
  tmForm.dataset.testid = 'tm-form';

  const mainLifts = ['squat', 'bench', 'deadlift', 'ohp'];
  for (const liftId of mainLifts) {
    const tm = tms.find((t) => t.exerciseId === liftId);
    const exercise = exercises.find((e) => e.id === liftId);
    const row = document.createElement('div');
    row.className = 'form-group';
    row.innerHTML = `
      <label for="tm-${liftId}">${exercise?.name ?? liftId}</label>
      <input type="number" id="tm-${liftId}" class="tm-input"
             data-exercise="${liftId}" value="${tm?.weight ?? 0}"
             min="0" step="5" inputmode="numeric"
             data-testid="tm-input-${liftId}">
      <span class="unit">lbs</span>
    `;
    tmForm.appendChild(row);
  }

  const saveTmBtn = document.createElement('button');
  saveTmBtn.className = 'btn btn-primary';
  saveTmBtn.id = 'save-tm-btn';
  saveTmBtn.textContent = 'Save Training Maxes';
  tmForm.appendChild(saveTmBtn);
  tmSection.appendChild(tmForm);
  main.appendChild(tmSection);

  // Rest Timer section
  const restSection = document.createElement('section');
  restSection.innerHTML = `
    <h2>Rest Timer</h2>
    <div class="rest-timer-form">
      <div class="form-group">
        <label for="rest-timer-input">Duration (seconds)</label>
        <input type="number" id="rest-timer-input"
               data-testid="rest-timer-input"
               value="${settings.restTimerSeconds}"
               min="30" max="600" step="5" inputmode="numeric">
        <span class="unit">sec</span>
      </div>
      <button id="save-settings-btn" class="btn btn-primary">Save</button>
    </div>
  `;
  main.appendChild(restSection);

  // Progression Override section
  if (state && template) {
    const progSection = document.createElement('section');
    progSection.dataset.testid = 'progression-override';
    progSection.innerHTML = `
      <h2>Program Position</h2>
      <div class="prog-form" data-testid="prog-form">
        <div class="form-group">
          <label for="override-cycle">Cycle</label>
          <input type="number" id="override-cycle" data-testid="override-cycle"
                 value="${state.cycle}" min="1" step="1" inputmode="numeric">
        </div>
        <div class="form-group">
          <label for="override-week">Week</label>
          <input type="number" id="override-week" data-testid="override-week"
                 value="${state.weekIndex + 1}" min="1" max="${template.weeks.length}" step="1" inputmode="numeric">
        </div>
        <div class="form-group">
          <label for="override-day">Day</label>
          <input type="number" id="override-day" data-testid="override-day"
                 value="${state.dayIndex + 1}" min="1" max="${template.weeks[state.weekIndex]?.days.length ?? 4}" step="1" inputmode="numeric">
        </div>
        <button id="save-progression-btn" class="btn btn-primary">Save Position</button>
      </div>
    `;
    main.appendChild(progSection);
  }

  // Notifications section
  const notifSection = document.createElement('section');
  notifSection.innerHTML = `
    <h2>Notifications</h2>
    <p>Enable push notifications for rest timer alerts.</p>
    <button id="enable-notif-btn" class="btn btn-secondary">Enable Notifications</button>
  `;
  main.appendChild(notifSection);

  // Debug Logs section
  const logsSection = document.createElement('section');
  logsSection.dataset.testid = 'debug-logs';
  logsSection.innerHTML = `
    <h2>Debug Logs</h2>
    <p>App keeps the last 7 days of errors locally. Export the file and share with Claude when you hit an issue.</p>
    <p data-testid="log-count">Stored entries: <strong>${logs.length}</strong></p>
    <div class="data-actions">
      <button id="export-logs-btn" class="btn btn-secondary">Export Logs (JSON)</button>
      <button id="clear-logs-btn" class="btn btn-text">Clear Logs</button>
    </div>
  `;
  main.appendChild(logsSection);

  // Export/Import section
  const dataSection = document.createElement('section');
  dataSection.innerHTML = `
    <h2>Data Management</h2>
    <div class="data-actions">
      <button id="export-btn" class="btn btn-secondary">Export Data (JSON)</button>
      <button id="import-btn" class="btn btn-secondary">Import Data</button>
      <input type="file" id="import-file" accept=".json" class="hidden">
    </div>
  `;
  main.appendChild(dataSection);

  // Navigation
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.innerHTML = `
    <button class="nav-btn" data-route="home">Home</button>
    <button class="nav-btn" data-route="templates">Templates</button>
    <button class="nav-btn" data-route="history">History</button>
    <button class="nav-btn active" data-route="settings">Settings</button>
  `;

  container.appendChild(main);
  container.appendChild(nav);

  // Event listeners
  document.getElementById('back-btn')?.addEventListener('click', () => navigate('home'));

  saveTmBtn.addEventListener('click', async () => {
    const inputs = tmForm.querySelectorAll('.tm-input') as NodeListOf<HTMLInputElement>;
    for (const input of inputs) {
      await putTrainingMax({
        exerciseId: input.dataset.exercise!,
        weight: parseInt(input.value) || 0,
      });
    }
    saveTmBtn.textContent = 'Saved!';
    setTimeout(() => {
      saveTmBtn.textContent = 'Save Training Maxes';
    }, 1500);
  });

  document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
    const restInput = document.getElementById('rest-timer-input') as HTMLInputElement;
    const restSeconds = parseInt(restInput.value) || 90;
    const currentSettings = await getSettings();
    await putSettings({ ...currentSettings, restTimerSeconds: restSeconds });
    const btn = document.getElementById('save-settings-btn')!;
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = 'Save'; }, 1500);
  });

  document.getElementById('save-progression-btn')?.addEventListener('click', async () => {
    if (state) {
      const cycle = parseInt((document.getElementById('override-cycle') as HTMLInputElement).value) || 1;
      const weekNum = parseInt((document.getElementById('override-week') as HTMLInputElement).value) || 1;
      const dayNum = parseInt((document.getElementById('override-day') as HTMLInputElement).value) || 1;
      const newState: ProgressionState = {
        ...state,
        cycle,
        weekIndex: weekNum - 1,
        dayIndex: dayNum - 1,
      };
      await putState(newState);
      const btn = document.getElementById('save-progression-btn')!;
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = 'Save Position'; }, 1500);
    }
  });

  document.getElementById('enable-notif-btn')?.addEventListener('click', async () => {
    const granted = await requestNotificationPermission();
    const btn = document.getElementById('enable-notif-btn')!;
    btn.textContent = granted ? 'Notifications Enabled' : 'Permission Denied';
  });

  document.getElementById('export-btn')?.addEventListener('click', async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workout-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('export-logs-btn')?.addEventListener('click', async () => {
    const entries = await getAllLogs();
    const payload = {
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workout-logs-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('clear-logs-btn')?.addEventListener('click', async () => {
    if (!confirm('Clear all stored debug logs?')) return;
    await clearLogs();
    renderSettings(container);
  });

  document.getElementById('import-btn')?.addEventListener('click', () => {
    document.getElementById('import-file')?.click();
  });

  document.getElementById('import-file')?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text);
    await importAll(data);
    navigate('home');
  });

  nav.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = (btn as HTMLElement).dataset.route;
      if (route) navigate(route as Route);
    });
  });
}
