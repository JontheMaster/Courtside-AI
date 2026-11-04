// Model A2 – Statistisches Ratingmodell: regularisierte Margin-Regression
//   margin = hfa + r_home - r_guest
// Der Ridge-Prior zieht Teamstärken zur 0 (Regression zur Mitte). Gegnerstärke und
// gemeinsame Gegner fließen automatisch ein. Siegchance = Phi(margin / sigma).
import { normCdf, round, solveLinear } from '../util/math.js';
import { output } from './common.js';

export const ratingDefaults = {
  lambda: 2, // Ridge-Stärke (Pseudo-Spiele gegen ein Durchschnittsteam)
  hfa0: 3, // Prior Heimvorteil in Punkten
  lambdaHfa: 10,
  marginCap: 40, // Kantersiege begrenzen
  sigma0: 15, // Prior Streuung der Spielergebnisse
  sigmaK: 8, // Pseudo-Spiele für den sigma-Prior
};

export function fitRatings(history, params) {
  const P = { ...ratingDefaults, ...params };
  const teams = [...new Set(history.flatMap((m) => [m.home.id, m.guest.id]))];
  const idx = new Map(teams.map((t, i) => [t, i]));
  const H = teams.length; // Index des Heimvorteils
  const n = H + 1;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  const cap = (x) => Math.max(-P.marginCap, Math.min(P.marginCap, x));
  for (const m of history) {
    const y = cap(m.homeScore - m.guestScore);
    const x = [[idx.get(m.home.id), 1], [idx.get(m.guest.id), -1], [H, 1]];
    for (const [a, va] of x) {
      b[a] += va * y;
      for (const [c, vc] of x) A[a][c] += va * vc;
    }
  }
  for (let t = 0; t < H; t++) A[t][t] += P.lambda;
  A[H][H] += P.lambdaHfa;
  b[H] += P.lambdaHfa * P.hfa0;
  const sol = solveLinear(A, b);
  const r = new Map(teams.map((t, i) => [t, sol[i]]));
  const hfa = sol[H];
  let ssr = 0;
  for (const m of history) {
    const pred = hfa + r.get(m.home.id) - r.get(m.guest.id);
    ssr += (cap(m.homeScore - m.guestScore) - pred) ** 2;
  }
  const sigma = Math.sqrt((ssr + P.sigmaK * P.sigma0 ** 2) / (history.length + P.sigmaK));
  return { r, hfa, sigma };
}

export const ratingModel = {
  id: 'rating',
  name: 'Statistisches Ratingmodell',
  codeVersion: 1,
  defaults: ratingDefaults,
  predict(ctx, params) {
    const P = { ...ratingDefaults, ...params };
    const fit = ctx.history.length ? fitRatings(ctx.history, P) : { r: new Map(), hfa: P.hfa0, sigma: P.sigma0 };
    const rh = fit.r.get(ctx.match.home.id) ?? 0;
    const rg = fit.r.get(ctx.match.guest.id) ?? 0;
    const margin = fit.hfa + rh - rg;
    return output(ctx, {
      homeWinProb: normCdf(margin / fit.sigma),
      predictedMargin: margin,
      factors: [
        { key: 'ratingHome', label: 'Teamstärke Heim (Punkte über Ø)', value: round(rh, 1) },
        { key: 'ratingGuest', label: 'Teamstärke Gast (Punkte über Ø)', value: round(rg, 1) },
        { key: 'hfaPoints', label: 'Heimvorteil (Punkte)', value: round(fit.hfa, 1) },
        { key: 'sigma', label: 'Streuung σ', value: round(fit.sigma, 1) },
      ],
    });
  },
};
