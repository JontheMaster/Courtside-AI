// Live-Prognosen für kommende Post-SV-Spiele. Append-only: Eine Prognose wird nur
// neu geschrieben, wenn sich Datenstand (Input-Hash) oder Modellversion geändert hat,
// und nur bis zur Sperrzeit vor Anpfiff. Danach ist die letzte Prognose final.
import { config } from '../config.js';
import { logger } from '../util/log.js';
import { nowIso, addMinutes } from '../util/time.js';
import { buildContext, ratableMatches, historyBefore } from './context.js';
import { statModels, paramsFor, modelVersion, loadParams } from '../models/registry.js';
import { createLlmModel } from '../models/llm/index.js';
import { involvesClub } from './backtest.js';
import { dataQuality } from '../stats/teamStats.js';

const log = logger('predict');

export const predictionFile = (seasonId) => `predictions/${seasonId}.ndjson`;

export function lockTime(match) {
  // Ohne angesetzte Uhrzeit: Sperre ab 00:00 Uhr des Spieltags
  return match.timeTbd ? match.kickoffUtc : addMinutes(match.kickoffUtc, -config.predictions.lockMinutes);
}

/** Für Pokalspiele: eine reguläre Liga suchen, in der beide Teams spielen. */
export function ratingLeagueFor(match, league, leagueData) {
  if (league.competitionType === 'regular') return leagueData.find((x) => x.league.ligaId === league.ligaId);
  const has = (ld, id) => ld.matches.some((m) => m.home?.id === id || m.guest?.id === id);
  return leagueData.find((ld) => ld.league.competitionType === 'regular' && has(ld, match.home.id) && has(ld, match.guest.id)) || null;
}

/** Letzte gespeicherte Prognose je (Spiel, Modell) */
export function latestByKey(records) {
  const m = new Map();
  for (const r of records) m.set(`${r.matchId}|${r.modelId}`, r);
  return m;
}

/** Finale Prognosen: letzter Eintrag vor der Sperrzeit. */
export function finalPredictions(records) {
  const m = new Map();
  for (const r of records) if (r.createdAt <= r.lockUtc) m.set(`${r.matchId}|${r.modelId}`, r);
  return [...m.values()];
}

export function upcomingClubMatches(leagueData, now) {
  const out = [];
  for (const ld of leagueData) {
    if (ld.league.role !== 'core') continue;
    for (const m of ld.matches) {
      if (m.status !== 'scheduled' || !m.kickoffUtc || !m.home || !m.guest || !involvesClub(m)) continue;
      if (m.kickoffUtc <= now) continue;
      out.push({ league: ld.league, match: m });
    }
  }
  return out.sort((a, b) => (a.match.kickoffUtc < b.match.kickoffUtc ? -1 : 1));
}

export async function runPredictions(store, { now = nowIso(), llm = createLlmModel() } = {}) {
  const leagueData = store.allLeagueData();
  const allParams = loadParams(store);
  const ratableCache = new Map();
  const ratable = (ld) => {
    if (!ratableCache.has(ld.league.ligaId)) ratableCache.set(ld.league.ligaId, ratableMatches(ld.matches));
    return ratableCache.get(ld.league.ligaId);
  };

  const bySeason = new Map();
  const existing = (season) => {
    if (!bySeason.has(season)) bySeason.set(season, { latest: latestByKey(store.readNdjson(predictionFile(season))), add: [] });
    return bySeason.get(season);
  };

  const skipped = [];
  let considered = 0;
  for (const { league, match } of upcomingClubMatches(leagueData, now)) {
    const lock = lockTime(match);
    if (now >= lock) continue; // gesperrt: keine Änderung mehr
    if (match.kickoffUtc > addMinutes(now, config.predictions.horizonDays * 1440)) continue;
    considered++;
    const rl = ratingLeagueFor(match, league, leagueData);
    if (!rl) {
      skipped.push({ matchId: match.matchId, reason: 'Pokalspiel ohne gemeinsame reguläre Liga – keine vergleichbare Datenbasis' });
      continue;
    }
    const history = historyBefore(ratable(rl), match, now);
    const ctx = buildContext({ league: rl.league, target: match, history });
    const season = existing(match.seasonId ?? league.seasonId);
    const base = {
      matchId: match.matchId, ligaId: league.ligaId, ratingLigaId: rl.league.ligaId,
      homeId: match.home.id, guestId: match.guest.id, kickoffUtc: match.kickoffUtc, lockUtc: lock,
      createdAt: now, inputHash: ctx.inputHash, minGames: ctx.minGames, dataQuality: dataQuality(ctx.minGames),
      competitionType: league.competitionType,
    };
    const outs = {};
    for (const model of statModels) {
      const version = modelVersion(model, allParams);
      const out = model.predict(ctx, paramsFor(model, rl.league.ageGroup, allParams));
      outs[model.id] = out;
      push(season, base, model.id, version, out);
    }
    if (llm.enabled) {
      const version = modelVersion(llm, {});
      const prev = season.latest.get(`${match.matchId}|${llm.id}`);
      if (prev && prev.inputHash === ctx.inputHash && prev.modelVersion === version) continue; // Cache: gleiche Eingabe
      try {
        const out = await llm.predictAsync(ctx, { eloOut: outs.elo, ratingOut: outs.rating });
        push(season, base, llm.id, version, out);
      } catch (err) {
        log.warn(`LLM ${match.matchId}: ${err.message}`);
      }
    }
  }

  let written = 0;
  for (const [season, s] of bySeason) written += store.appendNdjson(predictionFile(season), s.add);
  log.info(`${considered} offene Post-SV-Spiele, ${written} neue Prognosen, ${skipped.length} übersprungen`);
  return { considered, written, skipped };
}

function push(season, base, modelId, modelVersion, out) {
  const key = `${base.matchId}|${modelId}`;
  const prev = season.latest.get(key);
  if (prev && prev.inputHash === base.inputHash && prev.modelVersion === modelVersion) return;
  const rec = {
    ...base, modelId, modelVersion,
    homeWinProb: out.homeWinProb, predictedWinner: out.predictedWinner, predictedMargin: out.predictedMargin,
    predictedHomeScore: out.predictedHomeScore, predictedGuestScore: out.predictedGuestScore,
    confidence: out.confidence,
    factors: out.factors.map(({ key: k, label, value }) => ({ key: k, label, value })),
  };
  season.add.push(rec);
  season.latest.set(key, rec);
}
