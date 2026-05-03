import { getAllHistory, putWorkoutLog, deleteWorkoutLog, getAllTemplates, getState } from '../db/database';
import type { WorkoutLog } from '../db/types';
import { navigate, type Route } from './router';
import { decorateSettingsNavBadge } from '../logic/logger';

export async function renderHistory(container: HTMLElement): Promise<void> {
  const history = (await getAllHistory()).toSorted((a, b) => b.completedAt - a.completedAt);

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

  // Add Past Workout button
  const addPastBtn = document.createElement('button');
  addPastBtn.className = 'btn btn-secondary';
  addPastBtn.dataset.testid = 'add-past-workout-btn';
  addPastBtn.textContent = 'Add Past Workout';
  addPastBtn.style.marginBottom = '16px';
  addPastBtn.style.width = '100%';
  main.appendChild(addPastBtn);

  if (history.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.dataset.testid = 'history-empty';
    empty.textContent = 'No workouts completed yet. Start your first workout!';
    main.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'history-list';
    list.dataset.testid = 'history-list';

    for (const log of history) {
      const date = new Date(log.completedAt);
      const duration = Math.round((log.completedAt - log.startedAt) / 60000);

      const tmBlock = renderTMAdjustments(log);

      const card = document.createElement('div');
      card.className = 'history-card';
      card.dataset.logId = log.id;
      card.innerHTML = `
        <div class="history-header">
          <h3>${log.dayName}</h3>
          <span class="history-date">${date.toLocaleDateString()}</span>
        </div>
        <p class="history-meta">Cycle ${log.cycle} · Week ${log.weekIndex + 1} · ${duration} min</p>
        <p class="history-sets">${log.sets.length} sets completed</p>
        ${log.sets.filter((s) => s.isAmrap).map((s) => `<p class="history-amrap">AMRAP: ${s.exerciseId} — ${s.actualReps} reps @ ${s.weight} lbs</p>`).join('')}
        ${tmBlock}
        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button class="btn btn-small btn-secondary edit-workout-btn" data-testid="edit-workout-btn" data-log-id="${log.id}">Edit</button>
          <button class="btn btn-small btn-danger delete-workout-btn" data-testid="delete-workout-btn" data-log-id="${log.id}">Delete</button>
        </div>
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
  await decorateSettingsNavBadge(nav);

  // Event listeners
  document.getElementById('back-btn')?.addEventListener('click', () => navigate('home'));

  // Edit workout buttons
  container.querySelectorAll('.edit-workout-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const logId = (btn as HTMLElement).dataset.logId!;
      const log = history.find((l) => l.id === logId);
      if (log) renderEditForm(container, main, log);
    });
  });

  // Delete workout buttons
  container.querySelectorAll('.delete-workout-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const logId = (btn as HTMLElement).dataset.logId!;
      const log = history.find((l) => l.id === logId);
      if (!log) return;
      if (confirm(`Delete "${log.dayName}" on ${new Date(log.completedAt).toLocaleDateString()}?`)) {
        await deleteWorkoutLog(logId);
        renderHistory(container);
      }
    });
  });

  // Add past workout button
  addPastBtn.addEventListener('click', () => {
    renderAddPastForm(container, main);
  });

  nav.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = (btn as HTMLElement).dataset.route;
      if (route) navigate(route as Route);
    });
  });
}

function renderTMAdjustments(log: WorkoutLog): string {
  if (!log.tmAdjustments || log.tmAdjustments.length === 0) return '';
  const rows = log.tmAdjustments
    .map((a) => {
      if (a.hitTarget) {
        return `<li class="cycle-row bumped">
          <span class="cycle-lift">${a.exerciseId}</span>
          <span class="cycle-tm">${a.previousTrainingMax} → ${a.newTrainingMax}</span>
          <span class="cycle-tag bumped">+${a.appliedIncrement}</span>
        </li>`;
      }
      return `<li class="cycle-row held">
        <span class="cycle-lift">${a.exerciseId}</span>
        <span class="cycle-tm">${a.previousTrainingMax}</span>
        <span class="cycle-tag held">held (${a.amrapReps}/${a.prescribedReps})</span>
      </li>`;
    })
    .join('');
  return `
    <div class="tm-adjustments-banner" data-testid="tm-adjustments">
      <p class="tm-adjustments-title">Cycle ${log.cycle} complete — training max update</p>
      <ul class="cycle-list">${rows}</ul>
    </div>
  `;
}

async function renderEditForm(container: HTMLElement, main: HTMLElement, log: WorkoutLog): Promise<void> {
  const templates = await getAllTemplates();
  const state = await getState();
  const template = templates.find((t) => t.id === log.templateId) ?? templates.find((t) => t.id === state?.templateId);

  const dateValue = new Date(log.completedAt).toISOString().split('T')[0];

  const weekOptions = template
    ? template.weeks.map((w, i) =>
        `<option value="${i}" ${i === log.weekIndex ? 'selected' : ''}>${w.name}</option>`
      ).join('')
    : `<option value="${log.weekIndex}">Week ${log.weekIndex + 1}</option>`;

  const dayOptions = template
    ? template.weeks[log.weekIndex].days.map((d, i) =>
        `<option value="${i}" ${i === log.dayIndex ? 'selected' : ''}>${d.name}</option>`
      ).join('')
    : `<option value="${log.dayIndex}">${log.dayName}</option>`;

  main.innerHTML = '';
  const form = document.createElement('div');
  form.dataset.testid = 'edit-workout-form';
  form.className = 'edit-workout-form';

  let setsHtml = '';
  log.sets.forEach((set, idx) => {
    setsHtml += `
      <div class="form-group edit-set-row">
        <label>${set.exerciseId} — ${set.weight} lbs</label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <label style="font-size: 0.85rem;">Reps:</label>
          <input type="number" data-testid="edit-set-reps-${idx}" class="edit-set-reps"
                 data-set-index="${idx}" value="${set.actualReps}" min="0" inputmode="numeric"
                 style="width: 70px;">
          <label style="font-size: 0.85rem;">Weight:</label>
          <input type="number" data-testid="edit-set-weight-${idx}" class="edit-set-weight"
                 data-set-index="${idx}" value="${set.weight}" min="0" step="5" inputmode="numeric"
                 style="width: 80px;">
        </div>
      </div>
    `;
  });

  form.innerHTML = `
    <h2>Edit Workout</h2>
    <div class="form-group">
      <label for="edit-workout-date">Date</label>
      <input type="date" id="edit-workout-date" data-testid="edit-workout-date" value="${dateValue}">
    </div>
    <div class="form-group">
      <label for="edit-workout-cycle">Cycle</label>
      <input type="number" id="edit-workout-cycle" data-testid="edit-workout-cycle"
             value="${log.cycle}" min="1" inputmode="numeric" style="width: 80px;">
    </div>
    <div class="form-group">
      <label for="edit-workout-week">Week</label>
      <select id="edit-workout-week" data-testid="edit-workout-week">${weekOptions}</select>
    </div>
    <div class="form-group">
      <label for="edit-workout-day">Day</label>
      <select id="edit-workout-day" data-testid="edit-workout-day">${dayOptions}</select>
    </div>
    <h3 style="margin: 12px 0 8px;">Sets</h3>
    ${setsHtml}
    <div class="form-actions" style="margin-top: 16px;">
      <button class="btn btn-primary" data-testid="save-workout-edit-btn" id="save-workout-edit-btn">Save Changes</button>
      <button class="btn btn-secondary" id="cancel-edit-btn">Cancel</button>
    </div>
  `;

  main.appendChild(form);

  // Update day options when week changes
  if (template) {
    document.getElementById('edit-workout-week')?.addEventListener('change', () => {
      const weekIdx = parseInt((document.getElementById('edit-workout-week') as HTMLSelectElement).value);
      const week = template.weeks[weekIdx];
      const daySelect = document.getElementById('edit-workout-day') as HTMLSelectElement;
      daySelect.innerHTML = week.days.map((d, i) =>
        `<option value="${i}">${d.name}</option>`
      ).join('');
    });
  }

  document.getElementById('save-workout-edit-btn')?.addEventListener('click', async () => {
    const dateInput = document.getElementById('edit-workout-date') as HTMLInputElement;
    const cycleInput = document.getElementById('edit-workout-cycle') as HTMLInputElement;
    const weekSelect = document.getElementById('edit-workout-week') as HTMLSelectElement;
    const daySelect = document.getElementById('edit-workout-day') as HTMLSelectElement;
    const newDate = new Date(dateInput.value + 'T12:00:00');

    const newCycle = parseInt(cycleInput.value) || log.cycle;
    const newWeekIndex = parseInt(weekSelect.value);
    const newDayIndex = parseInt(daySelect.value);
    const newDayName = template?.weeks[newWeekIndex]?.days[newDayIndex]?.name ?? log.dayName;

    const updatedSets = [...log.sets];
    form.querySelectorAll('.edit-set-reps').forEach((input) => {
      const idx = parseInt((input as HTMLElement).dataset.setIndex!);
      updatedSets[idx] = {
        ...updatedSets[idx],
        actualReps: parseInt((input as HTMLInputElement).value) || updatedSets[idx].actualReps,
      };
    });
    form.querySelectorAll('.edit-set-weight').forEach((input) => {
      const idx = parseInt((input as HTMLElement).dataset.setIndex!);
      updatedSets[idx] = {
        ...updatedSets[idx],
        weight: parseInt((input as HTMLInputElement).value) || updatedSets[idx].weight,
      };
    });

    const updatedLog: WorkoutLog = {
      ...log,
      cycle: newCycle,
      weekIndex: newWeekIndex,
      dayIndex: newDayIndex,
      dayName: newDayName,
      sets: updatedSets,
      completedAt: newDate.getTime(),
      startedAt: newDate.getTime() - (log.completedAt - log.startedAt),
    };

    await putWorkoutLog(updatedLog);
    renderHistory(container);
  });

  document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
    renderHistory(container);
  });
}

async function renderAddPastForm(container: HTMLElement, main: HTMLElement): Promise<void> {
  const templates = await getAllTemplates();
  const state = await getState();
  const template = templates.find((t) => t.id === state?.templateId);

  if (!template) {
    main.innerHTML = '<p>No template found. Create a template first.</p>';
    return;
  }

  main.innerHTML = '';
  const form = document.createElement('div');
  form.dataset.testid = 'log-past-workout-form';
  form.className = 'log-past-workout-form';

  const today = new Date().toISOString().split('T')[0];

  const weekOptions = template.weeks.map((w, i) =>
    `<option value="${i}">${w.name}</option>`
  ).join('');

  const dayOptions = template.weeks[0].days.map((d, i) =>
    `<option value="${i}">${d.name}</option>`
  ).join('');

  form.innerHTML = `
    <h2>Log Past Workout</h2>
    <div class="form-group">
      <label for="past-workout-date">Date</label>
      <input type="date" id="past-workout-date" data-testid="past-workout-date" value="${today}">
    </div>
    <div class="form-group">
      <label for="past-workout-week">Week</label>
      <select id="past-workout-week" data-testid="past-workout-week">${weekOptions}</select>
    </div>
    <div class="form-group">
      <label for="past-workout-day">Day</label>
      <select id="past-workout-day" data-testid="past-workout-day">${dayOptions}</select>
    </div>
    <div class="form-actions" style="margin-top: 16px;">
      <button class="btn btn-primary" data-testid="save-past-workout-btn" id="save-past-workout-btn">Log Workout</button>
      <button class="btn btn-secondary" id="cancel-past-btn">Cancel</button>
    </div>
  `;

  main.appendChild(form);

  // Update day options when week changes
  document.getElementById('past-workout-week')?.addEventListener('change', () => {
    const weekIdx = parseInt((document.getElementById('past-workout-week') as HTMLSelectElement).value);
    const week = template.weeks[weekIdx];
    const daySelect = document.getElementById('past-workout-day') as HTMLSelectElement;
    daySelect.innerHTML = week.days.map((d, i) =>
      `<option value="${i}">${d.name}</option>`
    ).join('');
  });

  document.getElementById('save-past-workout-btn')?.addEventListener('click', async () => {
    const dateInput = document.getElementById('past-workout-date') as HTMLInputElement;
    const weekIdx = parseInt((document.getElementById('past-workout-week') as HTMLSelectElement).value);
    const dayIdx = parseInt((document.getElementById('past-workout-day') as HTMLSelectElement).value);

    const date = new Date(dateInput.value + 'T12:00:00');
    const week = template.weeks[weekIdx];
    const day = week.days[dayIdx];

    // Create a workout log with empty sets (user logged that they did the workout)
    const log: WorkoutLog = {
      id: `workout-past-${Date.now()}`,
      templateId: template.id,
      cycle: state?.cycle ?? 1,
      weekIndex: weekIdx,
      dayIndex: dayIdx,
      dayName: day.name,
      sets: day.sets.map((s) => ({
        exerciseId: s.exerciseId,
        prescribedReps: s.reps,
        actualReps: s.reps,
        weight: 0,
        isAmrap: s.isAmrap,
        timestamp: date.getTime(),
      })),
      startedAt: date.getTime(),
      completedAt: date.getTime(),
    };

    await putWorkoutLog(log);
    renderHistory(container);
  });

  document.getElementById('cancel-past-btn')?.addEventListener('click', () => {
    renderHistory(container);
  });
}
