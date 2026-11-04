import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brier, logLoss, wilson, metrics, calibration, brierDiffCI } from '../src/engine/evaluation.js';

test('Brier und Log Loss von Hand', () => {
  assert.ok(Math.abs(brier(0.7, 1) - 0.09) < 1e-12);
  assert.ok(Math.abs(brier(0.7, 0) - 0.49) < 1e-12);
  assert.ok(Math.abs(logLoss(0.5, 1) - Math.log(2)) < 1e-12);
  assert.ok(Math.abs(logLoss(1, 0) - -Math.log(0.01)) < 1e-12); // geclippt
});

test('Wilson-Intervall', () => {
  const [lo, hi] = wilson(7, 10);
  assert.ok(lo > 0.39 && lo < 0.40 && hi > 0.89 && hi < 0.90);
  assert.deepEqual(wilson(0, 0), [null, null]);
});

test('metrics: Accuracy, MAE, Heim/Auswärts getrennt', () => {
  const rows = [
    { matchId: 1, p: 0.8, homeWon: true, predMargin: 10, actualMargin: 6 },
    { matchId: 2, p: 0.6, homeWon: false, predMargin: 4, actualMargin: -8 },
    { matchId: 3, p: 0.3, homeWon: false, predMargin: -5, actualMargin: -5 },
  ];
  const m = metrics(rows);
  assert.equal(m.n, 3);
  assert.equal(m.accuracy, 0.6667);
  assert.equal(m.mae, round((4 + 12 + 0) / 3));
  assert.equal(m.homeWinAccuracy, 1);
  assert.equal(m.awayWinAccuracy, 0.5);
  assert.equal(m.reliable, false);
});

function round(x) {
  return Math.round(x * 100) / 100;
}

test('Kalibrierung zählt aus Sicht des Favoriten', () => {
  const rows = [
    { p: 0.75, homeWon: true }, { p: 0.25, homeWon: false }, { p: 0.72, homeWon: false }, { p: 0.55, homeWon: true },
  ];
  const c = calibration(rows);
  const bin = c.find((b) => b.range.startsWith('70'));
  assert.equal(bin.n, 3);
  assert.equal(bin.observed, 0.667);
  assert.equal(c.find((b) => b.range.startsWith('50')).n, 1);
});

test('Bootstrap: identische Modelle → Differenz 0', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ matchId: i, p: 0.6, homeWon: i % 2 === 0 }));
  const d = brierDiffCI(rows, rows, 200);
  assert.equal(d.diff, 0);
  assert.deepEqual(d.ci, [0, 0]);
});
