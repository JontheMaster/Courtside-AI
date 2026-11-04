import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expected, replay, movMultiplier, elo } from '../src/models/elo.js';
import { fitRatings, ratingModel } from '../src/models/ratingModel.js';
import { baseline } from '../src/models/baseline.js';
import { buildContext } from '../src/engine/context.js';
import { teamStats } from '../src/stats/teamStats.js';
import { game, league, roundRobin } from './helpers.js';

test('Elo: Erwartungswert', () => {
  assert.equal(expected(0), 0.5);
  assert.ok(Math.abs(expected(400) - 10 / 11) < 1e-12);
  assert.ok(Math.abs(expected(-200) + expected(200) - 1) < 1e-12);
});

test('Elo: Update von Hand nachgerechnet, Nullsumme', () => {
  const g = game({ home: 1, guest: 2, hs: 70, gs: 60, day: 1 });
  const { get } = replay([g], { k: 20, hfa: 0, mov: false, start: 1500 });
  assert.equal(get(1), 1510); // 20 * (1 - 0.5)
  assert.equal(get(2), 1490);
  const withMov = replay([g], { k: 20, hfa: 0, mov: true });
  assert.ok(Math.abs(withMov.get(1) - (1500 + 10 * movMultiplier(10, 0))) < 1e-9);
});

test('Elo: Heimvorteil erhöht Heimchance; starker Favorit gewinnt', () => {
  const games = roundRobin({ 1: 20, 2: 0, 3: -20 });
  const target = game({ id: 9999, home: 3, guest: 1, day: 200 });
  const ctx = buildContext({ league: league(), target, history: games });
  const out = elo.predict(ctx, {});
  assert.equal(out.predictedWinner, 'GUEST');
  assert.ok(out.homeWinProb < 0.3);
  assert.ok(out.predictedGuestScore > out.predictedHomeScore);
});

test('Ratingmodell findet bekannte Stärken wieder', () => {
  const games = roundRobin({ 1: 15, 2: 5, 3: -5, 4: -15 }, { rounds: 3 });
  const { r, hfa } = fitRatings(games, { lambda: 0.01, lambdaHfa: 0.01, marginCap: 100 });
  const order = [...r].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  assert.deepEqual(order, [1, 2, 3, 4]);
  assert.ok(Math.abs(r.get(1) - r.get(4) - 30) < 3, `Differenz ${r.get(1) - r.get(4)}`);
  assert.ok(Math.abs(hfa - 3) < 2, `hfa ${hfa}`);
});

test('Ratingmodell: Regularisierung zieht bei wenigen Spielen zur Mitte', () => {
  const g = [game({ home: 1, guest: 2, hs: 90, gs: 40, day: 1 })];
  const strong = fitRatings(g, { lambda: 10 }).r;
  const weak = fitRatings(g, { lambda: 0.1 }).r;
  assert.ok(strong.get(1) - strong.get(2) < weak.get(1) - weak.get(2));
});

test('Ohne Historie: alle Modelle vorsichtig nahe Heimquote', () => {
  const target = game({ id: 1, home: 1, guest: 2, day: 1 });
  const ctx = buildContext({ league: league(), target, history: [] });
  for (const m of [baseline, elo, ratingModel]) {
    const out = m.predict(ctx, {});
    assert.ok(out.homeWinProb > 0.45 && out.homeWinProb < 0.65, `${m.id}: ${out.homeWinProb}`);
    assert.equal(out.confidence, 'low');
  }
});

test('Statistik: Shrinkage und Form', () => {
  const games = [
    game({ home: 1, guest: 2, hs: 80, gs: 50, day: 1 }),
    game({ home: 3, guest: 1, hs: 70, gs: 60, day: 2 }),
    game({ home: 1, guest: 3, hs: 65, gs: 60, day: 3 }),
  ];
  const s = teamStats(games, 1, { shrinkN0: 3 });
  assert.equal(s.games, 3);
  assert.equal(s.wins, 2);
  assert.deepEqual(s.form5, ['W', 'L', 'W']);
  assert.equal(s.streak, 1);
  assert.equal(s.shrunk.winPct, (2 + 1.5) / 6);
  assert.ok(s.shrunk.avgMargin < s.avgMargin);
});
