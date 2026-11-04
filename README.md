# COURTSIDE AI

Prognosen für die Spiele des **Post SV Nürnberg** (Altersklassen U14, U16, U18, U20, Senioren) auf Basis der öffentlichen TeamSL-Daten von basketball-bund.net. Mehrere Modelle tippen unabhängig voneinander. Bewertet werden sie an den echten Ergebnissen (Model Championship).

- Keine Datenbank, keine npm-Abhängigkeiten: Node ≥ 22, Daten als JSON im Repo.
- Ein GitHub-Actions-Job läuft stündlich, die Oberfläche liegt auf GitHub Pages.
- Prognosen werden nur angehängt, nie geändert. Die Git-Historie belegt das.

## Schnellstart (lokal)

```bash
npm test              # automatisierte Tests
npm run sync          # Daten von basketball-bund.net holen (ca. 1 Minute)
npm run predict       # Prognosen für die nächsten 14 Tage anhängen
npm run backtest      # Walk-Forward-Backtest aller Modelle
npm run build         # JSON für die Oberfläche erzeugen (public/data)
npm run serve         # http://localhost:4173
npm run update        # alles hintereinander, wie in GitHub Actions
npm run tune          # Parameter je Altersklasse optimieren (manuell, nicht im Cronjob)
```

## Architektur

```
src/teamsl/client.js       API-Zugriff: Statusprüfung der Antwort-Hülle, Retry, Cache, max. 6 parallel
src/teamsl/normalizer.js   API-Objekt → internes Spiel (Status, Wettbewerbsart, Zeit in UTC)
src/sync/sync.js           Post-SV-Ligen ab U14 + Trainingsligen der Gegnervereine
src/store/fileStore.js     JSON-/NDJSON-Dateien in data/
src/stats/teamStats.js     Bilanz, Punkte, Form, Serie, Gegnerstärke, gemeinsame Gegner, H2H
src/engine/context.js      leakage-freier Eingabekontext (nur Spiele vor dem Zielspiel) + Input-Hash
src/models/                baseline, elo, ratingModel, ml (inaktiv), llm/ (inaktiv ohne Key)
src/engine/predict.js      Live-Prognosen (append-only, Sperrzeit)
src/engine/backtest.js     Walk-Forward-Backtest und Parameter-Tuning
src/engine/evaluation.js   Accuracy, Brier, Log Loss, MAE, Kalibrierung, Konfidenzintervalle
src/engine/championship.js Rangliste aus finalen Live-Prognosen
src/engine/verify.js       Integritätsprüfung der Prognose-Dateien gegen Git
src/build/site.js          JSON für die Oberfläche
public/                    statische Oberfläche (HTML/CSS/JS, SVG-Diagramme)
data/                      leagues.json, matches/<ligaId>.json, predictions/<saison>.ndjson,
                           changes.ndjson (Verlegungen/Ergebnisänderungen), backtest/, model-params.json
```

## Datenbasis: was die API wirklich liefert (geprüft am 04.11.2026)

| Befund | Folge |
|---|---|
| Fehler kommen auch als HTTP 200, mit `status: "-1"` **oder `"1"`** („no competition found“) | Erfolg nur bei `status === "0"` |
| Nur die laufende Saison 2026/27 ist abrufbar. Ältere Liga-IDs liefern „not found“. `/team/id/{teamPermanentId}/matches` funktioniert, zeigt aber auch nur die aktuelle Saison, `seasonId` wird ignoriert | Backtest auf der laufenden Saison. Ab jetzt archiviert das Repo alle Daten selbst |
| `ergebnisbestaetigt` ist bei vielen gespielten Spielen noch `false` (Stichprobe: 179 von 332) | Unbestätigte Ergebnisse werden genutzt und markiert (`config.data.useUnconfirmedResults`) |
| Verzicht: `result = null`, `verzicht` am Spiel und/oder am Team. Zurückgezogene Teams haben das Flag bei allen Spielen | kein sportliches Ergebnis, wird nicht prognostiziert |
| `ligaData` enthält keinen Ligatyp | Pokal/Vorbereitung/Play-off werden über den Namen erkannt (Heuristik in `competitionType`) |
| `/wam/data` liefert nur die erste Ergebnisseite | Zusätzliche Ligen kommen über die Spielpläne der Gegnervereine |
| keine Spieler-, Kader- oder Live-Daten | Die Modelle nutzen nur Ergebnisse. `matchInfo` (Personennamen) wird nicht abgefragt |

