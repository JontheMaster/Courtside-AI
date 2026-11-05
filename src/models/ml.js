// Model B – Machine Learning: Gradient Boosting auf den Merkmalen aus features.js.
// Training immer nur mit Spielen VOR dem zu tippenden Spiel (zeitliche Trennung):
//   Backtest: wöchentliche Blöcke, trainiert auf allen Spielen vor Wochenbeginn.
//   Live:     trainiert auf allen bisher gespielten Spielen.
// Live tippt das Modell nur mit, wenn es im Backtest die Baseline auf denselben Spielen schlägt.
import { config } from '../config.js';
import { statModels, paramsFor } from './registry.js';
import { buildContext, ratableMatches, historyBefore } from '../engine/context.js';
import { featureVector } from '../engine/features.js';
import { trainGbm, predictGbm } from '../ml/gbm.js';
import { trainLogreg, predictLogreg } from '../ml/logreg.js';
import { output } from './common.js';
import { sha256 } from '../util/hash.js';

export const mlDefaults = {
  learner: 'gbm',
  win: { trees: 150, depth: 2, learningRate: 0.05, minLeaf: 30, lambda: 5, bins: 32, loss: 'logloss' },
  margin: { trees: 150, depth: 2, learningRate: 0.05, minLeaf: 30, lambda: 5, bins: 32, loss: 'l2' },
  logreg: { lambda: 10 },
  marginCap: 40,
  minTrain: 300, // weniger Trainingsspiele → keine Prognose
};

const involvesClub = (m) => m.home?.clubId === config.club.id || m.guest?.clubId === config.club.id;

/** Statistische Modelle + Merkmalsvektor für einen Kontext */
export function statOutputs(ctx, allParams) {
  const outs = {};
  for (const m of statModels) outs[m.id] = m.predict(ctx, paramsFor(m, ctx.league.ageGroup, allParams));
  return outs;
}

/** Ein Datensatz-Zeile je gewertetem Ligaspiel; Merkmale nur aus der Historie davor. */
export function buildDataset(leagueData, allParams = {}) {
  const rows = [];
  for (const { league, matches } of leagueData) {
    if (league.competitionType !== 'regular') continue;
    const ratable = ratableMatches(matches);
    for (const target of ratable) {
      const history = historyBefore(ratable, target);
      const ctx = buildContext({ league, target, history });
      const outs = statOutputs(ctx, allParams);
      const margin = target.homeScore - target.guestScore;
      rows.push({
        matchId: target.matchId, ligaId: league.ligaId, ageGroup: league.ageGroup, role: league.role,
        postSv: involvesClub(target), kickoffUtc: target.kickoffUtc, minGames: ctx.minGames,
        x: featureVector(ctx, outs),
        homeWon: margin > 0, actualMargin: margin,
        yMargin: Math.max(-mlDefaults.marginCap, Math.min(mlDefaults.marginCap, margin)),
        exp: { h: (ctx.home.shrunk.ppg + ctx.guest.shrunk.papg) / 2, g: (ctx.guest.shrunk.ppg + ctx.home.shrunk.papg) / 2 },
      });
    }
  }
  return rows.sort((a, b) => (a.kickoffUtc < b.kickoffUtc ? -1 : a.kickoffUtc > b.kickoffUtc ? 1 : a.matchId - b.matchId));
}

export function fitMl(trainRows, P = mlDefaults) {
  const X = trainRows.map((r) => r.x);
  const yWin = trainRows.map((r) => (r.homeWon ? 1 : 0));
  const win = P.learner === 'logreg' ? trainLogreg(X, yWin, P.logreg) : trainGbm(X, yWin, P.win);
  const margin = trainGbm(X, trainRows.map((r) => r.yMargin), P.margin);
  return { win, margin, n: trainRows.length, trainHash: sha256(trainRows.map((r) => [r.matchId, r.actualMargin, r.kickoffUtc])) };
}

export function predictMl(model, x) {
  const p = model.win.kind === 'logreg' ? predictLogreg(model.win, x) : predictGbm(model.win, x);
  return { p: Math.min(0.99, Math.max(0.01, p)), margin: predictGbm(model.margin, x) };
}

