// Baut den einheitlichen, leakage-freien Eingabekontext für alle Modelle.
// Regel: Für ein Zielspiel zählen nur Ergebnisse von Spielen, deren Anpfiff
// VOR dem Anpfiff des Zielspiels liegt (und vor `asOf`, falls angegeben).
import { config } from '../config.js';
import { isRatable } from '../teamsl/normalizer.js';
import { teamStats, leagueStats, headToHead, commonOpponents } from '../stats/teamStats.js';
import { sha256 } from '../util/hash.js';

/** Sortierte, bewertbare Ligaspiele (regulärer Wettbewerb) – Grundlage der Historie */
export function ratableMatches(matches, opts = config.data) {
  return matches.filter((m) => isRatable(m, opts) && m.kickoffUtc).sort(byKickoff);
}

export function byKickoff(a, b) {
  return a.kickoffUtc < b.kickoffUtc ? -1 : a.kickoffUtc > b.kickoffUtc ? 1 : a.matchId - b.matchId;
}

/** Historie für ein Zielspiel: streng vorher angepfiffen und (optional) vor asOf. */
export function historyBefore(ratable, target, asOf = null) {
  const cutoff = asOf && asOf < target.kickoffUtc ? asOf : target.kickoffUtc;
  return ratable.filter((m) => m.kickoffUtc < cutoff && m.matchId !== target.matchId);
}

/** Datenstand-Hash: identische Historie + identisches Spiel → identischer Hash. */
export function inputHash(target, history, league) {
  return sha256({
    v: 1,
    match: [target.matchId, target.ligaId, target.home.id, target.guest.id, target.kickoffUtc],
    league: league.ligaId,
    history: history.map((m) => [m.matchId, m.home.id, m.guest.id, m.homeScore, m.guestScore, m.kickoffUtc]),
  });
}

export function buildContext({ league, target, history }) {
  const lg = leagueStats(history);
  const home = teamStats(history, target.home.id, { league: lg });
  const guest = teamStats(history, target.guest.id, { league: lg });
  return {
    league,
    match: target,
    history,
    leagueStats: lg,
    home,
    guest,
    h2h: headToHead(history, target.home.id, target.guest.id),
    common: commonOpponents(history, target.home.id, target.guest.id),
    minGames: Math.min(home.games, guest.games),
    inputHash: inputHash(target, history, league),
  };
}
