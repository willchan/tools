import { getState, getAllTemplates, getAllTrainingMaxes, putState, getSettings, putSettings, getAllHistory } from '../db/database';
import type { ProgressionState } from '../db/types';
import { navigate, type Route } from './router';
import { decorateSettingsNavBadge } from '../logic/logger';

export async function renderHome(container: HTMLElement): Promise<void> {
  const state = await getState();
  const templates = await getAllTemplates();
  const tms = await getAllTrainingMaxes();
  const settings = await getSettings();

  const history = await getAllHistory();
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

    const weekPickerButtons = template.weeks.map((w, i) =>
      `<button class="week-picker-btn ${i === state.weekIndex ? 'active' : ''}" data-week-index="${i}">${w.name}</button>`
    ).join('');

    // Find completed days for the current cycle+week
    const completedDayIndices = new Set(
      history
        .filter((log) => log.templateId === state.templateId && log.cycle === state.cycle && log.weekIndex === state.weekIndex)
        .map((log) => log.dayIndex)
    );

    // Auto-correct stale position: if the current day is already completed, advance
    // to the first incomplete day within this week. Only corrects dayIndex — never
    // jumps to the next week. True week/cycle progression is handled by completeWorkout().
    if (week && completedDayIndices.has(state.dayIndex)) {
      const firstIncomplete = week.days.findIndex((_, i) => !completedDayIndices.has(i));
      if (firstIncomplete >= 0) {
        await putState({ ...state, dayIndex: firstIncomplete });
        return renderHome(container);
      }
      // All days in this week are done — fall through and show the week as complete.
    }

    const allDaysComplete = week ? week.days.every((_, i) => completedDayIndices.has(i)) : false;

    const dayPickerButtons = week?.days.map((d, i) => {
      const isCompleted = completedDayIndices.has(i);
      const classes = ['day-picker-btn'];
      if (i === state.dayIndex) classes.push('active');
      if (isCompleted) classes.push('completed');
      return `<button class="${classes.join(' ')}" data-day-index="${i}" ${isCompleted ? 'disabled' : ''}>${d.name}</button>`;
    }).join('') ?? '';

    nextSection.innerHTML = `
      <h2>Next Workout</h2>
      <div class="workout-card" data-testid="next-workout-card">
        <p class="template-name">${template.name}</p>
        <p class="cycle-info">Cycle ${state.cycle} · ${week?.name ?? 'Unknown'}</p>
        <div class="week-picker" data-testid="week-picker">${weekPickerButtons}</div>
        <div class="day-picker" data-testid="day-picker">${dayPickerButtons}</div>
        <p class="day-name">${allDaysComplete ? 'Week complete — select another week or update your position in Settings' : (day?.name ?? 'Unknown')}</p>
        <label class="intersperse-option" data-testid="intersperse-label" ${allDaysComplete ? 'style="display:none"' : ''}>
          <input type="checkbox" id="intersperse-checkbox"
                 data-testid="intersperse-checkbox"
                 ${settings.intersperseAccessories ? 'checked' : ''}>
          <span>Intersperse accessories between main sets</span>
        </label>
        <button id="start-workout-btn" class="btn btn-primary btn-large" ${allDaysComplete ? 'disabled' : ''}>
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
  await decorateSettingsNavBadge(nav);

  // Event listeners
  const intersperseCheckbox = document.getElementById('intersperse-checkbox') as HTMLInputElement | null;
  intersperseCheckbox?.addEventListener('change', async () => {
    const current = await getSettings();
    await putSettings({ ...current, intersperseAccessories: intersperseCheckbox.checked });
  });

  const startBtn = document.getElementById('start-workout-btn');
  startBtn?.addEventListener('click', () => navigate('workout'));

  const setupBtn = document.getElementById('setup-template-btn');
  setupBtn?.addEventListener('click', () => navigate('templates'));

  // Week picker — allow selecting a different week
  container.querySelectorAll('.week-picker-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newWeekIndex = parseInt((btn as HTMLElement).dataset.weekIndex!);
      if (state && template) {
        // Re-clicking the active week must not reset the day selection.
        if (newWeekIndex === state.weekIndex) return;

        // Set dayIndex to the first incomplete day in the target week so that
        // the auto-correction in renderHome won't fire a second putState and
        // accidentally overwrite the intended position.
        const newWeek = template.weeks[newWeekIndex];
        if (!newWeek) return;
        const completedInNewWeek = new Set(
          history
            .filter((log) => log.templateId === state.templateId && log.cycle === state.cycle && log.weekIndex === newWeekIndex)
            .map((log) => log.dayIndex)
        );
        const firstIncomplete = newWeek.days.findIndex((_, i) => !completedInNewWeek.has(i));
        // Fall back to 0 when all days are done (auto-correction will advance to next week).
        const newDayIndex = firstIncomplete >= 0 ? firstIncomplete : 0;
        await putState({ ...state, weekIndex: newWeekIndex, dayIndex: newDayIndex });
        renderHome(container);
      }
    });
  });

  // Day picker — allow selecting a different day within the current week
  container.querySelectorAll('.day-picker-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newDayIndex = parseInt((btn as HTMLElement).dataset.dayIndex!);
      if (state && template) {
        const newState: ProgressionState = { ...state, dayIndex: newDayIndex };
        await putState(newState);
        renderHome(container);
      }
    });
  });

  nav.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = (btn as HTMLElement).dataset.route;
      if (route) navigate(route as Route);
    });
  });
}
