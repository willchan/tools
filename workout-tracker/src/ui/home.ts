import { getState, getAllTemplates, getAllTrainingMaxes } from '../db/database';
import { navigate } from './router';

export async function renderHome(container: HTMLElement): Promise<void> {
  const state = await getState();
  const templates = await getAllTemplates();
  const tms = await getAllTrainingMaxes();

  const template = templates.find((t) => t.id === state?.templateId);

  container.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `<h1>Workout Tracker</h1>`;
  container.appendChild(header);

  const main = document.createElement('main');
  main.className = 'home-screen';

  // Next workout section
  const nextSection = document.createElement('section');
  nextSection.className = 'next-workout';

  if (template && state) {
    const week = template.weeks[state.weekIndex];
    const day = week?.days[state.dayIndex];

    nextSection.innerHTML = `
      <h2>Next Workout</h2>
      <div class="workout-card" data-testid="next-workout-card">
        <p class="template-name">${template.name}</p>
        <p class="cycle-info">Cycle ${state.cycle} · ${week?.name ?? 'Unknown'}</p>
        <p class="day-name">${day?.name ?? 'Unknown'}</p>
        <button id="start-workout-btn" class="btn btn-primary btn-large">
          Start Next Workout
        </button>
      </div>
    `;
  } else {
    nextSection.innerHTML = `
      <h2>Welcome!</h2>
      <p>No workout template configured. Set up your first template to get started.</p>
      <button id="setup-template-btn" class="btn btn-primary">Set Up Template</button>
    `;
  }

  main.appendChild(nextSection);

  // Training maxes display
  if (tms.length > 0) {
    const tmSection = document.createElement('section');
    tmSection.className = 'training-maxes';
    tmSection.innerHTML = `
      <h2>Training Maxes</h2>
      <div class="tm-grid" data-testid="tm-grid">
        ${tms.map((tm) => `
          <div class="tm-item">
            <span class="tm-exercise">${tm.exerciseId}</span>
            <span class="tm-weight">${tm.weight} lbs</span>
          </div>
        `).join('')}
      </div>
    `;
    main.appendChild(tmSection);
  }

  // Navigation
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.innerHTML = `
    <button class="nav-btn active" data-route="home">Home</button>
    <button class="nav-btn" data-route="templates">Templates</button>
    <button class="nav-btn" data-route="history">History</button>
    <button class="nav-btn" data-route="settings">Settings</button>
  `;
  container.appendChild(main);
  container.appendChild(nav);

  // Event listeners
  const startBtn = document.getElementById('start-workout-btn');
  startBtn?.addEventListener('click', () => navigate('workout'));

  const setupBtn = document.getElementById('setup-template-btn');
  setupBtn?.addEventListener('click', () => navigate('templates'));

  nav.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = (btn as HTMLElement).dataset.route;
      if (route) navigate(route as any);
    });
  });
}
