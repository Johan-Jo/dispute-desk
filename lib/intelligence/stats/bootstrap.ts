/**
 * Percentile bootstrap for monetary quantities (design §7): monetary recovery
 * rate, average recovery per response, avoided-loss ranges. Used INSTEAD of
 * Wilson for continuous/ratio figures.
 *
 * Determinism: a seeded PRNG (mulberry32) so identical inputs + seed always
 * yield identical intervals (reproducibility, design §19). Money values are
 * passed as minor-unit numbers here for resampling; callers keep exact bigint
 * sums separately and use the bootstrap only for the interval bounds.
 */

export interface BootstrapResult {
  point: number;
  lower: number;
  upper: number;
  iterations: number;
  seed: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap an arbitrary statistic over a sample. `statistic` receives a
 * resampled array and returns a scalar. Default = mean.
 */
export function bootstrapInterval(
  sample: number[],
  opts: {
    iterations?: number;
    seed?: number;
    alpha?: number; // two-sided; 0.05 → 95%
    statistic?: (resample: number[]) => number;
  } = {},
): BootstrapResult {
  const iterations = opts.iterations ?? 2000;
  const seed = opts.seed ?? 12345;
  const alpha = opts.alpha ?? 0.05;
  const stat = opts.statistic ?? mean;

  if (sample.length === 0) {
    return { point: 0, lower: 0, upper: 0, iterations, seed };
  }
  const rand = mulberry32(seed);
  const n = sample.length;
  const stats: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const resample: number[] = new Array(n);
    for (let j = 0; j < n; j++) {
      resample[j] = sample[Math.floor(rand() * n)];
    }
    stats[i] = stat(resample);
  }
  stats.sort((a, b) => a - b);
  const lowerIdx = Math.floor((alpha / 2) * iterations);
  const upperIdx = Math.min(iterations - 1, Math.ceil((1 - alpha / 2) * iterations) - 1);
  return {
    point: stat(sample),
    lower: stats[lowerIdx],
    upper: stats[upperIdx],
    iterations,
    seed,
  };
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Ratio-of-sums statistic factory (e.g. Σrecovered / Σdisputed), paired input. */
export function ratioOfSums(pairs: Array<[number, number]>): number {
  let num = 0;
  let den = 0;
  for (const [a, b] of pairs) {
    num += a;
    den += b;
  }
  return den === 0 ? 0 : num / den;
}
