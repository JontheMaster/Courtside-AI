import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainGbm, predictGbm } from '../src/ml/gbm.js';
import { trainLogreg, predictLogreg } from '../src/ml/logreg.js';
import { walkForwardMl, weekStart, buildDataset, mlDefaults } from '../src/models/ml.js';
import { mlActivation } from '../src/engine/backtest.js';
import { FEATURE_NAMES } from '../src/engine/features.js';
import { rng } from '../src/util/math.js';
import { league, roundRobin } from './helpers.js';

const rand = rng(3);
const X = Array.from({ length: 400 }, () => [rand(), rand()]);

test('Gradient Boosting lernt eine Schwelle (Klassifikation)', () => {
  const y = X.map(([a]) => (a > 0.5 ? 1 : 0));
  const m = trainGbm(X, y, { trees: 60, depth: 2, minLeaf: 10 });
  assert.ok(predictGbm(m, [0.9, 0.5]) > 0.85);
  assert.ok(predictGbm(m, [0.1, 0.5]) < 0.15);
  assert.ok(m.importance[0] > m.importance[1], 'Merkmal 0 ist das wichtige');
});

test('Gradient Boosting ist deterministisch', () => {
  const y = X.map(([a, b]) => (a + b > 1 ? 1 : 0));
  const a = trainGbm(X, y, { trees: 20 });
  const b = trainGbm(X, y, { trees: 20 });
  assert.equal(predictGbm(a, [0.3, 0.8]), predictGbm(b, [0.3, 0.8]));
});

test('Gradient Boosting Regression nähert y = 20x an', () => {
  const y = X.map(([a]) => 20 * a);
  const m = trainGbm(X, y, { loss: 'l2', trees: 200, depth: 2, learningRate: 0.1, minLeaf: 5 });
  assert.ok(Math.abs(predictGbm(m, [0.75, 0.2]) - 15) < 2);
});

test('Logistische Regression trennt linear trennbare Daten', () => {
  const y = X.map(([a, b]) => (a - b > 0 ? 1 : 0));
  const m = trainLogreg(X, y, { lambda: 0.1 });
  assert.ok(predictLogreg(m, [0.9, 0.1]) > 0.9);
  assert.ok(predictLogreg(m, [0.1, 0.9]) < 0.1);
});

test('Merkmalsvektor: vollständig und endlich', () => {
  const games = roundRobin({ 1: 10, 2: 0, 3: -10 });
  const rows = buildDataset([{ league: league(), matches: games }]);
  assert.equal(rows.length, games.length);
  for (const r of rows) {
    assert.equal(r.x.length, FEATURE_NAMES.length);
    assert.ok(r.x.every(Number.isFinite));
  }
});

test('ML-Walk-Forward: Training nur mit Spielen vor Wochenbeginn, kein Leakage', () => {
  const games = roundRobin({ 1: 12, 2: 4, 3: -4, 4: -12 }, { rounds: 8 });
  const rows = buildDataset([{ league: league(), matches: games }]);
  const P = { ...mlDefaults, minTrain: 30, win: { ...mlDefaults.win, trees: 20, minLeaf: 5 }, margin: { ...mlDefaults.margin, trees: 20, minLeaf: 5 } };
  const out = walkForwardMl(rows, P);
  assert.ok(out.length > 10);
  for (const o of out) {
    const before = rows.filter((r) => r.kickoffUtc < weekStart(o.kickoffUtc)).length;
    assert.equal(o.trainSize, before);
  }
  // spätere Ergebnisse verfälschen → frühere ML-Tipps bleiben gleich
  const cut = out[Math.floor(out.length / 2)].kickoffUtc;
  const tampered = rows.map((r) => (r.kickoffUtc >= cut ? { ...r, homeWon: !r.homeWon, yMargin: -r.yMargin, actualMargin: -r.actualMargin } : r));
  const a = out.filter((o) => weekStart(o.kickoffUtc) < weekStart(cut));
  const b = walkForwardMl(tampered, P).filter((o) => weekStart(o.kickoffUtc) < weekStart(cut));
  assert.ok(a.length > 0);
  assert.deepEqual(b.map((o) => o.p), a.map((o) => o.p));
});

test('Aktivierungsregel: nur wenn Baseline auf denselben Spielen geschlagen', () => {
  assert.equal(mlActivation({ ml: { n: 0 } }).activeLive, false);
  assert.equal(mlActivation({ ml: { n: 10, brier: 0.1 }, baseline: { n: 10, brier: 0.2 } }).activeLive, false);
  assert.equal(mlActivation({ ml: { n: 100, brier: 0.21 }, baseline: { n: 100, brier: 0.2 } }).activeLive, false);
  assert.equal(mlActivation({ ml: { n: 100, brier: 0.19 }, baseline: { n: 100, brier: 0.2 } }).activeLive, true);
});
