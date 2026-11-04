// Anstoßzeiten liefert die API als lokale deutsche Zeit (Europe/Berlin) ohne Zone.
const TZ = 'Europe/Berlin';
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Offset von Europe/Berlin gegenüber UTC zum Zeitpunkt `ms`, in Minuten.
function offsetMinutes(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - ms) / 60000);
}

/** "2026-09-26", "11:00" → ISO-UTC-String. Ungültige Eingaben → null. */
export function berlinToUtcIso(date, time = '00:00') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  const t = /^(\d{1,2}):(\d{2})$/.exec(time || '00:00');
  if (!m || !t) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  // zweimal iterieren, damit Sommer-/Winterzeitwechsel korrekt landen
  let guess = naive - offsetMinutes(naive) * 60000;
  guess = naive - offsetMinutes(guess) * 60000;
  return new Date(guess).toISOString();
}

export function addMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString();
}

export function nowIso() {
  return process.env.COURTSIDE_NOW || new Date().toISOString();
}
