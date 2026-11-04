// Datenabgleich: Post-SV-Ligen (ab U14) + Trainingsligen der Gegnervereine.
import { config } from '../config.js';
import { logger } from '../util/log.js';
import { pool } from '../util/pool.js';
import { nowIso } from '../util/time.js';
import { getClubMatches, getSpielplan } from '../teamsl/client.js';
import { normalizeLeague, normalizeMatch } from '../teamsl/normalizer.js';

const log = logger('sync');

const relevant = (league) => league && config.ageGroups.includes(league.ageGroup);

/** Vergleicht alten und neuen Stand eines Spiels (Verlegungen, Ergebnisänderungen). */
export function diffMatch(prev, next) {
  if (!prev) return null;
  const changes = {};
  for (const k of ['kickoffDate', 'kickoffTime', 'status', 'homeScore', 'guestScore', 'confirmed']) {
    if (prev[k] !== next[k]) changes[k] = [prev[k], next[k]];
  }
  return Object.keys(changes).length ? changes : null;
}

async function fetchLeague(ligaId, role, now, store, changes) {
  const data = await getSpielplan(ligaId);
  const league = { ...normalizeLeague(data.ligaData), role };
  if (!league.ligaId) league.ligaId = ligaId;
  const matches = (data.matches || [])
    .map((m) => normalizeMatch(m, league, now, { gameDurationMinutes: config.predictions.gameDurationMinutes }))
    .sort((a, b) => a.matchId - b.matchId);

  const prev = store.leagueMatches(ligaId);
  const prevById = new Map((prev?.matches || []).map((m) => [m.matchId, m]));
  for (const m of matches) {
    const d = diffMatch(prevById.get(m.matchId), m);
    if (d) changes.push({ at: now, ligaId, matchId: m.matchId, changes: d });
  }
  store.saveLeagueMatches(ligaId, { league, matches });
  return { league, matches };
}

export async function runSync(store) {
  const now = nowIso();
  const changes = [];

  // 1. Ligen des Vereins
  const club = await getClubMatches(config.club.id);
  const coreLeagues = new Map();
  for (const m of club.matches || []) {
    const l = normalizeLeague(m.ligaData);
    if (relevant(l)) coreLeagues.set(l.ligaId, l);
  }
  log.info(`${coreLeagues.size} Post-SV-Ligen ab U14`);

  const leagues = {};
  const failed = [];
  const core = await pool([...coreLeagues.keys()], config.api.concurrency, async (id) => {
    try {
      return await fetchLeague(id, 'core', now, store, changes);
    } catch (err) {
      failed.push({ ligaId: id, error: err.message });
      log.warn(`Liga ${id}: ${err.message}`);
      return null;
    }
  });
  for (const r of core.filter(Boolean)) leagues[r.league.ligaId] = r.league;

  // 2. Trainingsligen: weitere Ligen ab U14 der Gegnervereine (gleicher Verband)
  if (config.trainingLeagues.enabled) {
    const clubIds = new Set();
    for (const r of core.filter(Boolean)) {
      for (const m of r.matches) for (const t of [m.home, m.guest]) if (t?.clubId && t.clubId !== config.club.id) clubIds.add(t.clubId);
    }
    const clubs = [...clubIds].slice(0, config.trainingLeagues.maxClubs);
    const extra = new Map();
    await pool(clubs, config.api.concurrency, async (cid) => {
      try {
        const d = await getClubMatches(cid);
        for (const m of d.matches || []) {
          const l = normalizeLeague(m.ligaData);
          if (relevant(l) && !leagues[l.ligaId] && l.competitionType === 'regular'
            && config.trainingLeagues.verbandIds.includes(l.verbandId)) extra.set(l.ligaId, l);
        }
      } catch (err) {
        log.warn(`Verein ${cid}: ${err.message}`);
      }
    });
    log.info(`${clubs.length} Gegnervereine → ${extra.size} zusätzliche Trainingsligen`);
    const tr = await pool([...extra.keys()], config.api.concurrency, async (id) => {
      try {
        return await fetchLeague(id, 'training', now, store, changes);
      } catch (err) {
        failed.push({ ligaId: id, error: err.message });
        return null;
      }
    });
    for (const r of tr.filter(Boolean)) leagues[r.league.ligaId] = r.league;
  }

  // Ligen, die in diesem Lauf fehlschlugen, behalten ihren alten Stand.
  const prevLeagues = store.leagues();
  for (const f of failed) if (prevLeagues[f.ligaId]) leagues[f.ligaId] = prevLeagues[f.ligaId];

  const sorted = Object.fromEntries(Object.keys(leagues).sort((a, b) => a - b).map((k) => [k, leagues[k]]));
  store.saveLeagues(sorted);
  store.appendNdjson('changes.ndjson', changes);
  log.info(`Sync fertig: ${Object.keys(sorted).length} Ligen, ${changes.length} Änderungen, ${failed.length} Fehler`);
  return { leagues: Object.keys(sorted).length, changes: changes.length, failed };
}
