// Vereinheitlicht API-Objekte in die interne Struktur. Keine Personendaten.
import { berlinToUtcIso, addMinutes } from '../util/time.js';

/** "74:66" → { home: 74, guest: 66 }; alles andere → null */
export function parseResult(result) {
  if (typeof result !== 'string') return null;
  const m = /^\s*(\d{1,3})\s*:\s*(\d{1,3})\s*$/.exec(result);
  if (!m) return null;
  return { home: Number(m[1]), guest: Number(m[2]) };
}

/**
 * Wettbewerbsart. Die API liefert keinen Ligatyp in ligaData; erkannt wird er
 * über Namen (Heuristik, siehe README). regular | cup | preseason | playoff
 */
export function competitionType(liga = {}) {
  const s = `${liga.liganame || ''} ${liga.skName || ''}`.toLowerCase();
  if (/pokal|cup/.test(s)) return 'cup';
  if (/vorbereitung|testspiel|freundschaft/.test(s)) return 'preseason';
  if (/play-?off|playdown|relegation|aufstieg|abstieg|finale|final four|meisterschaft/.test(s)) return 'playoff';
  return 'regular';
}

/** Altersklasse aus ligaData.akName ("Senioren", "U16", …), unbekannt → null */
export function ageGroup(liga = {}) {
  const ak = (liga.akName || '').trim();
  if (/^senioren/i.test(ak)) return 'Senioren';
  const m = /^U\s?(\d{1,2})/i.exec(ak);
  return m ? `U${m[1]}` : null;
}

export function normalizeLeague(ligaData) {
  if (!ligaData) return null;
  return {
    ligaId: ligaData.ligaId,
    name: ligaData.liganame,
    seasonId: ligaData.seasonId,
    seasonName: ligaData.seasonName,
    ageGroup: ageGroup(ligaData),
    gender: ligaData.geschlecht || null,
    level: ligaData.skName || null,
    levelScope: ligaData.skEbeneName || null,
    verbandId: ligaData.verbandId ?? null,
    bezirk: ligaData.bezirkName || null,
    competitionType: competitionType(ligaData),
  };
}

function team(t) {
  if (!t) return null;
  return { id: t.teamPermanentId, name: t.teamname, clubId: t.clubId ?? null, forfeit: Boolean(t.verzicht) };
}

/**
 * Status eines Spiels:
 *  cancelled       abgesagt
 *  forfeit         Verzicht (Spiel- oder Team-Flag); kein sportliches Ergebnis
 *  final           Ergebnis eingetragen (bestätigt oder nicht → Feld confirmed)
 *  missing_result  Spiel sollte vorbei sein, aber kein Ergebnis
 *  scheduled       zukünftig
 */
export function normalizeMatch(m, league, now = new Date().toISOString(), { gameDurationMinutes = 120 } = {}) {
  const home = team(m.homeTeam);
  const guest = team(m.guestTeam);
  const score = parseResult(m.result);
  const timeTbd = !m.kickoffTime || m.kickoffTime === '00:00';
  const kickoffUtc = berlinToUtcIso(m.kickoffDate, timeTbd ? '00:00' : m.kickoffTime);
  const forfeit = Boolean(m.verzicht || home?.forfeit || guest?.forfeit);

  let status;
  if (m.abgesagt) status = 'cancelled';
  else if (forfeit) status = 'forfeit';
  else if (score) status = 'final';
  else if (kickoffUtc && addMinutes(kickoffUtc, timeTbd ? 24 * 60 : gameDurationMinutes) < now) status = 'missing_result';
  else status = 'scheduled';

  return {
    matchId: m.matchId,
    ligaId: league?.ligaId ?? m.ligaData?.ligaId ?? null,
    seasonId: league?.seasonId ?? m.ligaData?.seasonId ?? null,
    matchDay: m.matchDay ?? null,
    kickoffDate: m.kickoffDate || null,
    kickoffTime: timeTbd ? null : m.kickoffTime,
    timeTbd,
    kickoffUtc,
    home,
    guest,
    homeScore: status === 'final' ? score.home : null,
    guestScore: status === 'final' ? score.guest : null,
    confirmed: Boolean(m.ergebnisbestaetigt),
    status,
    forfeitBy: forfeit ? (home?.forfeit ? 'home' : guest?.forfeit ? 'guest' : 'unknown') : null,
    competitionType: league?.competitionType ?? competitionType(m.ligaData || {}),
  };
}

/** Ist das Spiel als sportliches Ergebnis für Ratings/Statistik verwendbar? */
export function isRatable(match, { useUnconfirmedResults = true } = {}) {
  return match.status === 'final' && match.home && match.guest && (useUnconfirmedResults || match.confirmed)
    && match.homeScore !== match.guestScore;
}
