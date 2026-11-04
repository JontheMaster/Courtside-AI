import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptDecision } from '../src/engine/backtest.js';

const grid = { k: [24, 32, 48, 64, 80, 100], hfa: [0, 15, 30, 45, 60, 80] };
const defaults = { k: 64, hfa: 30 };
const bounds = { k: [16, 100] };

test('Deutliche Verbesserung mit Werten im Inneren wird übernommen', () => {
  const d = adoptDecision({ combo: { k: 48, hfa: 45 }, grid, defaults, bounds, testBrierDefault: 0.21, testBrierTuned: 0.205 });
  assert.equal(d.adopt, true);
  assert.deepEqual(d.reasons, []);
});

test('Randwert des Suchbereichs wird verworfen', () => {
  const d = adoptDecision({ combo: { k: 100, hfa: 30 }, grid, defaults, bounds, testBrierDefault: 0.21, testBrierTuned: 0.2 });
  assert.equal(d.adopt, false);
  assert.match(d.reasons.join(), /k=100 liegt am Rand/);
});

test('Randwert, der dem Startwert entspricht, ist kein Problem', () => {
  const d = adoptDecision({ combo: { k: 48, hfa: 0 }, grid: { ...grid }, defaults: { k: 64, hfa: 0 }, bounds, testBrierDefault: 0.21, testBrierTuned: 0.205 });
  assert.equal(d.adopt, true);
});

test('Zu kleine Verbesserung wird verworfen', () => {
  const d = adoptDecision({ combo: { k: 48, hfa: 45 }, grid, defaults, bounds, testBrierDefault: 0.21, testBrierTuned: 0.2095 });
  assert.equal(d.adopt, false);
  assert.match(d.reasons.join(), /Verbesserung/);
});

test('Werte außerhalb plausibler Grenzen werden verworfen', () => {
  const d = adoptDecision({ combo: { k: 160 }, grid: { k: [100, 160, 200] }, defaults, bounds, testBrierDefault: 0.21, testBrierTuned: 0.19 });
  assert.equal(d.adopt, false);
  assert.match(d.reasons.join(), /außerhalb plausibler Grenzen/);
});
