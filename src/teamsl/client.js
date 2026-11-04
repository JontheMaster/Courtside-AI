// Lesender Zugriff auf die inoffizielle TeamSL-REST-API von basketball-bund.net.
// Nur nachweislich existierende Endpunkte (siehe README, Abschnitt API).
import { config } from '../config.js';
import { logger } from '../util/log.js';

const log = logger('teamsl');
const cache = new Map(); // key → { at, data }

export class TeamSLError extends Error {
  constructor(message, { path, status, httpStatus } = {}) {
    super(message);
    this.name = 'TeamSLError';
    Object.assign(this, { path, status, httpStatus });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET auf einen REST-Pfad. Prüft die gemeinsame Antwort-Hülle: Erfolg ist nur
 * `status === "0"`. Auch HTTP 200 kann `status: "-1"` oder `"1"` (z. B. "no
 * competition found") enthalten.
 */
export async function api(path, { cacheMinutes = 0, fetchImpl = fetch } = {}) {
  const hit = cache.get(path);
  if (cacheMinutes > 0 && hit && Date.now() - hit.at < cacheMinutes * 60000) return hit.data;

  let lastErr;
  for (let attempt = 0; attempt <= config.api.retries; attempt++) {
    try {
      const res = await fetchImpl(config.api.baseUrl + path, {
        headers: { 'User-Agent': config.api.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(config.api.timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) throw new TeamSLError(`HTTP ${res.status}`, { path, httpStatus: res.status });
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new TeamSLError('Antwort ist kein JSON', { path, httpStatus: res.status });
      }
      if (body.status !== '0') {
        // fachlicher Fehler, kein Retry
        const err = new TeamSLError(body.message || `status ${body.status}`, { path, status: body.status });
        err.fatal = true;
        throw err;
      }
      cache.set(path, { at: Date.now(), data: body.data });
      return body.data;
    } catch (err) {
      lastErr = err;
      if (err.fatal) break;
      if (attempt < config.api.retries) {
        log.warn(`${path} fehlgeschlagen (${err.message}), Versuch ${attempt + 2}`);
        await sleep(500 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

const C = config.api.cacheMinutes;
export const getClubMatches = (clubId, rangeDays = 150) =>
  api(`/club/id/${clubId}/actualmatches?justHome=false&rangeDays=${rangeDays}`, { cacheMinutes: C.actualmatches });
export const getSpielplan = (ligaId) => api(`/competition/spielplan/id/${ligaId}`, { cacheMinutes: C.spielplan });
export const getTable = (ligaId) => api(`/competition/table/id/${ligaId}`, { cacheMinutes: C.table });

export function clearCache() {
  cache.clear();
}
