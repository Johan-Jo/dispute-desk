/**
 * Minimal L2-regularized logistic regression (design §14.1 — the explainable
 * baseline). Batch gradient descent; deterministic (no RNG). Weights[0] is the
 * bias. Kept small and pure so it is unit-testable and reproducible.
 */

export interface LogisticModel {
  weights: number[]; // [bias, w1, w2, ...]
  iterations: number;
  l2: number;
}

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

export function predictProba(model: LogisticModel, x: number[]): number {
  let z = model.weights[0];
  for (let i = 0; i < x.length; i++) z += model.weights[i + 1] * x[i];
  return sigmoid(z);
}

export function fitLogistic(
  X: number[][],
  y: number[],
  opts: { l2?: number; iterations?: number; lr?: number } = {},
): LogisticModel {
  const l2 = opts.l2 ?? 1.0;
  const iterations = opts.iterations ?? 500;
  const lr = opts.lr ?? 0.1;
  const n = X.length;
  const d = n > 0 ? X[0].length : 0;
  const weights = new Array(d + 1).fill(0);

  if (n === 0) return { weights, iterations, l2 };

  for (let it = 0; it < iterations; it++) {
    const grad = new Array(d + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const p = predictProba({ weights, iterations, l2 }, X[i]);
      const err = p - y[i];
      grad[0] += err;
      for (let j = 0; j < d; j++) grad[j + 1] += err * X[i][j];
    }
    // L2 on non-bias weights.
    weights[0] -= lr * (grad[0] / n);
    for (let j = 1; j <= d; j++) {
      weights[j] -= lr * (grad[j] / n + (l2 * weights[j]) / n);
    }
  }
  return { weights, iterations, l2 };
}

/** Brier score = mean squared error of probabilistic predictions. */
export function brierScore(probs: number[], y: number[]): number {
  if (probs.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < probs.length; i++) s += (probs[i] - y[i]) ** 2;
  return s / probs.length;
}