Stand des ersten Syncs: 25 Post-SV-Ligen ab U14, 133 zusätzliche Ligen ab U14 von 62 Gegnervereinen (Bayern), rund 1.500 gewertete Spiele.

## Modelle

| Modell | Idee | Status |
|---|---|---|
| Baseline | geglättete Siegquoten (log5) + Liga-Heimquote | aktiv |
| Elo | Rating je Liga, Heimvorteil, Punktedifferenz-Faktor (logarithmisch, gedämpft bei Favoritensiegen), Shrinkage zur Liga-Heimquote bei wenigen Spielen | aktiv |
| Statistisches Ratingmodell | Ridge-Regression `Differenz = Heimvorteil + Stärke_Heim − Stärke_Gast` über alle bisherigen Ligaspiele. Siegchance über die Normalverteilung mit geschätzter Streuung | aktiv |
| Machine Learning | Phase 4. Wird erst ab 1.000 Trainingsspielen und mit zeitlicher Train/Test-Trennung aktiviert | vorbereitet |
| Generative KI (Claude) | Phase 5. Anbieter-neutraler Adapter, Systemprompt, JSON-Validierung, Aufruf-Budget, Cache per Input-Hash. Erhält anonymisierte Kennzahlen ohne Teamnamen | inaktiv ohne `LLM_ENABLED=true` + `ANTHROPIC_API_KEY` |

Alle Modelle sind zustandslos: Jede Prognose wird aus der Historie vor dem Spiel neu berechnet. Damit ist sie reproduzierbar, und Data Leakage ist ausgeschlossen. Die Modellversion setzt sich aus der Code-Version und einem Hash aller Parameter zusammen.

### Regeln für die Datenqualität

- Ratings werden **je Liga** berechnet. Pokalspiele zählen nicht mit. Ein Pokalspiel wird nur prognostiziert, wenn beide Teams in derselben regulären Liga spielen.
- Abgesagte Spiele, Verzichte und fehlende Ergebnisse haben keinen Einfluss.
- Bei wenigen Spielen ziehen alle Werte zum Ligamittel. Die Datenbasis wird als `low`/`medium`/`high` gekennzeichnet (0–2 / 3–5 / 6+ Spiele des schwächer belegten Teams).

### Prognose-Lebenszyklus

1. Spiele des Post SV in den nächsten 14 Tagen werden prognostiziert.
2. Ändert sich der Datenstand (neues Ergebnis in der Liga) oder die Modellversion, wird **eine neue Zeile angehängt**.
3. Ab **2 h vor Anpfiff** (Spiele ohne Uhrzeit: ab 00:00 Uhr des Spieltags) entstehen keine neuen Zeilen mehr. Die letzte Zeile ist die finale Prognose.
4. `npm run verify` und der Actions-Job prüfen, dass bestehende Zeilen gegenüber dem letzten Commit unverändert sind und jede Prognose vor ihrer Sperrzeit erstellt wurde.

## Backtest (Walk-Forward)

Spiele werden chronologisch prognostiziert. Die Historie enthält nur Spiele mit Anpfiff **vor** dem Zielspiel. Gleichzeitige Spiele sehen einander nicht. Der Tabellen-Endpunkt wird nie benutzt, weil er Zukunftswissen enthält. Ein Test (`test/leakage.test.js`) manipuliert spätere Ergebnisse und prüft, dass frühere Prognosen bitgleich bleiben.

Erster Lauf am 04.11.2026, alle erfassten Ligen, 1.494 Spiele:

