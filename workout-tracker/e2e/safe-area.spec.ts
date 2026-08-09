import { test, expect } from '@playwright/test';
import { withSafeArea } from './helpers/safe-area';

/**
 * TDD: geometric coverage for env(safe-area-inset-*) handling.
 *
 * The bug this guards against: #app renders edge-to-edge in the native
 * shell (viewport-fit=cover), so anything pinned to the true top/bottom of
 * the viewport — the header, the rest-timer overlay, the bottom nav — must
 * claim the safe-area inset itself or its content renders under the
 * notch/Dynamic Island (top) or the home indicator (bottom). When the
 * header failed to claim the inset, the *-screen section below it (flex: 1)
 * didn't shrink either, so the unclaimed space silently reappeared as an
 * unexplained gap above the bottom nav instead.
 *
 * Playwright's Chromium/WebKit builds never resolve env(safe-area-inset-*)
 * to a non-zero value (only a real device or matching iOS Simulator model
 * does), so these tests mock the *input* our CSS consumes — see
 * withSafeArea in helpers/safe-area.ts — rather than relying on the browser
 * to report real geometry. That lets us assert the actual pixel layout
 * (boundingBox), not just that a CSS rule mentions safe-area-inset-top.
 */

const DYNAMIC_ISLAND_TOP_INSET = 59;
const HOME_INDICATOR_BOTTOM_INSET = 34;
const TOLERANCE_PX = 1;

function closeTo(actual: number, expected: number, tolerance = TOLERANCE_PX) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

test.describe('Home screen safe area', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await expect(page.locator('[data-testid="next-workout-card"]')).toBeVisible();
  });

  test('header title clears a mocked Dynamic-Island-sized top inset', async ({ page }) => {
    await withSafeArea(page, { top: DYNAMIC_ISLAND_TOP_INSET, bottom: HOME_INDICATOR_BOTTOM_INSET });

    const title = page.locator('.app-header h1');
    const box = await title.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(DYNAMIC_ISLAND_TOP_INSET);
  });

  test('bottom nav button row stays above a mocked home-indicator-sized bottom inset', async ({ page }) => {
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    await withSafeArea(page, { top: DYNAMIC_ISLAND_TOP_INSET, bottom: HOME_INDICATOR_BOTTOM_INSET });

    const navBtn = page.locator('.nav-btn').first();
    const box = await navBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height - HOME_INDICATOR_BOTTOM_INSET + TOLERANCE_PX);
  });

  test('mocking a top inset shrinks the home-screen by the same amount — no unexplained gap', async ({ page }) => {
    const headerBefore = await page.locator('.app-header').boundingBox();
    const mainBefore = await page.locator('.home-screen').boundingBox();
    const appBefore = await page.locator('#app').boundingBox();
    expect(headerBefore).not.toBeNull();
    expect(mainBefore).not.toBeNull();
    expect(appBefore).not.toBeNull();

    await withSafeArea(page, { top: DYNAMIC_ISLAND_TOP_INSET, bottom: 0 });

    const headerAfter = await page.locator('.app-header').boundingBox();
    const mainAfter = await page.locator('.home-screen').boundingBox();
    const appAfter = await page.locator('#app').boundingBox();
    expect(headerAfter).not.toBeNull();
    expect(mainAfter).not.toBeNull();
    expect(appAfter).not.toBeNull();

    // The header grows to claim the inset...
    closeTo(headerAfter!.height - headerBefore!.height, DYNAMIC_ISLAND_TOP_INSET);
    // ...and the home-screen (flex: 1) shrinks by exactly that amount, so
    // the reserved space is claimed by the header rather than showing up
    // as slack/gap somewhere else in the layout.
    closeTo(mainBefore!.height - mainAfter!.height, DYNAMIC_ISLAND_TOP_INSET);
    // #app's total height is unaffected — the inset is redistributed
    // between header/home-screen, not added on top of the viewport height.
    closeTo(appAfter!.height, appBefore!.height);
  });

  test('page has no vertical scroll overflow with a mocked top+bottom inset', async ({ page }) => {
    // Extends the existing "no vertical scroll overflow" regression test:
    // a large mocked inset must not push #app's content past the viewport.
    await withSafeArea(page, { top: DYNAMIC_ISLAND_TOP_INSET, bottom: HOME_INDICATOR_BOTTOM_INSET });

    const { scrollHeight, clientHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  });

  test('visual snapshot of home screen with a mocked safe area', async ({ page }) => {
    await expect(page.locator('[data-testid="tm-grid"]')).toBeVisible();
    await withSafeArea(page, { top: DYNAMIC_ISLAND_TOP_INSET, bottom: HOME_INDICATOR_BOTTOM_INSET });

    await expect(page).toHaveScreenshot('home-screen-safe-area.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});

test.describe('Workout screen safe area (rest timer)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
  });

  test('rest-timer overlay content clears a mocked top inset when active', async ({ page }) => {
    await withSafeArea(page, { top: DYNAMIC_ISLAND_TOP_INSET, bottom: HOME_INDICATOR_BOTTOM_INSET });

    await page.click('[data-testid="done-set-btn"]');
    const timer = page.locator('#rest-timer');
    await expect(timer).toBeVisible();

    const label = page.locator('.timer-label');
    const labelBox = await label.boundingBox();
    expect(labelBox).not.toBeNull();
    expect(labelBox!.y).toBeGreaterThanOrEqual(DYNAMIC_ISLAND_TOP_INSET);

    const value = page.locator('#timer-value');
    const valueBox = await value.boundingBox();
    expect(valueBox).not.toBeNull();
    expect(valueBox!.y).toBeGreaterThanOrEqual(DYNAMIC_ISLAND_TOP_INSET);
  });

  test('visual snapshot of rest-timer overlay with a mocked safe area', async ({ page }) => {
    await withSafeArea(page, { top: DYNAMIC_ISLAND_TOP_INSET, bottom: HOME_INDICATOR_BOTTOM_INSET });

    await page.click('[data-testid="done-set-btn"]');
    await expect(page.locator('#rest-timer')).toBeVisible();

    await expect(page).toHaveScreenshot('rest-timer-safe-area.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
