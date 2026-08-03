import { test, expect } from '@playwright/test';

/**
 * Editing a completed set's reps can change whether a volume group (BBB /
 * accessory) still owes bonus volume. This reconciles the bonus-set
 * machinery — the same decision logic used when a set is originally
 * completed — against edits, instead of only ever running once at the
 * moment a set is marked done.
 */

const SKIP_TIMER = '#skip-timer-btn';
const DONE = '[data-testid="done-set-btn"]';
const MISSED_TOGGLE = '[data-testid="missed-reps-toggle"]';
const STEPPER_DEC = '[data-testid="stepper-dec"]';
const STEPPER_VALUE = '[data-testid="stepper-value"]';

async function skipRestIfShown(page: import('@playwright/test').Page) {
  try {
    await page.locator(SKIP_TIMER).waitFor({ state: 'visible', timeout: 500 });
    await page.click(SKIP_TIMER);
  } catch {
    /* no timer to skip */
  }
}

async function completeSet(page: import('@playwright/test').Page) {
  await page.click(DONE);
  await skipRestIfShown(page);
}

async function logSetWithReps(page: import('@playwright/test').Page, reps: number, prescribed: number) {
  if (reps < prescribed) {
    await page.click(MISSED_TOGGLE);
    for (let i = 0; i < prescribed - reps; i++) {
      await page.click(STEPPER_DEC);
    }
    await expect(page.locator(STEPPER_VALUE)).toHaveText(String(reps));
  }
  await page.click(DONE);
  await skipRestIfShown(page);
}

async function completeMainSets(page: import('@playwright/test').Page) {
  await completeSet(page);
  await completeSet(page);
  await completeSet(page);
}

async function editLastCompletedSetReps(page: import('@playwright/test').Page, delta: number) {
  const item = page.locator('.set-item.completed').last();
  await item.locator('[data-testid="edit-set-btn"]').click();
  const btn = delta > 0 ? '[data-testid="edit-stepper-inc"]' : '[data-testid="edit-stepper-dec"]';
  for (let i = 0; i < Math.abs(delta); i++) {
    await item.locator(btn).click();
  }
  await item.locator('[data-testid="save-edit-btn"]').click();
}

test.describe('Editing a completed set reconciles volume/bonus sets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
  });

  test('editing a short BBB set up to full removes the now-unneeded pending bonus set', async ({ page }) => {
    await completeMainSets(page);
    // BBB 1-4 at full, BBB 5 short (6/10). Total = 46 < 50 → bonus set appended.
    for (let i = 0; i < 4; i++) await completeSet(page);
    await logSetWithReps(page, 6, 10);

    await expect(page.locator('.set-item.current')).toHaveAttribute('data-bonus', 'true');
    await expect(page.locator('.set-item')).toHaveCount(15);

    // Correct BBB 5 up to the full 10 reps — total now meets the 50 target.
    await editLastCompletedSetReps(page, 4);

    // The pending bonus set should be gone; back to the original 14 sets,
    // with the current set now the next scheduled one (leg-curl).
    await expect(page.locator('.set-item')).toHaveCount(14);
    await expect(page.locator('.set-item.current .set-exercise')).toContainText('leg-curl');
  });

  test('editing a full BBB set down after the group finished retroactively adds a bonus set', async ({ page }) => {
    await completeMainSets(page);
    // All 5 BBB sets at full reps — no bonus needed, group already resolved.
    for (let i = 0; i < 5; i++) await completeSet(page);
    await expect(page.locator('.set-item.current .set-exercise')).toContainText('leg-curl');
    await expect(page.locator('.set-item')).toHaveCount(14);

    // Correct the last BBB set down from 10 to 6 — total now falls short (46 < 50).
    const bbbSets = page.locator('.set-item.completed').filter({ hasText: 'squat' });
    await bbbSets.last().locator('[data-testid="edit-set-btn"]').click();
    await bbbSets.last().locator('[data-testid="edit-stepper-dec"]').click();
    await bbbSets.last().locator('[data-testid="edit-stepper-dec"]').click();
    await bbbSets.last().locator('[data-testid="edit-stepper-dec"]').click();
    await bbbSets.last().locator('[data-testid="edit-stepper-dec"]').click();
    await bbbSets.last().locator('[data-testid="save-edit-btn"]').click();

    // A bonus BBB set should now be inserted as the current set.
    await expect(page.locator('.set-item')).toHaveCount(15);
    const current = page.locator('.set-item.current');
    await expect(current.locator('.set-exercise')).toContainText('squat');
    await expect(current.locator('.set-prescription')).toContainText('bonus');
  });
});