/** Montag 00:00 UTC der Woche */
export function weekStart(iso) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString();
}

/** Walk-Forward: je Woche neu trainieren, nur mit Spielen vor Wochenbeginn. */
export function walkForwardMl(rows, P = mlDefaults) {
  const out = [];
  const blocks = [...new Set(rows.map((r) => weekStart(r.kickoffUtc)))].sort();
  for (const start of blocks) {
    const train = rows.filter((r) => r.kickoffUtc < start);
    if (train.length < P.minTrain) continue;
    const model = fitMl(train, P);
    for (const r of rows) {
      if (weekStart(r.kickoffUtc) !== start) continue;
      const { p, margin } = predictMl(model, r.x);
      const m = (p >= 0.5 && margin < 0) || (p < 0.5 && margin > 0) ? 0 : margin;
      const total = r.exp.h + r.exp.g;
      out.push({
        matchId: r.matchId, ligaId: r.ligaId, ageGroup: r.ageGroup, role: r.role, postSv: r.postSv,
        kickoffUtc: r.kickoffUtc, minGames: r.minGames, historySize: null, trainSize: train.length,
        p, predMargin: m, predHome: Math.round((total + m) / 2), predGuest: Math.round((total - m) / 2),
        actualMargin: r.actualMargin, homeWon: r.homeWon,
      });
    }
  }
  return out;
}

/** Live-Prognose im einheitlichen Ausgabeformat */
export function mlOutput(ctx, model, x) {
  const { p, margin } = predictMl(model, x);
  const top = topFeatures(model, 4);
  return output(ctx, {
    homeWinProb: p,
    predictedMargin: margin,
    factors: [
      { key: 'trainSize', label: 'Trainingsspiele', value: model.n },
      ...top.map((t, i) => ({ key: `feat${i}`, label: `Wichtiges Merkmal ${i + 1}`, value: t })),
    ],
  });
}

import { FEATURE_NAMES } from '../engine/features.js';
export const FEATURE_LABELS = {
  eloLogit: 'Elo-Siegchance', eloDiff: 'Elo-Abstand', ratingMargin: 'Ratingmodell: erwartete Differenz', ratingLogit: 'Ratingmodell: Siegchance',
  ratingSigma: 'Streuung der Liga', baseLogit: 'Baseline-Siegchance', winPctDiff: 'Unterschied Siegquote', avgMarginDiff: 'Unterschied Korbdifferenz',
  offDefDiff: 'Angriff vs. Verteidigung', last5MarginDiff: 'Form (Differenz letzte 5)', form5Diff: 'Form (Siege letzte 5)', streakDiff: 'Serie',
  sosDiff: 'Gegnerstärke', commonDiff: 'Gemeinsame Gegner', commonCount: 'Anzahl gemeinsamer Gegner', h2hNet: 'Direkte Duelle',
  minGames: 'Spiele (weniger erfahrenes Team)', maxGames: 'Spiele (erfahreneres Team)', historySize: 'Spiele in der Liga', leagueHomeLogit: 'Heimsiegquote der Liga', leagueAvgPoints: 'Punkteschnitt der Liga',
};

export function topFeatures(model, k = 5) {
  const imp = model.win.importance || [];
  return imp.map((v, j) => [v, FEATURE_NAMES[j]]).sort((a, b) => b[0] - a[0]).slice(0, k)
    .map(([, n]) => FEATURE_LABELS[n] || n.replace('age_', 'Altersklasse '));
}

export const ml = {
  id: 'ml',
  name: 'Machine Learning (Gradient Boosting)',
  codeVersion: 1,
  defaults: mlDefaults,
  /** Status aus dem letzten Backtest (data/ml/status.json) */
  status(store) {
    const s = store?.readJson('ml/status.json', null);
    if (!s) return { enabled: false, reason: 'Noch nicht im Backtest geprüft.' };
    return { enabled: Boolean(s.activeLive), reason: s.reason };
  },
};
