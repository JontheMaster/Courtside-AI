// Seite "Die Idee": worum es geht, wie das Projekt entstand, wie es weitergeht.
// Zahlen kommen aus den aktuellen Daten, Daten der Meilensteine aus der Git-Historie.

const REPO = 'https://github.com/JontheMaster/Courtside-AI';

export async function renderStory(app, { META, load, esc, pct, num, dot, modelName }) {
  let champ = null;
  try { champ = await load('championship.json'); } catch {}
  const bt = champ?.backtestAll || [];
  const best = bt[0];
  const base = bt.find((r) => r.modelId === 'baseline');
  const elo = bt.find((r) => r.modelId === 'elo');
  const liveN = champ?.live?.[0]?.n || 0;

  const steps = [
    ['Der Ausgangspunkt', 'Der Deutsche Basketball Bund veröffentlicht alle Spielpläne und Ergebnisse über eine Schnittstelle. Die Nutzung der öffentlichen Daten ist mit dem Bayerischen Basketball Verband abgestimmt, und zwar nur lesend. Damit lag die Frage nahe: Was lässt sich aus diesen Daten herauslesen?'],
    ['04.11.2026: Was ist überhaupt da?', 'Bevor eine Zeile Prognose-Code entstand, wurde die Schnittstelle untersucht. Die Überraschungen: Ältere Spielzeiten sind nicht mehr abrufbar. Fast die Hälfte der eingetragenen Ergebnisse war noch nicht offiziell bestätigt. Zurückgezogene Teams haben bei allen ihren Spielen einen „Verzicht“. All das musste sauber behandelt werden, bevor gerechnet werden konnte.'],
    ['Der Fokus', `Im Mittelpunkt stehen nur die Spiele des ${esc(META.club.name)}, und zwar ab der U14. Minis spielen nach anderen Regeln und mit anderen Abständen und würden die Modelle verfälschen. Damit die Tipper trotzdem genug zum Lernen haben, kommen die Ligen der Gegnervereine dazu: aktuell ${META.counts.leagues} Ligen mit ${META.counts.trainingGames} Spielen.`],
    ['Fair und öffentlich', 'Die Daten liegen nicht in einer versteckten Datenbank, sondern öffentlich auf GitHub. Jede Prognose wird mit Uhrzeit gespeichert, und die Versionsgeschichte zeigt jede Änderung. So kann niemand im Nachhinein behaupten, er hätte es „schon immer gewusst“. Kosten: null Euro.'],
    ['Der erste Probelauf', best ? `Die ganze bisherige Saison wurde nachgespielt, mit dem Wissen von damals. Ergebnis: Das Ratingmodell traf ${pct(best.accuracy)} der Sieger, die einfache Siegquote ${pct(base?.accuracy)}. Elo, das berühmte System aus dem Schach, lag ${elo && base && elo.accuracy < base.accuracy ? 'sogar knapp hinter' : 'nur auf Höhe'} der einfachen Siegquote. Der Grund: Bei vier bis acht Spielen pro Saison lernt ein Punktekonto zu langsam.` : 'Die ganze bisherige Saison wurde nachgespielt, mit dem Wissen von damals.'],
    ['Eine wichtige Lektion', 'Beim automatischen Feineinstellen der Modelle wählte der Computer für die U16 einen extremen Wert. Damit sahen die Modelle auf alten Spielen gut aus, hatten aber nur Zufälle auswendig gelernt. Seitdem gelten strenge Regeln: Eine Einstellung wird nur übernommen, wenn sie auf ungesehenen Spielen deutlich besser ist. Aktuell erfüllt das keine, deshalb gelten die Startwerte.'],
    ['05.11.2026: Für alle verständlich', 'Tipps werden jetzt aus Sicht des Post SV gezeigt, also als Sieg oder Niederlage. Die Methodik-Seite erklärt mit Reglern zum Ausprobieren, wie die Tipper rechnen.'],
    ['05.11.2026: Der vierte Tipper', 'Ein Machine-Learning-Modell kommt dazu. Es lernt aus über tausend vergangenen Spielen, wöchentlich neu und immer nur aus der Vergangenheit. Im Probelauf schlägt es die einfache Siegquote klar und liegt knapp hinter dem Ratingmodell. Damit darf es live mittippen.'],
    ['Ab jetzt: die echte Saison', liveN ? `Bisher sind ${liveN} Live-Tipps ausgewertet. Jede Woche kommen neue dazu.` : 'Mit jedem Spieltag kommen echte, vorher festgelegte Tipps dazu. Die Live-Wertung ist der eigentliche Wettbewerb, denn hier kennt niemand das Ergebnis vorher.'],
  ];

  app.innerHTML = `
    <section class="hero">
      <p class="kicker">Die Idee hinter COURTSIDE AI</p>
      <h1>Kann ein Computer vorhersagen, wie das nächste Spiel ausgeht?</h1>
      <p class="lead">Profivereine haben ganze Analyseabteilungen. Im Vereins- und Jugendbasketball gibt es nur Endstände in einer Ergebnisliste. Reicht das für gute Vorhersagen? Und wer kann es besser: eine einfache Statistik, ein lernendes Programm oder eine künstliche Intelligenz? Statt darüber zu streiten, lassen wir sie gegeneinander antreten.</p>
    </section>

    <div class="grid three" style="margin-top:1.2rem">
      <div class="card pillar"><div class="icon" aria-hidden="true">🎯</div><h3>Tippen</h3><p>Vor jedem Post-SV-Spiel geben mehrere Computer-Tipper unabhängig ihren Tipp ab: Sieg oder Niederlage, wie sicher, welcher Endstand.</p></div>
      <div class="card pillar"><div class="icon" aria-hidden="true">🔒</div><h3>Versiegeln</h3><p>${META.lockMinutes / 60} Stunden vor Anpfiff wird jeder Tipp eingefroren und öffentlich gespeichert. Nachträglich ändern geht nicht.</p></div>
      <div class="card pillar"><div class="icon" aria-hidden="true">🏆</div><h3>Abrechnen</h3><p>Nach dem Spiel wird verglichen. Über die Saison entsteht eine Rangliste, die <a href="#/championship">Model Championship</a>.</p></div>
    </div>

    <h2>Die Tipper</h2>
    <div class="grid three">
      ${[
        ['baseline', 'Der Bauchgefühl-Statistiker', 'Wer bisher oft gewonnen hat, gewinnt wieder. Simpel, aber schwer zu schlagen. Er ist der Maßstab für alle anderen.'],
        ['elo', 'Der Schachspieler', 'Führt für jedes Team ein Punktekonto, das nach jedem Spiel wächst oder schrumpft. Bewährt im Schach, im Fußball und in der NBA.'],
        ['rating', 'Der große Vergleicher', 'Vergleicht alle Ergebnisse einer Liga gleichzeitig, auch über gemeinsame Gegner. Liegt bisher vorne.'],
        ['ml', 'Der Lernende', 'Bekommt keine Regeln, sondern über tausend Beispielspiele, und findet selbst heraus, welche Hinweise zählen. Auch die Tipps der anderen gehören dazu.'],
      ].map(([id, t, d]) => `<div class="card pillar"><h3>${dot(id)}${esc(t)}</h3><p class="muted small">${esc(modelName(id))}</p><p>${d}</p></div>`).join('')}
    </div>
    <p class="muted small">Als Nächstes kommt eine generative KI dazu. Wie die Tipper genau rechnen, steht auf der Seite <a href="#/about">Methodik</a>.</p>

    <h2>Wie es entstand</h2>
    <ol class="timeline">${steps.map(([t, d]) => `<li><h3>${esc(t)}</h3><p>${d}</p></li>`).join('')}</ol>

    <h2>Was wir bisher gelernt haben</h2>
    <div class="grid three">
      <div class="card pillar"><h3>Wenig Daten sind die größte Hürde</h3><p>Jugendteams haben oft nur eine Handvoll Spiele. Ein gutes Modell muss vor allem wissen, wann es <b>nichts</b> weiß.</p></div>
      <div class="card pillar"><h3>Berühmt heißt nicht besser</h3><p>Elo ist das bekannteste System, liegt hier aber nicht vorne. Gemeinsame Gegner auszuwerten bringt in kleinen Ligen mehr.</p></div>
      <div class="card pillar"><h3>Ehrlichkeit braucht Regeln</h3><p>Es ist leicht, ein Modell im Nachhinein gut aussehen zu lassen. Deshalb gibt es Probeläufe ohne Zukunftswissen, eingefrorene Tipps und offene Daten.</p></div>
    </div>

    <h2>Wie es weitergeht</h2>
    <div class="card prose">
      <ol class="roadmap">
        <li class="done"><b>Datenbasis, Statistik, Elo, Ratingmodell, Backtest</b>: fertig</li>
        <li class="done"><b>Website mit Tipps, Championship, Performance, Methodik</b>: fertig</li>
        <li class="done"><b>Machine Learning</b>: ein lernendes Modell (Gradient Boosting), das alle Kennzahlen und die Tipps der anderen kombiniert. Es tippt live mit, solange es im Probelauf die einfache Siegquote schlägt.</li>
        <li><b>Generative KI</b>: Ein Sprachmodell bekommt dieselben Zahlen und gibt einen begründeten Tipp ab.</li>
        <li><b>Saisonfinale</b>: Am Ende der Saison steht fest, welcher Tipper Basketball am besten versteht. Mit der nächsten Saison wächst die Datenbasis weiter.</li>
      </ol>
    </div>

    <div class="card cta">
      <p><b>Alles ist offen:</b> Code, Daten und jede gespeicherte Prognose liegen öffentlich auf <a href="${REPO}" target="_blank" rel="noopener">GitHub</a>. Daten: TeamSL / basketball-bund.net. Es werden keine Personendaten verwendet.</p>
    </div>`;
}
