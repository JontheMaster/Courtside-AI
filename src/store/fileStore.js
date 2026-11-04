// Persistenz ohne Datenbank: JSON-Dateien im Repo (data/). Die Git-Historie
// ist das Änderungsprotokoll. Prognosen liegen append-only in NDJSON-Dateien.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { canonicalJson } from '../util/hash.js';

export function createStore(dataDir = config.dataDir) {
  const p = (...parts) => path.join(dataDir, ...parts);

  function readJson(rel, fallback = null) {
    try {
      return JSON.parse(fs.readFileSync(p(rel), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  /** Schreibt nur, wenn sich der Inhalt geändert hat (vermeidet leere Commits). */
  function writeJson(rel, value) {
    const file = p(rel);
    const text = JSON.stringify(value, null, 1) + '\n';
    try {
      if (fs.readFileSync(file, 'utf8') === text) return false;
    } catch {}
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return true;
  }

  function readNdjson(rel) {
    let text;
    try {
      text = fs.readFileSync(p(rel), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  function appendNdjson(rel, records) {
    if (!records.length) return 0;
    const file = p(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, records.map((r) => canonicalJson(r)).join('\n') + '\n');
    return records.length;
  }

  return {
    dataDir,
    readJson,
    writeJson,
    readNdjson,
    appendNdjson,
    leagues: () => readJson('leagues.json', {}),
    saveLeagues: (l) => writeJson('leagues.json', l),
    leagueMatches: (ligaId) => readJson(`matches/${ligaId}.json`, null),
    saveLeagueMatches: (ligaId, v) => writeJson(`matches/${ligaId}.json`, v),
    /** alle gespeicherten Ligen mit ihren Spielen */
    allLeagueData() {
      const leagues = readJson('leagues.json', {});
      return Object.values(leagues)
        .map((league) => ({ league, matches: readJson(`matches/${league.ligaId}.json`, { matches: [] }).matches }));
    },
  };
}
