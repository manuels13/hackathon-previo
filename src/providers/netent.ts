import type { ProviderProfile } from './types';

/**
 * NetEnt. Second provider, to show the scenarios run unchanged on another studio: the VLM finds the
 * spin button and reads the amounts, so only the intro click and the reels area are needed here.
 * TODO(calibrate): not yet seen with a session (intro point, reels area); no traffic parser yet,
 * so its rounds are judged from the screen and Betsson's wallet only.
 */
export const netEnt: ProviderProfile = {
  id: 'netent',
  name: 'NetEnt',
  insufficientBalance: {
    en: /(insufficient|not enough)\s+(funds|balance|money)|don'?t have enough/i,
    es: /(saldo|fondos|dinero)\s+insuficientes?|no\s+(tienes|tiene|hay)\s+(suficiente|saldo)/i,
  },
  visual: {
    introDismiss: { x: 0.5, y: 0.85 },
    reels: { x: 0.15, y: 0.12, w: 0.7, h: 0.66 },
    spinStartDiff: 0.05,
    stableDiff: 0.01,
    stableForMs: 2000,
  },
};
