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

  test('header reserves the top safe area so content clears the notch/Dynamic Island', async ({ page, browserName }) => {
    // Regression test: #app renders edge-to-edge in the native shell
    // (viewport-fit=cover), so .app-header — the flex item pinned at the
    // top — must claim env(safe-area-inset-top) itself or its content
    // (title, back/abandon buttons) renders under the notch.
    //
    // Real safe-area-inset values are only non-zero on an actual notched
    // device, so we use the CDP Emulation.setSafeAreaInsetsOverride API
    // (added to Chromium for exactly this kind of PWA testing) to make
    // env(safe-area-inset-top) resolve to a real, non-zero value here, then
    // assert on the *computed* (cascade-resolved) style. Asserting on
    // getComputedStyle rather than walking document.styleSheets for a
    // matching selector matters: the latter can find and return an
    // earlier/unrelated rule that isn't the one actually winning the
    // cascade, silently passing even if a later override broke the fix.
    //
    // CDP is Chromium-only — this file also runs on iphone-webkit (see
    // playwright.config.ts's crossProjectSpecs), where newCDPSession isn't
    // available, so skip there. chromium and mobile-chrome (which is
    // Chromium under a Pixel 5 UA/viewport, not a different engine) both
    // cover this.
    test.skip(browserName === 'webkit', 'CDP safe-area-insets override is Chromium-only');

    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 59, topMax: 59, bottom: 0, bottomMax: 0, left: 0, leftMax: 0, right: 0, rightMax: 0 },
    });

    const paddingTop = await page.locator('.app-header').evaluate((el) => getComputedStyle(el).paddingTop);
    expect(paddingTop).toBe('75px'); // base 16px + the 59px mocked inset
  });

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
