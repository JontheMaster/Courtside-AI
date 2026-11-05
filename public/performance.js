// Performance-Seite mit interaktiven Diagrammen (SVG, ohne Bibliotheken).
// Modelle ein-/ausblenden, Fadenkreuz mit Werten, Details per Antippen, umschaltbare Balken.

const COLORS = { baseline: 'var(--m-baseline)', elo: 'var(--m-elo)', rating: 'var(--m-rating)', ml: 'var(--m-ml)' };
const color = (id) => COLORS[id] || 'var(--m-llm)';

export async function renderPerformance(app, { load, esc, pct, num, signed, dot, modelName, store }) {
  const perf = await load('performance.json');
  const scopes = { postsv: 'Backtest · Post SV', core: 'Backtest · Post-SV-Ligen', all: 'Backtest · alle Ligen', live: 'Live' };
  let scope = store.get('perfScope', 'all');
  let hidden = new Set(store.get('perfHidden', []));
  let metric = store.get('perfMetric', 'accuracy');
  const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const render = () => {
    const reports = scope === 'live' ? perf.live : perf.backtest?.scopes?.[scope]?.models || {};
    const allIds = Object.keys(reports);
    const ids = allIds.filter((id) => !hidden.has(id));
    const same = scope === 'live' ? null : perf.backtest?.scopes?.[scope]?.sameGamesAsMl;

    app.innerHTML = `
      <h1>Performance</h1>
      <p class="muted">Wie gut tippen die Modelle? <b>Backtest</b> heißt: nachträglich, aber nur mit dem Wissen von damals gerechnet. <b>Live</b> sind die echten, vorher eingefrorenen Tipps. Alle Diagramme reagieren auf Darüberfahren oder Antippen.</p>
      <div class="tabs" role="tablist">${Object.entries(scopes).map(([k, v]) => `<button role="tab" data-s="${k}" class="${k === scope ? 'on' : ''}">${v}</button>`).join('')}</div>
      ${!allIds.length ? '<div class="card empty">Für diese Auswahl gibt es noch keine ausgewerteten Prognosen.</div>' : `
      <div class="legend toggles" role="group" aria-label="Modelle ein- oder ausblenden">
        <span class="muted small">Modelle:</span>
        ${allIds.map((id) => `<button type="button" data-m="${id}" class="${hidden.has(id) ? 'off' : ''}" aria-pressed="${!hidden.has(id)}">${dot(id)}${esc(modelName(id))} <span class="muted">(${reports[id].overall?.n ?? 0})</span></button>`).join('')}
      </div>
      ${reports.ml && scope !== 'live' ? '<p class="muted small">Das ML-Modell tippt erst ab 300 Trainingsspielen, also nicht die ersten Saisonwochen. Fairer Vergleich auf denselben Spielen: siehe Tabelle unten.</p>' : ''}
      <div class="grid two">
        <div class="card"><h3>Trefferquote im Saisonverlauf</h3><p class="muted small">Anteil richtig getippter Sieger, aufsummiert bis zum jeweiligen Spiel. Höher ist besser.</p><div class="chartbox" id="ch-acc"></div></div>
        <div class="card"><h3>Strafpunkte im Saisonverlauf (Brier)</h3><p class="muted small">Durchschnittliche Strafpunkte bis zum jeweiligen Spiel. Niedriger ist besser, Münzwurf = 0,25.</p><div class="chartbox" id="ch-brier"></div></div>
        <div class="card"><h3>Ehrliche Sicherheit? (Kalibrierung)</h3><p class="muted small">Punkte nahe der Linie: Die angegebene Sicherheit stimmt. Darunter: zu selbstsicher. Punkt antippen für Details.</p><div class="chartbox" id="ch-cal"></div><div class="result small" id="ch-cal-info"></div></div>
        <div class="card"><h3>Erwartete vs. tatsächliche Punktedifferenz</h3><p class="muted small">Jeder Punkt ist ein Spiel. Je näher an der Diagonalen, desto genauer der Endstand. Punkt antippen für Details.</p><div class="chartbox" id="ch-sc"></div><div class="result small" id="ch-sc-info"></div></div>
      </div>
      ${same ? sameTable(same) : ''}
      <h2>Aufgeschlüsselt</h2>
      <div class="seg" role="radiogroup" aria-label="Kennzahl">
        <span class="muted small">Zeige:</span>
        <button type="button" data-metric="accuracy" class="${metric === 'accuracy' ? 'on' : ''}">Trefferquote (höher = besser)</button>
        <button type="button" data-metric="brier" class="${metric === 'brier' ? 'on' : ''}">Strafpunkte (niedriger = besser)</button>
      </div>
      <div class="grid two" style="margin-top:.8rem">
        <div class="card"><h3>Nach Anzahl bisheriger Saisonspiele</h3><p class="muted small">Mit mehr Spielen sollten alle Tipper besser werden.</p><div id="br-exp"></div></div>
        <div class="card"><h3>Nach Altersklasse</h3><div id="br-age"></div></div>
      </div>
      <div class="card" style="margin-top:1rem"><h3>Nach Liga</h3><div id="br-liga"></div></div>
      <div class="result small" id="br-info"></div>`}`;

    app.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { scope = b.dataset.s; store.set('perfScope', scope); render(); }));
    app.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.m;
      if (hidden.has(id)) hidden.delete(id);
      else if (allIds.length - hidden.size > 1) hidden.add(id);
      store.set('perfHidden', [...hidden]);
      render();
    }));
    app.querySelectorAll('[data-metric]').forEach((b) => b.addEventListener('click', () => { metric = b.dataset.metric; store.set('perfMetric', metric); render(); }));
    if (!allIds.length) return;

    lineChart(document.getElementById('ch-acc'), ids, reports, 'accuracy', [0.4, 0.85], (v) => pct(v, 1));
    lineChart(document.getElementById('ch-brier'), ids, reports, 'brier', [0.15, 0.3], (v) => num(v, 3));
    calibChart(document.getElementById('ch-cal'), document.getElementById('ch-cal-info'), ids, reports);
    scatterChart(document.getElementById('ch-sc'), document.getElementById('ch-sc-info'), ids, reports);
    const info = document.getElementById('br-info');
    barChart(document.getElementById('br-exp'), info, ids, reports, 'byExperience', 'bucket', (v) => v);
    barChart(document.getElementById('br-age'), info, ids, reports, 'byAgeGroup', 'ageGroup', (v) => v);
    barChart(document.getElementById('br-liga'), info, ids, reports, 'byLeague', 'ligaId', (v) => perf.leagueNames[v] || String(v), 8);
  };

  function sameTable(same) {
    const rows = Object.entries(same).filter(([, m]) => m.n).sort((a, b) => a[1].brier - b[1].brier);
    return `<div class="card" style="margin-top:1rem"><h3>Fairer Vergleich auf denselben Spielen</h3>
      <p class="muted small">Nur die ${rows[0]?.[1].n ?? 0} Spiele, die auch das ML-Modell getippt hat. Sortiert nach Strafpunkten.</p>
      <div class="tablewrap"><table class="small"><thead><tr><th>#</th><th>Modell</th><th class="num">Treffer</th><th class="num">95 %-Bereich</th><th class="num">Strafpunkte</th><th class="num">Ø Abweichung</th></tr></thead><tbody>
      ${rows.map(([id, m], i) => `<tr><td>${i + 1}</td><td>${dot(id)}${esc(modelName(id))}</td><td class="num">${pct(m.accuracy, 1)}</td><td class="num muted">${m.accuracyCI ? `${pct(m.accuracyCI[0])}–${pct(m.accuracyCI[1])}` : '–'}</td><td class="num">${num(m.brier, 3)}</td><td class="num">${num(m.mae)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  // ---------- Diagramme ----------
  function svgPoint(svg, evt) {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return { x: ((evt.clientX - r.left) / r.width) * vb.width, y: ((evt.clientY - r.top) / r.height) * vb.height };
  }

  function placeTip(box, tip, svg, x, y) {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const px = (x / vb.width) * r.width;
    const py = (y / vb.height) * r.height;
    tip.style.display = 'block';
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(r.width - w, px + 12 > r.width - w ? px - w - 12 : px + 12))}px`;
    tip.style.top = `${Math.max(0, py - 10)}px`;
  }

  function lineChart(box, ids, reports, key, [lo0, hi0], fmt) {
    const W = 520, H = 240, L = 44, R = 12, T = 10, B = 28;
    // je Tag nur den Stand nach dem letzten Spiel dieses Tages (vermeidet senkrechte Zacken)
    const perDay = (arr) => [...arr.reduce((m, p) => m.set(p.date, p), new Map()).values()];
    const series = ids.map((id) => ({ id, pts: perDay((reports[id].series || []).filter((p) => p.n >= 10)) })).filter((s) => s.pts.length);
    if (!series.length) { box.innerHTML = '<p class="muted">Keine Daten</p>'; return; }
    const vals = series.flatMap((s) => s.pts.map((p) => p[key]));
    const lo = Math.min(lo0, Math.floor(Math.min(...vals) * 20) / 20);
    const hi = Math.max(hi0, Math.ceil(Math.max(...vals) * 20) / 20);
    const t0 = Math.min(...series.map((s) => Date.parse(s.pts[0].date)));
    const t1 = Math.max(...series.map((s) => Date.parse(s.pts[s.pts.length - 1].date)), t0 + 86400000);
    const sx = (d) => L + ((Date.parse(d) - t0) / (t1 - t0)) * (W - L - R);
    const sy = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
    const months = [];
    for (let d = new Date(t0); d <= new Date(t1); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      if (m.getTime() >= t0) months.push(m);
    }
    box.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf ${key}">
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}" stroke="var(--line)"/><text x="2" y="${sy(t) + 4}">${fmt(t)}</text>`).join('')}
      ${months.map((m) => `<text x="${sx(m.toISOString()) - 10}" y="${H - 8}">${m.toLocaleDateString('de-DE', { month: 'short' })}</text>`).join('')}
      ${series.map((s) => `<polyline fill="none" stroke="${color(s.id)}" stroke-width="2.2" points="${s.pts.map((p) => `${sx(p.date).toFixed(1)},${sy(p[key]).toFixed(1)}`).join(' ')}"/>`).join('')}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--text)" stroke-opacity=".4" style="display:none"/>
      ${series.map((s) => `<circle class="hl" data-id="${s.id}" r="4.5" fill="${color(s.id)}" style="display:none"/>`).join('')}
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" style="cursor:crosshair"/>
    </svg><div class="tip" role="status"></div>`;
    const svg = box.querySelector('svg');
    const tip = box.querySelector('.tip');
    const cross = svg.querySelector('.cross');
    const move = (evt) => {
      const { x } = svgPoint(svg, evt);
      const t = t0 + ((x - L) / (W - L - R)) * (t1 - t0);
      const rows = series.map((s) => {
        let best = s.pts[0];
        for (const p of s.pts) if (Math.abs(Date.parse(p.date) - t) < Math.abs(Date.parse(best.date) - t)) best = p;
        return { id: s.id, p: best };
      });
      const ref = rows[0].p;
      cross.setAttribute('x1', sx(ref.date)); cross.setAttribute('x2', sx(ref.date)); cross.style.display = '';
      for (const r of rows) {
        const c = svg.querySelector(`.hl[data-id="${r.id}"]`);
        c.setAttribute('cx', sx(r.p.date)); c.setAttribute('cy', sy(r.p[key])); c.style.display = '';
      }
      tip.innerHTML = `<b>bis ${dateFmt.format(new Date(ref.date))}</b>${rows.sort((a, b) => (key === 'brier' ? a.p[key] - b.p[key] : b.p[key] - a.p[key])).map((r) => `<div>${dot(r.id)}${esc(modelName(r.id))}: <b>${fmt(r.p[key])}</b> <span class="muted">(${r.p.n} Spiele)</span></div>`).join('')}`;
      placeTip(box, tip, svg, sx(ref.date), sy(ref[key]));
    };
    const leave = () => { tip.style.display = 'none'; cross.style.display = 'none'; svg.querySelectorAll('.hl').forEach((c) => { c.style.display = 'none'; }); };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
  }

  function calibChart(box, infoEl, ids, reports) {
    const S = 320, P = 40;
    const sx = (v) => P + ((v - 0.5) / 0.5) * (S - P - 12);
    const sy = (v) => S - P - v * (S - P - 12);
    const pts = ids.flatMap((id, k) => (reports[id].calibration || []).filter((b) => b.n > 0).map((b) => ({ id, b, dx: (k - (ids.length - 1) / 2) * 5 })));
    box.innerHTML = `<svg class="chart" viewBox="0 0 ${S} ${S}" style="max-width:400px" role="img" aria-label="Kalibrierung">
      <line x1="${sx(0.5)}" y1="${sy(0.5)}" x2="${sx(1)}" y2="${sy(1)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
      <line x1="${P}" x2="${S - 12}" y1="${S - P}" y2="${S - P}" stroke="var(--line)"/><line x1="${P}" x2="${P}" y1="10" y2="${S - P}" stroke="var(--line)"/>
      ${[0.5, 0.75, 1].map((v) => `<text x="${sx(v) - 12}" y="${S - P + 16}">${v * 100}%</text><text x="4" y="${sy(v) + 4}">${v * 100}%</text>`).join('')}
      <text x="${S / 2 - 50}" y="${S - 4}">angegebene Sicherheit</text>
      ${pts.map(({ id, b, dx }, i) => `
        ${b.ci?.[0] != null ? `<line x1="${sx(b.predicted) + dx}" x2="${sx(b.predicted) + dx}" y1="${sy(b.ci[0])}" y2="${sy(b.ci[1])}" stroke="${color(id)}" stroke-opacity=".45" stroke-width="2"/>` : ''}
        <circle data-i="${i}" cx="${sx(b.predicted) + dx}" cy="${sy(b.observed)}" r="${Math.min(12, 4 + Math.sqrt(b.n) / 2.5)}" fill="${color(id)}" fill-opacity=".75" stroke="var(--surface)" tabindex="0" style="cursor:pointer"/>`).join('')}
    </svg>`;
    const show = (i) => {
      const { id, b } = pts[i];
      const d = b.observed - b.predicted;
      infoEl.innerHTML = `${dot(id)}<b>${esc(modelName(id))}</b>, Tipps mit ${b.range} Sicherheit: ${b.n} Spiele. Angegeben im Schnitt ${pct(b.predicted)}, eingetreten ${pct(b.observed)} (Unsicherheitsbereich ${pct(b.ci[0])}–${pct(b.ci[1])}). ${Math.abs(d) < 0.05 ? 'Gut kalibriert.' : d < 0 ? 'Zu selbstsicher.' : 'Eher zu vorsichtig.'}`;
    };
    box.querySelectorAll('circle[data-i]').forEach((c) => {
      const i = Number(c.dataset.i);
      ['click', 'mouseenter', 'focus'].forEach((ev) => c.addEventListener(ev, () => show(i)));
    });
    if (pts.length) show(0);
  }

  function scatterChart(box, infoEl, ids, reports) {
    const W = 520, H = 280, M = 60, P = 30;
    const sx = (v) => P + ((Math.max(-M, Math.min(M, v)) + M) / (2 * M)) * (W - P - 10);
    const sy = (v) => 10 + ((M - Math.max(-M, Math.min(M, v))) / (2 * M)) * (H - P - 10);
    const pts = ids.flatMap((id) => (reports[id].scatter || []).map(([p, a]) => ({ id, p, a })));
    box.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Erwartete gegen tatsächliche Differenz">
      <line x1="${P}" x2="${W - 10}" y1="${sy(0)}" y2="${sy(0)}" stroke="var(--line)"/><line x1="${sx(0)}" x2="${sx(0)}" y1="10" y2="${H - P}" stroke="var(--line)"/>
      <line x1="${sx(-M)}" y1="${sy(-M)}" x2="${sx(M)}" y2="${sy(M)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
      <text x="${W - 120}" y="${H - 8}">erwartet (Heimsicht) →</text><text x="${sx(0) + 4}" y="20">tatsächlich ↑</text>
      <text x="${sx(-M)}" y="${H - 8}">−${M}</text><text x="4" y="${sy(M) + 4}">+${M}</text>
      ${pts.map((q, i) => `<circle data-i="${i}" cx="${sx(q.p).toFixed(1)}" cy="${sy(q.a).toFixed(1)}" r="2.6" fill="${color(q.id)}" fill-opacity=".45"/>`).join('')}
      <circle class="sel" r="6" fill="none" stroke="var(--text)" stroke-width="2" style="display:none"/>
    </svg>`;
    const svg = box.querySelector('svg');
    const sel = svg.querySelector('.sel');
    const pick = (evt) => {
      const { x, y } = svgPoint(svg, evt);
      let best = -1;
      let bd = 144;
      pts.forEach((q, i) => {
        const d = (sx(q.p) - x) ** 2 + (sy(q.a) - y) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) return;
      const q = pts[best];
      sel.setAttribute('cx', sx(q.p)); sel.setAttribute('cy', sy(q.a)); sel.style.display = '';
      const err = Math.abs(q.p - q.a);
      infoEl.innerHTML = `${dot(q.id)}<b>${esc(modelName(q.id))}</b>: erwartet ${signed(q.p, 1)} Punkte für das Heimteam, tatsächlich ${signed(q.a, 0)}. Abweichung ${num(err, 0)} Punkte${(q.p >= 0) !== (q.a > 0) ? ', Sieger falsch getippt' : ''}.`;
    };
    svg.addEventListener('pointermove', pick);
    svg.addEventListener('pointerdown', pick);
    infoEl.textContent = `${pts.length} Spiele. Fahre über die Punkte oder tippe einen an.`;
  }

  function barChart(box, infoEl, ids, reports, key, labelKey, labelFn, maxGroups = 20) {
    const groups = [...new Set(ids.flatMap((id) => (reports[id][key] || []).filter((r) => r.n).map((r) => r[labelKey])))];
    const size = (g) => Math.max(...ids.map((id) => (reports[id][key] || []).find((r) => r[labelKey] === g)?.n || 0));
    const shown = groups.sort((a, b) => size(b) - size(a)).slice(0, maxGroups);
    if (key === 'byExperience') shown.sort();
    if (!shown.length) { box.innerHTML = '<p class="muted">Keine Daten</p>'; return; }
    const isAcc = metric === 'accuracy';
    const domain = isAcc ? [0.3, 0.9] : [0.1, 0.3];
    const fmt = (v) => (isAcc ? pct(v) : num(v, 3));
    box.innerHTML = `<div class="gbars">${shown.map((g) => `
      <div class="grow"><div class="glabel" title="${esc(labelFn(g))}">${esc(labelFn(g))} <span class="muted small">n=${size(g)}</span></div>
        ${ids.map((id) => {
          const r = (reports[id][key] || []).find((x) => x[labelKey] === g);
          if (!r || !r.n) return '';
          const v = r[metric];
          const w = Math.max(2, ((Math.min(domain[1], Math.max(domain[0], v)) - domain[0]) / (domain[1] - domain[0])) * 100);
          return `<button type="button" class="gbar" data-g="${esc(String(g))}" data-id="${id}"><span class="track"><span class="fill" style="width:${w}%;background:${color(id)}"></span></span><span class="val">${fmt(v)}</span></button>`;
        }).join('')}
      </div>`).join('')}</div>
      <p class="muted small">${isAcc ? 'Balken ab 30 %. Längere Balken sind besser.' : 'Balken ab 0,10. Kürzere Balken sind besser.'} ${groups.length > shown.length ? `Die ${shown.length} größten von ${groups.length} Gruppen.` : ''} Balken antippen für Details.</p>`;
    box.querySelectorAll('.gbar').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.id;
      const r = (reports[id][key] || []).find((x) => String(x[labelKey]) === b.dataset.g);
      infoEl.innerHTML = `${dot(id)}<b>${esc(modelName(id))}</b> · ${esc(labelFn(r[labelKey]))}: ${r.n} Spiele, Trefferquote ${pct(r.accuracy, 1)} (${pct(r.accuracyCI[0])}–${pct(r.accuracyCI[1])}), Strafpunkte ${num(r.brier, 3)}, Ø Abweichung ${num(r.mae)} Punkte.${r.reliable ? '' : ' Weniger als 30 Spiele, noch nicht belastbar.'}`;
      infoEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }));
  }

  render();
}
