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

/**
 * Histogram gradient-boosted trees for P(up), logloss objective.
 * Node: feature < 0 marks a leaf. `value` is the node's (learning-rate-scaled) logit contribution;
 * internal nodes keep theirs too so a prediction can be attributed to features along its path.
 */
export interface GbmNode {
  feature: number;
  threshold: number;
  left: number;
  right: number;
  value: number;
}

export interface GbmModel {
  base: number;
  trees: GbmNode[][];
}

export interface GbmOptions {
  trees?: number;
  depth?: number;
  learningRate?: number;
  minLeaf?: number;
  lambda?: number;
  bins?: number;
  subsample?: number;
  seed?: number;
}

function quantileCuts(values: number[], bins: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let b = 1; b < bins; b++) {
    const v = sorted[Math.floor((sorted.length * b) / bins)];
    if (!cuts.length || v > cuts[cuts.length - 1]) cuts.push(v);
  }
  return cuts;
}

/** Number of cuts strictly below v — so v <= cuts[b] exactly when bin <= b. */
function binOf(cuts: number[], v: number): number {
  let lo = 0;
  let hi = cuts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cuts[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function fitGbm(X: number[][], y: number[], options: GbmOptions = {}): GbmModel {
  const {
    trees = 150,
    depth = 3,
    learningRate = 0.05,
    lambda = 10,
    bins = 32,
    subsample = 0.5,
    seed = 42,
  } = options;
  const n = X.length;
  const d = X[0]?.length ?? 0;
  if (n === 0 || d === 0) throw new Error("fitGbm: empty dataset");
  const minLeaf = options.minLeaf ?? Math.max(200, Math.floor(n / 200));

  // Quantile bins from (at most) 50k evenly spaced rows.
  const stride = Math.max(1, Math.floor(n / 50_000));
  const cuts: number[][] = [];
  for (let f = 0; f < d; f++) {
    const sample: number[] = [];
    for (let i = 0; i < n; i += stride) sample.push(X[i][f]);
    cuts.push(quantileCuts(sample, bins));
  }
  const binned = new Uint8Array(n * d);
  for (let i = 0; i < n; i++) for (let f = 0; f < d; f++) binned[i * d + f] = binOf(cuts[f], X[i][f]);

  const positives = y.reduce((s, v) => s + v, 0);
  const base = Math.log((positives + 1) / (n - positives + 1));
  const F = new Float64Array(n).fill(base);
  const g = new Float64Array(n);
  const h = new Float64Array(n);
  let rngState = seed >>> 0;
  const rand = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 2 ** 32;
  };

  const model: GbmModel = { base, trees: [] };
  const histG = new Float64Array(bins);
  const histH = new Float64Array(bins);
  const histN = new Int32Array(bins);

  for (let t = 0; t < trees; t++) {
    for (let i = 0; i < n; i++) {
      const p = sigmoid(F[i]);
      g[i] = p - y[i];
      h[i] = Math.max(p * (1 - p), 1e-6);
    }
    const rows: number[] = [];
    for (let i = 0; i < n; i++) if (rand() < subsample) rows.push(i);

    const nodes: GbmNode[] = [];
    const nodeBin: number[] = [];
    const build = (idx: number[], level: number): number => {
      let G = 0;
      let H = 0;
      for (const i of idx) {
        G += g[i];
        H += h[i];
      }
      const id = nodes.length;
      nodes.push({ feature: -1, threshold: 0, left: -1, right: -1, value: (-G / (H + lambda)) * learningRate });
      nodeBin.push(-1);
      if (level >= depth || idx.length < 2 * minLeaf) return id;

      const parentScore = (G * G) / (H + lambda);
      let bestGain = 0;
      let bestF = -1;
      let bestBin = -1;
      for (let f = 0; f < d; f++) {
        histG.fill(0);
        histH.fill(0);
        histN.fill(0);
        for (const i of idx) {
          const b = binned[i * d + f];
          histG[b] += g[i];
          histH[b] += h[i];
          histN[b]++;
        }
        let gl = 0;
        let hl = 0;
        let nl = 0;
        for (let b = 0; b < cuts[f].length; b++) {
          gl += histG[b];
          hl += histH[b];
          nl += histN[b];
          const nr = idx.length - nl;
          if (nl < minLeaf) continue;
          if (nr < minLeaf) break;
          const gain = (gl * gl) / (hl + lambda) + ((G - gl) * (G - gl)) / (H - hl + lambda) - parentScore;
          if (gain > bestGain) {
            bestGain = gain;
            bestF = f;
            bestBin = b;
          }
        }
      }
      if (bestF < 0) return id;

      const leftIdx: number[] = [];
      const rightIdx: number[] = [];
      for (const i of idx) (binned[i * d + bestF] <= bestBin ? leftIdx : rightIdx).push(i);
      nodes[id].feature = bestF;
      nodes[id].threshold = cuts[bestF][bestBin];
      nodeBin[id] = bestBin;
      nodes[id].left = build(leftIdx, level + 1);
      nodes[id].right = build(rightIdx, level + 1);
      return id;
    };
    build(rows, 0);
    model.trees.push(nodes);

    for (let i = 0; i < n; i++) {
      let k = 0;
      while (nodes[k].feature >= 0) k = binned[i * d + nodes[k].feature] <= nodeBin[k] ? nodes[k].left : nodes[k].right;
      F[i] += nodes[k].value;
    }
  }
  return model;
}

function gbmLeaf(tree: GbmNode[], x: number[]): GbmNode {
  let node = tree[0];
  while (node.feature >= 0) node = tree[x[node.feature] <= node.threshold ? node.left : node.right];
  return node;
}

export function predictGbm(model: GbmModel, x: number[]): number {
  let z = model.base;
  for (const tree of model.trees) z += gbmLeaf(tree, x).value;
  return sigmoid(z);
}

/** Path attribution: each split credits its feature with the change in node value it caused. */
export function gbmContributions(
  model: GbmModel,
  x: number[],
  names: readonly string[]
): Array<{ feature: string; contribution: number }> {
  const totals = new Array<number>(names.length).fill(0);
  for (const tree of model.trees) {
    let node = tree[0];
    while (node.feature >= 0) {
      const next = tree[x[node.feature] <= node.threshold ? node.left : node.right];
      totals[node.feature] += next.value - node.value;
      node = next;
    }
  }
  return totals
    .map((contribution, j) => ({ feature: names[j], contribution }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}
