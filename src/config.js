// Zentrale Konfiguration. Alles, was später per Backtesting optimiert oder
// betrieblich angepasst werden soll, steht hier und nicht verstreut im Code.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function envInt(name, fallback) {
  const v = process.env[name];
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  root,
  dataDir: path.join(root, 'data'),
  siteDir: path.join(root, 'public'),

  api: {
    baseUrl: 'https://www.basketball-bund.net/rest',
    userAgent: 'CourtsideAI/0.1 (+https://github.com; read-only)',
    concurrency: 6, // laut bisheriger Doku ca. 6 parallele Abfragen
    timeoutMs: 20000,
    retries: 2,
    // Cache-Intervalle in Minuten (In-Memory pro Prozess; persistente Daten liegen in data/)
    cacheMinutes: { spielplan: 10, table: 10, actualmatches: 15 },
  },

  club: { id: 1476, name: 'Post SV Nürnberg' },

  // Nur Altersklassen ab U14. Minis (U12, U10, U8) bleiben komplett außen vor.
  ageGroups: ['U14', 'U16', 'U18', 'U20', 'Senioren'],

  // Zusätzliche Trainingsligen: Ligen ab U14 der Gegnervereine im selben Verband.
  trainingLeagues: { enabled: true, verbandIds: [2], maxClubs: 120 },

  data: {
    // ergebnisbestaetigt ist bei vielen gespielten Spielen noch false. Ohne
    // unbestätigte Ergebnisse wäre die Datenbasis etwa halbiert.
    useUnconfirmedResults: true,
  },

  predictions: {
    // Prognosen sind ab lockMinutes vor Anpfiff eingefroren (finale Prognose).
    lockMinutes: 120,
    // Nur Spiele in diesem Zeitfenster werden prognostiziert (hält das Prognose-Log klein).
    horizonDays: 14,
    // Spiel gilt als "vorbei" nach dieser Zeit ab Anpfiff (für missing_result).
    gameDurationMinutes: 120,
  },

  evaluation: {
    minGamesReliable: 30, // darunter: "statistisch nicht belastbar"
    bootstrapSamples: 1000,
  },

  ml: { minTrainGames: 1000 },

  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    maxCallsPerRun: envInt('LLM_MAX_CALLS_PER_RUN', 20),
  },
};
