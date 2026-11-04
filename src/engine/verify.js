// Integritätsprüfung der Prognose-Dateien:
// 1. Gegenüber dem letzten Commit darf nur angehängt werden (keine Änderung, keine Löschung).
// 2. Jede Prognose wurde vor ihrer Sperrzeit erstellt (also vor Anpfiff).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function gitShow(root, ref, rel) {
  try {
    return execFileSync('git', ['show', `${ref}:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null; // Datei existierte noch nicht oder kein Git-Repo
  }
}

export function verifyPredictions(root, { ref = 'HEAD' } = {}) {
  const dir = path.join(root, 'data', 'predictions');
  const errors = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson'));
  } catch {}
  // auch Dateien prüfen, die im Commit existieren, lokal aber fehlen (Löschung)
  try {
    const listed = execFileSync('git', ['ls-tree', '--name-only', `${ref}`, 'data/predictions/'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const f of listed.split('\n').filter(Boolean)) {
      const base = path.basename(f);
      if (!files.includes(base)) errors.push(`${base}: Datei wurde gelöscht`);
    }
  } catch {}

  let records = 0;
  for (const f of files) {
    const rel = `data/predictions/${f}`;
    const now = fs.readFileSync(path.join(root, rel), 'utf8');
    const before = gitShow(root, ref, rel);
    if (before != null && !now.startsWith(before)) errors.push(`${f}: bestehende Prognosen wurden verändert`);
    for (const [i, line] of now.split('\n').filter(Boolean).entries()) {
      records++;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        errors.push(`${f}:${i + 1}: kein gültiges JSON`);
        continue;
      }
      if (!(r.createdAt <= r.lockUtc && r.lockUtc <= r.kickoffUtc)) errors.push(`${f}:${i + 1}: Prognose nach Sperrzeit erstellt (Spiel ${r.matchId})`);
      if (!(r.homeWinProb >= 0 && r.homeWinProb <= 1)) errors.push(`${f}:${i + 1}: Wahrscheinlichkeit ungültig`);
    }
  }
  return { ok: errors.length === 0, files: files.length, records, errors };
}
