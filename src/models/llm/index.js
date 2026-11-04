// Model C – Generative KI. Anbieter-neutral: ein Adapter liefert nur complete(system, user) -> Text.
// Aktiv nur, wenn LLM_ENABLED=true und ein API-Key gesetzt ist. Ohne Konfiguration läuft
// die App normal weiter. Aufrufe nur serverseitig (GitHub Actions / lokale CLI).
import { config } from '../../config.js';
import { round } from '../../util/math.js';
import { anthropicAdapter } from './anthropic.js';

export const SYSTEM_PROMPT = `Du bist ein Prognosemodell für Amateur- und Jugendbasketball in Deutschland.
Du erhältst strukturierte Daten zu genau einem kommenden Spiel. Regeln:
- Stütze dich ausschließlich auf die übergebenen Daten. Erfinde keine Statistiken, Spieler, Verletzungen oder sonstigen Informationen.
- Wenn die Datenbasis klein ist (wenige Spiele), bleibe mit der Siegchance nahe an 0.5 bzw. an der Liga-Heimsiegquote und setze confidence auf "low".
- Antworte ausschließlich mit einem JSON-Objekt, ohne Markdown, in genau diesem Format:
{"winner":"HOME"|"GUEST","homeWinProbability":Zahl zwischen 0 und 1,"predictedHomeScore":ganze Zahl,"predictedAwayScore":ganze Zahl,"confidence":"low"|"medium"|"high","reasoning":"max. 3 Sätze auf Deutsch"}`;

/** Kompakte, anonymisierte Eingabe. Teams nur als HOME/GUEST, keine Namen, keine Personendaten. */
export function buildLlmInput(ctx, eloOut, ratingOut) {
  const t = (s) => ({
    games: s.games, wins: s.wins, losses: s.losses,
    pointsPerGame: round(s.ppg, 1), pointsAllowedPerGame: round(s.papg, 1), avgPointDiff: round(s.avgMargin, 1),
    last5: s.form5.join(''), last5AvgPointDiff: round(s.last5AvgMargin, 1), streak: s.streak,
    homeRecord: `${s.homeWins}-${s.homeGames - s.homeWins}`, awayRecord: `${s.awayWins}-${s.awayGames - s.awayWins}`,
    strengthOfSchedule: round(s.sos, 3),
  });
  return {
    ageGroup: ctx.league.ageGroup,
    leagueLevel: ctx.league.level,
    league: { gamesPlayed: ctx.leagueStats.games, homeWinRate: round(ctx.leagueStats.homeWinRate, 3), avgPointsPerTeam: round(ctx.leagueStats.avgPoints, 1) },
    home: { ...t(ctx.home), elo: eloOut?.ratings?.home ?? null, ratingPoints: ratingOut?.factors?.find((f) => f.key === 'ratingHome')?.value ?? null },
    guest: { ...t(ctx.guest), elo: eloOut?.ratings?.guest ?? null, ratingPoints: ratingOut?.factors?.find((f) => f.key === 'ratingGuest')?.value ?? null },
    headToHead: ctx.h2h.map((g) => ({ homeTeamWasHome: g.homeId === ctx.match.home.id, homeScore: g.homeScore, guestScore: g.guestScore })),
    commonOpponents: { count: ctx.common.count, avgPointDiffAdvantageHome: round(ctx.common.avgDiff, 1) },
  };
}

/** Validiert die LLM-Antwort. Wirft bei ungültigem Inhalt. */
export function parseLlmResponse(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('keine JSON-Antwort');
  const j = JSON.parse(text.slice(start, end + 1));
  const p = Number(j.homeWinProbability);
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error('homeWinProbability außerhalb [0,1]');
  if (!['HOME', 'GUEST'].includes(j.winner)) throw new Error('winner ungültig');
  if ((j.winner === 'HOME') !== (p >= 0.5)) throw new Error('winner widerspricht Wahrscheinlichkeit');
  const hs = Number(j.predictedHomeScore);
  const as = Number(j.predictedAwayScore);
  if (![hs, as].every((x) => Number.isInteger(x) && x >= 0 && x <= 200)) throw new Error('Punktzahlen unplausibel');
  if (!['low', 'medium', 'high'].includes(j.confidence)) throw new Error('confidence ungültig');
  return { homeWinProb: p, predictedHomeScore: hs, predictedGuestScore: as, confidence: j.confidence, reasoning: String(j.reasoning || '').slice(0, 600) };
}

const adapters = { anthropic: anthropicAdapter };

export function createLlmModel({ budget = config.llm.maxCallsPerRun } = {}) {
  const enabled = process.env.LLM_ENABLED === 'true' && Boolean(config.llm.apiKey);
  const adapter = adapters[config.llm.provider];
  let calls = 0;
  return {
    id: `llm-${config.llm.provider}`,
    name: `Generative KI (${config.llm.model})`,
    codeVersion: 1,
    defaults: { model: config.llm.model, prompt: 1 },
    live: true, // nur Live-Prognosen, kein Backtest (Kosten)
    status() {
      if (!enabled) return { enabled: false, reason: 'Nicht konfiguriert (LLM_ENABLED und API-Key fehlen). Die übrigen Modelle laufen unabhängig davon.' };
      return { enabled: true, reason: `Max. ${budget} Aufrufe pro Lauf` };
    },
    get enabled() { return enabled; },
    async predictAsync(ctx, { eloOut, ratingOut }) {
      if (!enabled) throw new Error('LLM nicht konfiguriert');
      if (calls >= budget) throw Object.assign(new Error('LLM-Budget für diesen Lauf erschöpft'), { budget: true });
      calls++;
      const input = buildLlmInput(ctx, eloOut, ratingOut);
      const text = await adapter.complete({ system: SYSTEM_PROMPT, user: JSON.stringify(input), model: config.llm.model, apiKey: config.llm.apiKey });
      const r = parseLlmResponse(text);
      const margin = r.predictedHomeScore - r.predictedGuestScore;
      return {
        homeWinProb: round(Math.min(0.99, Math.max(0.01, r.homeWinProb)), 4),
        predictedWinner: r.homeWinProb >= 0.5 ? 'HOME' : 'GUEST',
        predictedMargin: margin,
        predictedHomeScore: r.predictedHomeScore,
        predictedGuestScore: r.predictedGuestScore,
        confidence: r.confidence,
        factors: [{ key: 'reasoning', label: 'Begründung', value: r.reasoning }],
      };
    },
  };
}
