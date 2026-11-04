// Model B – Machine Learning (Phase 4). Noch nicht aktiv.
import { config } from '../config.js';

export const ml = {
  id: 'ml',
  name: 'Machine Learning',
  codeVersion: 0,
  defaults: {},
  status({ trainingGames = 0 } = {}) {
    if (trainingGames < config.ml.minTrainGames) {
      return {
        enabled: false,
        reason: `Zu wenig Trainingsdaten: ${trainingGames} von mindestens ${config.ml.minTrainGames} bewertbaren Spielen. Mit weniger Daten wäre das Modell überangepasst.`,
      };
    }
    return { enabled: false, reason: 'Das Training wird in Phase 4 umgesetzt.' };
  },
  predict() {
    throw new Error('ML-Modell ist nicht aktiv');
  },
};
