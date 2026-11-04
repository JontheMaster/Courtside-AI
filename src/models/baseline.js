// Baseline: bisherige Siegquote (geglättet), log5-Kombination + Liga-Heimvorteil.
import { logit, logistic, round } from '../util/math.js';
import { output } from './common.js';

export const baseline = {
  id: 'baseline',
  name: 'Baseline (Siegquote)',
  codeVersion: 1,
  defaults: {},
  predict(ctx) {
    const pH = ctx.home.shrunk.winPct;
    const pG = ctx.guest.shrunk.winPct;
    const log5 = (pH * (1 - pG)) / (pH * (1 - pG) + pG * (1 - pH));
    const lg = ctx.leagueStats;
    const p = logistic(logit(log5) + logit(lg.homeWinRate));
    const homeMargin = lg.games ? (lg.avgHomeMargin * lg.games) / (lg.games + 10) : 0;
    const margin = (ctx.home.shrunk.avgMargin - ctx.guest.shrunk.avgMargin) / 2 + homeMargin;
    return output(ctx, {
      homeWinProb: p,
      predictedMargin: margin,
      factors: [
        { key: 'winPctHome', label: 'Siegquote Heim (geglättet)', value: round(pH, 3) },
        { key: 'winPctGuest', label: 'Siegquote Gast (geglättet)', value: round(pG, 3) },
        { key: 'homeWinRate', label: 'Heimsiegquote der Liga', value: round(lg.homeWinRate, 3) },
      ],
    });
  },
};
