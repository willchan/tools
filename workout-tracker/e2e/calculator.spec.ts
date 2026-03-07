import { test, expect } from '@playwright/test';

/**
 * TDD Loop 1: Core logic tests for 5/3/1 math and plate calculator.
 * These test the logic by evaluating functions in the browser context.
 */

test.describe('5/3/1 Weight Calculator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('calculates working weight from TM and percentage', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { calculateWorkingWeight } = await import('/src/logic/calculator.ts');
      return {
        // 225 TM × 65% = 146.25 → rounds to 145
        w65: calculateWorkingWeight(225, 0.65),
        // 225 TM × 75% = 168.75 → rounds to 170
        w75: calculateWorkingWeight(225, 0.75),
        // 225 TM × 85% = 191.25 → rounds to 190
        w85: calculateWorkingWeight(225, 0.85),
        // 185 TM × 90% = 166.5 → rounds to 165
        bench90: calculateWorkingWeight(185, 0.90),
        // 275 TM × 95% = 261.25 → rounds to 260
        dl95: calculateWorkingWeight(275, 0.95),
      };
    });

    expect(result.w65).toBe(145);
    expect(result.w75).toBe(170);
    expect(result.w85).toBe(190);
    expect(result.bench90).toBe(165);
    expect(result.dl95).toBe(260);
  });

  test('rounds working weight to nearest 5 lbs', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { calculateWorkingWeight } = await import('/src/logic/calculator.ts');
      // 200 × 0.73 = 146 → rounds to 145
      return calculateWorkingWeight(200, 0.73);
    });
    expect(result).toBe(145);
  });
});

test.describe('Plate Calculator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('calculates correct plates for 225 lbs', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { calculatePlates } = await import('/src/logic/calculator.ts');
      return calculatePlates(225);
    });

    // 225 - 45 bar = 180, per side = 90 → two 45s
    expect(result.plates).toEqual([45, 45]);
    expect(result.remainder).toBe(0);
  });

  test('calculates correct plates for 185 lbs', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { calculatePlates } = await import('/src/logic/calculator.ts');
      return calculatePlates(185);
    });

    // 185 - 45 = 140, per side = 70 → 45 + 25
    expect(result.plates).toEqual([45, 25]);
    expect(result.remainder).toBe(0);
  });

  test('calculates correct plates for 135 lbs', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { calculatePlates } = await import('/src/logic/calculator.ts');
      return calculatePlates(135);
    });

    // 135 - 45 = 90, per side = 45 → one 45
    expect(result.plates).toEqual([45]);
    expect(result.remainder).toBe(0);
  });

  test('returns empty plates for bar weight only', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { calculatePlates } = await import('/src/logic/calculator.ts');
      return calculatePlates(45);
    });

    expect(result.plates).toEqual([]);
    expect(result.remainder).toBe(0);
  });

  test('handles complex plate combinations', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { calculatePlates } = await import('/src/logic/calculator.ts');
      // 260 - 45 = 215, per side = 107.5 → 45 + 45 + 10 + 5 + 2.5 (greedy)
      return calculatePlates(260);
    });

    expect(result.plates).toEqual([45, 45, 10, 5, 2.5]);
    expect(result.remainder).toBe(0);
  });

  test('formats plates as readable string', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { formatPlates } = await import('/src/logic/calculator.ts');
      return {
        multi: formatPlates([45, 25]),
        empty: formatPlates([]),
        single: formatPlates([45]),
      };
    });

    expect(result.multi).toBe('45 + 25');
    expect(result.empty).toBe('Bar only');
    expect(result.single).toBe('45');
  });
});

test.describe('TM Increment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
  });

  test('returns 10 for lower body lifts and 5 for upper', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { getTMIncrement } = await import('/src/logic/calculator.ts');
      return {
        squat: getTMIncrement('squat'),
        deadlift: getTMIncrement('deadlift'),
        bench: getTMIncrement('bench'),
        ohp: getTMIncrement('ohp'),
      };
    });

    expect(result.squat).toBe(10);
    expect(result.deadlift).toBe(10);
    expect(result.bench).toBe(5);
    expect(result.ohp).toBe(5);
  });
});
