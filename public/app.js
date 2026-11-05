import { renderMethodik } from './methodik.js';
// COURTSIDE AI – Oberfläche (statisch, ohne Framework). Liest die vom Build erzeugten JSON-Dateien.
const app = document.getElementById('app');
const cache = new Map();
const load = (p) => {
  if (!cache.has(p)) cache.set(p, fetch(`data/${p}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${p}: HTTP ${r.status}`)))));
  return cache.get(p);
};

const MODEL_COLORS = { baseline: 'var(--m-baseline)', elo: 'var(--m-elo)', rating: 'var(--m-rating)', ml: 'var(--m-ml)' };
const color = (id) => MODEL_COLORS[id] || (id.startsWith('llm') ? 'var(--m-llm)' : 'var(--muted)');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const de = (x, d) => Number(x).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (p, d = 0) => (p == null ? '–' : `${de(p * 100, d)} %`);
const num = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : de(x, d));
const signed = (x, d = 1) => (x == null ? '–' : `${x > 0 ? '+' : ''}${de(x, d)}`);
const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' });
const dtFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '–');
const fmtDT = (iso) => (iso ? dtFmt.format(new Date(iso)) : '–');
const QUALITY = { low: 'geringe Datenbasis', medium: 'mittlere Datenbasis', high: 'solide Datenbasis' };
const CONF = { low: 'unsicher', medium: 'mittel', high: 'sicher' };
const STATUS = { cancelled: 'abgesagt', forfeit: 'Verzicht', missing_result: 'Ergebnis fehlt', scheduled: 'geplant', final: 'Endstand' };

let META = null;
const modelName = (id) => META?.models.find((m) => m.id === id)?.name || id;
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(`cs:${k}`)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`cs:${k}`, JSON.stringify(v)); } catch {} },
};

function form(list) {
  return `<span class="form">${(list || []).map((r) => `<i class="${r}" title="${r === 'W' ? 'Sieg' : 'Niederlage'}">${r === 'W' ? 'S' : 'N'}</i>`).join('') || '<span class="muted">–</span>'}</span>`;
}
function probbar(p, label = 'Heimsieg') {
  return `<div class="probbar" role="img" aria-label="${label} ${pct(p)}"><i class="h" style="width:${p * 100}%"></i><i class="g" style="width:${(1 - p) * 100}%"></i></div>`;
}

// Sicht des Post SV: Modelle rechnen intern mit P(Heimsieg); angezeigt wird Sieg/Niederlage für den Verein.
function clubView(side, p) {
  const win = side === 'home' ? p.p : 1 - p.p;
  const [own, opp] = side === 'home' ? [p.home, p.guest] : [p.guest, p.home];
  return {
    winProb: win,
    tip: win >= 0.5 ? 'Sieg' : 'Niederlage',
    tipProb: win >= 0.5 ? win : 1 - win,
    score: `${own}:${opp}`,
    margin: p.margin == null ? null : side === 'home' ? p.margin : -p.margin,
  };
}
function clubResult(g) {
  if (g.status !== 'final') return null;
  const [own, opp] = g.clubSide === 'home' ? [g.homeScore, g.guestScore] : [g.guestScore, g.homeScore];
  return { win: own > opp, label: own > opp ? 'Sieg' : 'Niederlage', score: `${own}:${opp}` };
}
const tipBadge = (v) => `<b class="${v.tip === 'Sieg' ? 'tip-win' : 'tip-loss'}">${v.tip}</b>`;
const dot = (id) => `<span class="dot" style="background:${color(id)}"></span>`;

