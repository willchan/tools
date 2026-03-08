import { test, expect } from '@playwright/test';

/**
 * E2E tests for flexible program start and manual correction features.
 */

test.describe('Flexible Program Start', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('shows week picker on home screen', async ({ page }) => {
    const weekPicker = page.locator('[data-testid="week-picker"]');
    await expect(weekPicker).toBeVisible();
    // Default 5/3/1 has 3 weeks
    await expect(weekPicker.locator('.week-picker-btn')).toHaveCount(3);
  });

  test('first week is active by default', async ({ page }) => {
    const activeWeek = page.locator('.week-picker-btn.active');
    await expect(activeWeek).toHaveCount(1);
    await expect(activeWeek).toContainText('Week 1');
  });

  test('clicking a different week updates the current week', async ({ page }) => {
    // Click week 2
    await page.click('.week-picker-btn:nth-child(2)');
    await page.waitForTimeout(300);

    const activeWeek = page.locator('.week-picker-btn.active');
    await expect(activeWeek).toContainText('Week 2');

    // Cycle info should update
    const cycleInfo = page.locator('.cycle-info');
    await expect(cycleInfo).toContainText('Week 2');
  });

  test('week selection persists after navigation', async ({ page }) => {
    // Click week 3
    await page.click('.week-picker-btn:nth-child(3)');
    await page.waitForTimeout(300);

    // Navigate to settings and back
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');
    await page.click('.nav-btn[data-route="home"]');
    await page.waitForSelector('.home-screen');

    const activeWeek = page.locator('.week-picker-btn.active');
    await expect(activeWeek).toContainText('Week 3');
  });

  test('day picker updates when week changes', async ({ page }) => {
    // On week 1, days should be the same 4 days
    const dayPicker = page.locator('[data-testid="day-picker"]');
    await expect(dayPicker.locator('.day-picker-btn')).toHaveCount(4);

    // Switch to week 2 - should still have 4 days
    await page.click('.week-picker-btn:nth-child(2)');
    await page.waitForTimeout(300);
    await expect(dayPicker.locator('.day-picker-btn')).toHaveCount(4);
  });
});

test.describe('Progression State Override in Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('.nav-btn[data-route="settings"]');
    await page.waitForSelector('.settings-screen');
  });

  test('shows progression override section', async ({ page }) => {
    const section = page.locator('[data-testid="progression-override"]');
    await expect(section).toBeVisible();
  });

  test('displays current cycle, week, and day inputs', async ({ page }) => {
    await expect(page.locator('[data-testid="override-cycle"]')).toBeVisible();
    await expect(page.locator('[data-testid="override-week"]')).toBeVisible();
    await expect(page.locator('[data-testid="override-day"]')).toBeVisible();
  });

  test('shows current state values in inputs', async ({ page }) => {
    await expect(page.locator('[data-testid="override-cycle"]')).toHaveValue('1');
    await expect(page.locator('[data-testid="override-week"]')).toHaveValue('1');
    await expect(page.locator('[data-testid="override-day"]')).toHaveValue('1');
  });

  test('can update progression state', async ({ page }) => {
    await page.locator('[data-testid="override-cycle"]').fill('2');
    await page.locator('[data-testid="override-week"]').fill('3');
    await page.locator('[data-testid="override-day"]').fill('2');
    await page.click('#save-progression-btn');

    // Verify feedback
    await expect(page.locator('#save-progression-btn')).toHaveText('Saved!');

    // Navigate to home and verify
    await page.click('.nav-btn[data-route="home"]');
    await page.waitForSelector('.home-screen');

    const cycleInfo = page.locator('.cycle-info');
    await expect(cycleInfo).toContainText('Cycle 2');
    await expect(cycleInfo).toContainText('Week 3');
  });
});

