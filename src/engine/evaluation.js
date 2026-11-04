// Bewertungsmetriken. Eingabe: Liste ausgewerteter Prognosen
// { p, homeWon, predMargin, actualMargin, ligaId, ageGroup, minGames, kickoffUtc }
import { clamp, mean, rng, round } from '../util/math.js';
import { config } from '../config.js';

export const brier = (p, y) => (p - y) ** 2;
export const logLoss = (p, y) => {
  const q = clamp(p, 0.01, 0.99);
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};

/** Wilson-Konfidenzintervall (95 %) für eine Quote */
export function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [round(c - h, 3), round(c + h, 3)];
}

export function metrics(rows) {
  const n = rows.length;
  if (!n) return { n: 0, reliable: false };
  const y = (r) => (r.homeWon ? 1 : 0);
  const correct = rows.filter((r) => (r.p >= 0.5) === r.homeWon).length;
  const withMargin = rows.filter((r) => Number.isFinite(r.predMargin));
  const homeWins = rows.filter((r) => r.homeWon);
  const awayWins = rows.filter((r) => !r.homeWon);
  return {
    n,
    reliable: n >= config.evaluation.minGamesReliable,
    accuracy: round(correct / n, 4),
    accuracyCI: wilson(correct, n),
    brier: round(mean(rows.map((r) => brier(r.p, y(r)))), 4),
    logLoss: round(mean(rows.map((r) => logLoss(r.p, y(r)))), 4),
    mae: withMargin.length ? round(mean(withMargin.map((r) => Math.abs(r.predMargin - r.actualMargin))), 2) : null,
    homeWinAccuracy: homeWins.length ? round(homeWins.filter((r) => r.p >= 0.5).length / homeWins.length, 4) : null,
    awayWinAccuracy: awayWins.length ? round(awayWins.filter((r) => r.p < 0.5).length / awayWins.length, 4) : null,
    homeWins: homeWins.length,
    awayWins: awayWins.length,
  };
}

/** Kalibrierung: Prognosen nach Sicherheit des Favoriten gruppiert (50–60 %, …) */
export function calibration(rows, edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001]) {
  const bins = edges.slice(0, -1).map((lo, i) => ({ lo, hi: Math.min(1, edges[i + 1]), n: 0, sumP: 0, wins: 0 }));
  for (const r of rows) {
    const fav = Math.max(r.p, 1 - r.p);
    const favWon = r.p >= 0.5 ? r.homeWon : !r.homeWon;
    const b = bins.find((x) => fav >= x.lo && fav < (x.hi === 1 ? 1.0001 : x.hi));
    if (!b) continue;
    b.n++;
    b.sumP += fav;
    if (favWon) b.wins++;
  }
  return bins.map((b) => ({
    range: `${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)} %`,
    n: b.n,
    predicted: b.n ? round(b.sumP / b.n, 3) : null,
    observed: b.n ? round(b.wins / b.n, 3) : null,
    ci: wilson(b.wins, b.n),
  }));
}

export function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

export const experienceBucket = (n) => (n <= 2 ? '0–2 Spiele' : n <= 5 ? '3–5 Spiele' : '6+ Spiele');

/** Verlauf: kumulierte Accuracy und Brier über die Zeit (nach Anpfiff sortiert) */
export function cumulativeSeries(rows) {
  const sorted = [...rows].sort((a, b) => (a.kickoffUtc < b.kickoffUtc ? -1 : 1));
  let c = 0;
  let bs = 0;
  return sorted.map((r, i) => {
    if ((r.p >= 0.5) === r.homeWon) c++;
    bs += brier(r.p, r.homeWon ? 1 : 0);
    return { date: r.kickoffUtc.slice(0, 10), n: i + 1, accuracy: round(c / (i + 1), 4), brier: round(bs / (i + 1), 4) };
  });
}

/**
 * Bootstrap-Intervall für die Brier-Differenz A − B auf denselben Spielen.
 * Negativ = A besser. Deterministischer Seed für Reproduzierbarkeit.
 */
export function brierDiffCI(rowsA, rowsB, samples = config.evaluation.bootstrapSamples, seed = 7) {
  const byId = new Map(rowsB.map((r) => [r.matchId, r]));
  const pairs = rowsA.filter((r) => byId.has(r.matchId)).map((a) => {
    const b = byId.get(a.matchId);
    const y = a.homeWon ? 1 : 0;
    return brier(a.p, y) - brier(b.p, y);
  });
  if (pairs.length < 2) return { n: pairs.length, diff: null, ci: [null, null] };
  const rand = rng(seed);
  const stats = [];
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let i = 0; i < pairs.length; i++) sum += pairs[Math.floor(rand() * pairs.length)];
    stats.push(sum / pairs.length);
  }
  stats.sort((a, b) => a - b);
  return { n: pairs.length, diff: round(mean(pairs), 4), ci: [round(stats[Math.floor(samples * 0.025)], 4), round(stats[Math.floor(samples * 0.975)], 4)] };
}

/** Vollständiger Bericht je Modell */
export function report(rows) {
  return {
    overall: metrics(rows),
    calibration: calibration(rows),
    byLeague: [...groupBy(rows, (r) => r.ligaId)].map(([ligaId, rs]) => ({ ligaId, ...metrics(rs) })),
    byAgeGroup: [...groupBy(rows, (r) => r.ageGroup)].map(([ageGroup, rs]) => ({ ageGroup, ...metrics(rs) })),
    byExperience: ['0–2 Spiele', '3–5 Spiele', '6+ Spiele'].map((b) => ({ bucket: b, ...metrics(rows.filter((r) => experienceBucket(r.minGames) === b)) })),
    series: cumulativeSeries(rows),
    scatter: rows.filter((r) => Number.isFinite(r.predMargin)).map((r) => [round(r.predMargin, 1), r.actualMargin]),
  };
}
