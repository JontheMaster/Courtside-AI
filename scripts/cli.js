#!/usr/bin/env node
// Kommandozeile: sync | predict | backtest | tune | build | update | verify
import { config } from '../src/config.js';
import { createStore } from '../src/store/fileStore.js';
import { runSync } from '../src/sync/sync.js';
import { runPredictions } from '../src/engine/predict.js';
import { runBacktest, summarize, tune } from '../src/engine/backtest.js';
import { buildSite } from '../src/build/site.js';
import { verifyPredictions } from '../src/engine/verify.js';
import { logger } from '../src/util/log.js';

const log = logger('cli');
const store = createStore();

const TUNING_GRIDS = {
  // Suchbereiche bewusst innerhalb plausibler Grenzen; Randwerte werden nicht übernommen (siehe adoptDecision)
  elo: { k: [24, 32, 48, 64, 80, 100], hfa: [0, 15, 30, 45, 60, 80], eloPerPoint: [6, 9, 12, 16, 20, 25], shrinkN0: [0, 0.5, 1, 2, 4] },
  rating: { lambda: [0.5, 1, 2, 4, 8, 16], hfa0: [0, 1.5, 3, 4.5, 6, 8], sigma0: [10, 12, 15, 18, 21, 25] },
};

const commands = {
  sync: () => runSync(store),
  predict: () => runPredictions(store),
  backtest: () => {
    const bt = runBacktest(store);
    console.log(summarize(bt));
  },
  tune: () => {
    const r = tune(store, TUNING_GRIDS);
    console.table(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.skipped ? { skipped: v.skipped } : { testN: v.testN, default: v.testBrierDefault, tuned: v.testBrierTuned, adopted: v.adopted }])));
    for (const [k, v] of Object.entries(r)) {
      if (v.best) console.log(`${k}: ${JSON.stringify(v.best)}${v.reasons?.length ? ` → verworfen: ${v.reasons.join('; ')}` : ' → übernommen'}`);
    }
  },
  build: () => buildSite(store),
  verify: () => {
    // optional: Vergleichsstand, z. B. `verify HEAD~1` nach einem Push
    const r = verifyPredictions(config.root, { ref: process.argv[3] || 'HEAD' });
    log.info(`${r.files} Dateien, ${r.records} Prognosen geprüft`);
    if (!r.ok) {
      for (const e of r.errors) log.error(e);
      process.exitCode = 1;
    }
  },
  // Kompletter Lauf (GitHub Actions): Daten holen → Prognosen → Backtest → Seite bauen → prüfen
  update: async () => {
    const s = await runSync(store);
    await runPredictions(store);
    runBacktest(store);
    buildSite(store);
    commands.verify();
    if (s.failed.length) log.warn(`${s.failed.length} Ligen konnten nicht geladen werden`);
  },
};

const cmd = process.argv[2];
if (!commands[cmd]) {
  console.error(`Verwendung: node scripts/cli.js <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
try {
  await commands[cmd]();
} catch (err) {
  log.error(err.stack || err.message);
  process.exitCode = 1;
}
