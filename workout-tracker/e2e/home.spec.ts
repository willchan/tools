import { test, expect } from '@playwright/test';

/**
 * TDD Loop 2: Home screen E2E tests.
 */

test.describe('Home Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('displays the app title', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Workout Tracker');
  });

  test('shows the next workout card with template info', async ({ page }) => {
    const card = page.locator('[data-testid="next-workout-card"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.template-name')).toContainText('5/3/1');
    await expect(card.locator('.cycle-info')).toContainText('Cycle 1');
    await expect(card.locator('.day-name')).toContainText('Squat Day');
  });

  test('shows the Start Next Workout button', async ({ page }) => {
    const btn = page.locator('#start-workout-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('Start Next Workout');
  });

  test('displays training maxes', async ({ page }) => {
    const grid = page.locator('[data-testid="tm-grid"]');
    await expect(grid).toBeVisible();
    // Default TMs: squat 225, bench 185, deadlift 275, ohp 115
    await expect(grid.locator('.tm-item')).toHaveCount(4);
  });

  test('navigates to workout screen when Start button is clicked', async ({ page }) => {
    await page.click('#start-workout-btn');
    await expect(page.locator('h1')).toHaveText('Squat Day');
  });

  test('has bottom navigation with 4 tabs', async ({ page }) => {
    const nav = page.locator('.bottom-nav');
    await expect(nav).toBeVisible();
    await expect(nav.locator('.nav-btn')).toHaveCount(4);
  });

  test('navigates to templates via bottom nav', async ({ page }) => {
    await page.click('.nav-btn[data-route="templates"]');
    await expect(page.locator('h1')).toHaveText('Templates');
  });

  test('navigates to history via bottom nav', async ({ page }) => {
    await page.click('.nav-btn[data-route="history"]');
    await expect(page.locator('h1')).toHaveText('History');
  });

  test('navigates to settings via bottom nav', async ({ page }) => {
    await page.click('.nav-btn[data-route="settings"]');
    await expect(page.locator('h1')).toHaveText('Settings');
  });

  // Geometric coverage for the header/rest-timer/bottom-nav safe-area
  // handling (header title clears a mocked notch inset, no unexplained gap
  // appears above the bottom nav, visual snapshot with a mocked inset,
  // etc.) lives in safe-area.spec.ts — see withSafeArea in
  // e2e/helpers/safe-area.ts for why layout tests mock the CSS custom
  // property rather than relying on env(), which Playwright's
  // Chromium/WebKit builds never resolve to a non-zero value. It
  // supersedes an earlier version of this test that used Chromium's CDP
  // Emulation.setSafeAreaInsetsOverride to check computed style: the
  // withSafeArea approach covers the same ground plus rest-timer/bottom-nav/
  // layout-invariant/visual-snapshot coverage, and runs on all 3 Playwright
  // projects rather than being skipped on webkit.

  test('page has no vertical scroll overflow on load', async ({ page }) => {
    // Regression test: the app shell used to size #app with min-height: 100dvh
    // while html/body allowed native document scrolling, so on some viewports
    // the document was a few px taller than the visual viewport — no visible
    // scrollbar, but the page was vertically offset/scrollable by that slop.
    await expect(page.locator('[data-testid="next-workout-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="tm-grid"]')).toBeVisible();
    const { scrollHeight, clientHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  });

  test('visual snapshot of home screen', async ({ page }) => {
    // Wait for data-driven content to render
    await expect(page.locator('[data-testid="next-workout-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="tm-grid"]')).toBeVisible();
    await expect(page).toHaveScreenshot('home-screen.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