test.describe('Edit Workout History', () => {
  // Helper to complete a workout
  async function completeWorkout(page: import('@playwright/test').Page) {
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    for (let i = 0; i < 14; i++) {
      await page.click('[data-testid="done-set-btn"]');
      try {
        await page.locator('#skip-timer-btn').waitFor({ state: 'visible', timeout: 1000 });
        await page.click('#skip-timer-btn');
      } catch {
        // Timer not shown (last set)
      }
    }
    await page.click('#complete-workout-btn');
    await page.waitForSelector('.home-screen');
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('history cards have an edit button', async ({ page }) => {
    await completeWorkout(page);

    await page.click('.nav-btn[data-route="history"]');
    await page.waitForSelector('.history-screen');

    const editBtn = page.locator('[data-testid="edit-workout-btn"]');
    await expect(editBtn.first()).toBeVisible();
  });

  test('clicking edit opens the edit form', async ({ page }) => {
    await completeWorkout(page);

    await page.click('.nav-btn[data-route="history"]');
    await page.waitForSelector('.history-screen');

    await page.click('[data-testid="edit-workout-btn"]');
    await page.waitForSelector('[data-testid="edit-workout-form"]');

    const form = page.locator('[data-testid="edit-workout-form"]');
    await expect(form).toBeVisible();
  });

  test('can edit workout date', async ({ page }) => {
    await completeWorkout(page);

    await page.click('.nav-btn[data-route="history"]');
    await page.waitForSelector('.history-screen');

    await page.click('[data-testid="edit-workout-btn"]');
    await page.waitForSelector('[data-testid="edit-workout-form"]');

    const dateInput = page.locator('[data-testid="edit-workout-date"]');
    await expect(dateInput).toBeVisible();
    await dateInput.fill('2026-03-05');

    await page.click('[data-testid="save-workout-edit-btn"]');
    await page.waitForSelector('.history-screen');

    // Verify date updated
    const dateDisplay = page.locator('.history-date').first();
    await expect(dateDisplay).toContainText('3/5/2026');
  });

  test('can edit set reps in workout history', async ({ page }) => {
    await completeWorkout(page);

    await page.click('.nav-btn[data-route="history"]');
    await page.waitForSelector('.history-screen');

    await page.click('[data-testid="edit-workout-btn"]');
    await page.waitForSelector('[data-testid="edit-workout-form"]');

    // Edit first set's actual reps
    const repsInput = page.locator('[data-testid="edit-set-reps-0"]');
    await expect(repsInput).toBeVisible();
    await repsInput.fill('8');

    await page.click('[data-testid="save-workout-edit-btn"]');
    await page.waitForSelector('.history-screen');
  });
});

test.describe('Manual Workout Logging (Backfill)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('.nav-btn[data-route="history"]');
    await page.waitForSelector('.history-screen');
  });

  test('shows Add Past Workout button', async ({ page }) => {
    const btn = page.locator('[data-testid="add-past-workout-btn"]');
    await expect(btn).toBeVisible();
  });

  test('clicking Add Past Workout opens log form', async ({ page }) => {
    await page.click('[data-testid="add-past-workout-btn"]');
    await page.waitForSelector('[data-testid="log-past-workout-form"]');

    const form = page.locator('[data-testid="log-past-workout-form"]');
    await expect(form).toBeVisible();
  });

  test('log form has date, week, and day selectors', async ({ page }) => {
    await page.click('[data-testid="add-past-workout-btn"]');
    await page.waitForSelector('[data-testid="log-past-workout-form"]');

    await expect(page.locator('[data-testid="past-workout-date"]')).toBeVisible();
    await expect(page.locator('[data-testid="past-workout-week"]')).toBeVisible();
    await expect(page.locator('[data-testid="past-workout-day"]')).toBeVisible();
  });

  test('can log a past workout', async ({ page }) => {
    await page.click('[data-testid="add-past-workout-btn"]');
    await page.waitForSelector('[data-testid="log-past-workout-form"]');

    // Fill in date
    await page.locator('[data-testid="past-workout-date"]').fill('2026-03-05');
    // Select week 1, day 1 (defaults)
    await page.click('[data-testid="save-past-workout-btn"]');
    await page.waitForSelector('.history-screen');

    // Should see the logged workout in history
    const list = page.locator('[data-testid="history-list"]');
    await expect(list).toBeVisible();
    const cards = list.locator('.history-card');
    await expect(cards).toHaveCount(1);
  });
});
