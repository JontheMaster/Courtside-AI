// Walk-Forward-Backtesting. Für jedes Spiel gilt: Das Modell sieht nur Spiele,
// die vor dessen Anpfiff angepfiffen wurden. Erst danach "erfährt" es das Ergebnis.
// Die Ratings werden für jede Prognose aus genau dieser Historie neu berechnet,
// spätere Ergebnisse können also strukturell nicht einfließen.
import { config } from '../config.js';
import { buildContext, ratableMatches, historyBefore } from './context.js';
import { statModels, paramsFor, modelVersion, loadParams } from '../models/registry.js';
import { report, brierDiffCI, metrics } from './evaluation.js';
import { logger } from '../util/log.js';
import { nowIso } from '../util/time.js';
import { round } from '../util/math.js';

const log = logger('backtest');

export const involvesClub = (m, clubId = config.club.id) => m.home?.clubId === clubId || m.guest?.clubId === clubId;

/** Liefert alle Backtest-Zeilen eines Modells über die übergebenen Ligen. */
export function walkForward(leagueData, model, allParams, { filter = () => true } = {}) {
  const rows = [];
  for (const { league, matches } of leagueData) {
    if (league.competitionType !== 'regular') continue;
    const ratable = ratableMatches(matches);
    const params = paramsFor(model, league.ageGroup, allParams);
    for (const target of ratable) {
      if (!filter(target, league)) continue;
      const history = historyBefore(ratable, target);
      const ctx = buildContext({ league, target, history });
      const out = model.predict(ctx, params);
      rows.push({
        matchId: target.matchId,
        ligaId: league.ligaId,
        ageGroup: league.ageGroup,
        role: league.role,
        postSv: involvesClub(target),
        kickoffUtc: target.kickoffUtc,
        minGames: ctx.minGames,
        historySize: history.length,
        p: out.homeWinProb,
        predMargin: out.predictedMargin,
        predHome: out.predictedHomeScore,
        predGuest: out.predictedGuestScore,
        actualMargin: target.homeScore - target.guestScore,
        homeWon: target.homeScore > target.guestScore,
        inputHash: ctx.inputHash,
      });
    }
  }
  return rows;
}

export function runBacktest(store, { models = statModels } = {}) {
  const leagueData = store.allLeagueData();
  const allParams = loadParams(store);
  const results = {};
  for (const model of models) {
    const t0 = Date.now();
    const rows = walkForward(leagueData, model, allParams);
    results[model.id] = { model, rows };
    log.info(`${model.id}: ${rows.length} Spiele in ${Date.now() - t0} ms`);
  }

  const scopes = {
    postsv: (r) => r.postSv,
    core: (r) => r.role === 'core',
    all: () => true,
  };
  const out = {
    createdAt: nowIso(),
    method: 'walk-forward; Historie = Spiele mit Anpfiff vor dem Zielspiel; nur reguläre Ligaspiele',
    dataSettings: { useUnconfirmedResults: config.data.useUnconfirmedResults, ageGroups: config.ageGroups },
    models: models.map((m) => ({ id: m.id, name: m.name, version: modelVersion(m, allParams) })),
    scopes: {},
    postSvGames: [],
  };
  for (const [scope, fn] of Object.entries(scopes)) {
    const s = { models: {}, vsBaseline: {} };
    for (const { model, rows } of Object.values(results)) s.models[model.id] = report(rows.filter(fn));
    const base = results.baseline?.rows.filter(fn) || [];
    for (const { model, rows } of Object.values(results)) {
      if (model.id !== 'baseline') s.vsBaseline[model.id] = brierDiffCI(rows.filter(fn), base);
    }
    out.scopes[scope] = s;
  }
  // Einzelprognosen der Post-SV-Spiele für die Detailansicht
  const byMatch = new Map();
  for (const { model, rows } of Object.values(results)) {
    for (const r of rows.filter((x) => x.postSv)) {
      if (!byMatch.has(r.matchId)) byMatch.set(r.matchId, { matchId: r.matchId, ligaId: r.ligaId, kickoffUtc: r.kickoffUtc, actualMargin: r.actualMargin, minGames: r.minGames, predictions: {} });
      byMatch.get(r.matchId).predictions[model.id] = { p: r.p, margin: r.predMargin, home: r.predHome, guest: r.predGuest };
    }
  }
  out.postSvGames = [...byMatch.values()].sort((a, b) => (a.kickoffUtc < b.kickoffUtc ? -1 : 1));
  // Zeitstempel nur erneuern, wenn sich das Ergebnis geändert hat (keine leeren Commits)
  const prev = store.readJson('backtest/latest.json', null);
  if (prev && JSON.stringify({ ...prev, createdAt: null }) === JSON.stringify({ ...out, createdAt: null })) out.createdAt = prev.createdAt;
  store.writeJson('backtest/latest.json', out);
  return out;
}

