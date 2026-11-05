// Erzeugt die statischen JSON-Daten für die Oberfläche (public/data/).
// Diese Dateien werden nicht committet, sondern bei jedem Deploy neu gebaut.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { nowIso } from '../util/time.js';
import { buildContext, ratableMatches, historyBefore } from '../engine/context.js';
import { involvesClub } from '../engine/backtest.js';
import { loadAllPredictions, championship } from '../engine/championship.js';
import { latestByKey, finalPredictions, ratingLeagueFor, lockTime } from '../engine/predict.js';
import { statModels, modelVersion, loadParams, paramsFor } from '../models/registry.js';
import { ml } from '../models/ml.js';
import { createLlmModel } from '../models/llm/index.js';
import { elo } from '../models/elo.js';
import { logger } from '../util/log.js';

const log = logger('build');

function teamView(s) {
  return {
    games: s.games, wins: s.wins, losses: s.losses, winPct: s.winPct, ppg: s.ppg, papg: s.papg, avgMargin: s.avgMargin,
    form5: s.form5, last5AvgMargin: s.last5AvgMargin, streak: s.streak, sos: s.sos,
    homeRecord: [s.homeWins, s.homeGames - s.homeWins], awayRecord: [s.awayWins, s.awayGames - s.awayWins],
    dataQuality: s.dataQuality,
  };
}

export function buildSite(store, outDir = path.join(config.siteDir, 'data')) {
  const now = nowIso();
  const leagueData = store.allLeagueData();
  const allParams = loadParams(store);
  const backtest = store.readJson('backtest/latest.json', null);
  const preds = loadAllPredictions(store);
  const latest = latestByKey(preds);
  const finals = new Map(finalPredictions(preds).map((p) => [`${p.matchId}|${p.modelId}`, p]));
  const btByMatch = new Map((backtest?.postSvGames || []).map((g) => [g.matchId, g]));
  const llm = createLlmModel();
  const ratable = new Map(leagueData.map((ld) => [ld.league.ligaId, ratableMatches(ld.matches)]));
  const trainingGames = [...ratable.values()].reduce((a, r) => a + r.length, 0);

  const models = [
    ...statModels.map((m) => ({
      id: m.id, name: m.name, version: modelVersion(m, allParams), enabled: true,
      // tatsächlich verwendete Parameter je Altersklasse (für die Methodik-Seite)
      params: Object.fromEntries(config.ageGroups.map((ag) => [ag, paramsFor(m, ag, allParams)])),
    })),
    { id: ml.id, name: ml.name, version: modelVersion(ml, {}), ...ml.status(store), mlStatus: store.readJson('ml/status.json', null) },
    { id: llm.id, name: llm.name, version: modelVersion(llm, {}), ...llm.status() },
  ];
  const modelIds = models.filter((m) => m.enabled).map((m) => m.id);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'match'), { recursive: true });
  const write = (rel, v) => fs.writeFileSync(path.join(outDir, rel), JSON.stringify(v));

  const games = [];
  for (const ld of leagueData) {
    if (ld.league.role !== 'core') continue;
    for (const m of ld.matches) {
      if (!m.home || !m.guest || !involvesClub(m)) continue;
      const rl = ratingLeagueFor(m, ld.league, leagueData);
      const isPast = m.kickoffUtc && m.kickoffUtc <= now;
      const predictions = {};
      for (const id of [...modelIds, llm.id]) {
        const p = (isPast ? finals : latest).get(`${m.matchId}|${id}`);
        if (p) predictions[id] = { p: p.homeWinProb, winner: p.predictedWinner, margin: p.predictedMargin, home: p.predictedHomeScore, guest: p.predictedGuestScore, confidence: p.confidence, createdAt: p.createdAt, version: p.modelVersion, factors: p.factors };
      }
      const clubSide = m.home.clubId === config.club.id ? 'home' : 'guest';
      const summary = {
        matchId: m.matchId, ligaId: ld.league.ligaId, league: ld.league.name, ageGroup: ld.league.ageGroup, competitionType: ld.league.competitionType,
        seasonName: ld.league.seasonName, matchDay: m.matchDay, kickoffDate: m.kickoffDate, kickoffTime: m.kickoffTime, kickoffUtc: m.kickoffUtc,
        home: { id: m.home.id, name: m.home.name }, guest: { id: m.guest.id, name: m.guest.name }, clubSide,
        status: m.status, confirmed: m.confirmed, homeScore: m.homeScore, guestScore: m.guestScore, forfeitBy: m.forfeitBy,
        lockUtc: m.kickoffUtc ? lockTime(m) : null, predictions,
        backtest: btByMatch.get(m.matchId)?.predictions || null,
        ratingLeague: rl ? rl.league.ligaId : null,
      };
      games.push(summary);

      // Detail: Statistik zum aktuellen Zeitpunkt (kommende Spiele) bzw. vor Anpfiff (vergangene)
      let detail = { ...summary, note: null };
      if (rl) {
        const history = historyBefore(ratable.get(rl.league.ligaId), m, now);
        const ctx = buildContext({ league: rl.league, target: m, history });
        const eloOut = elo.predict(ctx, paramsFor(elo, rl.league.ageGroup, allParams));
        const name = (id) => rl.matches.find((x) => x.home?.id === id)?.home.name || rl.matches.find((x) => x.guest?.id === id)?.guest.name || String(id);
        detail = {
          ...detail,
          asOf: history.length ? history[history.length - 1].kickoffUtc : null,
          leagueStats: ctx.leagueStats,
          stats: { home: teamView(ctx.home), guest: teamView(ctx.guest) },
          h2h: ctx.h2h,
          common: { ...ctx.common, rows: ctx.common.rows.map((r) => ({ ...r, oppName: name(r.opp) })) },
          eloTrails: eloOut.trails,
          elo: eloOut.ratings,
        };
      } else {
        detail.note = 'Pokalspiel ohne gemeinsame reguläre Liga: keine vergleichbare Datenbasis, daher keine Prognose.';
      }
      write(`match/${m.matchId}.json`, detail);
    }
  }
  games.sort((a, b) => (a.kickoffUtc < b.kickoffUtc ? -1 : 1));

  const champ = championship(store, backtest);
  const leagues = leagueData.filter((ld) => ld.league.role === 'core').map((ld) => ({ ligaId: ld.league.ligaId, name: ld.league.name, ageGroup: ld.league.ageGroup, competitionType: ld.league.competitionType, seasonName: ld.league.seasonName }));
  const clubTeams = new Map();
  for (const g of games) {
    const t = g[g.clubSide];
    clubTeams.set(`${t.id}`, { id: t.id, name: t.name, ageGroup: g.ageGroup });
  }

  write('meta.json', {
    generatedAt: now, club: config.club, ageGroups: config.ageGroups, models, leagues,
    teams: [...clubTeams.values()].sort((a, b) => a.ageGroup.localeCompare(b.ageGroup) || a.name.localeCompare(b.name)),
    counts: { leagues: leagueData.length, coreLeagues: leagues.length, trainingGames, clubGames: games.length },
    lockMinutes: config.predictions.lockMinutes,
  });
  write('games.json', games);
  write('championship.json', champ);
  write('performance.json', {
    backtest: backtest ? { createdAt: backtest.createdAt, method: backtest.method, models: backtest.models, scopes: backtest.scopes } : null,
    live: champ.liveReports,
    leagueNames: Object.fromEntries(leagueData.map((ld) => [ld.league.ligaId, ld.league.name])),
  });
  log.info(`Site-Daten: ${games.length} Post-SV-Spiele, ${preds.length} gespeicherte Prognosen`);
  return { games: games.length };
}
