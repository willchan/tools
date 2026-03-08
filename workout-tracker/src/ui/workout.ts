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
import { requestNotificationPermission, fireTimerNotification } from './notifications';

let timerInterval: ReturnType<typeof setInterval> | null = null;
let isResting = false;

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

  // Request wake lock and notification permission
  requestWakeLock();
  requestNotificationPermission();

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

      const weightDisplay = weight > 0 ? `${weight} lbs` : 'BW / Custom';
      let plateDisplay = '';
      if (plates && plates.plates.length > 0) {
        plateDisplay = `<span class="plate-info">${formatPlates(plates.plates)} per side</span>`;
      }

      if (isCompleted && completed) {
        const missedReps = completed.actualReps < completed.prescribedReps;
        setEl.innerHTML = `
          <div class="set-info">
            <span class="set-exercise">${set.exerciseId}</span>
            <span class="set-weight">${weightDisplay}</span>
            ${plateDisplay}
          </div>
          <div class="set-result">
            <span class="set-reps-done ${missedReps ? 'missed' : ''}">${completed.actualReps} reps ✓</span>
          </div>
        `;
      } else if (isCurrent) {
        if (set.isAmrap) {
          // AMRAP: stepper always visible, no toggle needed, no upper cap
          setEl.innerHTML = `
            <div class="set-info">
              <span class="set-exercise">${set.exerciseId}</span>
              <span class="set-weight">${weightDisplay}</span>
              ${plateDisplay}
              <span class="set-prescription">${repsDisplay}</span>
            </div>
            <div class="set-actions">
              <div class="reps-stepper" data-testid="reps-stepper" data-max="999">
                <span class="stepper-label">Reps:</span>
                <button class="stepper-btn" data-testid="stepper-dec" aria-label="Fewer reps">−</button>
                <span class="stepper-value" data-testid="stepper-value">${set.reps}</span>
                <button class="stepper-btn" data-testid="stepper-inc" aria-label="More reps">+</button>
              </div>
              <button class="btn btn-primary done-set-btn" data-testid="done-set-btn">Done</button>
            </div>
          `;
        } else {
          // Non-AMRAP: Done button primary, "missed some reps?" toggle reveals stepper
          setEl.innerHTML = `
            <div class="set-info">
              <span class="set-exercise">${set.exerciseId}</span>
              <span class="set-weight">${weightDisplay}</span>
              ${plateDisplay}
              <span class="set-prescription">${repsDisplay}</span>
            </div>
            <div class="set-actions">
              <div class="reps-stepper hidden" data-testid="reps-stepper" data-max="${set.reps}">
                <span class="stepper-label">Reps:</span>
                <button class="stepper-btn" data-testid="stepper-dec" aria-label="Fewer reps">−</button>
                <span class="stepper-value" data-testid="stepper-value">${set.reps}</span>
                <button class="stepper-btn" data-testid="stepper-inc" aria-label="More reps">+</button>
              </div>
              <button class="btn btn-primary done-set-btn" data-testid="done-set-btn">Done</button>
              <button class="missed-reps-toggle" data-testid="missed-reps-toggle">missed some reps?</button>
            </div>
          `;
        }
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

    attachSetHandlers();
    // Reflect rest state on the newly rendered done button
    const doneBtn = setsContainer.querySelector('.done-set-btn') as HTMLButtonElement | null;
    if (doneBtn) doneBtn.disabled = isResting;

    // Scroll current set into view
    const currentEl = setsContainer.querySelector('.current');
    currentEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function attachSetHandlers() {
    const doneBtn = setsContainer.querySelector('.done-set-btn') as HTMLButtonElement | null;
    doneBtn?.addEventListener('click', () => markSetDone());

    const toggleBtn = setsContainer.querySelector('[data-testid="missed-reps-toggle"]') as HTMLButtonElement | null;
    toggleBtn?.addEventListener('click', () => {
      const stepper = setsContainer.querySelector('[data-testid="reps-stepper"]') as HTMLElement | null;
      stepper?.classList.remove('hidden');
      toggleBtn.classList.add('hidden');
    });

    const decBtn = setsContainer.querySelector('[data-testid="stepper-dec"]') as HTMLButtonElement | null;
    decBtn?.addEventListener('click', () => {
      const valueEl = setsContainer.querySelector('[data-testid="stepper-value"]') as HTMLElement | null;
      if (!valueEl) return;
      const current = parseInt(valueEl.textContent || '0', 10);
      if (current > 0) valueEl.textContent = String(current - 1);
    });

    const incBtn = setsContainer.querySelector('[data-testid="stepper-inc"]') as HTMLButtonElement | null;
    incBtn?.addEventListener('click', () => {
      const stepperEl = setsContainer.querySelector('[data-testid="reps-stepper"]') as HTMLElement | null;
      const valueEl = setsContainer.querySelector('[data-testid="stepper-value"]') as HTMLElement | null;
      if (!stepperEl || !valueEl) return;
      const max = parseInt(stepperEl.dataset.max || '999', 10);
      const current = parseInt(valueEl.textContent || '0', 10);
      if (current < max) valueEl.textContent = String(current + 1);
    });
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
    const stepperValue = setsContainer.querySelector('[data-testid="stepper-value"]') as HTMLElement | null;
    if (stepperValue) {
      actualReps = parseInt(stepperValue.textContent || '', 10);
      if (isNaN(actualReps)) actualReps = set.reps;
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

  function setDoneButtonDisabled(disabled: boolean) {
    isResting = disabled;
    const doneBtn = setsContainer.querySelector('.done-set-btn') as HTMLButtonElement | null;
    if (doneBtn) doneBtn.disabled = disabled;
  }

  async function startRestTimer(restSeconds = 90) {
    const timer = createTimerState(restSeconds);
    await putTimerState(timer);

    timerEl.classList.remove('hidden');
    setDoneButtonDisabled(true);

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
        setDoneButtonDisabled(false);
        fireTimerNotification();
      }
    };

    timerInterval = setInterval(updateTimer, 250);
    updateTimer();
  }

  function detectFailures() {
    const mainFailed: Array<{ exerciseId: string; got: number; prescribed: number }> = [];
    const bbbFailed: Array<{ exerciseId: string; got: number; prescribed: number }> = [];

    day!.sets.forEach((set, i) => {
      const completed = completedSets[i];
      // AMRAP sets can't "fail" — any rep count is valid
      if (!completed || set.isAmrap) return;
      if (completed.actualReps >= set.reps) return;
      if (set.tmPercentage === null) return;

      if (set.tmPercentage > 0.5) {
        mainFailed.push({ exerciseId: set.exerciseId, got: completed.actualReps, prescribed: set.reps });
      } else {
        bbbFailed.push({ exerciseId: set.exerciseId, got: completed.actualReps, prescribed: set.reps });
      }
    });

    return { mainFailed, bbbFailed };
  }

  function showFailureSheet(
    mainFailed: Array<{ exerciseId: string; got: number; prescribed: number }>,
    bbbFailed: Array<{ exerciseId: string; got: number; prescribed: number }>,
  ) {
    const hasMainFailure = mainFailed.length > 0;

    const items = [
      ...mainFailed.map(
        (f) => `<li>${f.exerciseId}: ${f.got}/${f.prescribed} reps (main set)</li>`,
      ),
      ...bbbFailed.map(
        (f) => `<li>${f.exerciseId}: ${f.got}/${f.prescribed} reps (5×10)</li>`,
      ),
    ].join('');

    const advice = hasMainFailure
      ? 'Wendler recommends resetting your Training Max when you miss reps on main sets.'
      : 'Consider dropping your BBB percentage next session (e.g. 50% → 40%).';

    const sheet = document.createElement('div');
    sheet.className = 'failure-sheet';
    sheet.id = 'failure-sheet';
    sheet.innerHTML = `
      <div class="failure-sheet-card">
        <h2>Missed reps</h2>
        <ul class="failure-list">${items}</ul>
        <p class="failure-advice">${advice}</p>
        ${hasMainFailure ? `<button id="failure-review-btn" class="btn btn-primary btn-large">Review Training Maxes →</button>` : ''}
        <button id="failure-skip-btn" class="btn btn-text">Skip for now</button>
      </div>
    `;

    document.getElementById('app')?.appendChild(sheet);

    document.getElementById('failure-skip-btn')?.addEventListener('click', () => {
      navigate('home');
    });

    document.getElementById('failure-review-btn')?.addEventListener('click', () => {
      navigate('settings');
    });
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

    const { mainFailed, bbbFailed } = detectFailures();
    if (mainFailed.length > 0 || bbbFailed.length > 0) {
      showFailureSheet(mainFailed, bbbFailed);
    } else {
      navigate('home');
    }
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
    timerEl.classList.add('hidden');
    setDoneButtonDisabled(false);
    await putTimerState(null);
  });

  // Check for existing timer (browser tab resumed after suspension)
  const existingTimer = await getTimerState();
  if (existingTimer) {
    const remaining = getRemainingMs(existingTimer);
    if (remaining > 0) {
      timerEl.classList.remove('hidden');
      setDoneButtonDisabled(true);
      timerInterval = setInterval(async () => {
        const saved = await getTimerState();
        if (!saved) {
          timerEl.classList.add('hidden');
          setDoneButtonDisabled(false);
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
          setDoneButtonDisabled(false);
          fireTimerNotification();
        }
      }, 250);
    } else {
      await putTimerState(null);
    }
  }

  renderSets();
}