/** Kurzfassung für die Konsole */
export function summarize(bt) {
  const lines = [];
  for (const [scope, s] of Object.entries(bt.scopes)) {
    lines.push(`\n== ${scope} ==`);
    lines.push('Modell      n     Acc    [95%-KI]        Brier   LogLoss  MAE');
    for (const [id, r] of Object.entries(s.models)) {
      const o = r.overall;
      lines.push(`${id.padEnd(10)} ${String(o.n).padStart(4)}  ${o.accuracy?.toFixed(3)}  [${o.accuracyCI?.join('–')}]  ${o.brier?.toFixed(4)}  ${o.logLoss?.toFixed(4)}  ${o.mae}`);
    }
    for (const [id, d] of Object.entries(s.vsBaseline)) lines.push(`  Brier ${id} − baseline: ${d.diff} [${d.ci.join(', ')}]`);
  }
  return lines.join('\n');
}

/** Parameter-Tuning je Altersklasse: Grid-Search auf der ersten zeitlichen Hälfte, Test auf der zweiten. */
export function tune(store, grids) {
  const leagueData = store.allLeagueData();
  const current = loadParams(store);
  const result = {};
  const next = structuredClone(current);
  for (const model of statModels) {
    const grid = grids[model.id];
    if (!grid) continue;
    next[model.id] = next[model.id] || {};
    for (const ag of config.ageGroups) {
      const ld = leagueData.filter((x) => x.league.ageGroup === ag);
      const all = walkForward(ld, model, {});
      if (all.length < 40) {
        result[`${model.id}/${ag}`] = { skipped: `nur ${all.length} Spiele` };
        continue;
      }
      const dates = all.map((r) => r.kickoffUtc).sort();
      const split = dates[Math.floor(dates.length / 2)];
      const train = (t) => t.kickoffUtc < split;
      const test = (t) => t.kickoffUtc >= split;
      let best = null;
      for (const combo of cartesian(grid)) {
        const ps = { [model.id]: { [ag]: combo } };
        const m = metrics(walkForward(ld, model, ps, { filter: train }));
        // Primär Brier; bei Gleichstand (Parameter, die nur die Punktedifferenz betreffen) MAE
        if (!best || m.brier < best.brier - 1e-9 || (Math.abs(m.brier - best.brier) <= 1e-9 && m.mae < best.mae)) best = { combo, brier: m.brier, mae: m.mae };
      }
      const testDefault = metrics(walkForward(ld, model, {}, { filter: test }));
      const testTuned = metrics(walkForward(ld, model, { [model.id]: { [ag]: best.combo } }, { filter: test }));
      result[`${model.id}/${ag}`] = {
        split, best: best.combo, trainBrier: best.brier,
        testBrierDefault: testDefault.brier, testBrierTuned: testTuned.brier, testN: testTuned.n,
        adopted: testTuned.brier <= testDefault.brier,
      };
      // Nur übernehmen, wenn es auch außerhalb der Trainingsdaten nicht schlechter ist
      if (testTuned.brier <= testDefault.brier) next[model.id][ag] = best.combo;
      else delete next[model.id][ag];
    }
  }
  store.writeJson('model-params.json', next);
  store.writeJson('backtest/tuning.json', { createdAt: nowIso(), result });
  return result;
}

function cartesian(grid) {
  return Object.entries(grid).reduce((acc, [k, vals]) => acc.flatMap((a) => vals.map((v) => ({ ...a, [k]: v }))), [{}]);
}

export { round };
