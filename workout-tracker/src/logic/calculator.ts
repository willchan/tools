/**
 * 5/3/1 weight calculation and plate calculator logic.
 */

const BAR_WEIGHT = 45; // lbs
const AVAILABLE_PLATES = [45, 35, 25, 10, 5, 2.5]; // lbs per side

/**
 * Calculate the working weight for a set given a Training Max and percentage.
 * Rounds to nearest 5 lbs.
 */
export function calculateWorkingWeight(trainingMax: number, percentage: number): number {
  const raw = trainingMax * percentage;
  return Math.round(raw / 5) * 5;
}

/**
 * Break down a total barbell weight into plates per side.
 * Assumes a standard 45 lb bar.
 * Returns an array of plate weights for ONE side.
 */
export function calculatePlates(
  totalWeight: number,
  barWeight: number = BAR_WEIGHT
): { plates: number[]; remainder: number } {
  if (totalWeight <= barWeight) {
    return { plates: [], remainder: 0 };
  }

  let perSide = (totalWeight - barWeight) / 2;
  const plates: number[] = [];

  for (const plate of AVAILABLE_PLATES) {
    while (perSide >= plate) {
      plates.push(plate);
      perSide -= plate;
    }
  }

  // remainder is anything left that can't be represented with standard plates
  return { plates, remainder: Math.round(perSide * 100) / 100 };
}

/**
 * Format plates as a human-readable string.
 * e.g., "45 + 25 + 10" per side
 */
export function formatPlates(plates: number[]): string {
  if (plates.length === 0) return 'Bar only';
  return plates.join(' + ');
}

/**
 * Calculate all working sets for a given day, incorporating training maxes.
 */
export function calculateDayWeights(
  sets: Array<{ tmPercentage: number | null; tmLiftId: string | null }>,
  trainingMaxes: Map<string, number>
): number[] {
  return sets.map((set) => {
    if (set.tmPercentage === null || set.tmLiftId === null) {
      return 0; // Accessory — weight entered manually
    }
    const tm = trainingMaxes.get(set.tmLiftId);
    if (tm === undefined) return 0;
    return calculateWorkingWeight(tm, set.tmPercentage);
  });
}

/**
 * Calculate TM increase after a cycle.
 * Standard 5/3/1: +5 lbs for upper body, +10 lbs for lower body.
 */
export function getTMIncrement(exerciseId: string): number {
  const lowerBody = ['squat', 'deadlift', 'front-squat'];
  return lowerBody.includes(exerciseId) ? 10 : 5;
}
