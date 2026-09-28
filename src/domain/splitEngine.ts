/**
 * Pure expense-split calculation engine (docs/PLAN.md #4, Stage 2 task
 * description part C). Every split mode ultimately distributes a whole
 * integer amount across people so the shares always sum EXACTLY to the
 * amount: divide, floor, then hand out the leftover units one at a time
 * to the people with the largest fractional remainder (largest-remainder
 * method), breaking ties by original order for determinism.
 */

export interface PersonWeight {
  personId: string;
  weight: number;
}

export interface PersonAmount {
  personId: string;
  amount: number;
}

export interface PersonShare {
  personId: string;
  share: number;
}

/** Splits `amount` equally among `personIds` (equal-among-all / equal-among-selected). */
export function splitEqual(amount: number, personIds: string[]): PersonShare[] {
  return splitByWeight(
    amount,
    personIds.map((personId) => ({ personId, weight: 1 }))
  );
}

/**
 * Splits `amount` proportionally to each person's weight.
 * share_i = amount * w_i / sum(w), remainder distributed deterministically.
 * Also used for percent splits (weights = percentages, which must sum to 100).
 */
export function splitByWeight(amount: number, weights: PersonWeight[]): PersonShare[] {
  if (weights.length === 0) return [];

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) {
    throw new Error("مجموع ضرایب باید بزرگ‌تر از صفر باشد");
  }
  if (weights.some((w) => w.weight < 0)) {
    throw new Error("ضریب نمی‌تواند منفی باشد");
  }

  const floored = weights.map((w) => {
    const exact = (amount * w.weight) / totalWeight;
    const floor = Math.floor(exact);
    return { personId: w.personId, floor, remainder: exact - floor };
  });

  const flooredSum = floored.reduce((sum, f) => sum + f.floor, 0);
  let remaining = amount - flooredSum;

  const byRemainderDesc = floored
    .map((f, index) => ({ ...f, index }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const shareByPersonId = new Map(floored.map((f) => [f.personId, f.floor]));
  for (let i = 0; i < byRemainderDesc.length && remaining > 0; i++, remaining--) {
    const entry = byRemainderDesc[i];
    shareByPersonId.set(entry.personId, (shareByPersonId.get(entry.personId) ?? 0) + 1);
  }

  return weights.map((w) => ({ personId: w.personId, share: shareByPersonId.get(w.personId) ?? 0 }));
}

/** Builds shares directly from exact per-person amounts (the "exact amount" split mode). */
export function sharesFromExactAmounts(amounts: PersonAmount[]): PersonShare[] {
  return amounts.map((a) => ({ personId: a.personId, share: a.amount }));
}

/** True when a list of values sums exactly to `total` (used for payers, percent, and exact-amount validation). */
export function amountsSumTo(total: number, values: number[]): boolean {
  return values.reduce((sum, value) => sum + value, 0) === total;
}

/** True when a list of percentages sums exactly to 100 (percent split mode requirement). */
export function percentsSumTo100(percents: number[]): boolean {
  return amountsSumTo(100, percents);
}
