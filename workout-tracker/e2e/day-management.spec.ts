import { test, expect } from '@playwright/test';

/**
 * TDD: Day management — reordering days in template editor
 * and picking days out of order on the home screen.
 */

test.describe('Template Editor — Day Reordering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('.nav-btn[data-route="templates"]');
    await page.waitForSelector('.templates-screen');
    await page.click('.edit-template-btn');
    await page.waitForSelector('.template-edit-screen');
  });

  test('each day has move up and move down buttons', async ({ page }) => {
    const days = page.locator('.day-section');
    const count = await days.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Each day should have move-up and move-down buttons
    for (let i = 0; i < count; i++) {
      const day = days.nth(i);
      const moveUp = day.locator('.move-day-up-btn');
      const moveDown = day.locator('.move-day-down-btn');
      await expect(moveUp).toBeVisible();
      await expect(moveDown).toBeVisible();
    }
  });

  test('move up button is disabled on the first day', async ({ page }) => {
    const firstDay = page.locator('.day-section').first();
    await expect(firstDay.locator('.move-day-up-btn')).toBeDisabled();
  });

  test('move down button is disabled on the last day', async ({ page }) => {
    const lastDay = page.locator('.day-section').last();
    await expect(lastDay.locator('.move-day-down-btn')).toBeDisabled();
  });

  test('clicking move down swaps the day with the next one', async ({ page }) => {
    // Get original first two day names
    const firstDayName = await page.locator('.day-name-input').first().inputValue();
    const secondDayName = await page.locator('.day-name-input').nth(1).inputValue();

    // Click move down on the first day
    await page.locator('.day-section').first().locator('.move-day-down-btn').click();

    // Now the names should be swapped
    const newFirstName = await page.locator('.day-name-input').first().inputValue();
    const newSecondName = await page.locator('.day-name-input').nth(1).inputValue();

    expect(newFirstName).toBe(secondDayName);
    expect(newSecondName).toBe(firstDayName);
  });

  test('clicking move up swaps the day with the previous one', async ({ page }) => {
    const firstDayName = await page.locator('.day-name-input').first().inputValue();
    const secondDayName = await page.locator('.day-name-input').nth(1).inputValue();

    // Click move up on the second day
    await page.locator('.day-section').nth(1).locator('.move-day-up-btn').click();

    const newFirstName = await page.locator('.day-name-input').first().inputValue();
    const newSecondName = await page.locator('.day-name-input').nth(1).inputValue();

    expect(newFirstName).toBe(secondDayName);
    expect(newSecondName).toBe(firstDayName);
  });

  test('reordered days persist after saving template', async ({ page }) => {
    const originalSecondName = await page.locator('.day-name-input').nth(1).inputValue();

    // Move second day up to first position
    await page.locator('.day-section').nth(1).locator('.move-day-up-btn').click();

    // Save
    await page.click('[data-testid="save-template-btn"]');
    await page.waitForSelector('.templates-screen');

    // Re-open editor
    await page.click('.edit-template-btn');
    await page.waitForSelector('.template-edit-screen');

    // First day should now be what was previously second
    const firstDayName = await page.locator('.day-name-input').first().inputValue();
    expect(firstDayName).toBe(originalSecondName);
  });
});

test.describe('Template Editor — Day Reorder Propagation Across Weeks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('.nav-btn[data-route="templates"]');
    await page.waitForSelector('.templates-screen');
    await page.click('.edit-template-btn');
    await page.waitForSelector('.template-edit-screen');
  });

  test('reordering a day in week 1 propagates to all other weeks', async ({ page }) => {
    const weeks = page.locator('.week-section');

    // Get day names for week 1 (index 0) before reorder
    const week1Day0Before = await weeks.nth(0).locator('.day-name-input').nth(0).inputValue();
    const week1Day1Before = await weeks.nth(0).locator('.day-name-input').nth(1).inputValue();

    // Verify weeks 2 and 3 start with same day ordering as week 1
    expect(await weeks.nth(1).locator('.day-name-input').nth(0).inputValue()).toBe(week1Day0Before);
    expect(await weeks.nth(1).locator('.day-name-input').nth(1).inputValue()).toBe(week1Day1Before);
    expect(await weeks.nth(2).locator('.day-name-input').nth(0).inputValue()).toBe(week1Day0Before);
    expect(await weeks.nth(2).locator('.day-name-input').nth(1).inputValue()).toBe(week1Day1Before);

    // Move day 1 down (swapping day 0 and day 1) in week 1
    await weeks.nth(0).locator('.day-section').nth(0).locator('.move-day-down-btn').click();

    // Week 1 should now be swapped
    expect(await weeks.nth(0).locator('.day-name-input').nth(0).inputValue()).toBe(week1Day1Before);
    expect(await weeks.nth(0).locator('.day-name-input').nth(1).inputValue()).toBe(week1Day0Before);

    // Weeks 2 and 3 should also be swapped
    expect(await weeks.nth(1).locator('.day-name-input').nth(0).inputValue()).toBe(week1Day1Before);
    expect(await weeks.nth(1).locator('.day-name-input').nth(1).inputValue()).toBe(week1Day0Before);
    expect(await weeks.nth(2).locator('.day-name-input').nth(0).inputValue()).toBe(week1Day1Before);
    expect(await weeks.nth(2).locator('.day-name-input').nth(1).inputValue()).toBe(week1Day0Before);
  });

  test('reordering persists across weeks after save and reload', async ({ page }) => {
    const weeks = page.locator('.week-section');

    const week2Day1Before = await weeks.nth(1).locator('.day-name-input').nth(1).inputValue();

    // Move first day down in week 1
    await weeks.nth(0).locator('.day-section').nth(0).locator('.move-day-down-btn').click();

    // Save
    await page.click('[data-testid="save-template-btn"]');
    await page.waitForSelector('.templates-screen');

    // Re-open editor
    await page.click('.edit-template-btn');
    await page.waitForSelector('.template-edit-screen');

    const weeksAfter = page.locator('.week-section');

    // Week 2 day at position 0 should now be what was previously at position 1
    expect(await weeksAfter.nth(1).locator('.day-name-input').nth(0).inputValue()).toBe(week2Day1Before);
  });
});

