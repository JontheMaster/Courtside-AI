// Kernanforderung: kein Data Leakage. Spätere Ergebnisse dürfen frühere Prognosen nicht verändern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkForward } from '../src/engine/backtest.js';
import { statModels } from '../src/models/registry.js';
import { historyBefore, ratableMatches } from '../src/engine/context.js';
import { game, league, roundRobin } from './helpers.js';

test('Historie enthält nur vorher angepfiffene Spiele, gleichzeitige Spiele nicht', () => {
  const a = game({ id: 1, home: 1, guest: 2, hs: 70, gs: 60, day: 1 });
  const b = game({ id: 2, home: 3, guest: 4, hs: 70, gs: 60, day: 2 });
  const c = game({ id: 3, home: 1, guest: 3, hs: 70, gs: 60, day: 2 }); // gleiche Anwurfzeit wie b
  const d = game({ id: 4, home: 2, guest: 4, hs: 70, gs: 60, day: 3 });
  const h = historyBefore(ratableMatches([a, b, c, d]), c);
  assert.deepEqual(h.map((m) => m.matchId), [1]);
});

test('Manipulation zukünftiger Ergebnisse ändert frühere Prognosen nicht', () => {
  const games = roundRobin({ 1: 10, 2: 0, 3: -5, 4: -10 }, { rounds: 2 });
  const cut = games[Math.floor(games.length / 2)].kickoffUtc;
  const tampered = games.map((m) => (m.kickoffUtc >= cut ? { ...m, homeScore: m.guestScore, guestScore: m.homeScore + 30 } : m));
  for (const model of statModels) {
    const before = walkForward([{ league: league(), matches: games }], model, {}).filter((r) => r.kickoffUtc < cut);
    const after = walkForward([{ league: league(), matches: tampered }], model, {}).filter((r) => r.kickoffUtc < cut);
    assert.ok(before.length > 5);
    assert.deepEqual(after.map((r) => [r.p, r.predMargin, r.inputHash]), before.map((r) => [r.p, r.predMargin, r.inputHash]), model.id);
  }
});

test('Erste Saisonprognose hat keine Historie', () => {
  const games = roundRobin({ 1: 10, 2: 0 });
  const rows = walkForward([{ league: league(), matches: games }], statModels[1], {});
  assert.equal(rows[0].historySize, 0);
  assert.equal(rows[0].minGames, 0);
});
