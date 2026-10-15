import type { ProviderProfile } from './types';

/**
 * Pragmatic Play slots share one UI: a bottom bar with CREDIT / BET / WIN, a round spin button on
 * the right and the space bar as spin shortcut.
 * Points and regions verified on Sweet Bonanza in betsson.es; thresholds still to tune on real spins.
 */
export const pragmaticPlay: ProviderProfile = {
  id: 'pragmatic-play',
  name: 'Pragmatic Play',
  labels: {
    en: { credit: /CREDIT/i, bet: /\bBET\b/i, win: /\bWIN\b/i },
    es: { credit: /CR[ÉE]DITO/i, bet: /APUESTA/i, win: /GANANCIA|PREMIO/i },
  },
  insufficientBalance: {
    en: /(insufficient|not enough)\s+(funds|balance|credit)|don'?t have enough/i,
    es: /(saldo|fondos|cr[ée]dito)\s+insuficientes?|no\s+(tienes|tiene|hay)\s+(suficiente|saldo)/i,
  },
  visual: {
    // Verified on Sweet Bonanza: the "continue" button of the intro screen sits right of the reels.
    introDismiss: { x: 0.75, y: 0.34 },
    focusPoint: { x: 0.5, y: 0.04 },
    spinKey: 'Space',
    // Verified on Sweet Bonanza (es): spin button bottom centre-right, CRÉDITO/APUESTA bottom-left,
    // win message bottom centre. The HUD region stays below the side "APUESTA" ante box on purpose.
    spinButton: { x: 0.772, y: 0.904 },
    reels: { x: 0.25, y: 0.1, w: 0.65, h: 0.76 },
    hud: { x: 0.15, y: 0.88, w: 0.6, h: 0.11 },
    ocrFilter: 'warm-text',
    // The CRÉDITO / APUESTA numbers, right of their labels (checked on two real screenshots).
    fields: {
      credit: { x: 0.23, y: 0.892, w: 0.14, h: 0.046 },
      bet: { x: 0.23, y: 0.93, w: 0.14, h: 0.046 },
    },
    spinStartDiff: 0.05,
    stableDiff: 0.01,
    stableForMs: 2500,
    spinTimeoutMs: 60_000,
  },
  traffic: {
    isGameCall: (url) => /\/gs2c\/ge\/v\d+\/gameService/.test(url),
    parse: parsePragmaticCall,
  },
};

/**
 * Stake multiplier when the "double chance" ante is on (bl=1). Sweet Bonanza: 2,00 € → 2,50 €.
 */
const ANTE_MULTIPLIER = 1.25;

/**
 * Pragmatic's game service talks in url-encoded forms. Verified on a recorded Sweet Bonanza round:
 *   doSpin  request  c=0.01&l=20&bl=0         → stake 0.01 × 20 = 0.20
 *   doSpin  response balance=99.28&tw=0.05&rs=t (stake taken, cascade pending)
 *   doSpin  response tw=0.05&na=c               (cascades over, win to collect)
 *   doCollect response balance=99.33&na=s       (round closed: 99.48 − 0.20 + 0.05)
 * `na` is the next action the server expects: "s" means a new spin, i.e. the round is settled,
 * unless `rs=t` says a cascade is still pending.
 */
function parsePragmaticCall(requestBody: string, responseBody: string) {
  const request = new URLSearchParams(requestBody);
  const response = new URLSearchParams(responseBody);
  const action = request.get('action');
  const number = (value: string | null) => (value === null || value === '' ? undefined : Number(value));
  const kind = action === 'doInit' ? 'init' : action === 'doSpin' ? 'spin' : action === 'doCollect' ? 'collect' : 'other';
  const coin = number(request.get('c'));
  const lines = number(request.get('l'));
  return {
    kind,
    wager:
      kind === 'spin' && coin !== undefined && lines !== undefined
        ? Math.round(coin * lines * (request.get('bl') === '1' ? ANTE_MULTIPLIER : 1) * 100) / 100
        : undefined,
    balance: number(response.get('balance')),
    totalWin: number(response.get('tw')),
    // "na=s" alone is not enough: the first answer of a cascading spin already says na=s but carries
    // rs=t ("respin/tumble pending"); the round only ends once no tumble is left to play.
    roundClosed: response.get('na') === 's' && response.get('rs') !== 't',
  } as const;
}
