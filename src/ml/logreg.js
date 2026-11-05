// L2-regularisierte logistische Regression (Newton/IRLS), standardisierte Merkmale.
// Einfache, robuste Vergleichsvariante zum Gradient Boosting.
import { solveLinear } from '../util/math.js';

export const logregDefaults = { lambda: 10, iterations: 25 };

export function trainLogreg(X, y, params = {}) {
  const P = { ...logregDefaults, ...params };
  const n = X.length;
  const d = X[0].length;
  const mu = new Array(d).fill(0);
  const sd = new Array(d).fill(0);
  for (const r of X) r.forEach((v, j) => { mu[j] += v / n; });
  for (const r of X) r.forEach((v, j) => { sd[j] += (v - mu[j]) ** 2 / n; });
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((r) => [1, ...r.map((v, j) => (v - mu[j]) / sd[j])]);
  const k = d + 1;
  let w = new Array(k).fill(0);
  for (let it = 0; it < P.iterations; it++) {
    const Hm = Array.from({ length: k }, () => new Array(k).fill(0));
    const g = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const z = Z[i];
      let s = 0;
      for (let j = 0; j < k; j++) s += w[j] * z[j];
      const p = 1 / (1 + Math.exp(-s));
      const r = p - y[i];
      const h = Math.max(p * (1 - p), 1e-6);
      for (let a = 0; a < k; a++) {
        g[a] += r * z[a];
        for (let b = a; b < k; b++) Hm[a][b] += h * z[a] * z[b];
      }
    }
    for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) Hm[a][b] = Hm[b][a];
    for (let a = 1; a < k; a++) { Hm[a][a] += P.lambda; g[a] += P.lambda * w[a]; }
    const step = solveLinear(Hm, g);
    let max = 0;
    w = w.map((v, j) => { max = Math.max(max, Math.abs(step[j])); return v - step[j]; });
    if (max < 1e-7) break;
  }
  return { kind: 'logreg', params: P, mu, sd, w };
}

export function predictLogreg(model, x) {
  let s = model.w[0];
  for (let j = 0; j < x.length; j++) s += model.w[j + 1] * ((x[j] - model.mu[j]) / model.sd[j]);
  return 1 / (1 + Math.exp(-s));
}