// ---------- Dashboard ----------
async function dashboard() {
  const [games, champ] = await Promise.all([load('games.json'), load('championship.json')]);
  const now = new Date().toISOString();
  const f = store.get('filters', { liga: '', team: '', day: '', season: '', model: 'rating' });
  const enabled = META.models.filter((m) => m.enabled);
  if (!enabled.some((m) => m.id === f.model)) f.model = enabled[0]?.id;

  const leader = champ.champion
    ? { id: champ.champion.modelId, label: 'Live-Champion', sub: `${champ.champion.n} ausgewertete Spiele${champ.champion.reliable ? '' : ' · noch nicht belastbar'}` }
    : champ.backtestPostSv[0] ? { id: champ.backtestPostSv[0].modelId, label: 'Führend im Backtest', sub: `Post-SV-Spiele, n=${champ.backtestPostSv[0].n}; noch keine Live-Auswertung` } : null;

  const seasons = [...new Set(games.map((g) => g.seasonName))];
  const days = [...new Set(games.map((g) => g.matchDay).filter((d) => d != null))].sort((a, b) => a - b);
  const filtered = games.filter((g) => (!f.liga || String(g.ligaId) === f.liga)
    && (!f.team || String(g[g.clubSide].id) === f.team)
    && (!f.day || String(g.matchDay) === f.day)
    && (!f.season || g.seasonName === f.season));
  const upcoming = filtered.filter((g) => g.kickoffUtc > now && g.status === 'scheduled');
  const past = filtered.filter((g) => g.kickoffUtc <= now && ['final', 'missing_result', 'forfeit', 'cancelled'].includes(g.status)).reverse().slice(0, 30);
  const withPred = upcoming.filter((g) => g.predictions[f.model]);

  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  app.innerHTML = `
    <h1>Spiele des ${esc(META.club.name)}</h1>
    <p class="muted">Prognosen für die nächsten Spiele ab U14. Mehrere Modelle tippen unabhängig voneinander. Bewertet wird nur die Prognose, die ${META.lockMinutes / 60} h vor Anpfiff feststand.</p>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Anstehend mit Prognose</div><div class="value">${withPred.length}</div><div class="sub">von ${upcoming.length} kommenden Spielen</div></div>
      <div class="card kpi"><div class="label">Aktive Modelle</div><div class="value">${enabled.length}</div><div class="sub">${META.models.filter((m) => !m.enabled).length} vorbereitet, inaktiv</div></div>
      <div class="card kpi"><div class="label">${leader ? esc(leader.label) : 'Champion'}</div><div class="value">${leader ? `${dot(leader.id)}${esc(modelName(leader.id))}` : '–'}</div><div class="sub">${leader ? esc(leader.sub) : 'noch keine Auswertung'}</div></div>
      <div class="card kpi"><div class="label">Datenbasis</div><div class="value">${META.counts.trainingGames}</div><div class="sub">gewertete Spiele in ${META.counts.leagues} Ligen</div></div>
    </div>
    <div class="filters">
      <select data-f="liga" aria-label="Liga">${opt('', 'Alle Ligen', f.liga)}${META.leagues.map((l) => opt(l.ligaId, `${l.name}${l.competitionType === 'cup' ? ' (Pokal)' : ''}`, f.liga)).join('')}</select>
      <select data-f="team" aria-label="Mannschaft">${opt('', 'Alle Mannschaften', f.team)}${META.teams.map((t) => opt(t.id, `${t.name} · ${t.ageGroup}`, f.team)).join('')}</select>
      <select data-f="day" aria-label="Spieltag">${opt('', 'Alle Spieltage', f.day)}${days.map((d) => opt(d, `Spieltag ${d}`, f.day)).join('')}</select>
      <select data-f="season" aria-label="Saison">${opt('', 'Alle Saisons', f.season)}${seasons.map((s) => opt(s, s, f.season)).join('')}</select>
      <select data-f="model" aria-label="Modell">${enabled.map((m) => opt(m.id, `Modell: ${m.name}`, f.model)).join('')}</select>
    </div>
    <h2>Anstehende Spiele</h2>
    <div class="games">${upcoming.length ? upcoming.slice(0, 60).map((g) => gameRow(g, f.model)).join('') : '<div class="card empty">Keine anstehenden Spiele für diese Auswahl.</div>'}</div>
    ${upcoming.length > 60 ? `<p class="muted small">${upcoming.length - 60} weitere Spiele ausgeblendet. Prognosen gibt es nur für die nächsten 14 Tage.</p>` : ''}
    <h2>Letzte Ergebnisse</h2>
    <div class="games">${past.length ? past.map((g) => gameRow(g, f.model)).join('') : '<div class="card empty">Noch keine Ergebnisse.</div>'}</div>`;
  app.querySelectorAll('select[data-f]').forEach((s) => s.addEventListener('change', () => {
    f[s.dataset.f] = s.value;
    store.set('filters', f);
    dashboard();
  }));
}

