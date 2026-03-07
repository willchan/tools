import {
  getState,
  getTemplate,
  getAllTrainingMaxes,
  putState,
  putWorkoutLog,
  putTrainingMax,
  putTimerState,
  getTimerState,
} from '../db/database';
import type { CompletedSet, WorkoutLog, TemplateSet } from '../db/types';
import { calculateWorkingWeight, calculatePlates, formatPlates } from '../logic/calculator';
import { advanceState } from '../logic/progression';
import { createTimerState, getRemainingMs, formatTime } from '../logic/timer';
import { navigate } from './router';
import { requestWakeLock, releaseWakeLock } from './wakelock';
import { fireTimerNotification } from './notifications';

let timerInterval: ReturnType<typeof setInterval> | null = null;

export async function renderWorkout(container: HTMLElement): Promise<void> {
  const state = await getState();
  if (!state) {
    container.innerHTML = '<p>No workout state found.</p>';
    return;
  }

  const template = await getTemplate(state.templateId);
  if (!template) {
    container.innerHTML = '<p>Template not found.</p>';
    return;
  }

  const tmsRaw = await getAllTrainingMaxes();
  const tmMap = new Map(tmsRaw.map((tm) => [tm.exerciseId, tm.weight]));

  const week = template.weeks[state.weekIndex];
  const day = week?.days[state.dayIndex];
  if (!week || !day) {
    container.innerHTML = '<p>Invalid workout day.</p>';
    return;
  }

  // Request wake lock
  requestWakeLock();

  const completedSets: CompletedSet[] = [];
  let currentSetIndex = 0;
  const workoutStartTime = Date.now();

  container.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <button id="back-btn" class="btn btn-text">&larr; Back</button>
    <h1>${day.name}</h1>
    <span class="workout-meta">Cycle ${state.cycle} · ${week.name}</span>
  `;
  container.appendChild(header);

  const main = document.createElement('main');
  main.className = 'workout-screen';

  // Timer display
  const timerEl = document.createElement('div');
  timerEl.className = 'rest-timer hidden';
  timerEl.id = 'rest-timer';
  timerEl.innerHTML = `
    <span class="timer-label">Rest</span>
    <span class="timer-value" id="timer-value">0:00</span>
    <button id="skip-timer-btn" class="btn btn-small">Skip</button>
  `;
  main.appendChild(timerEl);

  // Sets list
  const setsContainer = document.createElement('div');
  setsContainer.className = 'sets-list';
  setsContainer.id = 'sets-list';
  main.appendChild(setsContainer);

  // Complete workout button (hidden initially)
  const completeBtn = document.createElement('button');
  completeBtn.id = 'complete-workout-btn';
  completeBtn.className = 'btn btn-primary btn-large hidden';
  completeBtn.textContent = 'Complete Workout';
  main.appendChild(completeBtn);

  container.appendChild(main);

  function renderSets() {
    setsContainer.innerHTML = '';
    day!.sets.forEach((set, idx) => {
      const weight = getSetWeight(set, tmMap);
      const plates = weight > 0 ? calculatePlates(weight) : null;
      const isCompleted = idx < currentSetIndex;
      const isCurrent = idx === currentSetIndex;
      const completed = completedSets[idx];

      const setEl = document.createElement('div');
      setEl.className = `set-item ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`;
      setEl.dataset.testid = `set-${idx}`;

      let repsDisplay = `${set.reps} reps`;
      if (set.isAmrap) repsDisplay += '+';

      let weightDisplay = weight > 0 ? `${weight} lbs` : 'BW / Custom';
      let plateDisplay = '';
      if (plates && plates.plates.length > 0) {
        plateDisplay = `<span class="plate-info">${formatPlates(plates.plates)} per side</span>`;
      }

      if (isCompleted && completed) {
        setEl.innerHTML = `
          <div class="set-info">
            <span class="set-exercise">${set.exerciseId}</span>
            <span class="set-weight">${weightDisplay}</span>
            ${plateDisplay}
          </div>
          <div class="set-result">
            <span class="set-reps-done">${completed.actualReps} reps ✓</span>
          </div>
        `;
      } else if (isCurrent) {
        setEl.innerHTML = `
          <div class="set-info">
            <span class="set-exercise">${set.exerciseId}</span>
            <span class="set-weight">${weightDisplay}</span>
            ${plateDisplay}
            <span class="set-prescription">${repsDisplay}</span>
          </div>
          <div class="set-actions">
            ${set.isAmrap ? `
              <label class="amrap-input-label">
                Reps:
                <input type="number" id="amrap-input" class="amrap-input"
                       value="${set.reps}" min="1" inputmode="numeric"
                       data-testid="amrap-input">
              </label>
            ` : ''}
            <button class="btn btn-primary done-set-btn" data-testid="done-set-btn">
              Done
            </button>
          </div>
        `;
      } else {
        setEl.innerHTML = `
          <div class="set-info">
            <span class="set-exercise">${set.exerciseId}</span>
            <span class="set-weight">${weightDisplay}</span>
            <span class="set-prescription">${repsDisplay}</span>
          </div>
        `;
      }

      setsContainer.appendChild(setEl);
    });

    // Show complete button when all sets done
    if (currentSetIndex >= day!.sets.length) {
      completeBtn.classList.remove('hidden');
    }

    // Attach done button handler
    const doneBtn = setsContainer.querySelector('.done-set-btn') as HTMLButtonElement | null;
    doneBtn?.addEventListener('click', () => markSetDone());

    // Scroll current set into view
    const currentEl = setsContainer.querySelector('.current');
    currentEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function getSetWeight(set: TemplateSet, tmMap: Map<string, number>): number {
    if (set.tmPercentage === null || set.tmLiftId === null) return 0;
    const tm = tmMap.get(set.tmLiftId);
    if (!tm) return 0;
    return calculateWorkingWeight(tm, set.tmPercentage);
  }

  async function markSetDone() {
    const set = day!.sets[currentSetIndex];
    const weight = getSetWeight(set, tmMap);

    let actualReps = set.reps;
    if (set.isAmrap) {
      const input = document.getElementById('amrap-input') as HTMLInputElement | null;
      if (input) {
        actualReps = parseInt(input.value, 10) || set.reps;
      }
    }

    completedSets.push({
      exerciseId: set.exerciseId,
      prescribedReps: set.reps,
      actualReps,
      weight,
      isAmrap: set.isAmrap,
      timestamp: Date.now(),
    });

    currentSetIndex++;

    // Start rest timer if more sets remain
    if (currentSetIndex < day!.sets.length) {
      await startRestTimer();
    }

    renderSets();
  }

  async function startRestTimer(restSeconds = 90) {
    const timer = createTimerState(restSeconds);
    await putTimerState(timer);

    timerEl.classList.remove('hidden');

    if (timerInterval) clearInterval(timerInterval);

    const updateTimer = async () => {
      const savedTimer = await getTimerState();
      if (!savedTimer) {
        timerEl.classList.add('hidden');
        return;
      }

      const remaining = getRemainingMs(savedTimer);
      const timerValue = document.getElementById('timer-value');
      if (timerValue) {
        timerValue.textContent = formatTime(remaining);
      }

      if (remaining <= 0) {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        await putTimerState(null);
        timerEl.classList.add('hidden');
        fireTimerNotification();
      }
    };

    timerInterval = setInterval(updateTimer, 250);
    updateTimer();
  }

  async function completeWorkout() {
    const log: WorkoutLog = {
      id: `workout-${Date.now()}`,
      templateId: state!.templateId,
      cycle: state!.cycle,
      weekIndex: state!.weekIndex,
      dayIndex: state!.dayIndex,
      dayName: day!.name,
      sets: completedSets,
      startedAt: workoutStartTime,
      completedAt: Date.now(),
    };

    await putWorkoutLog(log);

    // Advance state
    const result = advanceState(state!, template!);
    await putState(result.newState);

    // Apply TM bumps if new cycle started
    if (result.tmBumps) {
      for (const bump of result.tmBumps) {
        const current = tmMap.get(bump.exerciseId) ?? 0;
        await putTrainingMax({
          exerciseId: bump.exerciseId,
          weight: current + bump.increment,
        });
      }
    }

    // Cleanup
    releaseWakeLock();
    if (timerInterval) clearInterval(timerInterval);
    await putTimerState(null);

    navigate('home');
  }

  // Event listeners
  document.getElementById('back-btn')?.addEventListener('click', () => {
    releaseWakeLock();
    if (timerInterval) clearInterval(timerInterval);
    navigate('home');
  });

  completeBtn.addEventListener('click', completeWorkout);

  document.getElementById('skip-timer-btn')?.addEventListener('click', async () => {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    await putTimerState(null);
    timerEl.classList.add('hidden');
  });

  // Check for existing timer (browser tab resumed after suspension)
  const existingTimer = await getTimerState();
  if (existingTimer) {
    const remaining = getRemainingMs(existingTimer);
    if (remaining > 0) {
      timerEl.classList.remove('hidden');
      timerInterval = setInterval(async () => {
        const saved = await getTimerState();
        if (!saved) {
          timerEl.classList.add('hidden');
          return;
        }
        const r = getRemainingMs(saved);
        const tv = document.getElementById('timer-value');
        if (tv) tv.textContent = formatTime(r);
        if (r <= 0) {
          if (timerInterval) clearInterval(timerInterval);
          timerInterval = null;
          await putTimerState(null);
          timerEl.classList.add('hidden');
          fireTimerNotification();
        }
      }, 250);
    } else {
      await putTimerState(null);
    }
  }

  renderSets();
}
