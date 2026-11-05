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
import { ml, mlDefaults, buildDataset, walkForwardMl, fitMl, FEATURE_LABELS } from '../models/ml.js';
import { FEATURE_NAMES } from './features.js';

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

export function runBacktest(store, { models = statModels, withMl = true } = {}) {
  const leagueData = store.allLeagueData();
  const allParams = loadParams(store);
  const results = {};
  let mlImportance = [];
  for (const model of models) {
    const t0 = Date.now();
    const rows = walkForward(leagueData, model, allParams);
    results[model.id] = { model, rows };
    log.info(`${model.id}: ${rows.length} Spiele in ${Date.now() - t0} ms`);
  }
  if (withMl) {
    const t0 = Date.now();
    const dataset = buildDataset(leagueData, allParams);
    const rows = walkForwardMl(dataset);
    results.ml = { model: ml, rows };
    if (dataset.length >= mlDefaults.minTrain) mlImportance = importanceList(fitMl(dataset));
    log.info(`ml: ${rows.length} von ${dataset.length} Spielen getippt (wöchentlich neu trainiert) in ${Date.now() - t0} ms`);
  }
  const allModels = Object.values(results).map((r) => r.model);

  const scopes = {
    postsv: (r) => r.postSv,
    core: (r) => r.role === 'core',
    all: () => true,
  };
  const out = {
    createdAt: nowIso(),
    method: 'walk-forward; Historie = Spiele mit Anpfiff vor dem Zielspiel; nur reguläre Ligaspiele',
    dataSettings: { useUnconfirmedResults: config.data.useUnconfirmedResults, ageGroups: config.ageGroups },
    models: allModels.map((m) => ({ id: m.id, name: m.name, version: modelVersion(m, allParams) })),
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
    // Faire Gegenüberstellung: alle Modelle nur auf den Spielen, die auch ML getippt hat
    // (ML tippt erst, wenn genug Trainingsspiele vorliegen, also eher spätere Spiele).
    if (results.ml) {
      const ids = new Set(results.ml.rows.filter(fn).map((r) => r.matchId));
      s.sameGamesAsMl = Object.fromEntries(Object.values(results).map(({ model, rows }) => [model.id, metrics(rows.filter((r) => fn(r) && ids.has(r.matchId)))]));
    }
    out.scopes[scope] = s;
  }
  if (results.ml) writeMlStatus(store, out.scopes.all.sameGamesAsMl, out.scopes.all.vsBaseline.ml, mlImportance);
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

/**
 * Aktivierungsregel für Live-Tipps des ML-Modells: Es muss im Backtest auf denselben
 * Spielen einen niedrigeren Brier Score als die Baseline haben, bei mindestens
 * `minGamesReliable` getippten Spielen.
 */
export function mlActivation(same, minN = config.evaluation.minGamesReliable) {
  const m = same?.ml;
  const b = same?.baseline;
  if (!m || !m.n) return { activeLive: false, reason: 'Noch zu wenige Trainingsspiele für einen Backtest.' };
  if (m.n < minN) return { activeLive: false, reason: `Erst ${m.n} getippte Backtest-Spiele, mindestens ${minN} nötig.` };
  const fmt = (x) => x.toFixed(3).replace('.', ',');
  if (m.brier < b.brier) {
    return { activeLive: true, reason: `Schlägt die Baseline im Backtest auf ${m.n} Spielen (Brier ${fmt(m.brier)} vs. ${fmt(b.brier)}).` };
  }
  return { activeLive: false, reason: `Schlägt die Baseline im Backtest noch nicht (Brier ${fmt(m.brier)} vs. ${fmt(b.brier)} auf ${m.n} Spielen). Wird mit wachsender Datenbasis neu geprüft.` };
}

/** Merkmalswichtigkeit (Anteil am Gesamtgewinn der Baum-Splits) */
function importanceList(model) {
  const imp = model.win.importance || [];
  const total = imp.reduce((a, b) => a + b, 0) || 1;
  return imp.map((v, j) => ({ key: FEATURE_NAMES[j], label: FEATURE_LABELS[FEATURE_NAMES[j]] || FEATURE_NAMES[j].replace('age_', 'Altersklasse '), share: round(v / total, 4) }))
    .filter((x) => x.share > 0).sort((a, b) => b.share - a.share);
}

function writeMlStatus(store, same, vsBaseline, importance = []) {
  const decision = mlActivation(same);
  const status = { createdAt: nowIso(), ...decision, sameGames: same, vsBaseline, importance };
  const prev = store.readJson('ml/status.json', null);
  if (prev && JSON.stringify({ ...prev, createdAt: null }) === JSON.stringify({ ...status, createdAt: null })) status.createdAt = prev.createdAt;
  store.writeJson('ml/status.json', status);
  log.info(`ML live: ${decision.activeLive ? 'aktiv' : 'inaktiv'} – ${decision.reason}`);
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
    if (s.sameGamesAsMl) {
      lines.push('  Auf denselben Spielen wie ML:');
      for (const [id, o] of Object.entries(s.sameGamesAsMl)) lines.push(`    ${id.padEnd(9)} n=${o.n} acc=${o.accuracy?.toFixed(3)} brier=${o.brier?.toFixed(4)} mae=${o.mae}`);
    }
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
      const decision = adoptDecision({
        combo: best.combo, grid, defaults: model.defaults, bounds: TUNING_RULES.bounds[model.id] || {},
        testBrierDefault: testDefault.brier, testBrierTuned: testTuned.brier, minImprovement: TUNING_RULES.minImprovement,
      });
      result[`${model.id}/${ag}`] = {
        split, best: best.combo, trainBrier: best.brier,
        testBrierDefault: testDefault.brier, testBrierTuned: testTuned.brier, testN: testTuned.n,
        adopted: decision.adopt, reasons: decision.reasons,
      };
      if (decision.adopt) next[model.id][ag] = best.combo;
      else delete next[model.id][ag];
    }
  }
  store.writeJson('model-params.json', next);
  store.writeJson('backtest/tuning.json', { createdAt: nowIso(), result });
  return result;
}