function gameRow(g, modelId) {
  const p = g.predictions[modelId];
  const done = g.status === 'final';
  const clubIsHome = g.clubSide === 'home';
  let pred;
  if (!['scheduled', 'final'].includes(g.status)) pred = `<span class="badge">${STATUS[g.status]}</span>`;
  else if (!p) pred = `<span class="muted small">${done ? 'keine Live-Prognose vor Anpfiff' : g.ratingLeague ? 'Prognose ab 14 Tage vor dem Spiel' : 'keine vergleichbare Datenbasis'}</span>`;
  else {
    const hit = done ? (p.p >= 0.5) === (g.homeScore > g.guestScore) : null;
    const v = clubView(g.clubSide, p);
    pred = `<div class="row"><span>${dot(modelId)}Tipp: ${tipBadge(v)} ${pct(v.tipProb)}</span><span class="muted" title="Post SV zuerst">${v.score}</span></div>${probbar(v.winProb, 'Siegchance Post SV')}
      <div class="row"><span class="badge ${p.confidence}">${CONF[p.confidence]}</span>${hit == null ? '' : `<span class="badge ${hit ? 'hit' : 'miss'}">${hit ? 'Treffer' : 'daneben'}</span>`}</div>`;
  }
  const res = clubResult(g);
  if (res) pred = `<div class="row" style="margin-bottom:.3rem"><span>Ergebnis: <b class="${res.win ? 'tip-win' : 'tip-loss'}">${res.label}</b></span><span>${res.score}</span></div>${pred}`;
  const score = (side) => (done ? `<b>${side === 'home' ? g.homeScore : g.guestScore}</b>` : '');
  return `<a class="game" href="#/match/${g.matchId}">
    <div class="when"><b>${fmtDate(g.kickoffUtc)}</b>${g.kickoffTime ? `${g.kickoffTime} Uhr` : 'Uhrzeit offen'}</div>
    <div class="teams">
      <div class="t ${clubIsHome ? 'club' : ''}"><span>${esc(g.home.name)}</span>${score('home')}</div>
      <div class="t ${clubIsHome ? '' : 'club'}"><span>${esc(g.guest.name)}</span>${score('guest')}</div>
      <div class="meta">${esc(g.ageGroup)} · ${esc(g.league)}${g.matchDay ? ` · ST ${g.matchDay}` : ''}${done && !g.confirmed ? ' · Ergebnis unbestätigt' : ''}</div>
    </div>
    <div class="pred">${pred}</div>
  </a>`;
}

