import { createHash } from 'node:crypto';

/** JSON mit sortierten Schlüsseln, damit Hashes reproduzierbar sind. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256(value) {
  const text = typeof value === 'string' ? value : canonicalJson(value);
  return createHash('sha256').update(text).digest('hex');
}

export const shortHash = (value, n = 12) => sha256(value).slice(0, n);