/**
 * Sicherungen gegen Zufallstreffer beim Tuning (kleine Stichproben):
 * - Mindestverbesserung: Der getunte Satz muss auf der Testhälfte den Brier Score
 *   um mindestens `minImprovement` senken, sonst bleiben die Startwerte.
 * - Randwerte: Liegt ein Parameter am Rand des Suchbereichs (und weicht vom
 *   Startwert ab), ist das Optimum nicht eingegrenzt, das spricht für Rauschen.
 * - Plausibilitätsgrenzen je Parameter (z. B. K-Faktor).
 */
export const TUNING_RULES = {
  minImprovement: 0.002,
  bounds: {
    elo: { k: [16, 100], hfa: [0, 100], eloPerPoint: [4, 30], shrinkN0: [0, 5] },
    rating: { lambda: [0.5, 16], hfa0: [0, 8], sigma0: [8, 25] },
  },
};

export function adoptDecision({ combo, grid, defaults = {}, bounds = {}, testBrierDefault, testBrierTuned, minImprovement = TUNING_RULES.minImprovement }) {
  const reasons = [];
  for (const [k, v] of Object.entries(combo)) {
    const vals = (grid[k] || []).filter((x) => typeof x === 'number');
    if (vals.length >= 3 && v !== defaults[k] && (v === Math.min(...vals) || v === Math.max(...vals))) {
      reasons.push(`${k}=${v} liegt am Rand des Suchbereichs`);
    }
    const b = bounds[k];
    if (b && (v < b[0] || v > b[1])) reasons.push(`${k}=${v} außerhalb plausibler Grenzen [${b[0]}, ${b[1]}]`);
  }
  const gain = testBrierDefault - testBrierTuned;
  if (!(gain >= minImprovement)) reasons.push(`Verbesserung auf Testhälfte ${gain.toFixed(4)} < ${minImprovement}`);
  return { adopt: reasons.length === 0, reasons };
}

function cartesian(grid) {
  return Object.entries(grid).reduce((acc, [k, vals]) => acc.flatMap((a) => vals.map((v) => ({ ...a, [k]: v }))), [{}]);
}

export { round };