// ---------- Spieldetail ----------
async function matchPage(id) {
  let d;
  try {
    d = await load(`match/${id}.json`);
  } catch {
    app.innerHTML = '<div class="card empty">Spiel nicht gefunden. Angezeigt werden nur Spiele des Post SV Nürnberg ab U14.</div>';
    return;
  }
  const done = d.status === 'final';
  const preds = Object.entries(d.predictions);
  const s = d.stats;
  const statRow = (label, a, b) => `<tr><td>${a}</td><td>${label}</td><td>${b}</td></tr>`;
  app.innerHTML = `
    <p><a href="#/" class="muted small">← Alle Spiele</a></p>
    <div class="card">
      <div class="muted small">${esc(d.ageGroup)} · ${esc(d.league)}${d.matchDay ? ` · Spieltag ${d.matchDay}` : ''} · ${fmtDate(d.kickoffUtc)} ${d.kickoffTime ? `${d.kickoffTime} Uhr` : '(Uhrzeit offen)'}</div>
      <div class="vs" style="margin-top:.75rem">
        <div><div class="name">${esc(d.home.name)}</div><div class="muted small">Heim</div></div>
        <div class="score">${done ? `${d.homeScore}:${d.guestScore}` : 'vs'}</div>
        <div><div class="name">${esc(d.guest.name)}</div><div class="muted small">Gast</div></div>
      </div>
      ${d.status !== 'scheduled' && d.status !== 'final' ? `<p class="note">Status: ${STATUS[d.status]}${d.forfeitBy ? ` (${d.forfeitBy === 'home' ? 'Heim' : d.forfeitBy === 'guest' ? 'Gast' : 'unbekannt'})` : ''}. Wird nicht als sportliches Ergebnis gewertet.</p>` : ''}
      ${clubResult(d) ? `<p style="text-align:center;margin:.6rem 0 0">Post SV: <b class="${clubResult(d).win ? 'tip-win' : 'tip-loss'}">${clubResult(d).label}</b> ${clubResult(d).score}</p>` : ''}
      ${done && !d.confirmed ? '<p class="muted small">Ergebnis eingetragen, aber noch nicht bestätigt.</p>' : ''}
    </div>
    ${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}

    <h2>Modellvergleich ${done ? '(finale Prognosen vor Anpfiff)' : '(aktueller Stand)'}</h2>
    ${preds.length ? `<div class="card tablewrap"><table>
      <thead><tr><th>Modell</th><th>Tipp Post SV</th><th class="num">Siegchance Post SV</th><th class="num">Endstand (Post SV zuerst)</th><th class="num">Differenz</th><th>Sicherheit</th><th>Erstellt</th></tr></thead>
      <tbody>${preds.map(([mid, p]) => {
        const v = clubView(d.clubSide, p);
        const hit = (p.p >= 0.5) === (d.homeScore > d.guestScore);
        return `<tr>
        <td>${dot(mid)}${esc(modelName(mid))}<div class="muted small">v${esc(p.version)}</div></td>
        <td>${tipBadge(v)}${done ? ` <span class="badge ${hit ? 'hit' : 'miss'}">${hit ? 'Treffer' : 'daneben'}</span>` : ''}</td>
        <td class="num">${pct(v.winProb)}${probbar(v.winProb, 'Siegchance Post SV')}</td><td class="num">${v.score}</td><td class="num">${signed(v.margin)}</td>
        <td><span class="badge ${p.confidence}">${CONF[p.confidence]}</span></td><td class="small muted">${fmtDT(p.createdAt)}</td></tr>`;
      }).join('')}</tbody></table></div>`
      : `<div class="card empty">${done ? 'Für dieses Spiel gab es vor Anpfiff keine Live-Prognose (das System lief damals noch nicht oder das Spiel lag außerhalb des Zeitfensters).' : 'Noch keine Prognose. Prognosen entstehen ab 14 Tage vor dem Spiel.'}</div>`}
    ${d.backtest ? `<p class="muted small" style="margin-top:.6rem">Backtest (nachträglich gerechnet, nur mit Ergebnissen vor dem Spiel): ${Object.entries(d.backtest).map(([mid, p]) => { const v = clubView(d.clubSide, p); return `${dot(mid)}${esc(modelName(mid))} ${v.tip} ${pct(v.tipProb)} (${v.score})`; }).join(' · ')}</p>` : ''}

    ${s ? `
    <h2>Teamvergleich</h2>
    <p class="muted small">Stand: alle gewerteten Spiele der Liga ${d.asOf ? `bis ${fmtDate(d.asOf)}` : '(noch keine)'}${done ? ', vor Anpfiff dieses Spiels' : ''}. Datenbasis: Heim ${QUALITY[s.home.dataQuality]}, Gast ${QUALITY[s.guest.dataQuality]}.</p>
    <div class="card tablewrap"><table class="statgrid"><tbody>
      ${statRow('Bilanz', `${s.home.wins}–${s.home.losses}`, `${s.guest.wins}–${s.guest.losses}`)}
      ${statRow('Siegquote', pct(s.home.winPct), pct(s.guest.winPct))}
      ${statRow('Punkte / Spiel', num(s.home.ppg), num(s.guest.ppg))}
      ${statRow('Gegenpunkte / Spiel', num(s.home.papg), num(s.guest.papg))}
      ${statRow('Ø Korbdifferenz', signed(s.home.avgMargin), signed(s.guest.avgMargin))}
      ${statRow('Form (letzte 5)', form(s.home.form5), form(s.guest.form5))}
      ${statRow('Ø Differenz letzte 5', signed(s.home.last5AvgMargin), signed(s.guest.last5AvgMargin))}
      ${statRow('Serie', streakText(s.home.streak), streakText(s.guest.streak))}
      ${statRow('Heim / Auswärts', `${s.home.homeRecord.join('–')} / ${s.home.awayRecord.join('–')}`, `${s.guest.homeRecord.join('–')} / ${s.guest.awayRecord.join('–')}`)}
      ${statRow('Gegnerstärke (Ø Siegquote der Gegner)', pct(s.home.sos), pct(s.guest.sos))}
      ${statRow('Elo-Rating', num(d.elo?.home, 0), num(d.elo?.guest, 0))}
    </tbody></table></div>

    <div class="grid two" style="margin-top:1rem">
      <div class="card"><h3>Elo-Verlauf</h3>${eloChart(d.eloTrails, d.home.name, d.guest.name)}</div>
      <div class="card"><h3>Direkte Vergleiche &amp; gemeinsame Gegner</h3>
        ${d.h2h.length ? `<p>${d.h2h.map((h) => `${fmtDate(h.kickoffUtc)}: ${h.homeId === d.home.id ? esc(d.home.name) : esc(d.guest.name)} (Heim) ${h.homeScore}:${h.guestScore}`).join('<br>')}</p>` : '<p class="muted">Diese Saison noch kein direktes Duell.</p>'}
        ${d.common.count ? `<table><thead><tr><th>Gegner</th><th class="num">Heim</th><th class="num">Gast</th></tr></thead><tbody>
          ${d.common.rows.map((r) => `<tr><td>${esc(r.oppName)}</td><td class="num">${signed(r.marginA)}</td><td class="num">${signed(r.marginB)}</td></tr>`).join('')}
          </tbody></table><p class="muted small">Ø Vorteil Heimteam gegen gemeinsame Gegner: ${signed(d.common.avgDiff)} Punkte</p>` : '<p class="muted">Keine gemeinsamen Gegner.</p>'}
      </div>
    </div>` : ''}

    ${preds.length ? `<h2>Was die Modelle sehen</h2>
    <div class="grid two">${preds.map(([mid, p]) => `<div class="card"><h3>${dot(mid)}${esc(modelName(mid))}</h3><table><tbody>
      ${(p.factors || []).map((fct) => `<tr><td>${esc(fct.label)}</td><td class="num">${esc(typeof fct.value === 'number' ? fct.value : fct.value)}</td></tr>`).join('')}</tbody></table></div>`).join('')}</div>` : ''}`;
}

