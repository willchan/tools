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
