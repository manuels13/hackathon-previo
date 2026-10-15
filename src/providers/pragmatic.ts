import type { GameCall, ProviderProfile } from './types';

/**
 * Pragmatic Play. Verified on Sweet Bonanza in betsson.es: intro screen, reels area and the
 * game-service traffic of a real round.
 */
export const pragmaticPlay: ProviderProfile = {
  id: 'pragmatic-play',
  name: 'Pragmatic Play',
  insufficientBalance: {
    en: /(insufficient|not enough)\s+(funds|balance|credit)|don'?t have enough/i,
    es: /(saldo|fondos|cr[ée]dito)\s+insuficientes?|no\s+(tienes|tiene|hay)\s+(suficiente|saldo)/i,
  },
  visual: {
    // The "continue" button of the intro screen sits right of the reels.
    introDismiss: { x: 0.75, y: 0.34 },
    reels: { x: 0.25, y: 0.1, w: 0.65, h: 0.76 },
    spinStartDiff: 0.05,
    stableDiff: 0.01,
    stableForMs: 2500,
  },
  traffic: {
    isGameCall: (url) => /\/gs2c\/(ge\/v\d+\/gameService|SingleSessionAPI\/data)/.test(url),
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
function parsePragmaticCall(requestBody: string, responseBody: string): GameCall {
  // SingleSessionAPI/data answers JSON when the game opens: currency, language and jurisdiction the
  // provider configured for this player, plus the balance it sees.
  if (responseBody.trimStart().startsWith('{')) {
    const data = JSON.parse(responseBody).data ?? {};
    return {
      kind: 'session',
      session: {
        currency: data.currencyCode ?? data.currency,
        language: data.lang,
        jurisdiction: data.jurisdiction,
        balance: data.balance?.total,
      },
      roundClosed: false,
    };
  }
  const request = new URLSearchParams(requestBody);
  const response = new URLSearchParams(responseBody);
  const action = request.get('action');
  const number = (value: string | null) => (value === null || value === '' ? undefined : Number(value));
  const kind = action === 'doInit' ? 'init' : action === 'doSpin' ? 'spin' : action === 'doCollect' ? 'collect' : 'other';
  const coin = number(request.get('c'));
  const lines = number(request.get('l'));
  return {
    kind: kind as GameCall['kind'],
    wager:
      kind === 'spin' && coin !== undefined && lines !== undefined
        ? Math.round(coin * lines * (request.get('bl') === '1' ? ANTE_MULTIPLIER : 1) * 100) / 100
        : undefined,
    balance: number(response.get('balance')),
    totalWin: number(response.get('tw')),
    // "na=s" alone is not enough: the first answer of a cascading spin already says na=s but carries
    // rs=t ("respin/tumble pending"); the round only ends once no tumble is left to play.
    roundClosed: response.get('na') === 's' && response.get('rs') !== 't',
  };
}
