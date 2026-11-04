// Model A – Elo, ligaindividuell. Ratings werden für jede Prognose aus der
// Historie (nur Spiele vor dem Zielspiel) neu durchgespielt, dadurch reproduzierbar.
import { round } from '../util/math.js';
import { output } from './common.js';

export const eloDefaults = {
  start: 1500,
  // Startwerte nach erster Analyse der Saison 2026/27 (siehe README): Mit wenigen
  // Spielen pro Saison braucht Elo einen hohen K-Faktor, sonst lernt es zu langsam.
  k: 64,
  hfa: 30, // Heimvorteil in Elo-Punkten
  mov: true, // Punktedifferenz berücksichtigen
  eloPerPoint: 12, // Elo-Differenz pro erwartetem Punkt Differenz
  shrinkN0: 0.5, // Pseudo-Spiele: Wahrscheinlichkeit Richtung Liga-Heimquote
};

export function expected(diff) {
  return 1 / (1 + 10 ** (-diff / 400));
}

/** Dämpft die Autokorrelation: Favoritensiege zählen weniger stark. */
export function movMultiplier(margin, winnerEloDiff) {
  return (Math.log(Math.abs(margin) + 1) * 2.2) / (winnerEloDiff * 0.001 + 2.2);
}

/** Spielt die Historie durch. Rückgabe: Ratings, Verlauf je Team. */
export function replay(history, params) {
  const P = { ...eloDefaults, ...params };
  const rating = new Map();
  const trail = new Map();
  const get = (id) => rating.get(id) ?? P.start;
  for (const m of history) {
    const rh = get(m.home.id);
    const rg = get(m.guest.id);
    const diff = rh + P.hfa - rg;
    const e = expected(diff);
    const homeWon = m.homeScore > m.guestScore;
    const margin = m.homeScore - m.guestScore;
    const mult = P.mov ? movMultiplier(margin, homeWon ? diff : -diff) : 1;
    const delta = P.k * mult * ((homeWon ? 1 : 0) - e);
    rating.set(m.home.id, rh + delta);
    rating.set(m.guest.id, rg - delta);
    for (const [id, r] of [[m.home.id, rh + delta], [m.guest.id, rg - delta]]) {
      if (!trail.has(id)) trail.set(id, []);
      trail.get(id).push({ kickoffUtc: m.kickoffUtc, rating: round(r, 1) });
    }
  }
  return { rating, trail, get };
}

export const elo = {
  id: 'elo',
  name: 'Elo',
  codeVersion: 1,
  defaults: eloDefaults,
  predict(ctx, params) {
    const P = { ...eloDefaults, ...params };
    const { get, trail } = replay(ctx.history, P);
    const rh = get(ctx.match.home.id);
    const rg = get(ctx.match.guest.id);
    const diff = rh + P.hfa - rg;
    const raw = expected(diff);
    const w = ctx.minGames / (ctx.minGames + P.shrinkN0);
    const p = w * raw + (1 - w) * ctx.leagueStats.homeWinRate;
    return output(ctx, {
      homeWinProb: p,
      predictedMargin: (diff / P.eloPerPoint) * w,
      factors: [
        { key: 'eloHome', label: 'Elo Heim', value: round(rh, 0) },
        { key: 'eloGuest', label: 'Elo Gast', value: round(rg, 0) },
        { key: 'hfa', label: 'Heimvorteil (Elo)', value: P.hfa },
        { key: 'rawProb', label: 'Elo-Siegchance ungeglättet', value: round(raw, 3) },
        { key: 'shrinkWeight', label: 'Gewicht Elo vs. Liga-Mittel', value: round(w, 2) },
      ],
      extra: {
        ratings: { home: round(rh, 1), guest: round(rg, 1) },
        trails: { home: trail.get(ctx.match.home.id) || [], guest: trail.get(ctx.match.guest.id) || [] },
      },
    });
  },
};
