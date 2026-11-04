import { clamp, round } from '../util/math.js';

/** Erwartete Punkte beider Teams aus (geshrinkter) Offensive/Defensive, auf eine Differenz eingepasst. */
export function scoreFromMargin(ctx, margin) {
  const h = ctx.home.shrunk;
  const g = ctx.guest.shrunk;
  const homeExp = (h.ppg + g.papg) / 2;
  const guestExp = (g.ppg + h.papg) / 2;
  const total = homeExp + guestExp;
  return {
    predictedHomeScore: Math.max(0, Math.round((total + margin) / 2)),
    predictedGuestScore: Math.max(0, Math.round((total - margin) / 2)),
  };
}

export function confidenceLabel(p, minGames) {
  if (minGames < 3) return 'low';
  const d = Math.abs(p - 0.5);
  return d >= 0.25 && minGames >= 5 ? 'high' : d >= 0.1 ? 'medium' : 'low';
}

/** Einheitliches Ausgabeformat aller Modelle */
export function output(ctx, { homeWinProb, predictedMargin, factors = [], extra = {} }) {
  const p = clamp(homeWinProb, 0.01, 0.99);
  // Gewinner und Differenz müssen konsistent sein
  let margin = predictedMargin;
  if ((p >= 0.5 && margin < 0) || (p < 0.5 && margin > 0)) margin = 0;
  const scores = scoreFromMargin(ctx, margin);
  if (p >= 0.5 && scores.predictedHomeScore <= scores.predictedGuestScore) scores.predictedHomeScore = scores.predictedGuestScore + 1;
  if (p < 0.5 && scores.predictedGuestScore <= scores.predictedHomeScore) scores.predictedGuestScore = scores.predictedHomeScore + 1;
  return {
    homeWinProb: round(p, 4),
    predictedWinner: p >= 0.5 ? 'HOME' : 'GUEST',
    predictedMargin: round(margin, 1),
    ...scores,
    confidence: confidenceLabel(p, ctx.minGames),
    factors,
    ...extra,
  };
}
