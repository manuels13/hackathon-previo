import type { ProviderProfile } from './types';

/**
 * NetEnt slots show BALANCE / BET / WIN in cash mode along the bottom and accept the space bar.
 * TODO(calibrate): not yet seen with a session; verify with `npm run calibrate -- --project=es-starburst`.
 */
export const netEnt: ProviderProfile = {
  id: 'netent',
  name: 'NetEnt',
  labels: {
    en: { credit: /BALANCE|CASH/i, bet: /\bBET\b/i, win: /\bWIN\b/i },
    es: { credit: /SALDO|EFECTIVO/i, bet: /APUESTA/i, win: /GANANCIA|PREMIO/i },
  },
  insufficientBalance: {
    en: /(insufficient|not enough)\s+(funds|balance|money)|don'?t have enough/i,
    es: /(saldo|fondos|dinero)\s+insuficientes?|no\s+(tienes|tiene|hay)\s+(suficiente|saldo)/i,
  },
  visual: {
    introDismiss: { x: 0.5, y: 0.85 },
    focusPoint: { x: 0.5, y: 0.04 },
    spinKey: 'Space',
    spinButton: { x: 0.5, y: 0.92 },
    reels: { x: 0.15, y: 0.12, w: 0.7, h: 0.66 },
    hud: { x: 0, y: 0.82, w: 1, h: 0.18 },
    spinStartDiff: 0.05,
    stableDiff: 0.01,
    stableForMs: 2000,
    spinTimeoutMs: 45_000,
  },
};