test.describe('Template Editor — Day Order Normalization on Load', () => {
  test('normalizes out-of-sync day ordering across weeks when editor opens', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');

    // Inject a template with out-of-sync day ordering across weeks via IndexedDB
    await page.evaluate(async () => {
      const { putTemplate, putState } = await import('/src/db/database.ts');

      // Week 0: Squat, Bench, Deadlift, OHP (canonical order)
      // Week 1: Bench, Squat, OHP, Deadlift (out of sync!)
      // Week 2: Deadlift, OHP, Squat, Bench (out of sync!)
      const template = {
        id: 'out-of-sync-template',
        name: 'Out of Sync Template',
        weeks: [
          {
            id: 'w0', name: 'Week 1',
            days: [
              { id: 'd0-0', name: 'Squat Day', mainLiftId: 'squat', sets: [] },
              { id: 'd0-1', name: 'Bench Day', mainLiftId: 'bench', sets: [] },
              { id: 'd0-2', name: 'Deadlift Day', mainLiftId: 'deadlift', sets: [] },
              { id: 'd0-3', name: 'OHP Day', mainLiftId: 'ohp', sets: [] },
            ],
          },
          {
            id: 'w1', name: 'Week 2',
            days: [
              { id: 'd1-0', name: 'Bench Day', mainLiftId: 'bench', sets: [] },
              { id: 'd1-1', name: 'Squat Day', mainLiftId: 'squat', sets: [] },
              { id: 'd1-2', name: 'OHP Day', mainLiftId: 'ohp', sets: [] },
              { id: 'd1-3', name: 'Deadlift Day', mainLiftId: 'deadlift', sets: [] },
            ],
          },
          {
            id: 'w2', name: 'Week 3',
            days: [
              { id: 'd2-0', name: 'Deadlift Day', mainLiftId: 'deadlift', sets: [] },
              { id: 'd2-1', name: 'OHP Day', mainLiftId: 'ohp', sets: [] },
              { id: 'd2-2', name: 'Squat Day', mainLiftId: 'squat', sets: [] },
              { id: 'd2-3', name: 'Bench Day', mainLiftId: 'bench', sets: [] },
            ],
          },
        ],
        cycleLength: 3,
      };
      await putTemplate(template);
      await putState({ templateId: 'out-of-sync-template', cycle: 1, weekIndex: 0, dayIndex: 0 });
    });

    // Navigate to template editor
    await page.click('.nav-btn[data-route="templates"]');
    await page.waitForSelector('.templates-screen');

    // Click edit on the out-of-sync template
    const editBtns = page.locator('.edit-template-btn');
    // Find the one for our template
    const templateCards = page.locator('.template-card');
    for (let i = 0; i < await templateCards.count(); i++) {
      const text = await templateCards.nth(i).textContent();
      if (text?.includes('Out of Sync')) {
        await templateCards.nth(i).locator('.edit-template-btn').click();
        break;
      }
    }
    await page.waitForSelector('.template-edit-screen');

    // All weeks should now have the same day ordering as week 0
    const weeks = page.locator('.week-section');
    const expectedOrder = ['Squat Day', 'Bench Day', 'Deadlift Day', 'OHP Day'];

    for (let wi = 0; wi < 3; wi++) {
      for (let di = 0; di < 4; di++) {
        const dayName = await weeks.nth(wi).locator('.day-name-input').nth(di).inputValue();
        expect(dayName).toBe(expectedOrder[di]);
      }
    }
  });
});

test.describe('Home Screen — Day Picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('shows a day picker with all days in the current week', async ({ page }) => {
    const dayPicker = page.locator('[data-testid="day-picker"]');
    await expect(dayPicker).toBeVisible();

    // Default 5/3/1 has 4 days per week
    const dayButtons = dayPicker.locator('.day-picker-btn');
    await expect(dayButtons).toHaveCount(4);
  });

  test('highlights the currently scheduled day', async ({ page }) => {
    const activeDay = page.locator('.day-picker-btn.active');
    await expect(activeDay).toHaveCount(1);
    // Default state starts at day index 0 = Squat Day
    await expect(activeDay).toContainText('Squat');
  });

  test('clicking a different day changes the next workout display', async ({ page }) => {
    // Click the second day button (Bench Day)
    const dayButtons = page.locator('.day-picker-btn');
    await dayButtons.nth(1).click();

    // The day name shown should now reflect Bench Day
    const dayName = page.locator('.day-name');
    await expect(dayName).toContainText('Bench');

    // The active button should now be the second one
    await expect(dayButtons.nth(1)).toHaveClass(/active/);
  });

  test('selecting a different day persists the state and starts that workout', async ({ page }) => {
    // Click the third day (Deadlift Day)
    const dayButtons = page.locator('.day-picker-btn');
    await dayButtons.nth(2).click();

    // Start the workout
    await page.click('#start-workout-btn');

    // Workout screen should show the selected day
    await expect(page.locator('h1')).toContainText('Deadlift');
  });
});
