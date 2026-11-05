// Merkmalsvektor für das ML-Modell. Er wird ausschließlich aus dem leakage-freien
// Kontext (Historie vor dem Spiel) und den Ausgaben der statistischen Modelle gebildet.
import { config } from '../config.js';
import { logit } from '../util/math.js';

const clampP = (p) => Math.min(0.99, Math.max(0.01, p));
const nz = (x, d = 0) => (Number.isFinite(x) ? x : d);
const winsOf = (form) => (form.length ? form.filter((r) => r === 'W').length / form.length : 0.5);

export const FEATURE_NAMES = [
  'eloLogit', 'eloDiff', 'ratingMargin', 'ratingLogit', 'ratingSigma', 'baseLogit',
  'winPctDiff', 'avgMarginDiff', 'offDefDiff', 'last5MarginDiff', 'form5Diff', 'streakDiff', 'sosDiff',
  'commonDiff', 'commonCount', 'h2hNet',
  'minGames', 'maxGames', 'historySize', 'leagueHomeLogit', 'leagueAvgPoints',
  ...config.ageGroups.map((a) => `age_${a}`),
];

/**
 * @param ctx      Kontext aus buildContext
 * @param outs     { baseline, elo, rating } Ausgaben der statistischen Modelle für dieses Spiel
 */
export function featureVector(ctx, outs) {
  const h = ctx.home;
  const g = ctx.guest;
  const eloRaw = outs.elo.factors.find((f) => f.key === 'rawProb')?.value ?? 0.5;
  const ratingSigma = outs.rating.factors.find((f) => f.key === 'sigma')?.value ?? 15;
  const h2hNet = ctx.h2h.reduce((s, m) => {
    const homeTeamWon = m.homeScore > m.guestScore;
    const targetHomeWasHome = m.homeId === ctx.match.home.id;
    return s + (homeTeamWon === targetHomeWasHome ? 1 : -1);
  }, 0);
  const v = [
    logit(clampP(eloRaw)),
    ((outs.elo.ratings?.home ?? 1500) - (outs.elo.ratings?.guest ?? 1500)) / 400,
    nz(outs.rating.predictedMargin),
    logit(clampP(outs.rating.homeWinProb)),
    ratingSigma,
    logit(clampP(outs.baseline.homeWinProb)),
    h.shrunk.winPct - g.shrunk.winPct,
    h.shrunk.avgMargin - g.shrunk.avgMargin,
    (h.shrunk.ppg - g.shrunk.papg) - (g.shrunk.ppg - h.shrunk.papg),
    nz(h.last5AvgMargin) - nz(g.last5AvgMargin),
    winsOf(h.form5) - winsOf(g.form5),
    h.streak - g.streak,
    nz(h.sos, 0.5) - nz(g.sos, 0.5),
    nz(ctx.common.avgDiff),
    ctx.common.count,
    h2hNet,
    ctx.minGames,
    Math.max(h.games, g.games),
    ctx.history.length,
    logit(clampP(ctx.leagueStats.homeWinRate)),
    nz(ctx.leagueStats.avgPoints, 60),
    ...config.ageGroups.map((a) => (ctx.league.ageGroup === a ? 1 : 0)),
  ];
  return v.map((x) => (Number.isFinite(x) ? x : 0));
}
