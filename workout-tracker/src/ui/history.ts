import { getAllHistory } from '../db/database';
import { navigate } from './router';

export async function renderHistory(container: HTMLElement): Promise<void> {
  const history = await getAllHistory();
  // Sort by most recent first
  history.sort((a, b) => b.completedAt - a.completedAt);

  container.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <button id="back-btn" class="btn btn-text">&larr; Back</button>
    <h1>History</h1>
  `;
  container.appendChild(header);

  const main = document.createElement('main');
  main.className = 'history-screen';

  if (history.length === 0) {
    main.innerHTML = '<p class="empty-state" data-testid="history-empty">No workouts completed yet. Start your first workout!</p>';
  } else {
    const list = document.createElement('div');
    list.className = 'history-list';
    list.dataset.testid = 'history-list';

    for (const log of history) {
      const date = new Date(log.completedAt);
      const duration = Math.round((log.completedAt - log.startedAt) / 60000);

      const card = document.createElement('div');
      card.className = 'history-card';
      card.innerHTML = `
        <div class="history-header">
          <h3>${log.dayName}</h3>
          <span class="history-date">${date.toLocaleDateString()}</span>
        </div>
        <p class="history-meta">Cycle ${log.cycle} · Week ${log.weekIndex + 1} · ${duration} min</p>
        <p class="history-sets">${log.sets.length} sets completed</p>
        ${log.sets.filter((s) => s.isAmrap).map((s) => `<p class="history-amrap">AMRAP: ${s.exerciseId} — ${s.actualReps} reps @ ${s.weight} lbs</p>`).join('')}
      `;
      list.appendChild(card);
    }

    main.appendChild(list);
  }

  // Navigation
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.innerHTML = `
    <button class="nav-btn" data-route="home">Home</button>
    <button class="nav-btn" data-route="templates">Templates</button>
    <button class="nav-btn active" data-route="history">History</button>
    <button class="nav-btn" data-route="settings">Settings</button>
  `;

  container.appendChild(main);
  container.appendChild(nav);

  document.getElementById('back-btn')?.addEventListener('click', () => navigate('home'));
  nav.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = (btn as HTMLElement).dataset.route;
      if (route) navigate(route as any);
    });
  });
}
