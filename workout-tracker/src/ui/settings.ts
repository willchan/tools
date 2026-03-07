import {
  getAllTrainingMaxes,
  putTrainingMax,
  exportAll,
  importAll,
  getAllExercises,
} from '../db/database';
import { navigate } from './router';
import { requestNotificationPermission } from './notifications';

export async function renderSettings(container: HTMLElement): Promise<void> {
  const tms = await getAllTrainingMaxes();
  const exercises = await getAllExercises();

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

  // Notifications section
  const notifSection = document.createElement('section');
  notifSection.innerHTML = `
    <h2>Notifications</h2>
    <p>Enable push notifications for rest timer alerts.</p>
    <button id="enable-notif-btn" class="btn btn-secondary">Enable Notifications</button>
  `;
  main.appendChild(notifSection);

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
      if (route) navigate(route as any);
    });
  });
}
