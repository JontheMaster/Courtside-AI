// Model Championship: Rangliste aus den gespeicherten, finalen Live-Prognosen
// der Post-SV-Spiele. Keine Demo-Werte. Primäre Wertung: Brier Score (niedriger ist besser).
import { finalPredictions, predictionFile } from './predict.js';
import { report, metrics } from './evaluation.js';
import { isRatable } from '../teamsl/normalizer.js';
import { config } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';

export function loadAllPredictions(store) {
  const dir = path.join(store.dataDir, 'predictions');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson'));
  } catch {}
  return files.flatMap((f) => store.readNdjson(`predictions/${f}`));
}

/** Verknüpft finale Prognosen mit tatsächlichen Ergebnissen. */
export function evaluatedRows(store, leagueData = store.allLeagueData()) {
  const matches = new Map();
  const ageOf = new Map();
  for (const ld of leagueData) for (const m of ld.matches) {
    matches.set(m.matchId, m);
    ageOf.set(m.matchId, ld.league.ageGroup);
  }
  const rows = [];
  for (const p of finalPredictions(loadAllPredictions(store))) {
    const m = matches.get(p.matchId);
    if (!m || !isRatable(m, config.data)) continue;
    rows.push({
      modelId: p.modelId, modelVersion: p.modelVersion, matchId: p.matchId, ligaId: p.ligaId, ageGroup: ageOf.get(p.matchId),
      kickoffUtc: p.kickoffUtc, minGames: p.minGames, p: p.homeWinProb, predMargin: p.predictedMargin,
      actualMargin: m.homeScore - m.guestScore, homeWon: m.homeScore > m.guestScore, confirmed: m.confirmed,
    });
  }
  return rows;
}

export function championship(store, backtest) {
  const rows = evaluatedRows(store);
  const byModel = new Map();
  for (const r of rows) {
    if (!byModel.has(r.modelId)) byModel.set(r.modelId, []);
    byModel.get(r.modelId).push(r);
  }
  const live = [...byModel].map(([modelId, rs]) => ({ modelId, ...metrics(rs), unconfirmed: rs.filter((r) => !r.confirmed).length }))
    .sort((a, b) => a.brier - b.brier)
    .map((x, i) => ({ rank: i + 1, ...x }));

  const fromBacktest = (scope) => {
    const s = backtest?.scopes?.[scope];
    if (!s) return [];
    return Object.entries(s.models).map(([modelId, r]) => ({ modelId, ...r.overall }))
      .sort((a, b) => a.brier - b.brier).map((x, i) => ({ rank: i + 1, ...x }));
  };
  return {
    live,
    liveReports: Object.fromEntries([...byModel].map(([id, rs]) => [id, report(rs)])),
    champion: live.find((x) => x.n > 0) || null,
    backtestPostSv: fromBacktest('postsv'),
    backtestAll: fromBacktest('all'),
    backtestCreatedAt: backtest?.createdAt || null,
  };
}
