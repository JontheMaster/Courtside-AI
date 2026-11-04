import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store/fileStore.js';

let counter = 0;
/** Synthetisches, bereits normalisiertes Spiel */
export function game({ id, home, guest, hs = null, gs = null, day, status, clubHome = null, clubGuest = null, time = '18:00' }) {
  const kickoffUtc = new Date(Date.UTC(2026, 8, 1 + day, 16, 0)).toISOString();
  return {
    matchId: id ?? ++counter, ligaId: 1, seasonId: 2026, matchDay: day, kickoffDate: kickoffUtc.slice(0, 10), kickoffTime: time, timeTbd: false, kickoffUtc,
    home: { id: home, name: `T${home}`, clubId: clubHome ?? home * 10, forfeit: false },
    guest: { id: guest, name: `T${guest}`, clubId: clubGuest ?? guest * 10, forfeit: false },
    homeScore: hs, guestScore: gs, confirmed: false,
    status: status ?? (hs == null ? 'scheduled' : 'final'), forfeitBy: null, competitionType: 'regular',
  };
}

export const league = (over = {}) => ({ ligaId: 1, name: 'Testliga', seasonId: 2026, seasonName: '2026/2027', ageGroup: 'U16', competitionType: 'regular', role: 'core', ...over });

/** Rundenturnier mit festen Stärken, deterministische Ergebnisse */
export function roundRobin(strengths, { rounds = 2, noise = (i) => ((i * 7919) % 11) - 5 } = {}) {
  const ids = Object.keys(strengths).map(Number);
  const out = [];
  let day = 0;
  let i = 0;
  for (let r = 0; r < rounds; r++) {
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      day++;
      const margin = strengths[a] - strengths[b] + 3 + noise(i++);
      const hs = 60 + Math.max(1, Math.ceil(margin / 2));
      const gs = hs - (margin === 0 ? 1 : margin);
      out.push(game({ id: 1000 + day, home: a, guest: b, hs, gs: gs === hs ? gs - 1 : gs, day }));
    }
  }
  return out;
}

export function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courtside-'));
  return { dir, store: createStore(dir) };
}
