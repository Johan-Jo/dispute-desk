/**
 * Wilson score interval for a binomial proportion (design §7).
 *
 * Use ONLY for binary case rates (full-win rate, any-recovery rate, response
 * rate). NEVER for monetary recovery ratios — those use bootstrap.ts.
 */

export interface ProportionResult {
  numerator: number;
  denominator: number;
  point: number; // MLE proportion
  lower: number; // Wilson lower bound
  upper: number; // Wilson upper bound
  ciWidth: number;
  z: number;
}

/** z for a two-sided confidence level (default 95% → 1.959964). */
const Z95 = 1.959964;

export function wilsonInterval(
  numerator: number,
  denominator: number,
  z: number = Z95,
): ProportionResult {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new Error("[stats/wilson] numerator and denominator must be integers");
  }
  if (numerator < 0 || denominator < 0 || numerator > denominator) {
    throw new Error(`[stats/wilson] invalid counts ${numerator}/${denominator}`);
  }
  if (denominator === 0) {
    return { numerator, denominator, point: 0, lower: 0, upper: 0, ciWidth: 0, z };
  }
  const n = denominator;
  const phat = numerator / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  const lower = Math.max(0, center - margin);
  const upper = Math.min(1, center + margin);
  return { numerator, denominator, point: phat, lower, upper, ciWidth: upper - lower, z };
}
