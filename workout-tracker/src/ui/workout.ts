import {
  getState,
  getTemplate,
  getAllTrainingMaxes,
  getAllExercises,
  putTimerState,
  getTimerState,
  getSettings,
  getActiveWorkout,
  putActiveWorkout,
  commitActiveWorkoutAtomic,
  completeWorkoutAtomic,
  putTrainingMaxesAtomic,
} from '../db/database';
import type { ActiveWorkout, ProgressionState, TimerState } from '../db/types';
import { calculatePlates, formatPlates, calculateResetTM } from '../logic/calculator';
import { advanceState } from '../logic/progression';
import { getVolumeGroupKey, computeVolumeProgress } from '../logic/volume';
import type { VolumeProgress } from '../logic/volume';
import {
  applySessionEvent,
  buildWorkoutLog,
  createSession,
  createSessionContext,
  detectFailures,
  getEffectiveReps,
  getSetWeight,
} from '../logic/workoutSession';
import type { SessionEvent, SessionResult, SessionState } from '../logic/workoutSession';
import { getRemainingMs, formatTime } from '../logic/timer';
import { resolveExerciseName } from '../logic/exerciseName';
import { navigate } from './router';
import { requestWakeLock, releaseWakeLock } from './wakelock';
import { requestNotificationPermission, fireTimerNotification, scheduleBackgroundTimerNotification, cancelBackgroundTimerNotification, primeAudioContext } from './notifications';
import { log as logEvent } from '../logic/logger';
import { startWorkoutActivity, updateWorkoutActivity, endWorkoutActivity } from '../native/liveActivity';

let timerInterval: ReturnType<typeof setInterval> | null = null;
let isResting = false;
// Registered on `document`, which outlives any single renderWorkout() call,
// so each render must tear down the previous instance's listener before
// attaching its own — otherwise repeated workouts in one session would
// stack handlers referencing stale, detached DOM.
let removeVisibilityReconcileHandler: (() => void) | null = null;

/** Does a persisted active-workout record belong to this exact position? */
function activeWorkoutMatches(activeWorkout: ActiveWorkout, state: ProgressionState): boolean {
  return (
    activeWorkout.templateId === state.templateId &&
    activeWorkout.cycle === state.cycle &&
    activeWorkout.weekIndex === state.weekIndex &&
    activeWorkout.dayIndex === state.dayIndex
  );
}

/**
 * Blocks starting a new workout until the user resolves a stuck one for a
 * *different* day. `activeWorkout` is a single global IndexedDB slot, not
 * scoped per day — logging the first set of a freshly-started workout would
 * silently overwrite whatever's sitting there, permanently losing it with no
 * warning. Renders into `container` and resolves once the user picks.
 */
function promptStaleWorkoutConflict(
  container: HTMLElement,
  info: { dayName: string; setsLogged: number; startedAt: number; canResume: boolean },
): Promise<'resume' | 'discard'> {
  return new Promise((resolve) => {
    const dateStr = new Date(info.startedAt).toLocaleDateString();
    // Only offer "Finish it" when the stale workout's day still exists to
    // resume into (its template/day may have been edited or deleted since).
    // Otherwise resuming isn't possible, so don't show a button that would
    // silently discard instead of doing what it says.
    const bodyText = info.canResume
      ? `<p>Finish it before starting a new workout.</p>`
      : `<p>Its template or day has since changed, so it can no longer be resumed.</p>`;
    const resumeBtnHtml = info.canResume
      ? `<button id="stale-workout-resume-btn" class="btn btn-primary" data-testid="stale-workout-resume-btn">Finish it</button>`
      : '';
    container.innerHTML = `
      <div class="stale-workout-overlay" data-testid="stale-workout-dialog">
        <div class="stale-workout-card">
          <h2>Unfinished Workout</h2>
          <p>You have an unfinished <strong>${info.dayName}</strong> workout from ${dateStr}
             with ${info.setsLogged} set${info.setsLogged === 1 ? '' : 's'} logged.</p>
          ${bodyText}
          <div class="stale-workout-actions">
            <button id="stale-workout-discard-btn" class="btn btn-text btn-danger" data-testid="stale-workout-discard-btn">Discard it</button>
            ${resumeBtnHtml}
          </div>
        </div>
      </div>
    `;
    document.getElementById('stale-workout-resume-btn')?.addEventListener('click', () => resolve('resume'));
    document.getElementById('stale-workout-discard-btn')?.addEventListener('click', () => resolve('discard'));
  });
}