const streakText = (s) => (!s ? '–' : s > 0 ? `${s} Siege` : `${-s} Niederl.`);

function eloChart(trails, homeName, guestName) {
  const series = [['home', homeName, 'var(--accent)'], ['guest', guestName, 'var(--m-elo)']].filter(([k]) => trails?.[k]?.length);
  if (!series.length) return '<p class="muted">Noch keine gewerteten Spiele.</p>';
  const pts = series.flatMap(([k]) => trails[k]);
  const xs = pts.map((p) => Date.parse(p.kickoffUtc));
  const ys = pts.map((p) => p.rating).concat([1500]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 86400000);
  const y0 = Math.min(...ys) - 10;
  const y1 = Math.max(...ys) + 10;
  const W = 460, H = 200, L = 40, B = 22;
  const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - 10);
  const sy = (y) => 10 + (1 - (y - y0) / (y1 - y0)) * (H - 10 - B);
  const lines = series.map(([k, , c]) => {
    const d = [[x0, 1500], ...trails[k].map((p) => [Date.parse(p.kickoffUtc), p.rating])];
    return `<polyline fill="none" stroke="${c}" stroke-width="2" points="${d.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')}"/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Elo-Verlauf beider Teams">
    <line x1="${L}" x2="${W - 10}" y1="${sy(1500)}" y2="${sy(1500)}" stroke="var(--line)" stroke-dasharray="4 4"/>
    <text x="4" y="${sy(1500) + 4}">1500</text><text x="4" y="${sy(y1 - 10) + 4}">${Math.round(y1 - 10)}</text><text x="4" y="${sy(y0 + 10) + 4}">${Math.round(y0 + 10)}</text>
    ${lines}</svg>
    <div class="legend">${series.map(([, n, c]) => `<span><span class="dot" style="background:${c}"></span>${esc(n)}</span>`).join('')}</div>`;
}

// ---------- Championship ----------
async function championshipPage() {
  const c = await load('championship.json');
  const table = (rows, empty) => (rows.length ? `<div class="card tablewrap"><table>
    <thead><tr><th class="num">Rang</th><th>Modell</th><th class="num">Spiele</th><th class="num">Accuracy</th><th class="num">95 %-Intervall</th><th class="num">Brier ↓</th><th class="num">Log Loss ↓</th><th class="num">MAE Diff. ↓</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td class="num">${r.rank}</td><td>${dot(r.modelId)}${esc(modelName(r.modelId))}</td><td class="num">${r.n}</td>
      <td class="num">${pct(r.accuracy, 1)}</td><td class="num small muted">${r.accuracyCI ? `${pct(r.accuracyCI[0])} – ${pct(r.accuracyCI[1])}` : '–'}</td>
      <td class="num">${num(r.brier, 3)}</td><td class="num">${num(r.logLoss, 3)}</td><td class="num">${num(r.mae)}</td></tr>`).join('')}</tbody></table>
      ${rows.some((r) => !r.reliable) ? '<p class="muted small">Weniger als 30 Spiele: statistisch noch nicht belastbar. Die Intervalle zeigen, wie groß die Unsicherheit ist.</p>' : ''}</div>`
    : `<div class="card empty">${empty}</div>`);
  app.innerHTML = `
    <h1>Model Championship</h1>
    <p class="muted">Rangfolge nach Brier Score (mittlere quadratische Abweichung der Siegchance, kleiner ist besser). Die Accuracy zählt nur, ob der Sieger stimmt. Der Brier Score bewertet auch, ob die Sicherheit angemessen war.</p>
    <h2>Live-Saison: Post-SV-Spiele</h2>
    <p class="muted small">Nur Prognosen, die vor der Sperrzeit gespeichert und danach nicht mehr verändert wurden.</p>
    ${table(c.live, 'Noch keine ausgewerteten Live-Prognosen. Sobald die ersten prognostizierten Spiele gespielt und eingetragen sind, entsteht hier die Rangliste.')}
    <h2>Backtest: Post-SV-Spiele dieser Saison</h2>
    <p class="muted small">Nachträglich, aber ohne Zukunftswissen gerechnet (Walk-Forward). Stand ${fmtDT(c.backtestCreatedAt)}.</p>
    ${table(c.backtestPostSv, 'Noch kein Backtest.')}
    <h2>Backtest: alle Spiele der erfassten Ligen</h2>
    <p class="muted small">Größere Stichprobe aus den Post-SV-Ligen und weiteren Ligen ab U14 der Gegnervereine.</p>
    ${table(c.backtestAll, 'Noch kein Backtest.')}`;
}

// ---------- Performance ----------
async function performancePage() {
  const perf = await load('performance.json');
  const scopes = { postsv: 'Backtest · Post SV', core: 'Backtest · Post-SV-Ligen', all: 'Backtest · alle Ligen', live: 'Live' };
  let scope = store.get('perfScope', 'all');
  const render = () => {
    const reports = scope === 'live' ? perf.live : perf.backtest?.scopes?.[scope]?.models || {};
    const ids = Object.keys(reports);
    app.innerHTML = `
      <h1>Performance</h1>
      <div class="tabs" role="tablist">${Object.entries(scopes).map(([k, v]) => `<button role="tab" data-s="${k}" class="${k === scope ? 'on' : ''}">${v}</button>`).join('')}</div>
      ${!ids.length ? '<div class="card empty">Für diese Auswahl gibt es noch keine ausgewerteten Prognosen.</div>' : `
      <div class="legend" style="margin-bottom:1rem">${ids.map((id) => `<span>${dot(id)}${esc(modelName(id))}</span>`).join('')}</div>
      <div class="grid two">
        <div class="card"><h3>Trefferquote über die Saison (kumuliert)</h3>${lineChart(ids, reports, 'accuracy', [0.3, 1])}</div>
        <div class="card"><h3>Brier Score über die Saison (kumuliert, ↓)</h3>${lineChart(ids, reports, 'brier', [0, 0.35])}</div>
        <div class="card"><h3>Kalibrierung</h3>${calibChart(ids, reports)}<p class="muted small">Ideal liegt auf der Diagonalen: Bei 70 % angegebener Chance gewinnt der Favorit in 70 % der Fälle.</p></div>
        <div class="card"><h3>Prognostizierte vs. tatsächliche Differenz</h3>${scatter(ids, reports)}</div>
      </div>
      <h2>Nach Anzahl bisheriger Saisonspiele</h2>
      ${breakdown(ids, reports, 'byExperience', 'bucket')}
      <h2>Nach Altersklasse</h2>
      ${breakdown(ids, reports, 'byAgeGroup', 'ageGroup')}
      <h2>Nach Liga</h2>
      ${breakdown(ids, reports, 'byLeague', 'ligaId', (v) => perf.leagueNames[v] || v)}`}`;
    app.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
      scope = b.dataset.s;
      store.set('perfScope', scope);
      render();
    }));
  };
  render();
}

function lineChart(ids, reports, key, [lo, hi]) {
  const W = 460, H = 220, L = 34, B = 22;
  const all = ids.flatMap((id) => reports[id].series || []);
  if (!all.length) return '<p class="muted">Keine Daten</p>';
  const maxN = Math.max(...all.map((p) => p.n));
  const sx = (n) => L + ((n - 1) / Math.max(1, maxN - 1)) * (W - L - 10);
  const sy = (y) => 8 + (1 - (Math.min(hi, Math.max(lo, y)) - lo) / (hi - lo)) * (H - 8 - B);
  const ticks = [lo, (lo + hi) / 2, hi];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - 10}" y1="${sy(t)}" y2="${sy(t)}" stroke="var(--line)"/><text x="2" y="${sy(t) + 4}">${key === 'accuracy' ? Math.round(t * 100) + '%' : t.toFixed(2)}</text>`).join('')}
    ${ids.map((id) => {
      const s = (reports[id].series || []).filter((p) => p.n >= 10); // die ersten Werte schwanken zu stark
      return `<polyline fill="none" stroke="${color(id)}" stroke-width="2" points="${s.map((p) => `${sx(p.n).toFixed(1)},${sy(p[key]).toFixed(1)}`).join(' ')}"/>`;
    }).join('')}
    <text x="${L}" y="${H - 4}">Spiel 10</text><text x="${W - 60}" y="${H - 4}">Spiel ${maxN}</text></svg>`;
}

function calibChart(ids, reports) {
  const S = 240, P = 30;
  const s = (v) => P + ((v - 0.5) / 0.5) * (S - P - 10);
  const y = (v) => S - P - v * (S - P - 10) + 0;
  return `<svg class="chart" viewBox="0 0 ${S} ${S}" style="max-width:320px" role="img">
    <line x1="${s(0.5)}" y1="${y(0.5)}" x2="${s(1)}" y2="${y(1)}" stroke="var(--line)" stroke-dasharray="4 4"/>
    <line x1="${P}" x2="${S - 10}" y1="${S - P}" y2="${S - P}" stroke="var(--line)"/><line x1="${P}" x2="${P}" y1="10" y2="${S - P}" stroke="var(--line)"/>
    <text x="${P - 4}" y="${S - 12}">50%</text><text x="${S - 36}" y="${S - 12}">100%</text><text x="2" y="${y(1) + 4}">100%</text><text x="2" y="${y(0.5) + 4}">50%</text>
    <text x="${S / 2 - 30}" y="${S - 1}">angegeben</text>
    ${ids.map((id) => (reports[id].calibration || []).filter((b) => b.n > 0).map((b) => `<circle cx="${s(b.predicted)}" cy="${y(b.observed)}" r="${Math.min(10, 3 + Math.sqrt(b.n) / 2)}" fill="${color(id)}" fill-opacity=".55"><title>${esc(modelName(id))} ${b.range}: angegeben ${pct(b.predicted)}, eingetreten ${pct(b.observed)} (n=${b.n})</title></circle>`).join('')).join('')}
  </svg>`;
}

function scatter(ids, reports) {
  const W = 460, H = 240, M = 60;
  const sx = (v) => W / 2 + (Math.max(-M, Math.min(M, v)) / M) * (W / 2 - 14);
  const sy = (v) => H / 2 - (Math.max(-M, Math.min(M, v)) / M) * (H / 2 - 14);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)"/><line x1="${W / 2}" x2="${W / 2}" y1="0" y2="${H}" stroke="var(--line)"/>
    <line x1="${sx(-M)}" y1="${sy(-M)}" x2="${sx(M)}" y2="${sy(M)}" stroke="var(--line)" stroke-dasharray="4 4"/>
    <text x="${W - 70}" y="${H / 2 - 4}">Prognose →</text><text x="${W / 2 + 4}" y="12">tatsächlich ↑</text>
    ${ids.map((id) => (reports[id].scatter || []).map(([p, a]) => `<circle cx="${sx(p).toFixed(1)}" cy="${sy(a).toFixed(1)}" r="2.2" fill="${color(id)}" fill-opacity=".4"/>`).join('')).join('')}
  </svg><p class="muted small">Heimsicht, auf ±${M} Punkte begrenzt.</p>`;
}