| Modell | Accuracy | 95 %-KI | Brier ↓ | Log Loss ↓ | MAE Differenz |
|---|---|---|---|---|---|
| Statistisches Ratingmodell | 66,9 % | 64,5–69,3 % | 0,209 | 0,604 | 24,1 |
| Elo | 62,4 % | 59,9–64,8 % | 0,224 | 0,637 | 24,6 |
| Baseline | 62,6 % | 60,1–65,0 % | 0,223 | 0,636 | 25,3 |

Das Ratingmodell ist signifikant besser als die Baseline (Brier-Differenz −0,014, Bootstrap-95 %-KI −0,019 bis −0,009). Elo ist bisher nicht besser als die Baseline. Bei 4–8 Saisonspielen pro Team lernt ein inkrementelles Rating zu langsam, die gemeinsame Regression über alle Spiele nutzt die wenigen Daten besser. Für die Post-SV-Spiele allein (n=69) sind die Unterschiede noch nicht belastbar.

**Ehrlicher Hinweis:** Die Elo-Startwerte (K=64, Heimvorteil 30) habe ich nach einem Blick auf die ganze Saison gewählt. Belastbar wird der Vergleich erst durch die Live-Prognosen ab jetzt.

### Parameter-Tuning (`npm run tune`)

Grid-Search je Altersklasse auf der ersten zeitlichen Saisonhälfte, Prüfung auf der zweiten. Gegen Zufallstreffer in kleinen Stichproben greifen drei Sicherungen (`adoptDecision` in `src/engine/backtest.js`). Ein getunter Satz wird nur übernommen, wenn

1. er auf der Testhälfte den Brier Score um **mindestens 0,002** senkt,
2. **kein Parameter am Rand des Suchbereichs** liegt (sonst ist das Optimum nicht eingegrenzt) und
3. alle Werte in **plausiblen Grenzen** bleiben (z. B. Elo-K-Faktor 16–100).

Stand 04.11.2026: Kein Satz erfüllt alle drei Bedingungen, es gelten überall die Startwerte. Elo wählt auf der ersten Saisonhälfte in jeder Altersklasse das Maximum K=100. Auf der zweiten Hälfte bringt das aber nichts. Ein früherer Lauf ohne diese Sicherungen hatte für die U16 K=160 übernommen.

## GitHub einrichten

1. Auf github.com ein **öffentliches** Repository anlegen (z. B. `courtside-ai`), ohne README.
2. Lokal:
   ```bash
   git remote add origin https://github.com/<user>/courtside-ai.git
   git push -u origin main
   ```
3. Unter *Settings → Pages → Build and deployment* als Quelle **GitHub Actions** wählen.
4. Unter *Settings → Actions → General → Workflow permissions* **Read and write** erlauben.
5. Optional für die KI: *Settings → Secrets and variables → Actions*: Secret `ANTHROPIC_API_KEY`, Variablen `LLM_ENABLED=true` und `LLM_MAX_CALLS_PER_RUN=20`.
6. Unter *Actions → Update & Deploy → Run workflow* den ersten Lauf manuell starten.

GitHub deaktiviert geplante Workflows in Repos ohne Aktivität nach 60 Tagen. Die stündlichen Daten-Commits sollten das verhindern. Falls es doch passiert, reicht ein Klick auf „Enable workflow“.

## Bekannte Einschränkungen

- Nur die laufende Saison ist abrufbar, das Repo baut die Historie erst selbst auf.
- Wettbewerbsart nur per Namensheuristik. Der Bestätigungsstatus von Ergebnissen ist unzuverlässig.
- Jugendligen haben oft nur 4–8 Spiele pro Team, entsprechend groß sind die Unsicherheiten.
- Die Zeitpunkte der GitHub-Cronjobs sind nicht exakt (Verzögerungen von Minuten sind normal). Die Sperrzeit von 2 h fängt das ab.

## Nächste Schritte

- Phase 4: ML-Modell (Gradient Boosting auf den Features aus `context.js`), sobald genug Spiele vorliegen.
- Phase 5: LLM-Prognosen live schalten und Kosten beobachten.
- Phase 7: Benachrichtigungen, Tuning regelmäßig automatisch.