export async function renderWorkout(container: HTMLElement): Promise<void> {
  let state = await getState();
  if (!state) {
    container.innerHTML = '<p>No workout state found.</p>';
    return;
  }
  let template = await getTemplate(state.templateId);
  if (!template) {
    container.innerHTML = '<p>Template not found.</p>';
    return;
  }

  const [tmsRaw, settings, exercises] = await Promise.all([
    getAllTrainingMaxes(),
    getSettings(),
    // Exercise catalog, for resolving the Live Activity's exerciseName to a
    // human-readable name (see resolveExerciseName).
    getAllExercises(),
  ]);
  const tmMap = new Map(tmsRaw.map((tm) => [tm.exerciseId, tm.weight]));

  let week = template.weeks[state.weekIndex];
  let day = week?.days[state.dayIndex];
  if (!week || !day) {
    container.innerHTML = '<p>Invalid workout day.</p>';
    return;
  }

  // A stuck activeWorkout for a *different* position must be resolved before
  // rendering anything else — see promptStaleWorkoutConflict's doc comment.
  let activeWorkout = await getActiveWorkout();
  if (activeWorkout && !activeWorkoutMatches(activeWorkout, state)) {
    const staleTemplate =
      activeWorkout.templateId === template.id ? template : await getTemplate(activeWorkout.templateId);
    const staleDay = staleTemplate?.weeks[activeWorkout.weekIndex]?.days[activeWorkout.dayIndex];

    const choice = await promptStaleWorkoutConflict(container, {
      dayName: staleDay?.name ?? 'a previous workout',
      setsLogged: activeWorkout.completedSets.length,
      startedAt: activeWorkout.startedAt,
      canResume: !!(staleTemplate && staleDay),
    });

    if (choice === 'resume' && staleTemplate && staleDay) {
      // Switch this render to the stale workout's own position instead of
      // the one that was originally requested.
      state = {
        ...state,
        templateId: activeWorkout.templateId,
        cycle: activeWorkout.cycle,
        weekIndex: activeWorkout.weekIndex,
        dayIndex: activeWorkout.dayIndex,
      };
      template = staleTemplate;
      week = staleTemplate.weeks[activeWorkout.weekIndex]!;
      day = staleDay;
    } else {
      // Either the user chose to discard it, or the stale workout points at
      // a day/template that no longer exists to resume into — either way,
      // clear it and proceed with the originally-requested workout.
      await putActiveWorkout(null);
      await putTimerState(null);
      await logEvent(
        'info',
        'workout abandoned',
        `${staleDay?.name ?? 'unknown day'} discarded to start ${day.name}`,
      );
      activeWorkout = null;
    }
  }

  // All in-workout rules live in the pure reducer (src/logic/workoutSession.ts),
  // shared with Apple Watch events. `session` is this render's copy of its
  // state; it's only replaced after the new state is committed to IndexedDB.
  const ctx = createSessionContext(day.sets, tmMap, settings);
  let session: SessionState = createSession(day.sets, {
    intersperseAccessories: settings.intersperseAccessories,
    startedAt: Date.now(),
  });

  // Request wake lock and notification permission
  requestWakeLock();
  requestNotificationPermission();

  let editingSetIndex: number | null = null;
  let timerExpiredTimeout: ReturnType<typeof setTimeout> | null = null;
  let timerExpiredClickDismiss: (() => void) | null = null;
  // Three independent places within *this* render can notice a rest timer
  // hit zero — the 250ms poll in startRestTimer's updateTimer, the
  // resumed-timer recovery interval set up when this render finds an
  // in-progress timer, and the visibilitychange reconciler. Each does its
  // own `await getTimerState()` before deciding to act, so two of them can
  // both read the timer as still-expired-but-present before either has
  // written it back to null — this flag is checked-and-set synchronously
  // (no await in between) right after that read, so only the first one to
  // get there actually handles the expiry. Reset whenever a new rest period
  // starts, so a later, distinct expiry can be handled again.
  //
  // Deliberately scoped per-renderWorkout()-call (not module-level): a
  // second render of this same route (e.g. the user leaves via a native
  // back-navigation that bypasses #back-btn's cleanup, then returns) can
  // leave a *previous* render's detectors still running against detached
  // DOM. A module-level flag would let that stale render's detector win the
  // race and permanently block the live render's own detector from ever
  // updating the visible page. Scoping it here means each render's
  // detectors only ever race against each other, never against a different
  // render's.
  let timerExpiryHandled = false;
  // Rest-timer end time as last reported to the Live Activity (native-only;
  // no-op on web). Tracked separately from the DOM/IndexedDB timer state so
  // the activity payload can be rebuilt on demand without re-reading either.
  let liveActivityRestEndTime: number | null = null;

  // Restore in-progress workout if one exists for this same day (either it
  // already matched, or the conflict above was just resolved by resuming it).
  let resumingActiveWorkout = false;
  if (activeWorkout && activeWorkoutMatches(activeWorkout, state)) {
    session = {
      ...session,
      completedSets: [...activeWorkout.completedSets],
      currentSetIndex: activeWorkout.currentSetIndex,
      startedAt: activeWorkout.startedAt,
      // Restore the effective sequence (including any bonus sets that were
      // appended for volume deficits) so the indexing into completedSets
      // stays consistent across reloads.
      workoutSets:
        activeWorkout.workoutSets && activeWorkout.workoutSets.length > 0
          ? activeWorkout.workoutSets
          : session.workoutSets,
      appliedEventIds: activeWorkout.appliedEventIds ?? [],
    };
    resumingActiveWorkout = true;
  }

  // If starting fresh (not resuming), clear any stale timer state that may
  // have been left over from a previous session (e.g. user pressed Back
  // while a rest timer was running).
  if (!resumingActiveWorkout) {
    await putTimerState(null);
    cancelBackgroundTimerNotification();
  }

  await logEvent(
    'info',
    resumingActiveWorkout ? 'workout resumed' : 'workout started',
    `${day.name} (cycle ${state.cycle}, week ${state.weekIndex + 1})`,
  );

  container.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <button id="back-btn" class="btn btn-text">&larr; Back</button>
    <h1>${day.name}</h1>
    <span class="workout-meta">Cycle ${state.cycle} · ${week.name}</span>
    <button id="abandon-workout-btn" class="btn btn-text btn-danger">Abandon</button>
  `;
  container.appendChild(header);

  // Timer display — appended directly to #app (not the scrolling
  // .workout-screen) so it stays a fixed-position sibling of the scroll
  // container rather than a descendant of one. WebKit has historically
  // compositor-pinned `position: fixed` descendants of a
  // `-webkit-overflow-scrolling: touch` ancestor to that ancestor's own
  // scroll layer instead of the true viewport, which would make the timer
  // drift with the set list instead of staying put while resting.
  const timerEl = document.createElement('div');
  timerEl.className = 'rest-timer hidden';
  timerEl.id = 'rest-timer';
  timerEl.innerHTML = `
    <span class="timer-label">Rest</span>
    <span class="timer-value" id="timer-value">0:00</span>
    <button id="skip-timer-btn" class="btn btn-small">Skip</button>
  `;
  container.appendChild(timerEl);

  const main = document.createElement('main');
  main.className = 'workout-screen';

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
    const { workoutSets, completedSets, currentSetIndex } = session;
    setsContainer.innerHTML = '';
    const actualRepsSoFar = completedSets.map((s) => s.actualReps);

    // Volume-group deficit display, tracked per group (not by raw array
    // position) so accessory interspersing — which can put an unrelated
    // group's set between two occurrences of the same group — can't break
    // the dedup below:
    //
    // 1. Completed sets show a growing trail: the running total right
    //    after each was logged, but only when it differs from that group's
    //    most recently *shown* total — so if nothing changed (e.g. a 0-rep
    //    set), it still doesn't repeat identical numbers back to back.
    // 2. The current set shows its own "before this attempt" total, unless
    //    it's identical to the trail's last entry for its own group — that
    //    number is already visible on the completed card above it.
    // 3. The next upcoming occurrence of a *different* group than the
    //    current set's own gets one heads-up (e.g. a bonus set queued
    //    behind an unrelated primary lift); further-out future sets don't
    //    repeat it, since nothing can change until the current set itself
    //    is logged.
    const lastShownForGroup = new Map<string, VolumeProgress>();
    const deficitShownAhead = new Set<string>();
    const currentSet = workoutSets[currentSetIndex];
    const currentGroupKey = currentSet ? getVolumeGroupKey(currentSet) : null;
    if (currentGroupKey) deficitShownAhead.add(currentGroupKey);
    const isSameValue = (a: VolumeProgress, b: VolumeProgress) => a.cumulative === b.cumulative && a.target === b.target;

    workoutSets.forEach((set, idx) => {
      const weight = getSetWeight(set, ctx.tmMap);
      const plates = weight > 0 ? calculatePlates(weight) : null;
      const isCompleted = idx < currentSetIndex;
      const isCurrent = idx === currentSetIndex;
      const completed = completedSets[idx];

      const setEl = document.createElement('div');
      setEl.className = `set-item ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''} ${set.isBonus ? 'bonus' : ''}`;
      setEl.dataset.testid = `set-${idx}`;
      if (set.isBonus) setEl.dataset.bonus = 'true';

      // A bonus set may owe fewer reps than a normal set of this exercise
      // (e.g. only 3 more needed to close the deficit) — prescribe exactly
      // that, not the full per-set count.
      const effectiveReps = getEffectiveReps(set);

      let repsDisplay = `${effectiveReps} reps`;
      if (set.isAmrap) repsDisplay += '+';
      if (set.isBonus) repsDisplay += ' (bonus)';

      let deficitDisplay = '';
      const groupKey = getVolumeGroupKey(set);
      if (groupKey) {
        if (isCompleted) {
          const progress = computeVolumeProgress(groupKey, workoutSets, actualRepsSoFar, idx + 1, ctx.volumeGroups);
          if (progress) {
            const prevShown = lastShownForGroup.get(groupKey);
            if (!prevShown || !isSameValue(prevShown, progress)) {
              const remaining = Math.max(0, progress.target - progress.cumulative);
              deficitDisplay = `<span class="set-deficit" data-testid="set-deficit">${progress.cumulative}/${progress.target} reps so far · ${remaining} to go</span>`;
              lastShownForGroup.set(groupKey, progress);
            }
          }
        } else {
          const isFirstUpcomingOccurrence = idx > currentSetIndex && !deficitShownAhead.has(groupKey);
          if (idx === currentSetIndex || isFirstUpcomingOccurrence) {
            const progress = computeVolumeProgress(groupKey, workoutSets, actualRepsSoFar, idx, ctx.volumeGroups);
            if (progress) {
              const prevShown = lastShownForGroup.get(groupKey);
              const duplicatesTrail = idx === currentSetIndex && !!prevShown && isSameValue(prevShown, progress);
              if (!duplicatesTrail) {
                const remaining = Math.max(0, progress.target - progress.cumulative);
                deficitDisplay = `<span class="set-deficit" data-testid="set-deficit">${progress.cumulative}/${progress.target} reps so far · ${remaining} to go</span>`;
              }
            }
          }
          if (idx > currentSetIndex) deficitShownAhead.add(groupKey);
        }
      }

      const weightDisplay = weight > 0 ? `${weight} lbs` : 'BW / Custom';
      let plateDisplay = '';
      if (plates && plates.plates.length > 0) {
        plateDisplay = `<span class="plate-info">${formatPlates(plates.plates)} per side</span>`;
      }

      if (isCompleted && completed) {
        const missedReps = completed.actualReps < completed.prescribedReps;
        if (editingSetIndex === idx) {
          setEl.innerHTML = `
            <div class="set-info">
              <span class="set-exercise">${set.exerciseId}</span>
              <span class="set-weight">${weightDisplay}</span>
              ${plateDisplay}
            </div>
            <div class="set-actions">
              <div class="reps-stepper" data-testid="edit-reps-stepper" data-max="${set.isAmrap ? 999 : effectiveReps}">
                <span class="stepper-label">Reps:</span>
                <button class="stepper-btn" data-testid="edit-stepper-dec" aria-label="Fewer reps">−</button>
                <span class="stepper-value" data-testid="edit-stepper-value">${completed.actualReps}</span>
                <button class="stepper-btn" data-testid="edit-stepper-inc" aria-label="More reps">+</button>
              </div>
              <button class="btn btn-primary save-edit-btn" data-testid="save-edit-btn">Save</button>
              <button class="btn btn-text cancel-edit-btn" data-testid="cancel-edit-btn">Cancel</button>
            </div>
          `;
        } else {
          setEl.innerHTML = `
            <div class="set-info">
              <span class="set-exercise">${set.exerciseId}</span>
              <span class="set-weight">${weightDisplay}</span>
              ${plateDisplay}
            </div>
            <div class="set-result">
              <span class="set-reps-done ${missedReps ? 'missed' : ''}">${completed.actualReps} reps ✓</span>
              ${deficitDisplay}
              <button class="btn btn-small edit-set-btn" data-testid="edit-set-btn" data-set-idx="${idx}">Edit</button>
            </div>
          `;
        }
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
              ${deficitDisplay}
            </div>
            <div class="set-actions">
              <div class="reps-stepper hidden" data-testid="reps-stepper" data-max="${effectiveReps}">
                <span class="stepper-label">Reps:</span>
                <button class="stepper-btn" data-testid="stepper-dec" aria-label="Fewer reps">−</button>
                <span class="stepper-value" data-testid="stepper-value">${effectiveReps}</span>
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
            ${deficitDisplay}
          </div>
        `;
      }

      setsContainer.appendChild(setEl);
    });

    // Show complete button when all sets done
    if (currentSetIndex >= workoutSets.length) {
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
    doneBtn?.addEventListener('click', () => {
      // Prime synchronously inside the user gesture so the beep can play
      // ~90s later despite the browser's autoplay policy.
      primeAudioContext();
      markSetDone();
    });

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

    // Editing a completed set's recorded reps
    setsContainer.querySelectorAll('[data-testid="edit-set-btn"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.setIdx || '-1', 10);
        editingSetIndex = idx;
        renderSets();
      });
    });

    const editDecBtn = setsContainer.querySelector('[data-testid="edit-stepper-dec"]') as HTMLButtonElement | null;
    editDecBtn?.addEventListener('click', () => {
      const valueEl = setsContainer.querySelector('[data-testid="edit-stepper-value"]') as HTMLElement | null;
      if (!valueEl) return;
      const current = parseInt(valueEl.textContent || '0', 10);
      if (current > 0) valueEl.textContent = String(current - 1);
    });

    const editIncBtn = setsContainer.querySelector('[data-testid="edit-stepper-inc"]') as HTMLButtonElement | null;
    editIncBtn?.addEventListener('click', () => {
      const stepperEl = setsContainer.querySelector('[data-testid="edit-reps-stepper"]') as HTMLElement | null;
      const valueEl = setsContainer.querySelector('[data-testid="edit-stepper-value"]') as HTMLElement | null;
      if (!stepperEl || !valueEl) return;
      const max = parseInt(stepperEl.dataset.max || '999', 10);
      const current = parseInt(valueEl.textContent || '0', 10);
      if (current < max) valueEl.textContent = String(current + 1);
    });

    const saveEditBtn = setsContainer.querySelector('[data-testid="save-edit-btn"]') as HTMLButtonElement | null;
    saveEditBtn?.addEventListener('click', () => {
      void saveEditedSet();
    });

    const cancelEditBtn = setsContainer.querySelector('[data-testid="cancel-edit-btn"]') as HTMLButtonElement | null;
    cancelEditBtn?.addEventListener('click', () => {
      editingSetIndex = null;
      renderSets();
    });
  }

  async function saveEditedSet() {
    if (editingSetIndex === null) return;
    const valueEl = setsContainer.querySelector('[data-testid="edit-stepper-value"]') as HTMLElement | null;
    const newReps = parseInt(valueEl?.textContent || '', 10);
    if (!isNaN(newReps)) {
      const index = editingSetIndex;
      await dispatch(() => applyEvent({ type: 'editSet', index, reps: newReps }));
    }
    editingSetIndex = null;
    renderSets();
  }

  function toActiveWorkout(s: SessionState): ActiveWorkout {
    const record: ActiveWorkout = {
      templateId: state!.templateId,
      cycle: state!.cycle,
      weekIndex: state!.weekIndex,
      dayIndex: state!.dayIndex,
      completedSets: [...s.completedSets],
      currentSetIndex: s.currentSetIndex,
      startedAt: s.startedAt,
      workoutSets: [...s.workoutSets],
    };
    if (s.appliedEventIds.length > 0) record.appliedEventIds = [...s.appliedEventIds];
    return record;
  }

  // Every in-workout action (a tap here, or an Apple Watch event) runs one
  // at a time against the latest state, so two sources can't both act on
  // the same set.
  let dispatchChain: Promise<unknown> = Promise.resolve();
  function dispatch<T>(action: () => Promise<T>): Promise<T> {
    const run = dispatchChain.then(action, action);
    dispatchChain = run.catch(() => {});
    return run;
  }

  /**
   * Apply one event: compute the next state with the shared reducer, commit
   * it (workout + rest timer in one transaction), and only then adopt it and
   * update the screen. Must run inside dispatch().
   */
  async function applyEvent(event: SessionEvent): Promise<SessionResult> {
    const result = applySessionEvent(session, event, ctx);
    // Don't rewrite an unchanged running timer, so a rest the expiry
    // handler just cleared can't be written back. Clearing is always safe.
    const nextTimer = result.state.timer;
    const timerUpdate = nextTimer === null || nextTimer !== session.timer ? nextTimer : undefined;
    await commitActiveWorkoutAtomic(toActiveWorkout(result.state), timerUpdate);
    session = result.state;
    await runEffects(event, result);
    return result;
  }

  async function runEffects(event: SessionEvent, result: SessionResult) {
    const next = result.state;
    switch (event.type) {
      case 'completeSet': {
        syncLiveActivity(null);
        const hasNextSet = next.currentSetIndex < next.workoutSets.length;
        if (result.restStarted && next.timer) {
          await startRestTimer(next.timer);
          // e.g. an accessory is next during a primary set's rest.
          if (!next.restLocksDone) setDoneButtonDisabled(false);
        } else if (hasNextSet && next.restLocksDone && next.timer) {
          // e.g. an accessory was done during a still-running rest.
          setDoneButtonDisabled(true);
        }
        renderSets();
        break;
      }
      case 'editSet':
        break;
      case 'skipRest':
        endRestEarly();
        break;
      case 'adjustRest':
        if (!next.timer) {
          endRestEarly();
        } else {
          cancelBackgroundTimerNotification();
          scheduleBackgroundTimerNotification(next.timer.expectedEndTime);
          syncLiveActivity(next.timer.expectedEndTime);
        }
        break;
      case 'restExpired':
        break;
    }
  }

  function endRestEarly() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    timerEl.classList.add('hidden');
    setDoneButtonDisabled(false);
    cancelBackgroundTimerNotification();
    syncLiveActivity(null);
  }

  async function markSetDone() {
    const set = session.workoutSets[session.currentSetIndex];
    if (!set) return;
    const effectiveReps = getEffectiveReps(set);

    let actualReps = effectiveReps;
    const stepperValue = setsContainer.querySelector('[data-testid="stepper-value"]') as HTMLElement | null;
    if (stepperValue) {
      actualReps = parseInt(stepperValue.textContent || '', 10);
      if (isNaN(actualReps)) actualReps = effectiveReps;
    }

    await dispatch(() => applyEvent({ type: 'completeSet', at: Date.now(), reps: actualReps }));
  }

  function liveActivityState() {
    const { workoutSets, currentSetIndex } = session;
    const exerciseId = workoutSets[currentSetIndex]?.exerciseId ?? '';
    return {
      dayName: day.name,
      exerciseName: resolveExerciseName(exerciseId, exercises),
      setIndex: Math.min(currentSetIndex + 1, workoutSets.length),
      setTotal: workoutSets.length,
      restEndTime: liveActivityRestEndTime,
    };
  }

  function syncLiveActivity(restEndTime: number | null) {
    liveActivityRestEndTime = restEndTime;
    void updateWorkoutActivity(liveActivityState());
  }

  function setDoneButtonDisabled(disabled: boolean) {
    isResting = disabled;
    const doneBtn = setsContainer.querySelector('.done-set-btn') as HTMLButtonElement | null;
    if (doneBtn) doneBtn.disabled = disabled;
  }

  // fireTimerNotification() decides whether an OS/SW notification already
  // covers this expiry and returns whether cancelBackgroundTimerNotification()
  // is still warranted — see that function's own comment for why it isn't
  // simply "always" on native (cancelling a notification we've just decided
  // to trust would silently prevent it from ever firing). Centralized here
  // (rather than duplicated at each expiry call site) so this can't be
  // broken by fixing it in one place and not another.
  async function notifyTimerExpired() {
    const shouldCancel = await fireTimerNotification();
    if (shouldCancel) {
      await cancelBackgroundTimerNotification();
    }
  }

  // The single place that clears a completed rest timer's state and fires
  // the expiry alert. Four independent detectors can notice an expiry (the
  // 250ms poll below, the resumed-timer recovery interval, the
  // visibilitychange reconciler, and the already-expired-on-mount check) —
  // routing all of them through here, guarded by timerExpiryHandled (see its
  // declaration), keeps that sequence from silently drifting out of sync
  // across call sites the way notifyTimerExpired's own comment above warns
  // about.
  //
  // isLiveExpiry distinguishes two genuinely different situations, not just
  // a formatting choice, and both consequences of it (the "Time's Up!"
  // banner vs. silent hide, and syncing isResting/the Live Activity vs.
  // not) always move together — hence one parameter, not two. `true` is for
  // an expiry this page instance watched happen in real time (the poll, the
  // recovery interval, or visibilitychange catching one just missed) — the
  // banner is useful there, and the done button/Live Activity are already
  // wired up from earlier in this same render. `false` is for a timer
  // already expired when the page loads: it's cleared silently (see
  // e2e/timer-notification.spec.ts's "fires notification when re-rendering
  // with an already-expired timer", which asserts #rest-timer stays hidden
  // for that case) and skips syncing the done button/Live Activity, since at
  // that point in renderWorkout() startWorkoutActivity() hasn't even run yet
  // for this render — syncLiveActivity(null) would call updateActivity() for
  // an activity that doesn't exist yet (harmless, just log noise) and
  // there's no done button in the DOM yet to disable/enable either.
  async function handleTimerExpiry(isLiveExpiry: boolean) {
    if (timerExpiryHandled) return;
    timerExpiryHandled = true;
    try {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      await putTimerState(null);
      session = applySessionEvent(session, { type: 'restExpired' }, ctx).state;
      if (isLiveExpiry) {
        setDoneButtonDisabled(false);
        syncLiveActivity(null);
      }
      // UI feedback first, synchronously — showTimerExpired()/hiding the
      // timer shouldn't wait on notifyTimerExpired()'s native permission
      // check.
      if (isLiveExpiry) {
        showTimerExpired(timerEl);
      } else {
        timerEl.classList.add('hidden');
      }
      await notifyTimerExpired();
    } catch (err) {
      // A failure partway through (e.g. putTimerState(null) rejecting on a
      // blocked/quota-exceeded IndexedDB transaction) must not leave
      // timerExpiryHandled stuck true — that would permanently stop every
      // other detector from ever retrying this expiry for the rest of the
      // render, freezing the countdown with no alert ever firing. Let the
      // next detector tick try again.
      timerExpiryHandled = false;
      void logEvent(
        'warn',
        'timer expiry handling failed',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // `timer` is already committed to IndexedDB by applyEvent().
  async function startRestTimer(timer: TimerState) {
    // Cancel any stale "Time's Up!" auto-dismiss from a previous expired timer.
    if (timerExpiredTimeout !== null) {
      clearTimeout(timerExpiredTimeout);
      timerExpiredTimeout = null;
    }
    if (timerExpiredClickDismiss !== null) {
      timerEl.removeEventListener('click', timerExpiredClickDismiss);
      timerExpiredClickDismiss = null;
    }
    // Reset the element from any expired visual state.
    timerEl.classList.remove('timer-expired');
    delete timerEl.dataset.testid;
    const skipBtnEl = document.getElementById('skip-timer-btn');
    if (skipBtnEl) skipBtnEl.classList.remove('hidden');

    // A fresh timer means any previous expiry is done being handled — allow
    // this new one's eventual expiry to be handled too.
    timerExpiryHandled = false;

    scheduleBackgroundTimerNotification(timer.expectedEndTime);
    syncLiveActivity(timer.expectedEndTime);

    timerEl.classList.remove('hidden');
    setDoneButtonDisabled(true);

    if (timerInterval) clearInterval(timerInterval);

    let timerCompleting = false;

    const updateTimer = async () => {
      if (timerCompleting) return;

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
        timerCompleting = true;
        await handleTimerExpiry(true);
      }
    };

    timerInterval = setInterval(updateTimer, 250);
    updateTimer();
  }

  function showTimerExpired(el: HTMLElement) {
    el.classList.remove('hidden');
    el.classList.add('timer-expired');
    el.dataset.testid = 'timer-expired';
    const timerValue = document.getElementById('timer-value');
    if (timerValue) timerValue.textContent = "Time's Up!";
    const skipBtn = document.getElementById('skip-timer-btn');
    if (skipBtn) skipBtn.classList.add('hidden');

    const dismiss = () => {
      el.classList.add('hidden');
      el.classList.remove('timer-expired');
      delete el.dataset.testid;
      el.removeEventListener('click', dismiss);
      timerExpiredTimeout = null;
      timerExpiredClickDismiss = null;
    };

    timerExpiredClickDismiss = dismiss;
    el.addEventListener('click', dismiss);
    timerExpiredTimeout = setTimeout(dismiss, 10000);
  }

  function showFailureSheet(
    mainFailed: Array<{ exerciseId: string; got: number; prescribed: number }>,
    bbbFailed: Array<{ exerciseId: string; got: number; target: number }>,
  ) {
    const hasMainFailure = mainFailed.length > 0;

    const items = [
      ...mainFailed.map(
        (f) => `<li>${f.exerciseId}: ${f.got}/${f.prescribed} reps (main set)</li>`,
      ),
      ...bbbFailed.map(
        (f) => `<li>${f.exerciseId}: ${f.got}/${f.target} reps (volume target)</li>`,
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
        ${hasMainFailure ? `<button id="failure-reset-tm-btn" class="btn btn-primary btn-large">Reset Training Max</button>` : ''}
        <button id="failure-skip-btn" class="btn btn-text">Skip for now</button>
      </div>
    `;

    document.getElementById('app')?.appendChild(sheet);

    document.getElementById('failure-skip-btn')?.addEventListener('click', () => {
      navigate('home');
    });

    document.getElementById('failure-reset-tm-btn')?.addEventListener('click', async () => {
      const failedExerciseIds = new Set(mainFailed.map((f) => f.exerciseId));
      const tms = [...failedExerciseIds]
        .map((exerciseId) => {
          const currentTM = tmMap.get(exerciseId);
          return currentTM === undefined ? null : { exerciseId, weight: calculateResetTM(currentTM) };
        })
        .filter((tm): tm is { exerciseId: string; weight: number } => tm !== null);
      await putTrainingMaxesAtomic(tms);
      await logEvent(
        'info',
        'training max reset',
        `Dropped TM 10% for ${[...failedExerciseIds].join(', ')} after missed reps`,
      );
      navigate('settings');
    });
  }

  // Must run inside dispatch(). `at` is when the user finished.
  async function completeWorkout(at: number) {
    const log = buildWorkoutLog(session, state!, day!.name, at);

    const result = advanceState(state!, template!);
    const tmBumps = (result.tmBumps ?? []).map((bump) => ({
      exerciseId: bump.exerciseId,
      weight: (tmMap.get(bump.exerciseId) ?? 0) + bump.increment,
    }));

    // Log the workout, advance progression, apply any cycle-end TM bumps, and
    // clear the timer/active-workout records in one atomic transaction.
    // completeWorkoutAtomic itself guards against regressing progression —
    // relevant when finishing a workout resumed from a stale activeWorkout
    // conflict, whose "next" position may be behind wherever progression
    // has since actually moved (see its doc comment).
    await completeWorkoutAtomic({ log, candidateState: result.newState, tmBumps });

    // Cleanup
    releaseWakeLock();
    if (timerInterval) clearInterval(timerInterval);
    cancelBackgroundTimerNotification();
    void endWorkoutActivity();

    const { mainFailed, bbbFailed } = detectFailures(session, ctx.volumeGroups);
    await logEvent(
      'info',
      'workout completed',
      `${day!.name} — ${session.completedSets.length} sets; missed main=${mainFailed.length} bbb=${bbbFailed.length}`,
    );
    if (mainFailed.length > 0 || bbbFailed.length > 0) {
      showFailureSheet(mainFailed, bbbFailed);
    } else {
      navigate('home');
    }
  }

  // Event listeners
  document.getElementById('back-btn')?.addEventListener('click', async () => {
    releaseWakeLock();
    if (timerInterval) clearInterval(timerInterval);
    cancelBackgroundTimerNotification();
    void endWorkoutActivity();
    await putTimerState(null);
    navigate('home');
  });

  document.getElementById('abandon-workout-btn')?.addEventListener('click', () => {
    // Show confirmation dialog
    const existing = document.getElementById('abandon-confirm-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'abandon-confirm-dialog';
    dialog.className = 'abandon-dialog-overlay';
    dialog.innerHTML = `
      <div class="abandon-dialog-card">
        <h2>Abandon Workout?</h2>
        <p>Your progress on this workout will be lost.</p>
        <div class="abandon-dialog-actions">
          <button id="abandon-confirm-no" class="btn btn-text">Keep Going</button>
          <button id="abandon-confirm-yes" class="btn btn-danger">Abandon</button>
        </div>
      </div>
    `;
    document.getElementById('app')?.appendChild(dialog);

    document.getElementById('abandon-confirm-yes')?.addEventListener('click', async () => {
      await putActiveWorkout(null);
      await putTimerState(null);
      releaseWakeLock();
      if (timerInterval) clearInterval(timerInterval);
      cancelBackgroundTimerNotification();
      void endWorkoutActivity();
      await logEvent('info', 'workout abandoned', `${day!.name} after ${session.completedSets.length} sets`);
      navigate('home');
    });

    document.getElementById('abandon-confirm-no')?.addEventListener('click', () => {
      dialog.remove();
    });
  });

  completeBtn.addEventListener('click', () => {
    const at = Date.now();
    void dispatch(() => completeWorkout(at));
  });

  document.getElementById('skip-timer-btn')?.addEventListener('click', () => {
    void dispatch(() => applyEvent({ type: 'skipRest' }));
  });

  // On iOS, backgrounding the app for long enough can freeze the main
  // thread entirely — including the 250ms polling interval above — so a
  // rest timer can expire while nothing on the page is running to notice.
  // The service worker's own setTimeout still fires eventually, but only
  // once iOS resumes the process, which can be minutes late. Reconcile
  // immediately when the page becomes visible again instead of waiting for
  // the polling interval to catch up.
  if (removeVisibilityReconcileHandler) removeVisibilityReconcileHandler();
  const onVisibilityReconcile = () => {
    if (document.visibilityState !== 'visible') return;
    void (async () => {
      const saved = await getTimerState();
      if (!saved || getRemainingMs(saved) > 0) return;
      await handleTimerExpiry(true);
    })();
  };
  document.addEventListener('visibilitychange', onVisibilityReconcile);
  removeVisibilityReconcileHandler = () =>
    document.removeEventListener('visibilitychange', onVisibilityReconcile);

  // Check for existing timer (browser tab resumed after suspension)
  const existingTimer = await getTimerState();
  if (existingTimer) {
    const remaining = getRemainingMs(existingTimer);
    if (remaining > 0) {
      session = { ...session, timer: existingTimer, restLocksDone: true };
      liveActivityRestEndTime = existingTimer.expectedEndTime;
      timerEl.classList.remove('hidden');
      setDoneButtonDisabled(true);
      // timerInterval is shared module state — if a previous render left
      // its own interval running (e.g. the user left via a raw route change
      // that bypassed #back-btn's cleanup, not this render's fault to
      // clean up otherwise), it's still ticking against that render's own
      // (now detached) DOM. Overwriting timerInterval below without first
      // clearing it would orphan that stale interval rather than stop it —
      // it keeps running, and when it later notices the same expiry and
      // clears "timerInterval" itself, it would cancel *this* render's
      // interval instead (they're the same shared variable), silently
      // killing the live detector.
      if (timerInterval) clearInterval(timerInterval);
      let recoveryCompleting = false;
      timerInterval = setInterval(async () => {
        if (recoveryCompleting) return;
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
          recoveryCompleting = true;
          await handleTimerExpiry(true);
        }
      }, 250);
    } else {
      await handleTimerExpiry(false);
    }
  }

  renderSets();
  void startWorkoutActivity(liveActivityState());
}
