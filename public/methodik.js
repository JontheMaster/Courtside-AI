// Methodik-Seite: einfache Erklärungen mit interaktiven Rechnern.
// Jede Erklärung hat zwei Ebenen: "Kurz erklärt" für alle und aufklappbare Details mit Formeln.
// Die Rechner verwenden dieselben Formeln und Parameter wie die echten Modelle.

const REPO = 'https://github.com/JontheMaster/Courtside-AI';
const logit = (p) => Math.log(p / (1 - p));
const logistic = (x) => 1 / (1 + Math.exp(-x));
function normCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
const normPdf = (x, mu, s) => Math.exp(-0.5 * ((x - mu) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));

export async function renderMethodik(app, { META, load, esc, pct, num, signed, dot, modelName }) {
  let champ = null;
  let perf = null;
  try { [champ, perf] = await Promise.all([load('championship.json'), load('performance.json')]); } catch {}
  const models = Object.fromEntries(META.models.map((x) => [x.id, x]));
  const eloP = models.elo?.params?.Senioren || { k: 64, hfa: 30, eloPerPoint: 12, shrinkN0: 0.5 };
  const rtP = models.rating?.params?.Senioren || { sigma0: 15, hfa0: 3 };
  const bt = champ?.backtestAll || [];
  const lock = META.lockMinutes / 60;

  const slider = (id, label, min, max, step, value) => `
    <label class="ctl"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><output id="${id}-v"></output></label>`;
  const toggle = (id, label, checked) => `<label class="ctl ctl-check"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
  const details = (title, body) => `<details class="tech"><summary>${title}</summary><div>${body}</div></details>`;
  const mlStatus = models.ml?.mlStatus;
  const mlBlock = () => {
    if (!mlStatus) return '<p class="muted">Das Modell wurde noch nicht im Backtest geprüft.</p>';
    const same = mlStatus.sameGames || {};
    const order = Object.entries(same).filter(([, m]) => m.n).sort((a, b) => a[1].brier - b[1].brier);
    return `
      <p>Status: ${mlStatus.activeLive ? '<span class="badge high">tippt live mit</span>' : '<span class="badge">tippt noch nicht live</span>'} ${esc(mlStatus.reason)}</p>
      <p><b>Was hat der Lernende herausgefunden?</b> Die Balken zeigen, welche Hinweise er am meisten nutzt. Tippe auf einen Balken für eine Erklärung.</p>
      <div class="widget"><div class="bars" id="ml-imp"></div><div class="result small" id="ml-imp-info"></div></div>
      ${order.length ? `<p><b>Fairer Vergleich</b> auf denselben ${order[0][1].n} Spielen, die das ML-Modell im Backtest getippt hat:</p>
      <div class="tablewrap"><table class="small"><thead><tr><th>Tipper</th><th class="num">Treffer</th><th class="num">Strafpunkte (Brier)</th><th class="num">Ø Abweichung Punkte</th></tr></thead><tbody>
        ${order.map(([id, m]) => `<tr><td>${dot(id)}${esc(modelName(id))}</td><td class="num">${pct(m.accuracy, 1)}</td><td class="num">${num(m.brier, 3)}</td><td class="num">${num(m.mae)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}`;
  };

  app.innerHTML = `
    <h1>Methodik</h1>
    <p class="lead">Wie kommt eine Prognose zustande, und woher weiß man, ob sie etwas taugt? Diese Seite erklärt es Schritt für Schritt. Vorwissen braucht man dafür nicht. An den <b>Reglern</b> kannst du selbst ausprobieren, wie die Modelle rechnen. Wer es genauer wissen will, klappt die Abschnitte <b>„Für Technikinteressierte“</b> auf.</p>

    <nav class="toc card" aria-label="Inhalt">
      ${[['idee', 'Die Idee'], ['daten', 'Daten'], ['ablauf', 'Ablauf'], ['baseline', 'Tipper 1: Siegquote'], ['elo', 'Tipper 2: Elo'], ['rating', 'Tipper 3: Ratingmodell'], ['ki', 'Tipper 4: ML'], ['llm', 'KI'], ['wenig', 'Wenig Daten'], ['vertrauen', 'Fälschungssicher'], ['bewertung', 'Bewertung'], ['backtest', 'Backtest'], ['grenzen', 'Grenzen'], ['glossar', 'Glossar']]
        .map(([id, t]) => `<button type="button" data-goto="${id}">${t}</button>`).join('')}
    </nav>

    <section id="idee"><h2>Die Idee in drei Sätzen</h2>
    <div class="card prose">
      <p>Vor jedem Spiel des ${esc(META.club.name)} geben mehrere Computer-„Tipper“ unabhängig voneinander einen Tipp ab: <b>Sieg oder Niederlage, wie sicher, welcher Endstand</b>. Jeder Tipp wird gespeichert, bevor das Spiel beginnt, und lässt sich danach nicht mehr ändern. Nach dem Spiel wird verglichen, und über die Saison zeigt sich, welcher Tipper am besten liegt. Das ist die <b>Model Championship</b>.</p>
      <p class="muted small">Ein Tipp wie „Sieg 70 %“ heißt nicht „sicher gewonnen“. Er heißt: Von zehn solchen Spielen gewinnt man ungefähr sieben. Drei Niederlagen sind dabei ganz normal.</p>
    </div></section>

    <section id="daten"><h2>Woher kommen die Daten?</h2>
    <div class="card prose">
      <p><b>Kurz erklärt:</b> Alle Ergebnisse stammen von <b>basketball-bund.net</b>, wo die Vereine ihre Spielpläne und Endstände eintragen. Ein Programm holt sie jede Stunde automatisch ab. Mehr als die Ergebnisse kennen die Tipper nicht: keine Spieler, keine Aufstellungen, keine Verletzungen.</p>
      <ul>
        <li><b>Post-SV-Teams:</b> alle Mannschaften ab U14 (${META.ageGroups.join(', ')}) in ${META.counts.coreLeagues} Ligen. Minis (U12 und jünger) sind ausgeschlossen, dort wird anders gespielt.</li>
        <li><b>Zum Lernen:</b> zusätzlich Ligen anderer Vereine aus Bayern, gegen die der Post SV spielt. Insgesamt ${META.counts.leagues} Ligen mit ${META.counts.trainingGames} gewerteten Spielen.</li>
        <li><b>Jede Liga für sich:</b> Ein Team wird nur mit Teams aus derselben Liga verglichen. „Stark“ heißt immer: stark in dieser Liga.</li>
      </ul>
      ${details('Für Technikinteressierte: Sonderfälle', `
        <table class="small"><thead><tr><th>Fall</th><th>Behandlung</th></tr></thead><tbody>
          <tr><td>Ergebnis eingetragen, aber nicht bestätigt</td><td>wird verwendet und markiert. Viele Ergebnisse werden spät oder nie bestätigt, ohne sie fehlte etwa die Hälfte der Daten.</td></tr>
          <tr><td>Spiel abgesagt</td><td>zählt nicht</td></tr>
          <tr><td>Verzicht / Team zurückgezogen</td><td>kein sportliches Ergebnis, zählt nicht, wird nicht prognostiziert</td></tr>
          <tr><td>Spiel vorbei, kein Ergebnis eingetragen</td><td>„Ergebnis fehlt“, zählt nicht</td></tr>
          <tr><td>Pokalspiel</td><td>fließt nicht in die Ligastärken ein. Eine Prognose gibt es nur, wenn beide Teams in derselben Liga spielen.</td></tr>
          <tr><td>Uhrzeit fehlt</td><td>gilt als 0:00 Uhr des Spieltags</td></tr>
          <tr><td>Verlegung</td><td>wird bei jedem Abruf erkannt und protokolliert. Die Schnittstelle selbst kennt keine Verlegungshistorie.</td></tr>
        </tbody></table>
        <p>Schnittstelle: <code>/competition/spielplan/id/{ligaId}</code> und <code>/club/id/{clubId}/actualmatches</code>. Ältere Saisons sind darüber nicht abrufbar, das Projekt archiviert deshalb ab jetzt selbst. Personennamen (<code>matchInfo</code>) werden nie abgerufen.</p>`)}
    </div></section>

    <section id="ablauf"><h2>Wie entsteht ein Tipp?</h2>
    <div class="card prose">
      <ol class="steps">
        <li><b>Spiel auswählen:</b> jedes Post-SV-Spiel der nächsten 14 Tage.</li>
        <li><b>Nur die Vergangenheit anschauen:</b> Gezählt werden nur Spiele der Liga, die <b>vor</b> diesem Spiel stattgefunden haben. Spätere Ergebnisse oder die aktuelle Tabelle sind tabu, sonst wäre es Schummeln.</li>
        <li><b>Zahlen sammeln:</b> Bilanz, Punkte pro Spiel, Gegenpunkte, Form der letzten Spiele, Heim- und Auswärtsbilanz, Stärke der bisherigen Gegner, direkte Duelle, gemeinsame Gegner.</li>
        <li><b>Jeder Tipper rechnet für sich</b> und gibt Siegchance und Endstand ab.</li>
        <li><b>Speichern und einfrieren:</b> Kommen neue Ergebnisse dazu, wird der Tipp aktualisiert. Die alte Version bleibt aber gespeichert. ${lock} Stunden vor Anpfiff ist Schluss, dann zählt der letzte Tipp.</li>
      </ol>
      ${details('Für Technikinteressierte: Endstand und Input-Hash', `
        <p>Intern rechnen alle Modelle mit P(Heimsieg). Auf der Seite wird das in die Sicht des Post SV umgerechnet (Sieg/Niederlage). Der Endstand entsteht so: erwartete Punkte = Ø(eigene Punkte pro Spiel, Gegenpunkte des Gegners pro Spiel), beide mit Regression zur Mitte. Die Summe wird dann so aufgeteilt, dass die Differenz zur Modellerwartung passt.</p>
        <p>Jeder Tipp speichert einen <b>Input-Hash</b>, einen Fingerabdruck aller verwendeten Ergebnisse. Gleicher Hash und gleiche Modellversion bedeuten: kein neuer Eintrag.</p>`)}
    </div></section>

    <h2>Die Tipper im Wettbewerb</h2>
    <p class="muted">Jeder Tipper hat eine andere Denkweise. Die Rechner unten benutzen dieselben Formeln wie die echten Modelle.</p>

    <section id="baseline"><h3 class="mh">${dot('baseline')}Tipper 1: „Wer oft gewinnt, gewinnt wieder“ (Baseline)</h3>
    <div class="card prose">
      <p><b>Kurz erklärt:</b> Der einfachste Tipper schaut nur auf die bisherige Siegquote beider Teams und gibt dem Heimteam einen kleinen Bonus. Er ist der <b>Maßstab</b>: Ein schlaues Modell muss ihn schlagen, sonst ist es nicht schlau.</p>
      <div class="widget">
        <div class="controls">
          ${slider('b-own', 'Siegquote Post SV', 0, 100, 5, 70)}
          ${slider('b-opp', 'Siegquote Gegner', 0, 100, 5, 40)}
          ${toggle('b-home', 'Post SV spielt zu Hause', true)}
        </div>
        <div class="result" id="b-out"></div>
      </div>
      ${details('Für Technikinteressierte: Formel', `
        <p class="formula">geglättete Siegquote q = (Siege + 1,5) / (Spiele + 3)</p>
        <p class="formula">log5 = q₁·(1 − q₂) / [q₁·(1 − q₂) + q₂·(1 − q₁)]</p>
        <p class="formula">P(Heimsieg) = logistic( logit(log5) + logit(Heimsiegquote der Liga) )</p>
        <p>log5 ist eine klassische Formel aus dem Baseball (Bill James), die aus zwei Siegquoten eine Siegchance im direkten Duell macht. Im Rechner gilt eine Liga-Heimsiegquote von 55 %.</p>`)}
    </div></section>

    <section id="elo"><h3 class="mh">${dot('elo')}Tipper 2: Das Punktekonto (Elo)</h3>
    <div class="card prose">
      <p><b>Kurz erklärt:</b> Jedes Team hat ein Punktekonto, am Saisonstart 1500 Punkte. Nach jedem Spiel gibt der Verlierer Punkte an den Gewinner ab. Gewinnt ein Außenseiter, wandern viele Punkte. Gewinnt der Favorit, nur wenige. Ein hoher Sieg bringt etwas mehr als ein knapper. Das System kommt aus dem Schach.</p>
      <p>Vor dem Spiel gilt: <b>Je größer der Punkteabstand, desto größer die Siegchance.</b> Probier es aus:</p>
      <div class="widget">
        <div class="controls">
          ${slider('e-own', 'Elo Post SV', 1200, 1800, 10, 1550)}
          ${slider('e-opp', 'Elo Gegner', 1200, 1800, 10, 1500)}
          ${toggle('e-home', `Post SV spielt zu Hause (+${eloP.hfa} Punkte Heimbonus)`, true)}
        </div>
        <div class="result" id="e-out"></div>
        <div id="e-chart"></div>
      </div>
      <p><b>Und nach dem Spiel?</b> Stell ein, wie es ausgeht:</p>
      <div class="widget">
        <div class="controls">${slider('e-res', 'Ergebnis aus Sicht Post SV (Punktedifferenz)', -40, 40, 1, 10)}</div>
        <div class="result" id="e-upd"></div>
      </div>
      ${details('Für Technikinteressierte: Formeln und Parameter', `
        <p class="formula">Erwartung E = 1 / (1 + 10^(−(Elo_Heim + Heimvorteil − Elo_Gast) / 400))</p>
        <p class="formula">Änderung = K · ln(|Differenz| + 1) · 2,2 / (0,001 · Elo-Vorsprung des Siegers + 2,2) · (Ergebnis − E)</p>
        <p class="formula">erwartete Punktedifferenz = (Elo_Heim + Heimvorteil − Elo_Gast) / Elo-Punkte pro Korbpunkt</p>
        <p>Der Faktor mit dem Logarithmus dämpft Kantersiege, die in der Jugend häufig sind. Der Bruch verhindert, dass Favoriten durch hohe Siege immer weiter davonziehen. Bei wenigen Spielen wird die Siegchance zusätzlich zur Heimsiegquote der Liga gezogen (siehe „Wenig Daten“).</p>
        ${paramTable(models.elo, [['k', 'K-Faktor (Lerngeschwindigkeit)'], ['hfa', 'Heimvorteil (Elo-Punkte)'], ['eloPerPoint', 'Elo-Punkte pro Korbpunkt'], ['shrinkN0', 'Glättung (Pseudo-Spiele)']], esc)}`)}
    </div></section>

    <section id="rating"><h3 class="mh">${dot('rating')}Tipper 3: Der große Vergleicher (Ratingmodell)</h3>
    <div class="card prose">
      <p><b>Kurz erklärt:</b> Dieser Tipper gibt jedem Team eine <b>Stärke in Punkten</b>, zum Beispiel „+6“, also 6 Punkte besser als ein Durchschnittsteam der Liga. Die Stärken werden so gewählt, dass sie <b>alle bisherigen Ergebnisse gemeinsam</b> möglichst gut erklären. Hat Team A gegen B knapp gewonnen und B gegen C hoch, dann weiß er auch etwas über A gegen C, obwohl die beiden noch nie gespielt haben.</p>
      <p>Aus den Stärken folgt der erwartete Punkteabstand. Basketball ist aber kein Uhrwerk: Das echte Ergebnis streut um diese Erwartung. Die Kurve zeigt, wie wahrscheinlich welches Ergebnis ist. <span class="tip-win">Grün</span> sind die Ausgänge, bei denen der Post SV gewinnt.</p>
      <div class="widget">
        <div class="controls">
          ${slider('r-own', 'Stärke Post SV (Punkte über Ø)', -20, 20, 1, 6)}
          ${slider('r-opp', 'Stärke Gegner (Punkte über Ø)', -20, 20, 1, -4)}
          ${slider('r-sig', 'Streuung: wie zufällig sind Ergebnisse?', 6, 25, 1, Math.round(rtP.sigma0))}
          ${toggle('r-home', 'Post SV spielt zu Hause (+2 Punkte)', true)}
        </div>
        <div class="result" id="r-out"></div>
        <div id="r-chart"></div>
      </div>
      ${details('Für Technikinteressierte: Formeln und Parameter', `
        <p class="formula">Differenz_Spiel ≈ Heimvorteil + Stärke_Heim − Stärke_Gast</p>
        <p class="formula">minimiere Σ (tatsächliche − erklärte Differenz)² + λ · Σ Stärke²</p>
        <p class="formula">P(Heimsieg) = Φ(erwartete Differenz / σ)</p>
        <p>Das ist eine Ridge-Regression, ähnlich dem „Simple Rating System“ aus dem US-Sport. Der Strafterm λ zieht Stärken zur 0, so bekommen Teams mit wenigen Spielen vorsichtige Werte. Differenzen über ±40 werden gekappt. Heimvorteil und σ (die Standardabweichung der Ergebnisse) werden aus den Ligaspielen geschätzt. Φ ist die Verteilungsfunktion der Normalverteilung, im Diagramm die grüne Fläche.</p>
        ${paramTable(models.rating, [['lambda', 'λ Regularisierung'], ['hfa0', 'Startwert Heimvorteil (Punkte)'], ['marginCap', 'Kappung der Differenz'], ['sigma0', 'Startwert Streuung σ']], esc)}`)}
    </div></section>

    <section id="ki"><h3 class="mh">${dot('ml')}Tipper 4: Der Lernende (Machine Learning)</h3>
    <div class="card prose">
      <p><b>Kurz erklärt:</b> Die ersten drei Tipper folgen festen Regeln, die sich ein Mensch ausgedacht hat. Der vierte bekommt keine Regeln, sondern <b>Beispiele</b>: über tausend vergangene Spiele, jeweils mit allen Zahlen von vorher und dem tatsächlichen Ausgang. Daraus sucht er selbst, welche Zahlen wirklich etwas über den Ausgang verraten und wie man sie kombiniert. Auch die Tipps der anderen drei Tipper gehören zu seinen Hinweisen, er kann also lernen, wann welcher von ihnen recht hat.</p>
      <p>Technisch ist es ein <b>Gradient Boosting</b>: viele kleine Ja/Nein-Entscheidungsbäume („Ist die Form der letzten fünf Spiele besser als +5 Punkte?“), die nacheinander jeweils die Fehler der bisherigen korrigieren.</p>
      ${mlBlock()}
      ${details('Für Technikinteressierte: Training und Aktivierung', `
        <ul>
          <li><b>Zeitliche Trennung:</b> Im Backtest wird jede Woche neu trainiert, und zwar nur mit Spielen vor Wochenbeginn. Live wird mit allen bisher gespielten Spielen trainiert. Eine zufällige Aufteilung in Trainings- und Testdaten würde Zukunftswissen einschleusen.</li>
          <li><b>Mindestmenge:</b> Getippt wird erst ab 300 Trainingsspielen. Die frühen Saisonspiele tippt das ML-Modell deshalb nicht, und Vergleiche laufen fair nur auf denselben Spielen.</li>
          <li><b>Merkmale (${'26'}):</b> Elo- und Ratingmodell-Ausgaben, Siegquote, Korbdifferenz, Angriff/Verteidigung, Form, Serie, Gegnerstärke, gemeinsame Gegner, direkte Duelle, Anzahl Spiele, Liga-Kennzahlen, Altersklasse.</li>
          <li><b>Modell:</b> Newton-Boosting mit Histogramm-Splits, 150 Bäume der Tiefe 2, Lernrate 0,05, min. 30 Spiele je Blatt, L2-Regularisierung 5. Ein zweites Modell schätzt die Punktedifferenz. Deterministisch, ohne Zufall, also reproduzierbar. Eine logistische Regression lief zum Vergleich mit und war knapp schlechter.</li>
          <li><b>Live-Freigabe:</b> Das Modell tippt nur mit, wenn es im Backtest auf denselben Spielen einen niedrigeren Brier Score als die Baseline hat, bei mindestens 30 Spielen. Das wird bei jedem Lauf neu geprüft.</li>
        </ul>`)}
    </div></section>

    <section id="llm"><h3 class="mh">${dot('llm-anthropic')}Bald dabei: Generative KI</h3>
    <div class="card prose">
      <p>Ein Sprachmodell (Claude) bekommt später dieselben Zahlen, ohne Teamnamen, und muss einen Tipp mit kurzer Begründung im festen Format abgeben. Erfinden darf es nichts. Ob ein „schreibendes“ Modell beim Rechnen mithalten kann, ist eine der spannendsten Fragen des Projekts.</p>
      <table class="small"><tbody>${META.models.map((x) => `<tr><td>${dot(x.id)}${esc(x.name)}</td><td>${x.enabled ? '<span class="badge high">aktiv</span>' : '<span class="badge">inaktiv</span>'}</td><td class="muted">${esc(x.reason || '')}</td></tr>`).join('')}</tbody></table>
    </div></section>

    <section id="wenig"><h2>Was passiert, wenn es kaum Daten gibt?</h2>
    <div class="card prose">
      <p><b>Kurz erklärt:</b> Ein Jugendteam hat nach drei Spielen vielleicht dreimal gewonnen. Heißt das 100 % Siegchance für immer? Natürlich nicht. Deshalb mischen alle Tipper die eigenen Daten mit dem <b>Durchschnitt der Liga</b>. Je mehr Spiele ein Team hat, desto mehr zählen seine eigenen Ergebnisse. Statistiker nennen das <i>Regression zur Mitte</i>.</p>
      <div class="widget">
        <div class="controls">${slider('w-n', 'Bisherige Spiele eines ungeschlagenen Teams', 0, 15, 1, 3)}</div>
        <div class="result" id="w-out"></div>
        <div id="w-chart"></div>
      </div>
      <p>Deshalb steht bei jedem Tipp, wie gut die Datenbasis ist: <span class="badge low">unsicher</span> bei 0–2 Spielen des Teams mit weniger Spielen, <span class="badge">mittel</span> bei 3–5 und <span class="badge high">sicher</span> erst bei 6+ Spielen und einem klaren Favoriten.</p>
      ${details('Für Technikinteressierte: Formel', `<p class="formula">geglätteter Wert = (n · eigener Wert + n₀ · Ligamittel) / (n + n₀)</p><p>Beispiel Siegquote mit n₀ = 3 Pseudo-Spielen mit 50 %: (Siege + 1,5) / (Spiele + 3). Elo mischt die Wahrscheinlichkeit mit Gewicht n/(n + n₀) zur Liga-Heimquote, das Ratingmodell erreicht dasselbe über λ.</p>`)}
    </div></section>

    <section id="vertrauen"><h2>Warum man nachträglich nicht schummeln kann</h2>
    <div class="card prose">
      <ul>
        <li>Tipps werden in eine Datei geschrieben, an die nur <b>angehängt</b> wird. Geändert oder gelöscht wird nie etwas.</li>
        <li><b>${lock} Stunden vor Anpfiff</b> ist Schluss, danach kommt kein neuer Tipp mehr dazu.</li>
        <li>Bei jedem automatischen Lauf prüft ein Test, ob eine alte Zeile verändert wurde. Wenn ja, bricht der Lauf ab.</li>
        <li>Alles liegt öffentlich auf GitHub. Jede Änderung ist mit Uhrzeit in der <a href="${REPO}/commits/main/data/predictions" target="_blank" rel="noopener">Versionsgeschichte</a> sichtbar, wie bei einem notariell versiegelten Umschlag.</li>
      </ul>
    </div></section>

    <section id="bewertung"><h2>Wie wird bewertet, wer am besten tippt?</h2>
    <div class="card prose">
      <p><b>Kurz erklärt:</b> Nur zu zählen, wie oft der Sieger stimmt (<b>Trefferquote</b>), reicht nicht. Wer bei jedem Spiel „99 % sicher“ sagt und dreimal danebenliegt, sollte schlechter dastehen als jemand, der bei knappen Spielen ehrlich „55 %“ sagt. Deshalb gibt es <b>Strafpunkte</b> (Brier Score): Je sicherer man war und je falscher es kam, desto mehr Strafe. <b>Weniger ist besser.</b> Wer immer nur 50 % tippt, bekommt pro Spiel 0,25 Strafpunkte. Gute Tipper liegen darunter.</p>
      <div class="widget">
        <div class="controls">
          ${slider('s-p', 'Tipp: Siegchance Post SV', 1, 99, 1, 70)}
          <div class="ctl seg" role="radiogroup" aria-label="Tatsächliches Ergebnis"><span>Tatsächliches Ergebnis</span>
            <button type="button" data-res="1" class="on">Sieg</button><button type="button" data-res="0">Niederlage</button></div>
        </div>
        <div class="result" id="s-out"></div>
        <div id="s-chart"></div>
      </div>
      ${details('Für Technikinteressierte: alle Maße', `
        <table class="small"><tbody>
          <tr><td><b>Accuracy</b></td><td>Anteil richtig getippter Sieger, mit 95-%-Wilson-Intervall</td></tr>
          <tr><td><b>Brier Score</b></td><td>(p − Ergebnis)², gemittelt. Hauptwertung der Championship.</td></tr>
          <tr><td><b>Log Loss</b></td><td>−ln(Wahrscheinlichkeit des eingetretenen Ergebnisses). Bestraft Übermut besonders hart, p wird auf [0,01, 0,99] begrenzt.</td></tr>
          <tr><td><b>MAE</b></td><td>mittlere Abweichung der erwarteten von der tatsächlichen Punktedifferenz</td></tr>
          <tr><td><b>Kalibrierung</b></td><td>Prognosen nach Sicherheit gruppiert: Stimmt die angegebene mit der eingetretenen Quote überein?</td></tr>
        </tbody></table>
        <p>Modellunterschiede werden per Bootstrap (1000 Wiederholungen) geprüft. Unter 30 Spielen gilt ein Ergebnis als nicht belastbar.</p>`)}

      <h3 style="margin-top:1.4rem">Sagt ein Tipper die Wahrheit über seine Sicherheit?</h3>
      <p>Wenn ein Tipper 70 % sagt, sollte das Team in etwa 7 von 10 solchen Fällen auch gewinnen. Das nennt man <b>Kalibrierung</b>. Das Diagramm zeigt echte Tipps aus dem Backtest: Punkte nahe der gestrichelten Linie bedeuten ehrliche Sicherheit, Punkte darunter bedeuten Übermut. Wähle einen Tipper und tippe oder fahre über einen Punkt:</p>
      <div class="widget">
        <div class="tabs" id="c-tabs"></div>
        <div id="c-chart"></div>
        <div class="result small" id="c-info">Tippe auf einen Punkt für Details.</div>
      </div>
    </div></section>

    <section id="backtest"><h2>Backtest: Probe an vergangenen Spielen</h2>
    <div class="card prose">
      <p><b>Kurz erklärt:</b> Damit man nicht eine ganze Saison warten muss, spielen wir die bisherige Saison nach. Der Computer geht Spieltag für Spieltag vor und tippt jedes Spiel nur mit dem Wissen, das es <b>damals</b> gab. Erst danach bekommt er das Ergebnis. So sieht man schon jetzt, welcher Tipper vorne liegt.</p>
      ${bt.length ? `<div class="bars" id="bt-bars"></div>
        <p class="muted small">Alle ${bt[0].n} gewerteten Spiele der erfassten Ligen. Balken: Trefferquote, Strich: 95-%-Unsicherheitsbereich. Tippe auf einen Balken für Details.</p>
        <div class="result small" id="bt-info"></div>` : '<p class="muted">Noch kein Backtest.</p>'}
      ${details('Für Technikinteressierte: Walk-Forward und Leakage-Test', `<p>Walk-Forward: Für jedes Spiel enthält die Historie nur Spiele mit Anpfiff vor dem Zielspiel. Gleichzeitig angepfiffene Spiele sehen einander nicht. Ein automatischer Test verfälscht spätere Ergebnisse und prüft, dass frühere Prognosen bitgleich bleiben. Einschränkung: Die Elo-Startwerte wurden nach einem ersten Blick auf diese Saison gewählt. Wirklich unabhängig ist erst die Live-Wertung.</p>
        <p>Parameter-Tuning: Optimierung auf der ersten Saisonhälfte, Prüfung auf der zweiten. Übernommen wird nur bei mindestens 0,002 Brier-Verbesserung, ohne Randwerte des Suchbereichs und innerhalb plausibler Grenzen.</p>`)}
    </div></section>

    <section id="grenzen"><h2>Was die Tipper nicht können</h2>
    <div class="card prose">
      <ul>
        <li>Sie wissen nichts über Aufstellung, Ausfälle, Neuzugänge oder Tagesform. Sie sehen nur Ergebnisse.</li>
        <li>Am Saisonanfang und in kleinen Jugendligen sind sie naturgemäß unsicher.</li>
        <li>Ob ein Wettbewerb ein Pokal ist, wird am Namen erkannt. Die Schnittstelle liefert dafür kein eigenes Feld.</li>
        <li>Ein Tipp ist eine Wahrscheinlichkeit, kein Versprechen: Bei 70 % verliert der Favorit in drei von zehn Spielen.</li>
      </ul>
    </div></section>

    <section id="glossar"><h2>Glossar</h2>
    <div class="card prose"><dl class="gloss">
      <dt>Wahrscheinlichkeit / Siegchance</dt><dd>Wie oft ein Ausgang auf lange Sicht eintritt. 70 % heißt: in etwa 7 von 10 vergleichbaren Spielen.</dd>
      <dt>Heimvorteil</dt><dd>Teams gewinnen zu Hause etwas öfter (vertraute Halle, keine Anreise). Wie groß er ist, wird für jede Liga aus den Daten geschätzt.</dd>
      <dt>Elo</dt><dd>Punktekonto für Spielstärke, benannt nach dem Schachspieler Arpad Elo.</dd>
      <dt>Regression zur Mitte</dt><dd>Wenige Ergebnisse sind oft Zufall. Darum werden Extremwerte in Richtung Durchschnitt gezogen.</dd>
      <dt>Brier Score</dt><dd>Strafpunkte für Tipps. Je sicherer und je falscher, desto mehr. Weniger ist besser.</dd>
      <dt>Kalibrierung</dt><dd>Passt die angegebene Sicherheit zur tatsächlichen Trefferquote?</dd>
      <dt>Backtest</dt><dd>Probelauf an vergangenen Spielen, bei dem nur das Wissen von damals verwendet wird.</dd>
      <dt>Data Leakage</dt><dd>Wenn versehentlich Zukunftswissen in einen Tipp gelangt. Das wird hier technisch ausgeschlossen.</dd>
      <dt>Konfidenz- / Unsicherheitsbereich</dt><dd>Spanne, in der der wahre Wert mit 95 % Wahrscheinlichkeit liegt. Je weniger Spiele, desto breiter.</dd>
    </dl></div></section>`;

  // ---------- Interaktion ----------
  const $ = (id) => document.getElementById(id);
  const val = (id) => Number($(id).value);
  const bindAll = (ids, fn) => {
    ids.forEach((id) => $(id)?.addEventListener('input', fn));
    fn();
  };
  const showVal = (id, text) => { const o = $(`${id}-v`); if (o) o.textContent = text; };
  const verdict = (pWin) => `<div class="big ${pWin >= 0.5 ? 'tip-win' : 'tip-loss'}">${pWin >= 0.5 ? 'Sieg' : 'Niederlage'} <span>${pct(pWin >= 0.5 ? pWin : 1 - pWin)}</span></div>
    <div class="probbar"><i class="h" style="width:${pWin * 100}%"></i><i class="g" style="width:${(1 - pWin) * 100}%"></i></div>
    <div class="row small muted"><span>Siegchance Post SV ${pct(pWin)}</span><span>Gegner ${pct(1 - pWin)}</span></div>`;

  // Baseline
  bindAll(['b-own', 'b-opp', 'b-home'], () => {
    const qo = val('b-own') / 100;
    const qg = val('b-opp') / 100;
    showVal('b-own', pct(qo));
    showVal('b-opp', pct(qg));
    const a = Math.min(0.99, Math.max(0.01, qo));
    const b = Math.min(0.99, Math.max(0.01, qg));
    const l5 = (a * (1 - b)) / (a * (1 - b) + b * (1 - a));
    const home = $('b-home').checked;
    const p = logistic(logit(l5) + (home ? 1 : -1) * logit(0.55));
    $('b-out').innerHTML = `${verdict(p)}<p class="small">Ohne Heimvorteil wären es ${pct(l5)}. ${home ? 'Das Heimspiel' : 'Das Auswärtsspiel'} verschiebt die Chance auf ${pct(p)}.</p>`;
  });

  // Elo
  const eloChart = (diff, p) => {
    const W = 520, H = 200, L = 36, B = 26;
    const sx = (d) => L + ((d + 600) / 1200) * (W - L - 12);
    const sy = (q) => 10 + (1 - q) * (H - 10 - B);
    const pts = [];
    for (let d = -600; d <= 600; d += 20) pts.push(`${sx(d).toFixed(1)},${sy(1 / (1 + 10 ** (-d / 400))).toFixed(1)}`);
    const cd = Math.max(-600, Math.min(600, diff));
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Siegchance in Abhängigkeit vom Elo-Abstand">
      ${[0, 0.5, 1].map((q) => `<line x1="${L}" x2="${W - 12}" y1="${sy(q)}" y2="${sy(q)}" stroke="var(--line)"/><text x="2" y="${sy(q) + 4}">${q * 100}%</text>`).join('')}
      <line x1="${sx(0)}" x2="${sx(0)}" y1="10" y2="${H - B}" stroke="var(--line)" stroke-dasharray="3 3"/>
      <polyline fill="none" stroke="var(--m-elo)" stroke-width="2.5" points="${pts.join(' ')}"/>
      <line x1="${sx(cd)}" x2="${sx(cd)}" y1="${sy(p)}" y2="${H - B}" stroke="var(--accent)" stroke-dasharray="3 3"/>
      <circle cx="${sx(cd)}" cy="${sy(p)}" r="6" fill="var(--accent)"/>
      <text x="${L}" y="${H - 6}">Post SV 600 schwächer</text><text x="${W - 140}" y="${H - 6}">Post SV 600 stärker</text>
    </svg>`;
  };
  let eloState = { diff: 0, p: 0.5 };
  bindAll(['e-own', 'e-opp', 'e-home'], () => {
    const own = val('e-own');
    const opp = val('e-opp');
    showVal('e-own', own);
    showVal('e-opp', opp);
    const home = $('e-home').checked;
    const diff = own - opp + (home ? eloP.hfa : -eloP.hfa);
    const p = 1 / (1 + 10 ** (-diff / 400));
    eloState = { diff, p };
    $('e-out').innerHTML = `${verdict(p)}<p class="small">Abstand inklusive Heimbonus: <b>${signed(diff, 0)} Elo-Punkte</b> → erwartet ${signed(diff / eloP.eloPerPoint, 0)} Punkte Differenz.</p>`;
    $('e-chart').innerHTML = eloChart(diff, p);
    $('e-res').dispatchEvent(new Event('input'));
  });
  bindAll(['e-res'], () => {
    const m = val('e-res') || 1;
    showVal('e-res', `${m > 0 ? '+' : ''}${m}`);
    const won = m > 0;
    const winnerDiff = won ? eloState.diff : -eloState.diff;
    const mult = (Math.log(Math.abs(m) + 1) * 2.2) / (winnerDiff * 0.001 + 2.2);
    const delta = eloP.k * mult * ((won ? 1 : 0) - eloState.p);
    $('e-upd').innerHTML = `<p>Bei einem ${won ? `<b class="tip-win">Sieg mit ${m}</b>` : `<b class="tip-loss">Niederlage mit ${-m}</b>`} Punkten bekommt der Post SV <b>${signed(delta, 1)}</b> Elo-Punkte, der Gegner ${signed(-delta, 1)}.
      ${won === (eloState.p >= 0.5)
        ? `Das entsprach der Erwartung (Siegchance vorher ${pct(won ? eloState.p : 1 - eloState.p)}), deshalb hängt die Änderung vor allem an der Höhe des Ergebnisses.`
        : `Das war eine Überraschung (vorher nur ${pct(won ? eloState.p : 1 - eloState.p)} Chance), deshalb wandern besonders viele Punkte.`}</p>`;
  });

  // Ratingmodell
  const bell = (mu, s) => {
    const W = 520, H = 210, B = 26, R = 60;
    const sx = (x) => ((x + R) / (2 * R)) * W;
    const peak = normPdf(mu, mu, s);
    const sy = (y) => H - B - (y / peak) * (H - B - 14);
    const win = [];
    const loss = [];
    for (let x = -R; x <= R; x += 1) {
      const pt = `${sx(x).toFixed(1)},${sy(normPdf(x, mu, s)).toFixed(1)}`;
      if (x >= 0) win.push(pt);
      if (x <= 0) loss.push(pt);
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verteilung möglicher Endstände">
      <polygon fill="var(--bad)" fill-opacity=".25" points="${sx(-R)},${sy(0)} ${loss.join(' ')} ${sx(0)},${sy(0)}"/>
      <polygon fill="var(--good)" fill-opacity=".3" points="${sx(0)},${sy(0)} ${win.join(' ')} ${sx(R)},${sy(0)}"/>
      <polyline fill="none" stroke="var(--m-rating)" stroke-width="2.5" points="${[...loss, ...win].join(' ')}"/>
      <line x1="${sx(0)}" x2="${sx(0)}" y1="8" y2="${H - B}" stroke="var(--text)" stroke-opacity=".5"/>
      <line x1="${sx(Math.max(-R, Math.min(R, mu)))}" x2="${sx(Math.max(-R, Math.min(R, mu)))}" y1="12" y2="${H - B}" stroke="var(--m-rating)" stroke-dasharray="4 3"/>
      <text x="${sx(Math.max(-R + 8, Math.min(R - 20, mu))) + 4}" y="22">erwartet ${mu > 0 ? '+' : ''}${Math.round(mu)}</text>
      <text x="4" y="${H - 6}">Post SV verliert hoch</text><text x="${sx(0) - 4}" y="${H - 6}">0</text><text x="${W - 130}" y="${H - 6}">Post SV gewinnt hoch</text>
    </svg>`;
  };
  bindAll(['r-own', 'r-opp', 'r-sig', 'r-home'], () => {
    const own = val('r-own');
    const opp = val('r-opp');
    const s = val('r-sig');
    showVal('r-own', signed(own, 0));
    showVal('r-opp', signed(opp, 0));
    showVal('r-sig', `±${s}`);
    const mu = own - opp + ($('r-home').checked ? 2 : -2);
    const p = normCdf(mu / s);
    $('r-out').innerHTML = `${verdict(p)}<p class="small">Erwartet: Post SV ${mu >= 0 ? 'gewinnt' : 'verliert'} mit etwa <b>${Math.abs(Math.round(mu))} Punkten</b>. Die grüne Fläche ist die Siegchance (${pct(p)}). Je größer die Streuung, desto flacher die Kurve und desto näher an 50 %. Der Zufall wird wichtiger.</p>`;
    $('r-chart').innerHTML = bell(mu, s);
  });

  // Wenig Daten
  bindAll(['w-n'], () => {
    const n = val('w-n');
    showVal('w-n', n);
    const n0 = 3;
    const w = n / (n + n0);
    const q = (n + 1.5) / (n + n0);
    $('w-out').innerHTML = `<p>Nach <b>${n} ${n === 1 ? 'Sieg' : 'Siegen'}</b> ohne Niederlage zählt das eigene Ergebnis zu <b>${pct(w)}</b>, der Ligadurchschnitt (50 %) zu ${pct(1 - w)}. Verwendete Siegquote: <b>${pct(q)}</b> statt 100 %.</p>`;
    const W = 520, H = 150, B = 22;
    const bw = (W - 20) / 16;
    $('w-chart').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gewicht der eigenen Ergebnisse nach Anzahl Spielen">
      ${Array.from({ length: 16 }, (_, i) => {
        const wi = i / (i + n0);
        const h = wi * (H - B - 10);
        return `<rect x="${10 + i * bw + 2}" y="${H - B - h}" width="${bw - 4}" height="${h}" rx="3" fill="${i === n ? 'var(--accent)' : 'var(--surface-2)'}" stroke="var(--line)"/>
          <text x="${10 + i * bw + bw / 2 - 4}" y="${H - 6}">${i}</text>`;
      }).join('')}
      <text x="12" y="14">Gewicht eigener Ergebnisse (Balkenhöhe), nach Anzahl Spielen</text>
    </svg>`;
  });

  // Bewertung
  let res = 1;
  const scoreChart = (p, y) => {
    const W = 520, H = 190, L = 34, B = 24;
    const sx = (q) => L + q * (W - L - 12);
    const sy = (v) => 10 + (1 - v) * (H - 10 - B);
    const curve = (yy) => Array.from({ length: 99 }, (_, i) => (i + 1) / 100).map((q) => `${sx(q).toFixed(1)},${sy((q - yy) ** 2).toFixed(1)}`).join(' ');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Strafpunkte je nach Tipp">
      ${[0, 0.25, 0.5, 1].map((v) => `<line x1="${L}" x2="${W - 12}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--line)"/><text x="2" y="${sy(v) + 4}">${String(v).replace('.', ',')}</text>`).join('')}
      <polyline fill="none" stroke="var(--good)" stroke-width="2" stroke-opacity="${y === 1 ? 1 : 0.3}" points="${curve(1)}"/>
      <polyline fill="none" stroke="var(--bad)" stroke-width="2" stroke-opacity="${y === 0 ? 1 : 0.3}" points="${curve(0)}"/>
      <circle cx="${sx(p)}" cy="${sy((p - y) ** 2)}" r="6" fill="var(--accent)"/>
      <text x="${L}" y="${H - 6}">Tipp 0 % Sieg</text><text x="${W - 100}" y="${H - 6}">Tipp 100 % Sieg</text>
    </svg><div class="legend"><span><span class="dot" style="background:var(--good)"></span>Strafe, wenn Post SV gewinnt</span><span><span class="dot" style="background:var(--bad)"></span>Strafe, wenn Post SV verliert</span></div>`;
  };
  const scoreUpdate = () => {
    const p = val('s-p') / 100;
    showVal('s-p', pct(p));
    const brier = (p - res) ** 2;
    const ll = -Math.log(res ? p : 1 - p);
    const right = (p >= 0.5) === (res === 1);
    $('s-out').innerHTML = `<p>Treffer? <b class="${right ? 'tip-win' : 'tip-loss'}">${right ? 'Ja' : 'Nein'}</b> · Strafpunkte (Brier) <b>${num(brier, 3)}</b> · Log Loss ${num(ll, 2)}<br>
      <span class="small muted">${right && p > 0.85 ? 'Mutig und richtig: kaum Strafe.' : !right && Math.max(p, 1 - p) > 0.85 ? 'Sehr sicher und falsch: hohe Strafe. Genau das soll der Brier Score bestrafen.' : !right ? 'Falsch, aber vorsichtig getippt: mäßige Strafe.' : 'Richtig, aber vorsichtig: kleine Strafe.'}</span></p>`;
    $('s-chart').innerHTML = scoreChart(p, res);
  };
  bindAll(['s-p'], scoreUpdate);
  app.querySelectorAll('[data-res]').forEach((b) => b.addEventListener('click', () => {
    res = Number(b.dataset.res);
    app.querySelectorAll('[data-res]').forEach((x) => x.classList.toggle('on', x === b));
    scoreUpdate();
  }));

  // Kalibrierung (echte Backtest-Daten)
  const calReports = perf?.backtest?.scopes?.all?.models || {};
  const calIds = Object.keys(calReports);
  if (calIds.length) {
    let cur = calIds.includes('rating') ? 'rating' : calIds[0];
    const drawCal = () => {
      $('c-tabs').innerHTML = calIds.map((id) => `<button type="button" data-cal="${id}" class="${id === cur ? 'on' : ''}">${esc(modelName(id))}</button>`).join('');
      const S = 300, P = 34;
      const sx = (v) => P + ((v - 0.5) / 0.5) * (S - P - 12);
      const sy = (v) => S - P - v * (S - P - 12);
      const bins = (calReports[cur].calibration || []).filter((b) => b.n > 0);
      $('c-chart').innerHTML = `<svg class="chart" viewBox="0 0 ${S} ${S}" style="max-width:380px" role="img" aria-label="Kalibrierung">
        <line x1="${sx(0.5)}" y1="${sy(0.5)}" x2="${sx(1)}" y2="${sy(1)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
        <line x1="${P}" x2="${S - 12}" y1="${S - P}" y2="${S - P}" stroke="var(--line)"/><line x1="${P}" x2="${P}" y1="10" y2="${S - P}" stroke="var(--line)"/>
        <text x="${P - 6}" y="${S - 16}">50%</text><text x="${S - 44}" y="${S - 16}">100%</text><text x="2" y="${sy(1) + 4}">100%</text><text x="2" y="${sy(0.5) + 4}">50%</text>
        <text x="${S / 2 - 50}" y="${S - 2}">angegebene Sicherheit</text>
        <text x="4" y="${sy(0.75)}" transform="rotate(-90 10 ${sy(0.75)})">tatsächlich gewonnen</text>
        ${bins.map((b, i) => {
          const ci = b.ci && b.ci[0] != null ? `<line x1="${sx(b.predicted)}" x2="${sx(b.predicted)}" y1="${sy(b.ci[0])}" y2="${sy(b.ci[1])}" stroke="${color(cur)}" stroke-opacity=".5" stroke-width="2"/>` : '';
          return `${ci}<circle data-bin="${i}" cx="${sx(b.predicted)}" cy="${sy(Math.max(0, b.observed))}" r="${Math.min(14, 5 + Math.sqrt(b.n) / 2)}" fill="${color(cur)}" fill-opacity=".7" tabindex="0" style="cursor:pointer"><title>${b.range}</title></circle>`;
        }).join('')}
      </svg>`;
      const info = (b) => {
        $('c-info').innerHTML = `<b>${esc(modelName(cur))}, Tipps mit ${b.range} Sicherheit:</b> ${b.n} Spiele. Angegeben im Schnitt ${pct(b.predicted)}, der Favorit hat tatsächlich ${pct(b.observed)} gewonnen (Unsicherheitsbereich ${pct(b.ci[0])}–${pct(b.ci[1])}). ${Math.abs(b.observed - b.predicted) < 0.05 ? 'Gut kalibriert.' : b.observed < b.predicted ? 'Etwas zu selbstsicher.' : 'Eher zu vorsichtig.'}`;
      };
      $('c-chart').querySelectorAll('[data-bin]').forEach((c) => {
        const b = bins[Number(c.dataset.bin)];
        c.addEventListener('click', () => info(b));
        c.addEventListener('mouseenter', () => info(b));
        c.addEventListener('focus', () => info(b));
      });
      $('c-tabs').querySelectorAll('[data-cal]').forEach((x) => x.addEventListener('click', () => { cur = x.dataset.cal; drawCal(); }));
    };
    drawCal();
  } else {
    $('c-chart').innerHTML = '<p class="muted">Noch keine Backtest-Daten.</p>';
  }

  // ML: Merkmalswichtigkeit
  const FEATURE_TEXT = {
    eloLogit: 'Die Siegchance, die das Elo-Punktekonto ausrechnet. Der Lernende nutzt den Tipp eines anderen Tippers als Hinweis.',
    eloDiff: 'Wie weit die Elo-Punktekonten beider Teams auseinanderliegen.',
    ratingMargin: 'Der Punkteabstand, den das Ratingmodell erwartet. Ein Zeichen, dass der „große Vergleicher“ viel richtig macht.',
    ratingLogit: 'Die Siegchance des Ratingmodells.',
    ratingSigma: 'Wie zufällig die Ergebnisse in dieser Liga schwanken.',
    baseLogit: 'Die Siegchance der einfachen Baseline (Siegquoten).',
    winPctDiff: 'Unterschied der bisherigen Siegquoten.',
    avgMarginDiff: 'Unterschied der durchschnittlichen Korbdifferenz: Wer gewinnt deutlicher?',
    offDefDiff: 'Eigener Angriff gegen gegnerische Verteidigung, auf beiden Seiten verglichen.',
    last5MarginDiff: 'Form: Wie hoch haben die Teams ihre letzten fünf Spiele gewonnen oder verloren? Aktuelle Form zählt offenbar viel.',
    form5Diff: 'Form: Wie viele der letzten fünf Spiele wurden gewonnen?',
    streakDiff: 'Aktuelle Sieg- oder Niederlagenserie.',
    sosDiff: 'Wie stark waren die bisherigen Gegner?',
    commonDiff: 'Wie haben beide Teams gegen dieselben Gegner abgeschnitten?',
    commonCount: 'Wie viele gemeinsame Gegner es gibt.',
    h2hNet: 'Ergebnisse direkter Duelle in dieser Saison.',
    minGames: 'Wie viele Spiele das weniger erfahrene Team hat, also wie verlässlich die Zahlen sind.',
    maxGames: 'Wie viele Spiele das erfahrenere Team hat.',
    historySize: 'Wie viele Spiele die Liga insgesamt schon hat.',
    leagueHomeLogit: 'Wie oft in dieser Liga das Heimteam gewinnt.',
    leagueAvgPoints: 'Wie viele Punkte in dieser Liga im Schnitt fallen.',
  };
  const imp = (mlStatus?.importance || []).slice(0, 10);
  if (imp.length && $('ml-imp')) {
    const max = imp[0].share;
    $('ml-imp').innerHTML = imp.map((f, i) => `
      <button type="button" class="barrow" data-imp="${i}">
        <span class="lbl">${esc(f.label)}</span>
        <span class="track"><span class="fill" style="width:${(f.share / max) * 100}%;background:var(--m-ml)"></span></span>
        <span class="val">${pct(f.share, 1)}</span>
      </button>`).join('');
    const info = (f) => { $('ml-imp-info').innerHTML = `<b>${esc(f.label)}</b> (${pct(f.share, 1)} Anteil): ${esc(FEATURE_TEXT[f.key] || (f.key.startsWith('age_') ? 'Die Altersklasse: Spielt sie für den Ausgang eine Rolle?' : ''))}`; };
    $('ml-imp').querySelectorAll('[data-imp]').forEach((b) => b.addEventListener('click', () => info(imp[Number(b.dataset.imp)])));
    info(imp[0]);
  }

  // Backtest-Balken
  if (bt.length && $('bt-bars')) {
    $('bt-bars').innerHTML = bt.map((r, i) => `
      <button type="button" class="barrow" data-bt="${i}">
        <span class="lbl">${dot(r.modelId)}${esc(modelName(r.modelId))}</span>
        <span class="track"><span class="fill" style="width:${r.accuracy * 100}%;background:${color(r.modelId)}"></span>
          ${r.accuracyCI ? `<span class="ci" style="left:${r.accuracyCI[0] * 100}%;width:${(r.accuracyCI[1] - r.accuracyCI[0]) * 100}%"></span>` : ''}
          <span class="half"></span></span>
        <span class="val">${pct(r.accuracy, 1)}</span>
      </button>`).join('');
    const info = (r) => {
      $('bt-info').innerHTML = `<b>${esc(modelName(r.modelId))}:</b> ${pct(r.accuracy, 1)} richtige Sieger (wahrscheinlich zwischen ${pct(r.accuracyCI[0])} und ${pct(r.accuracyCI[1])}), Strafpunkte ${num(r.brier, 3)} pro Spiel (weniger ist besser, Münzwurf = 0,250), Endstand-Abweichung im Schnitt ${num(r.mae)} Punkte.`;
    };
    $('bt-bars').querySelectorAll('[data-bt]').forEach((b) => b.addEventListener('click', () => info(bt[Number(b.dataset.bt)])));
    info(bt[0]);
  }

  app.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => document.getElementById(b.dataset.goto)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
}

const COLORS = { baseline: 'var(--m-baseline)', elo: 'var(--m-elo)', rating: 'var(--m-rating)', ml: 'var(--m-ml)' };
const color = (id) => COLORS[id] || 'var(--m-llm)';

function paramTable(model, rows, esc) {
  if (!model?.params) return '';
  const ags = Object.keys(model.params);
  return `<div class="tablewrap"><table class="small"><thead><tr><th>Parameter</th>${ags.map((a) => `<th class="num">${esc(a)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([k, label]) => `<tr><td>${esc(label)}</td>${ags.map((a) => `<td class="num">${esc(Number(model.params[a][k]).toLocaleString('de-DE'))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="muted small">Aktuell verwendete Werte je Altersklasse. Getunte Werte werden nur übernommen, wenn sie auf ungesehenen Spielen deutlich besser sind.</p>`;
}
