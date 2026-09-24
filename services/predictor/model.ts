/**
 * L2-regularised logistic regression for P(close up after horizon),
 * plus volatility-scaled empirical quantiles for the price range.
 */

export interface LogisticModel {
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
}

export interface FitOptions {
  l2?: number;
  iterations?: number;
  learningRate?: number;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
}

export function fitLogistic(X: number[][], y: number[], options: FitOptions = {}): LogisticModel {
  const { l2 = 1e-2, iterations = 400, learningRate = 0.05 } = options;
  const n = X.length;
  const d = X[0]?.length ?? 0;
  if (n === 0 || d === 0) throw new Error("fitLogistic: empty dataset");

  const mean = new Array<number>(d).fill(0);
  const std = new Array<number>(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  for (const row of X) for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  const Z = X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]));

  // Full-batch Adam — deterministic, so the same data always gives the same model.
  const w = new Array<number>(d).fill(0);
  let b = Math.log((y.reduce((s, v) => s + v, 0) + 1) / (n - y.reduce((s, v) => s + v, 0) + 1));
  const m = new Array<number>(d + 1).fill(0);
  const v = new Array<number>(d + 1).fill(0);
  const beta1 = 0.9;
  const beta2 = 0.999;

  for (let t = 1; t <= iterations; t++) {
    const grad = new Array<number>(d + 1).fill(0);
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const err = sigmoid(z) - y[i];
      for (let j = 0; j < d; j++) grad[j] += (err * Z[i][j]) / n;
      grad[d] += err / n;
    }
    for (let j = 0; j < d; j++) grad[j] += l2 * w[j];

    for (let j = 0; j <= d; j++) {
      m[j] = beta1 * m[j] + (1 - beta1) * grad[j];
      v[j] = beta2 * v[j] + (1 - beta2) * grad[j] * grad[j];
      const step = (learningRate * (m[j] / (1 - beta1 ** t))) / (Math.sqrt(v[j] / (1 - beta2 ** t)) + 1e-8);
      if (j < d) w[j] -= step;
      else b -= step;
    }
  }

  return { mean, std, weights: w, bias: b };
}

export function predictProbability(model: LogisticModel, x: number[]): number {
  let z = model.bias;
  for (let j = 0; j < model.weights.length; j++) {
    z += model.weights[j] * ((x[j] - model.mean[j]) / model.std[j]);
  }
  return sigmoid(z);
}

/** Per-feature push on the logit for one input, largest first. */
export function featureContributions(
  model: LogisticModel,
  x: number[],
  names: readonly string[]
): Array<{ feature: string; contribution: number }> {
  return model.weights
    .map((w, j) => ({ feature: names[j], contribution: w * ((x[j] - model.mean[j]) / model.std[j]) }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Forward moves in volatility units (log move / (vol * sqrt(horizon))).
 * close: end-of-horizon close; high/low: extreme reached during the horizon.
 */
export interface MoveQuantiles {
  close: { q10: number; q25: number; q50: number; q75: number; q90: number };
  high: { q50: number; q90: number };
  low: { q10: number; q50: number };
}

export function computeMoveQuantiles(z: number[], zHigh: number[], zLow: number[]): MoveQuantiles {
  const s = [...z].sort((a, b) => a - b);
  const sh = [...zHigh].sort((a, b) => a - b);
  const sl = [...zLow].sort((a, b) => a - b);
  return {
    close: {
      q10: quantile(s, 0.1),
      q25: quantile(s, 0.25),
      q50: quantile(s, 0.5),
      q75: quantile(s, 0.75),
      q90: quantile(s, 0.9),
    },
    high: { q50: quantile(sh, 0.5), q90: quantile(sh, 0.9) },
    low: { q10: quantile(sl, 0.1), q50: quantile(sl, 0.5) },
  };
}

/** Least-squares fit of z ≈ intercept + slope * (p - 0.5): how the expected move scales with P(up). */
export function fitExpectedMove(p: number[], z: number[]): { intercept: number; slope: number } {
  const n = p.length;
  if (n < 2) return { intercept: 0, slope: 0 };
  const xs = p.map((v) => v - 0.5);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const mz = z.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (z[i] - mz);
    varX += (xs[i] - mx) ** 2;
  }
  const slope = varX > 0 ? cov / varX : 0;
  return { intercept: mz - slope * mx, slope };
}
