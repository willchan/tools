import { test, expect } from '@playwright/test';

/**
 * Pure logic behind the human-readable exercise name shown in the Live
 * Activity (see src/native/liveActivity.ts and
 * ios/App/LiveActivityWidget/WorkoutLiveActivityWidget.swift)
 * — the workout's TemplateSet only carries exerciseId (a kebab-case slug
 * like "hanging-leg-raise"), so the widget needs this to look up the
 * catalog's display name instead of showing the raw slug.
 */
test.describe('resolveExerciseName', () => {
  test('looks up the catalog display name for a known exercise id', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');

    const result = await page.evaluate(async () => {
      const { resolveExerciseName } = await import('/src/logic/exerciseName.ts');
      return resolveExerciseName('hanging-leg-raise', [
        { id: 'squat', name: 'Barbell Squat', category: 'barbell', muscleGroup: 'legs' },
        { id: 'hanging-leg-raise', name: 'Hanging Leg Raise', category: 'bodyweight', muscleGroup: 'core' },
      ]);
    });

    expect(result).toBe('Hanging Leg Raise');
  });

  test('falls back to the raw id when the exercise is not in the catalog', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');

    const result = await page.evaluate(async () => {
      const { resolveExerciseName } = await import('/src/logic/exerciseName.ts');
      return resolveExerciseName('mystery-lift', []);
    });

    expect(result).toBe('mystery-lift');
  });
});
