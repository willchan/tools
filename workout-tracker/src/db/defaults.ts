import type { Exercise, Template, TemplateSet, TemplateDay, TemplateWeek } from './types';

export function getDefaultExercises(): Exercise[] {
  return [
    // Barbell compound lifts
    { id: 'squat', name: 'Barbell Squat', category: 'barbell', muscleGroup: 'legs' },
    { id: 'bench', name: 'Barbell Bench Press', category: 'barbell', muscleGroup: 'chest' },
    { id: 'deadlift', name: 'Barbell Deadlift', category: 'barbell', muscleGroup: 'back' },
    { id: 'ohp', name: 'Overhead Press', category: 'barbell', muscleGroup: 'shoulders' },
    // BBB accessories (same lifts at lighter weight)
    { id: 'front-squat', name: 'Front Squat', category: 'barbell', muscleGroup: 'legs' },
    { id: 'incline-bench', name: 'Incline Bench Press', category: 'barbell', muscleGroup: 'chest' },
    { id: 'barbell-row', name: 'Barbell Row', category: 'barbell', muscleGroup: 'back' },
    { id: 'close-grip-bench', name: 'Close-Grip Bench Press', category: 'barbell', muscleGroup: 'chest' },
    // Dumbbell
    { id: 'db-row', name: 'Dumbbell Row', category: 'dumbbell', muscleGroup: 'back' },
    { id: 'db-curl', name: 'Dumbbell Curl', category: 'dumbbell', muscleGroup: 'arms' },
    { id: 'db-lateral-raise', name: 'Dumbbell Lateral Raise', category: 'dumbbell', muscleGroup: 'shoulders' },
    // Bodyweight
    { id: 'pushup', name: 'Pushups', category: 'bodyweight', muscleGroup: 'chest' },
    { id: 'pullup', name: 'Pull-ups', category: 'bodyweight', muscleGroup: 'back' },
    { id: 'dip', name: 'Dips', category: 'bodyweight', muscleGroup: 'chest' },
    { id: 'hanging-leg-raise', name: 'Hanging Leg Raise', category: 'bodyweight', muscleGroup: 'core' },
    // Machine / Cable
    { id: 'leg-curl', name: 'Leg Curl', category: 'machine', muscleGroup: 'legs' },
    { id: 'leg-extension', name: 'Leg Extension', category: 'machine', muscleGroup: 'legs' },
    { id: 'face-pull', name: 'Face Pull', category: 'cable', muscleGroup: 'shoulders' },
    { id: 'lat-pulldown', name: 'Lat Pulldown', category: 'cable', muscleGroup: 'back' },
    { id: 'cable-tricep', name: 'Cable Tricep Pushdown', category: 'cable', muscleGroup: 'arms' },
  ];
}

/**
 * 5/3/1 Boring But Big (BBB) template.
 *
 * 3-week wave:
 *   Week 1 (5s):   65%, 75%, 85% (AMRAP)
 *   Week 2 (3s):   70%, 80%, 90% (AMRAP)
 *   Week 3 (5/3/1): 75%, 85%, 95% (AMRAP)
 *
 * Each day: 3 main sets + 5x10 BBB @ 50% TM + accessories.
 */
export function getDefault531Template(): Template {
  const weekConfigs: Array<{
    name: string;
    percentages: [number, number, number];
    reps: [number, number, number];
  }> = [
    { name: 'Week 1 — 5s', percentages: [0.65, 0.75, 0.85], reps: [5, 5, 5] },
    { name: 'Week 2 — 3s', percentages: [0.70, 0.80, 0.90], reps: [3, 3, 3] },
    { name: 'Week 3 — 5/3/1', percentages: [0.75, 0.85, 0.95], reps: [5, 3, 1] },
  ];

  const dayConfigs: Array<{
    name: string;
    mainLiftId: string;
    bbbLiftId: string;
    accessories: Array<{ exerciseId: string; reps: number }>;
  }> = [
    {
      name: 'Squat Day',
      mainLiftId: 'squat',
      bbbLiftId: 'squat',
      accessories: [
        { exerciseId: 'leg-curl', reps: 10 },
        { exerciseId: 'hanging-leg-raise', reps: 15 },
      ],
    },
    {
      name: 'Bench Day',
      mainLiftId: 'bench',
      bbbLiftId: 'bench',
      accessories: [
        { exerciseId: 'db-row', reps: 10 },
        { exerciseId: 'face-pull', reps: 15 },
      ],
    },
    {
      name: 'Deadlift Day',
      mainLiftId: 'deadlift',
      bbbLiftId: 'deadlift',
      accessories: [
        { exerciseId: 'hanging-leg-raise', reps: 15 },
        { exerciseId: 'db-curl', reps: 10 },
      ],
    },
    {
      name: 'OHP Day',
      mainLiftId: 'ohp',
      bbbLiftId: 'ohp',
      accessories: [
        { exerciseId: 'pullup', reps: 10 },
        { exerciseId: 'dip', reps: 10 },
      ],
    },
  ];

  const weeks: TemplateWeek[] = weekConfigs.map((wc, wi) => {
    const days: TemplateDay[] = dayConfigs.map((dc, di) => {
      const sets: TemplateSet[] = [];

      // 3 main working sets
      for (let i = 0; i < 3; i++) {
        sets.push({
          exerciseId: dc.mainLiftId,
          tmPercentage: wc.percentages[i],
          tmLiftId: dc.mainLiftId,
          reps: wc.reps[i],
          isAmrap: i === 2, // Last set is AMRAP
        });
      }

      // 5x10 BBB @ 50%
      for (let i = 0; i < 5; i++) {
        sets.push({
          exerciseId: dc.bbbLiftId,
          tmPercentage: 0.50,
          tmLiftId: dc.mainLiftId,
          reps: 10,
          isAmrap: false,
        });
      }

      // Accessories (no TM, bodyweight or fixed weight)
      for (const acc of dc.accessories) {
        for (let i = 0; i < 3; i++) {
          sets.push({
            exerciseId: acc.exerciseId,
            tmPercentage: null,
            tmLiftId: null,
            reps: acc.reps,
            isAmrap: false,
          });
        }
      }

      return {
        id: `day-${wi}-${di}`,
        name: dc.name,
        mainLiftId: dc.mainLiftId,
        sets,
      };
    });

    return { id: `week-${wi}`, name: wc.name, days };
  });

  return {
    id: '531-bbb',
    name: '5/3/1 Boring But Big',
    weeks,
    cycleLength: 3,
  };
}
