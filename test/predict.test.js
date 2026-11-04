// Prognosen sind append-only, werden nur vor der Sperrzeit geschrieben und nicht dupliziert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runPredictions, finalPredictions, predictionFile } from '../src/engine/predict.js';
import { verifyPredictions } from '../src/engine/verify.js';
import { config } from '../src/config.js';
import { game, league, tempStore } from './helpers.js';

const CLUB = config.club.id;
const noLlm = { enabled: false };

function setup() {
  const { dir, store } = tempStore();
  const played = [
    game({ id: 1, home: 1, guest: 2, hs: 70, gs: 50, day: 1, clubHome: CLUB }),
    game({ id: 2, home: 2, guest: 3, hs: 60, gs: 62, day: 2 }),
  ];
  const upcoming = game({ id: 3, home: 3, guest: 1, day: 10, clubGuest: CLUB });
  store.saveLeagues({ 1: league() });
  store.saveLeagueMatches(1, { league: league(), matches: [...played, upcoming] });
  return { dir, store, upcoming };
}

test('Prognose wird einmal geschrieben und bei gleichem Datenstand nicht wiederholt', async () => {
  const { store, upcoming } = setup();
  const now = new Date(Date.parse(upcoming.kickoffUtc) - 3 * 86400000).toISOString();
  const r1 = await runPredictions(store, { now, llm: noLlm });
  const r2 = await runPredictions(store, { now: new Date(Date.parse(now) + 3600000).toISOString(), llm: noLlm });
  assert.equal(r1.written, 3); // baseline, elo, rating
  assert.equal(r2.written, 0);
  const recs = store.readNdjson(predictionFile(2026));
  assert.ok(recs.every((r) => r.createdAt < r.lockUtc && r.lockUtc < r.kickoffUtc));
});

test('Nach der Sperrzeit entstehen keine neuen Prognosen, auch bei neuem Datenstand', async () => {
  const { store, upcoming } = setup();
  const early = new Date(Date.parse(upcoming.kickoffUtc) - 2 * 86400000).toISOString();
  await runPredictions(store, { now: early, llm: noLlm });
  // neues Ergebnis kommt hinzu, aber wir sind innerhalb der Sperrzeit
  const lg = store.leagueMatches(1);
  lg.matches.push(game({ id: 4, home: 1, guest: 3, hs: 80, gs: 40, day: 9, clubHome: CLUB }));
  store.saveLeagueMatches(1, lg);
  const late = new Date(Date.parse(upcoming.kickoffUtc) - 30 * 60000).toISOString();
  const r = await runPredictions(store, { now: late, llm: noLlm });
  assert.equal(r.written, 0);
  const finals = finalPredictions(store.readNdjson(predictionFile(2026)));
  assert.equal(finals.length, 3);
  assert.ok(finals.every((f) => f.createdAt === early));
});

test('Integritätsprüfung erkennt nachträglich veränderte Prognosen', async () => {
  const { dir, store, upcoming } = setup();
  await runPredictions(store, { now: new Date(Date.parse(upcoming.kickoffUtc) - 86400000).toISOString(), llm: noLlm });
  const root = path.dirname(dir);
  // Repo-Struktur nachbilden: <root>/data/predictions
  const repo = fs.mkdtempSync(path.join(root, 'repo-'));
  fs.mkdirSync(path.join(repo, 'data'), { recursive: true });
  fs.cpSync(path.join(dir, 'predictions'), path.join(repo, 'data', 'predictions'), { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  assert.equal(verifyPredictions(repo).ok, true);

  const file = path.join(repo, 'data', 'predictions', '2026.ndjson');
  fs.appendFileSync(file, fs.readFileSync(file, 'utf8').split('\n')[0] + '\n');
  assert.equal(verifyPredictions(repo).ok, true, 'Anhängen ist erlaubt');

  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"homeWinProb":', '"homeWinProb":0.99,"x":'));
  const r = verifyPredictions(repo);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /verändert/);
});
