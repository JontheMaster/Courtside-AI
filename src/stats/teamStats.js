// Team- und Ligastatistiken, ausschließlich aus einer übergebenen Historie
// (= Spiele vor dem Prognosezeitpunkt). Dadurch ist Leakage strukturell ausgeschlossen.
import { mean } from '../util/math.js';

/** Sicht eines Teams auf ein Spiel: { opp, pf, pa, home, win, margin, matchId, kickoffUtc } */
function perspective(m, teamId) {
  const isHome = m.home.id === teamId;
  const pf = isHome ? m.homeScore : m.guestScore;
  const pa = isHome ? m.guestScore : m.homeScore;
  return { matchId: m.matchId, kickoffUtc: m.kickoffUtc, opp: isHome ? m.guest.id : m.home.id, home: isHome, pf, pa, margin: pf - pa, win: pf > pa };
}

export function gamesOf(history, teamId) {
  return history.filter((m) => m.home.id === teamId || m.guest.id === teamId).map((m) => perspective(m, teamId));
}

export function leagueStats(history) {
  const n = history.length;
  const homeWins = history.filter((m) => m.homeScore > m.guestScore).length;
  const pts = history.flatMap((m) => [m.homeScore, m.guestScore]);
  const margins = history.map((m) => m.homeScore - m.guestScore);
  return {
    games: n,
    homeWins,
    // Heimsiegquote mit Prior 0.55 über 10 Pseudo-Spiele (Regression zur Mitte)
    homeWinRate: (homeWins + 0.55 * 10) / (n + 10),
    avgPoints: pts.length ? mean(pts) : null,
    avgHomeMargin: n ? mean(margins) : null,
    avgAbsMargin: n ? mean(margins.map(Math.abs)) : null,
  };
}

function streak(games) {
  if (!games.length) return 0;
  const last = games[games.length - 1].win;
  let s = 0;
  for (let i = games.length - 1; i >= 0 && games[i].win === last; i--) s++;
  return last ? s : -s;
}

function basic(games) {
  const n = games.length;
  const wins = games.filter((g) => g.win).length;
  return {
    games: n,
    wins,
    losses: n - wins,
    winPct: n ? wins / n : null,
    ppg: n ? mean(games.map((g) => g.pf)) : null,
    papg: n ? mean(games.map((g) => g.pa)) : null,
    avgMargin: n ? mean(games.map((g) => g.margin)) : null,
  };
}

export function dataQuality(n) {
  return n >= 6 ? 'high' : n >= 3 ? 'medium' : 'low';
}

/**
 * Vollständige Statistik eines Teams zur Historie.
 * shrinkN0: Pseudo-Spiele auf Liga-Mittel (Regression zur Mitte bei kleinen n).
 */
export function teamStats(history, teamId, { shrinkN0 = 3, league = leagueStats(history) } = {}) {
  const games = gamesOf(history, teamId);
  const b = basic(games);
  const last5 = games.slice(-5);
  const avgPts = league.avgPoints ?? 60;

  // Gegnerstärke: Siegquote der Gegner in ihren Spielen gegen andere Teams
  const oppWinPcts = games.map((g) => {
    const og = gamesOf(history, g.opp).filter((x) => x.opp !== teamId);
    return og.length ? og.filter((x) => x.win).length / og.length : 0.5;
  });

  const w = b.games / (b.games + shrinkN0);
  return {
    teamId,
    ...b,
    homeGames: games.filter((g) => g.home).length,
    homeWins: games.filter((g) => g.home && g.win).length,
    awayGames: games.filter((g) => !g.home).length,
    awayWins: games.filter((g) => !g.home && g.win).length,
    form3: games.slice(-3).map((g) => (g.win ? 'W' : 'L')),
    form5: last5.map((g) => (g.win ? 'W' : 'L')),
    last5AvgMargin: last5.length ? mean(last5.map((g) => g.margin)) : null,
    streak: streak(games),
    sos: oppWinPcts.length ? mean(oppWinPcts) : null,
    // geshrinkte Werte für Modelle
    shrunk: {
      winPct: (b.wins + 0.5 * shrinkN0) / (b.games + shrinkN0),
      ppg: b.games ? w * b.ppg + (1 - w) * avgPts : avgPts,
      papg: b.games ? w * b.papg + (1 - w) * avgPts : avgPts,
      avgMargin: b.games ? w * b.avgMargin : 0,
      weight: w,
    },
    dataQuality: dataQuality(b.games),
    marginsByGame: games.map((g) => ({ matchId: g.matchId, kickoffUtc: g.kickoffUtc, opp: g.opp, home: g.home, margin: g.margin })),
  };
}

export function headToHead(history, homeId, guestId) {
  return history
    .filter((m) => (m.home.id === homeId && m.guest.id === guestId) || (m.home.id === guestId && m.guest.id === homeId))
    .map((m) => ({ matchId: m.matchId, kickoffUtc: m.kickoffUtc, homeId: m.home.id, homeScore: m.homeScore, guestScore: m.guestScore }));
}

/** Ergebnisse gegen gemeinsame Gegner: Ø-Differenz beider Teams je Gegner */
export function commonOpponents(history, aId, bId) {
  const ga = gamesOf(history, aId);
  const gb = gamesOf(history, bId);
  const opps = new Set(ga.map((g) => g.opp).filter((o) => o !== bId && gb.some((x) => x.opp === o)));
  const rows = [...opps].map((o) => {
    const ma = mean(ga.filter((g) => g.opp === o).map((g) => g.margin));
    const mb = mean(gb.filter((g) => g.opp === o).map((g) => g.margin));
    return { opp: o, marginA: ma, marginB: mb, diff: ma - mb };
  });
  return { count: rows.length, avgDiff: rows.length ? mean(rows.map((r) => r.diff)) : null, rows };
}
