import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResult, normalizeMatch, competitionType, ageGroup, isRatable } from '../src/teamsl/normalizer.js';
import { berlinToUtcIso } from '../src/util/time.js';

const raw = (over = {}) => ({
  matchId: 1, matchDay: 1, kickoffDate: '2026-09-26', kickoffTime: '11:00',
  homeTeam: { teamPermanentId: 10, teamname: 'A', clubId: 1476, verzicht: false },
  guestTeam: { teamPermanentId: 20, teamname: 'B', clubId: 2, verzicht: false },
  result: null, ergebnisbestaetigt: false, verzicht: false, abgesagt: false, ...over,
});
const lg = { ligaId: 5, seasonId: 2026, competitionType: 'regular' };
const NOW = '2026-11-01T12:00:00.000Z';

test('parseResult', () => {
  assert.deepEqual(parseResult('74:66'), { home: 74, guest: 66 });
  assert.deepEqual(parseResult(' 5 : 120 '), { home: 5, guest: 120 });
  assert.equal(parseResult(null), null);
  assert.equal(parseResult('20:0 (Wertung)'), null);
});

test('Status: final, unbestätigt', () => {
  const m = normalizeMatch(raw({ result: '74:66' }), lg, NOW);
  assert.equal(m.status, 'final');
  assert.equal(m.homeScore, 74);
  assert.equal(m.confirmed, false);
  assert.equal(isRatable(m), true);
  assert.equal(isRatable(m, { useUnconfirmedResults: false }), false);
});

test('Status: abgesagt ist kein Ergebnis', () => {
  const m = normalizeMatch(raw({ abgesagt: true }), lg, NOW);
  assert.equal(m.status, 'cancelled');
  assert.equal(isRatable(m), false);
});

test('Status: Verzicht über Team-Flag, kein normales Ergebnis', () => {
  const m = normalizeMatch(raw({ verzicht: true, guestTeam: { teamPermanentId: 20, teamname: 'B', clubId: 2, verzicht: true } }), lg, NOW);
  assert.equal(m.status, 'forfeit');
  assert.equal(m.forfeitBy, 'guest');
  assert.equal(isRatable(m), false);
});

test('Status: fehlendes Ergebnis vs. geplant; 00:00 = Uhrzeit offen', () => {
  assert.equal(normalizeMatch(raw(), lg, NOW).status, 'missing_result');
  const future = normalizeMatch(raw({ kickoffDate: '2026-12-01', kickoffTime: '00:00' }), lg, NOW);
  assert.equal(future.status, 'scheduled');
  assert.equal(future.timeTbd, true);
  assert.equal(future.kickoffTime, null);
});

test('Wettbewerbsart und Altersklasse', () => {
  assert.equal(competitionType({ liganame: 'MFR Bezirkspokal Herren', skName: 'Bezirkspokal' }), 'cup');
  assert.equal(competitionType({ liganame: 'BBV-Pokal U16 männlich', skName: 'Bayernliga' }), 'cup');
  assert.equal(competitionType({ liganame: 'MFR U14m Bezirksoberliga' }), 'regular');
  assert.equal(ageGroup({ akName: 'Senioren' }), 'Senioren');
  assert.equal(ageGroup({ akName: 'U16' }), 'U16');
  assert.equal(ageGroup({ akName: '' }), null);
});

test('Europe/Berlin → UTC inkl. Sommer-/Winterzeit', () => {
  assert.equal(berlinToUtcIso('2026-09-26', '11:00'), '2026-09-26T09:00:00.000Z'); // MESZ
  assert.equal(berlinToUtcIso('2026-11-07', '14:45'), '2026-11-07T13:45:00.000Z'); // MEZ
  assert.equal(berlinToUtcIso('kaputt', '11:00'), null);
});