function breakdown(ids, reports, key, labelKey, labelFn = (v) => v) {
  const labels = [...new Set(ids.flatMap((id) => (reports[id][key] || []).map((r) => r[labelKey])))];
  if (!labels.length) return '<div class="card empty">Keine Daten</div>';
  return `<div class="card tablewrap"><table><thead><tr><th>Gruppe</th>${ids.map((id) => `<th class="num">${dot(id)}${esc(modelName(id))}</th>`).join('')}</tr></thead>
    <tbody>${labels.map((l) => `<tr><td>${esc(labelFn(l))}</td>${ids.map((id) => {
      const r = (reports[id][key] || []).find((x) => x[labelKey] === l);
      return `<td class="num">${r && r.n ? `${pct(r.accuracy)} · ${num(r.brier, 3)}<div class="muted small">n=${r.n}</div>` : '–'}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table><p class="muted small">Je Zelle: Accuracy · Brier Score</p></div>`;
}

// ---------- Methodik (eigene Datei) ----------
async function aboutPage() {
  await renderMethodik(app, { META, load, esc, pct, num, signed, dot, modelName });
}

// ---------- Router ----------
async function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [, page, id] = h.split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', (a.dataset.nav === 'dashboard' && (!page || page === 'match')) || a.dataset.nav === page));
  try {
    if (!META) META = await load('meta.json');
    document.getElementById('stamp').textContent = `Stand: ${fmtDT(META.generatedAt)}`;
    if (page === 'match' && id) await matchPage(id);
    else if (page === 'championship') await championshipPage();
    else if (page === 'performance') await performancePage();
    else if (page === 'about') await aboutPage();
    else await dashboard();
    window.scrollTo(0, 0);
  } catch (err) {
    app.innerHTML = `<div class="card empty">Daten konnten nicht geladen werden (${esc(err.message)}). Lokal zuerst <code>npm run build</code> ausführen.</div>`;
  }
}
window.addEventListener('hashchange', route);
route();
