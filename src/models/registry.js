// Registrierte Modelle + Parameterverwaltung. Neue Modelle werden hier eingetragen.
// Parameter: Defaults im Modell, Overrides je Altersklasse aus data/model-params.json
// (wird durch `npm run tune` erzeugt). Die Version ändert sich mit Code oder Parametern.
import { baseline } from './baseline.js';
import { elo } from './elo.js';
import { ratingModel } from './ratingModel.js';
import { shortHash } from '../util/hash.js';

export const statModels = [baseline, elo, ratingModel];

export function loadParams(store) {
  return store ? store.readJson('model-params.json', {}) : {};
}

/** Parameter eines Modells für eine Altersklasse */
export function paramsFor(model, ageGroup, allParams = {}) {
  const p = allParams[model.id] || {};
  return { ...model.defaults, ...(p.default || {}), ...(p[ageGroup] || {}) };
}

/** Modellversion = Code-Version + Hash aller Parameter (alle Altersklassen). */
export function modelVersion(model, allParams = {}) {
  return `${model.codeVersion}.${shortHash({ d: model.defaults, p: allParams[model.id] || {} }, 8)}`;
}
