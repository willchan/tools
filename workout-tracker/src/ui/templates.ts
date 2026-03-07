import { getAllTemplates, getAllExercises, putTemplate, getState, putState } from '../db/database';
import type { TemplateSet, Exercise } from '../db/types';
import { navigate } from './router';

export async function renderTemplates(container: HTMLElement): Promise<void> {
  const templates = await getAllTemplates();

  container.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <button id="back-btn" class="btn btn-text">&larr; Back</button>
    <h1>Templates</h1>
  `;
  container.appendChild(header);

  const main = document.createElement('main');
  main.className = 'templates-screen';

  if (templates.length === 0) {
    main.innerHTML = '<p>No templates yet.</p>';
  } else {
    const list = document.createElement('div');
    list.className = 'template-list';
    list.dataset.testid = 'template-list';

    for (const t of templates) {
      const card = document.createElement('div');
      card.className = 'template-card';
      card.innerHTML = `
        <h3>${t.name}</h3>
        <p>${t.weeks.length} weeks · ${t.weeks[0]?.days.length ?? 0} days/week</p>
        <button class="btn btn-secondary edit-template-btn" data-id="${t.id}">Edit</button>
      `;
      list.appendChild(card);
    }

    main.appendChild(list);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary';
  addBtn.id = 'add-template-btn';
  addBtn.textContent = 'Create New Template';
  main.appendChild(addBtn);

  // Navigation
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.innerHTML = `
    <button class="nav-btn" data-route="home">Home</button>
    <button class="nav-btn active" data-route="templates">Templates</button>
    <button class="nav-btn" data-route="history">History</button>
    <button class="nav-btn" data-route="settings">Settings</button>
  `;

  container.appendChild(main);
  container.appendChild(nav);

  // Listeners
  document.getElementById('back-btn')?.addEventListener('click', () => navigate('home'));

  main.querySelectorAll('.edit-template-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id!;
      navigate('template-edit', { id });
    });
  });

  nav.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = (btn as HTMLElement).dataset.route;
      if (route) navigate(route as any);
    });
  });
}

export async function renderTemplateEdit(
  container: HTMLElement,
  params: Record<string, string>
): Promise<void> {
  const exercises = await getAllExercises();
  const templates = await getAllTemplates();
  let template = templates.find((t) => t.id === params.id);

  const isNew = !template;
  if (!template) {
    template = {
      id: `template-${Date.now()}`,
      name: 'New Template',
      weeks: [
        {
          id: `week-0`,
          name: 'Week 1',
          days: [
            {
              id: `day-0-0`,
              name: 'Day 1',
              mainLiftId: exercises[0]?.id ?? '',
              sets: [],
            },
          ],
        },
      ],
      cycleLength: 1,
    };
  }

  container.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <button id="back-btn" class="btn btn-text">&larr; Back</button>
    <h1>${isNew ? 'New Template' : 'Edit Template'}</h1>
  `;
  container.appendChild(header);

  const main = document.createElement('main');
  main.className = 'template-edit-screen';

  // Template name
  main.innerHTML = `
    <div class="form-group">
      <label for="template-name">Template Name</label>
      <input type="text" id="template-name" value="${template.name}" data-testid="template-name-input">
    </div>

    <div id="weeks-container"></div>

    <div class="form-actions">
      <button id="add-week-btn" class="btn btn-secondary">Add Week</button>
      <button id="save-template-btn" class="btn btn-primary" data-testid="save-template-btn">Save Template</button>
    </div>
  `;

  container.appendChild(main);

  const weeksContainer = document.getElementById('weeks-container')!;

  function renderWeeks() {
    weeksContainer.innerHTML = '';
    template!.weeks.forEach((week, wi) => {
      const weekEl = document.createElement('div');
      weekEl.className = 'week-section';
      weekEl.innerHTML = `
        <h3>
          <input type="text" value="${week.name}" class="week-name-input" data-week="${wi}">
        </h3>
      `;

      week.days.forEach((day, di) => {
        const dayEl = document.createElement('div');
        dayEl.className = 'day-section';
        dayEl.innerHTML = `
          <h4>
            <input type="text" value="${day.name}" class="day-name-input" data-week="${wi}" data-day="${di}">
          </h4>
          <div class="day-exercise">
            <label>Main Lift:</label>
            <select class="main-lift-select" data-week="${wi}" data-day="${di}" data-testid="main-lift-select-${wi}-${di}">
              ${exercises.map((e) => `<option value="${e.id}" ${e.id === day.mainLiftId ? 'selected' : ''}>${e.name}</option>`).join('')}
            </select>
          </div>
          <div class="sets-editor" data-week="${wi}" data-day="${di}">
            ${renderSetsList(day.sets, exercises, wi, di)}
          </div>
          <button class="btn btn-small add-set-btn" data-week="${wi}" data-day="${di}">Add Set</button>
        `;
        weekEl.appendChild(dayEl);
      });

      const addDayBtn = document.createElement('button');
      addDayBtn.className = 'btn btn-small add-day-btn';
      addDayBtn.dataset.week = String(wi);
      addDayBtn.textContent = 'Add Day';
      weekEl.appendChild(addDayBtn);

      weeksContainer.appendChild(weekEl);
    });

    attachWeekListeners();
  }

  function renderSetsList(
    sets: TemplateSet[],
    exercises: Exercise[],
    wi: number,
    di: number
  ): string {
    return sets
      .map(
        (set, si) => `
      <div class="set-editor-row" data-testid="set-row-${wi}-${di}-${si}">
        <select class="set-exercise-select" data-week="${wi}" data-day="${di}" data-set="${si}">
          ${exercises.map((e) => `<option value="${e.id}" ${e.id === set.exerciseId ? 'selected' : ''}>${e.name}</option>`).join('')}
        </select>
        <input type="number" class="set-reps-input" value="${set.reps}" data-week="${wi}" data-day="${di}" data-set="${si}" placeholder="Reps" min="1">
        <input type="number" class="set-pct-input" value="${set.tmPercentage !== null ? Math.round(set.tmPercentage * 100) : ''}" data-week="${wi}" data-day="${di}" data-set="${si}" placeholder="TM%">
        <label class="set-amrap-label">
          <input type="checkbox" class="set-amrap-input" data-week="${wi}" data-day="${di}" data-set="${si}" ${set.isAmrap ? 'checked' : ''}>
          AMRAP
        </label>
        <button class="btn btn-small btn-danger remove-set-btn" data-week="${wi}" data-day="${di}" data-set="${si}">×</button>
      </div>
    `
      )
      .join('');
  }

  function attachWeekListeners() {
    // Update week names
    weeksContainer.querySelectorAll('.week-name-input').forEach((input) => {
      input.addEventListener('change', (e) => {
        const el = e.target as HTMLInputElement;
        const wi = parseInt(el.dataset.week!);
        template!.weeks[wi].name = el.value;
      });
    });

    // Update day names
    weeksContainer.querySelectorAll('.day-name-input').forEach((input) => {
      input.addEventListener('change', (e) => {
        const el = e.target as HTMLInputElement;
        const wi = parseInt(el.dataset.week!);
        const di = parseInt(el.dataset.day!);
        template!.weeks[wi].days[di].name = el.value;
      });
    });

    // Main lift select
    weeksContainer.querySelectorAll('.main-lift-select').forEach((select) => {
      select.addEventListener('change', (e) => {
        const el = e.target as HTMLSelectElement;
        const wi = parseInt(el.dataset.week!);
        const di = parseInt(el.dataset.day!);
        template!.weeks[wi].days[di].mainLiftId = el.value;
      });
    });

    // Set exercise selects
    weeksContainer.querySelectorAll('.set-exercise-select').forEach((select) => {
      select.addEventListener('change', (e) => {
        const el = e.target as HTMLSelectElement;
        const wi = parseInt(el.dataset.week!);
        const di = parseInt(el.dataset.day!);
        const si = parseInt(el.dataset.set!);
        template!.weeks[wi].days[di].sets[si].exerciseId = el.value;
      });
    });

    // Set reps inputs
    weeksContainer.querySelectorAll('.set-reps-input').forEach((input) => {
      input.addEventListener('change', (e) => {
        const el = e.target as HTMLInputElement;
        const wi = parseInt(el.dataset.week!);
        const di = parseInt(el.dataset.day!);
        const si = parseInt(el.dataset.set!);
        template!.weeks[wi].days[di].sets[si].reps = parseInt(el.value) || 1;
      });
    });

    // Set TM% inputs
    weeksContainer.querySelectorAll('.set-pct-input').forEach((input) => {
      input.addEventListener('change', (e) => {
        const el = e.target as HTMLInputElement;
        const wi = parseInt(el.dataset.week!);
        const di = parseInt(el.dataset.day!);
        const si = parseInt(el.dataset.set!);
        const val = el.value ? parseInt(el.value) : null;
        const set = template!.weeks[wi].days[di].sets[si];
        set.tmPercentage = val !== null ? val / 100 : null;
        set.tmLiftId = val !== null ? template!.weeks[wi].days[di].mainLiftId : null;
      });
    });

    // AMRAP checkboxes
    weeksContainer.querySelectorAll('.set-amrap-input').forEach((input) => {
      input.addEventListener('change', (e) => {
        const el = e.target as HTMLInputElement;
        const wi = parseInt(el.dataset.week!);
        const di = parseInt(el.dataset.day!);
        const si = parseInt(el.dataset.set!);
        template!.weeks[wi].days[di].sets[si].isAmrap = el.checked;
      });
    });

    // Remove set buttons
    weeksContainer.querySelectorAll('.remove-set-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const el = e.target as HTMLButtonElement;
        const wi = parseInt(el.dataset.week!);
        const di = parseInt(el.dataset.day!);
        const si = parseInt(el.dataset.set!);
        template!.weeks[wi].days[di].sets.splice(si, 1);
        renderWeeks();
      });
    });

    // Add set buttons
    weeksContainer.querySelectorAll('.add-set-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const el = e.target as HTMLButtonElement;
        const wi = parseInt(el.dataset.week!);
        const di = parseInt(el.dataset.day!);
        const day = template!.weeks[wi].days[di];
        day.sets.push({
          exerciseId: day.mainLiftId,
          tmPercentage: null,
          tmLiftId: null,
          reps: 10,
          isAmrap: false,
        });
        renderWeeks();
      });
    });

    // Add day buttons
    weeksContainer.querySelectorAll('.add-day-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const el = e.target as HTMLButtonElement;
        const wi = parseInt(el.dataset.week!);
        template!.weeks[wi].days.push({
          id: `day-${wi}-${template!.weeks[wi].days.length}`,
          name: `Day ${template!.weeks[wi].days.length + 1}`,
          mainLiftId: exercises[0]?.id ?? '',
          sets: [],
        });
        renderWeeks();
      });
    });
  }

  // Add week
  document.getElementById('add-week-btn')?.addEventListener('click', () => {
    template!.weeks.push({
      id: `week-${template!.weeks.length}`,
      name: `Week ${template!.weeks.length + 1}`,
      days: [
        {
          id: `day-${template!.weeks.length}-0`,
          name: 'Day 1',
          mainLiftId: exercises[0]?.id ?? '',
          sets: [],
        },
      ],
    });
    template!.cycleLength = template!.weeks.length;
    renderWeeks();
  });

  // Save
  document.getElementById('save-template-btn')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('template-name') as HTMLInputElement;
    template!.name = nameInput.value;
    template!.cycleLength = template!.weeks.length;
    await putTemplate(template!);

    // Set as active template if it's the only one or is new
    const currentState = await getState();
    if (!currentState || isNew) {
      await putState({
        templateId: template!.id,
        cycle: 1,
        weekIndex: 0,
        dayIndex: 0,
      });
    }

    navigate('templates');
  });

  document.getElementById('back-btn')?.addEventListener('click', () => navigate('templates'));

  renderWeeks();
}
