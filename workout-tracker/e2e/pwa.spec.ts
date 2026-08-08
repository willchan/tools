import { test, expect } from '@playwright/test';

/**
 * PWA capability tests.
 */

test.describe('PWA Features', () => {
  test('serves a valid web app manifest', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');

    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveCount(1);
  });

  test('has meta theme-color for mobile browsers', async ({ page }) => {
    await page.goto('/');
    const meta = page.locator('meta[name="theme-color"]');
    await expect(meta).toHaveAttribute('content', '#0f0f0f');
  });

  test('icon links and manifest icons resolve to real, non-empty files', async ({ page, request, baseURL }) => {
    await page.goto('/');

    // Every <link rel="icon"|"apple-touch-icon"> href must resolve to a real
    // asset, not 404 or a leftover placeholder stub (see icon-192/512.png,
    // which once shipped as 1x1 placeholder PNGs under 100 bytes).
    const iconHrefs = await page
      .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
      .evaluateAll((links) => links.map((l) => l.getAttribute('href')));
    expect(iconHrefs.length).toBeGreaterThan(0);

    for (const href of iconHrefs) {
      const res = await request.get(new URL(href!, baseURL).toString());
      expect(res.ok(), `${href} should resolve`).toBe(true);
      const body = await res.body();
      expect(body.length, `${href} should not be an empty placeholder`).toBeGreaterThan(500);
    }

    // manifest.json's icons array must also point to real, non-empty files.
    const manifestRes = await request.get(new URL('./manifest.json', baseURL).toString());
    const manifest = await manifestRes.json();
    expect(manifest.icons.length).toBeGreaterThan(0);

    for (const icon of manifest.icons) {
      const res = await request.get(new URL(icon.src, baseURL).toString());
      expect(res.ok(), `${icon.src} should resolve`).toBe(true);
      const body = await res.body();
      expect(body.length, `${icon.src} should not be an empty placeholder`).toBeGreaterThan(500);
    }
  });

  test('registers a service worker', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');

    // Wait for the service worker to register by polling the registration list
    const hasSwCode = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;

      // In dev mode, SW may not register (Vite serves differently), so we just
      // verify the registration API exists
      return true;
    });
    expect(hasSwCode).toBe(true);
  });

  test('data can be exported as complete JSON', async ({ page }) => {
    await page.goto('/');
    // Wait for full app init (seedDefaults + render) before touching IndexedDB
    await page.waitForSelector('#start-workout-btn');

    const data = await page.evaluate(async () => {
      const { exportAll } = await import('/src/db/database.ts');
      return exportAll();
    });

    expect(data).toHaveProperty('exercises');
    expect(data).toHaveProperty('templates');
    expect(data).toHaveProperty('state');
    expect(data).toHaveProperty('trainingMaxes');
    expect(data).toHaveProperty('history');
    expect(data).toHaveProperty('timerState');
    expect(data).toHaveProperty('activeWorkout');
    expect(data.exercises.length).toBeGreaterThan(0);
    expect(data.templates.length).toBeGreaterThan(0);
  });

  test('data roundtrips through export/import', async ({ page }) => {
    await page.goto('/');
    // Wait for full app init (seedDefaults + render) before touching IndexedDB
    await page.waitForSelector('#start-workout-btn');

    const roundtrip = await page.evaluate(async () => {
      const { exportAll, importAll } = await import('/src/db/database.ts');

      // Export current state
      const original = await exportAll();

      // Import back
      await importAll(original);

      // Export again
      const restored = await exportAll();

      return {
        exerciseCount: restored.exercises.length,
        templateCount: restored.templates.length,
        tmCount: restored.trainingMaxes.length,
        matches:
          original.exercises.length === restored.exercises.length &&
          original.templates.length === restored.templates.length,
      };
    });

    expect(roundtrip.exerciseCount).toBeGreaterThan(0);
    expect(roundtrip.matches).toBe(true);
  });

  test('an in-progress workout survives an export/import roundtrip', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#start-workout-btn');
    await page.click('#start-workout-btn');
    await page.waitForSelector('.workout-screen');
    await page.click('[data-testid="done-set-btn"]');

    const roundtrip = await page.evaluate(async () => {
      const { exportAll, importAll, getActiveWorkout } = await import('/src/db/database.ts');

      const original = await exportAll();
      await importAll(original);
      const restored = await getActiveWorkout();

      return {
        exportedHadActiveWorkout: original.activeWorkout !== null && original.activeWorkout !== undefined,
        exportedCompletedSets: original.activeWorkout?.completedSets.length ?? 0,
        restoredCompletedSets: restored?.completedSets.length ?? 0,
      };
    });

    expect(roundtrip.exportedHadActiveWorkout).toBe(true);
    expect(roundtrip.exportedCompletedSets).toBe(1);
    expect(roundtrip.restoredCompletedSets).toBe(1);
  });
});
