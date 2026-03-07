import { test, expect } from '@playwright/test';

/**
 * TDD Loop 1: State progression tests.
 * Tests advancing through days, weeks, and cycles.
 */

test.describe('Progression State Machine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('advances to next day within same week', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { advanceState } = await import('/src/logic/progression.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const template = getDefault531Template();

      return advanceState(
        { templateId: '531-bbb', cycle: 1, weekIndex: 0, dayIndex: 0 },
        template
      );
    });

    expect(result.newState.dayIndex).toBe(1);
    expect(result.newState.weekIndex).toBe(0);
    expect(result.newState.cycle).toBe(1);
    expect(result.tmBumps).toBeNull();
  });

  test('advances to next week after last day', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { advanceState } = await import('/src/logic/progression.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const template = getDefault531Template();

      // Day index 3 is the last day (0-indexed, 4 days total)
      return advanceState(
        { templateId: '531-bbb', cycle: 1, weekIndex: 0, dayIndex: 3 },
        template
      );
    });

    expect(result.newState.dayIndex).toBe(0);
    expect(result.newState.weekIndex).toBe(1);
    expect(result.newState.cycle).toBe(1);
    expect(result.tmBumps).toBeNull();
  });

  test('starts new cycle after last week and returns TM bumps', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { advanceState } = await import('/src/logic/progression.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const template = getDefault531Template();

      // Week 2 (index), Day 3 (last day of last week)
      return advanceState(
        { templateId: '531-bbb', cycle: 1, weekIndex: 2, dayIndex: 3 },
        template
      );
    });

    expect(result.newState.dayIndex).toBe(0);
    expect(result.newState.weekIndex).toBe(0);
    expect(result.newState.cycle).toBe(2);

    // Should have TM bumps for all 4 main lifts
    expect(result.tmBumps).not.toBeNull();
    expect(result.tmBumps!.length).toBe(4);

    // Verify correct increments
    const squatBump = result.tmBumps!.find((b: any) => b.exerciseId === 'squat');
    const benchBump = result.tmBumps!.find((b: any) => b.exerciseId === 'bench');
    expect(squatBump!.increment).toBe(10); // Lower body
    expect(benchBump!.increment).toBe(5);  // Upper body
  });

  test('progresses through an entire 3-week cycle correctly', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { advanceState } = await import('/src/logic/progression.ts');
      const { getDefault531Template } = await import('/src/db/defaults.ts');
      const template = getDefault531Template();

      let state = { templateId: '531-bbb', cycle: 1, weekIndex: 0, dayIndex: 0 };
      let tmBumpsReceived = false;
      let totalAdvances = 0;

      // 3 weeks × 4 days = 12 workouts per cycle
      for (let i = 0; i < 12; i++) {
        const res = advanceState(state, template);
        state = res.newState;
        totalAdvances++;
        if (res.tmBumps) tmBumpsReceived = true;
      }

      return { state, tmBumpsReceived, totalAdvances };
    });

    expect(result.totalAdvances).toBe(12);
    expect(result.tmBumpsReceived).toBe(true);
    expect(result.state.cycle).toBe(2);
    expect(result.state.weekIndex).toBe(0);
    expect(result.state.dayIndex).toBe(0);
  });
});
