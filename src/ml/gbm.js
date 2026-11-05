// Gradient Boosting mit Entscheidungsbäumen (Newton-Boosting, Histogramm-Splits).
// Ohne Abhängigkeiten, deterministisch (kein Zufall) → reproduzierbare Modelle.
//   loss 'logloss': binäre Klassifikation, Ausgabe = Wahrscheinlichkeit
//   loss 'l2':      Regression, Ausgabe = Zahl

export const gbmDefaults = { trees: 150, depth: 2, learningRate: 0.05, minLeaf: 30, lambda: 5, bins: 32, loss: 'logloss' };

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** Schwellenwerte je Merkmal aus Quantilen der Trainingsdaten */
function makeBins(X, nBins) {
  const d = X[0].length;
  const edges = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]).sort((a, b) => a - b);
    const e = [];
    for (let b = 1; b < nBins; b++) {
      const v = col[Math.floor((b * col.length) / nBins)];
      if (e.length === 0 || v > e[e.length - 1]) e.push(v);
    }
    edges.push(e);
  }
  return edges;
}

function binIndex(edges, v) {
  // Anzahl Schwellen < v ... binäre Suche: Bin k bedeutet edges[k-1] < v <= edges[k]
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v > edges[mid]) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildTree(B, idx, grad, hess, depth, P, nBinsPer) {
  let G = 0;
  let H = 0;
  for (const i of idx) { G += grad[i]; H += hess[i]; }
  const leaf = { value: -G / (H + P.lambda) };
  if (depth === 0 || idx.length < 2 * P.minLeaf) return leaf;

  const parentScore = (G * G) / (H + P.lambda);
  let best = null;
  const d = B[0].length;
  for (let j = 0; j < d; j++) {
    const nb = nBinsPer[j] + 1;
    if (nb < 2) continue;
    const gs = new Float64Array(nb);
    const hs = new Float64Array(nb);
    const cs = new Int32Array(nb);
    for (const i of idx) {
      const b = B[i][j];
      gs[b] += grad[i]; hs[b] += hess[i]; cs[b]++;
    }
    let gl = 0;
    let hl = 0;
    let cl = 0;
    for (let b = 0; b < nb - 1; b++) {
      gl += gs[b]; hl += hs[b]; cl += cs[b];
      const cr = idx.length - cl;
      if (cl < P.minLeaf || cr < P.minLeaf) continue;
      const gr = G - gl;
      const hr = H - hl;
      const gain = (gl * gl) / (hl + P.lambda) + (gr * gr) / (hr + P.lambda) - parentScore;
      if (gain > 1e-9 && (!best || gain > best.gain)) best = { gain, feature: j, bin: b };
    }
  }
  if (!best) return leaf;
  const left = [];
  const right = [];
  for (const i of idx) (B[i][best.feature] <= best.bin ? left : right).push(i);
  return {
    feature: best.feature,
    bin: best.bin,
    gain: best.gain,
    left: buildTree(B, left, grad, hess, depth - 1, P, nBinsPer),
    right: buildTree(B, right, grad, hess, depth - 1, P, nBinsPer),
  };
}

function evalTree(t, b) {
  while (t.left) t = b[t.feature] <= t.bin ? t.left : t.right;
  return t.value;
}

export function trainGbm(X, y, params = {}) {
  const P = { ...gbmDefaults, ...params };
  if (!X.length) throw new Error('keine Trainingsdaten');
  const edges = makeBins(X, P.bins);
  const nBinsPer = edges.map((e) => e.length);
  const B = X.map((r) => r.map((v, j) => binIndex(edges[j], v)));
  const n = X.length;
  const mean = y.reduce((a, b) => a + b, 0) / n;
  const base = P.loss === 'logloss' ? Math.log(Math.min(0.99, Math.max(0.01, mean)) / (1 - Math.min(0.99, Math.max(0.01, mean)))) : mean;
  const F = new Float64Array(n).fill(base);
  const grad = new Float64Array(n);
  const hess = new Float64Array(n);
  const all = Array.from({ length: n }, (_, i) => i);
  const trees = [];
  const importance = new Float64Array(X[0].length);
  for (let t = 0; t < P.trees; t++) {
    for (let i = 0; i < n; i++) {
      if (P.loss === 'logloss') {
        const p = sigmoid(F[i]);
        grad[i] = p - y[i];
        hess[i] = Math.max(p * (1 - p), 1e-6);
      } else {
        grad[i] = F[i] - y[i];
        hess[i] = 1;
      }
    }
    const tree = buildTree(B, all, grad, hess, P.depth, P, nBinsPer);
    collectImportance(tree, importance);
    trees.push(tree);
    for (let i = 0; i < n; i++) F[i] += P.learningRate * evalTree(tree, B[i]);
  }
  return { kind: 'gbm', params: P, edges, base, trees, importance: [...importance] };
}

function collectImportance(t, imp) {
  if (!t.left) return;
  imp[t.feature] += t.gain;
  collectImportance(t.left, imp);
  collectImportance(t.right, imp);
}

export function predictGbm(model, x) {
  const b = x.map((v, j) => binIndex(model.edges[j], v));
  let f = model.base;
  for (const t of model.trees) f += model.params.learningRate * evalTree(t, b);
  return model.params.loss === 'logloss' ? sigmoid(f) : f;
}
