import type { Locator, Page } from '@playwright/test';
import type { Language } from '../providers/types';

export type MarketId = 'es';

type LocatorFn = (page: Page) => Locator;

/**
 * A DOM dialog Betsson may show between opening a game page and the game itself (regulatory
 * session limits, responsible-gaming warnings...). `steps` are clicked in order inside the dialog.
 */
export interface EntryDialog {
  name: string;
  dialog: LocatorFn;
  steps: ((dialog: Locator) => Locator)[];
}

/** Everything about a Betsson site that is independent of the game being tested. */
export interface MarketConfig {
  id: MarketId;
  baseUrl: string;
  /** Hostnames that belong to Betsson for this market (they get the extra headers). */
  ownHosts: RegExp;
  /** Casino lobby path relative to baseUrl. */
  casinoPath: string;
  /** Expected language of what the player sees. */
  language: Language;
  currency: 'EUR';
  /** Ways the currency may be displayed (and read by the VLM). */
  currencyMarks: RegExp;
  /** Betsson's own site (outside the game), which is regular DOM. */
  shell: {
    acceptCookies: LocatorFn;
    openLogin: LocatorFn;
    username: LocatorFn;
    password: LocatorFn;
    submitLogin: LocatorFn;
    /** Visible only while logged out (the header "log in" button). */
    loggedOutMarker: LocatorFn;
    /** Opens the balance dropdown on pages where the balance is hidden behind one. */
    balanceToggle?: LocatorFn;
    balance: LocatorFn;
    /** Dialogs that can stand between the game page and the game, in any order. */
    gameEntryDialogs: EntryDialog[];
    /**
     * API the site calls to decide which entry dialog to show. Dialogs are watched for at least until
     * it answers, since they can appear seconds after the page has loaded.
     */
    entryStateApi?: RegExp;
    /** Candidate iframes for the game (the largest visible one is used). */
    gameFrame: LocatorFn;
    /** Non-blocking panels/dialogs to close when they show up (best effort). */
    prompts: LocatorFn[];
    /** Elements with personal data, masked in every screenshot. */
    sensitive: LocatorFn[];
  };
}

/** "Iniciar sesión" button of Betsson's gaming-session dialogs (its label may live in a shadow root). */
const startButton = (dialog: Locator) =>
  dialog.getByRole('button', { name: /^iniciar sesi[óo]n$/i }).or(dialog.getByText(/^iniciar sesi[óo]n$/i)).first();

export const markets: Record<MarketId, MarketConfig> = {
  es: {
    id: 'es',
    baseUrl: 'https://www.betsson.es',
    ownHosts: /(^|\.)betsson\.es$/,
    casinoPath: '/casino',
    language: 'es',
    currency: 'EUR',
    currencyMarks: /€|EUR|\bE(?=\s?\d)/,
    shell: {
      // Verified on the live site: cookies, login dialog.
      acceptCookies: (p) => p.locator('#onetrust-accept-btn-handler'),
      openLogin: (p) => p.getByRole('button', { name: /^iniciar sesi[óo]n$/i }).first(),
      username: (p) => p.locator('input[name="email"]'),
      password: (p) => p.locator('input[name="password"]'),
      submitLogin: (p) => p.getByRole('button', { name: /^iniciar sesi[óo]n$/i }).last(),
      loggedOutMarker: (p) => p.getByRole('button', { name: /^iniciar sesi[óo]n$/i }).first(),
      // Verified logged in: the lobby header shows the balance; game pages hide it in a "Saldo" dropdown.
      balanceToggle: (p) => p.locator('[data-test-id="in-game-balance-button"]'),
      balance: (p) =>
        p.locator('[data-test-id="balance-button"], [data-test-id="user-summary-balance"]').filter({ visible: true }).first(),
      // Verified: there is no extra "play for real" step; logged-in players go straight to Real Play.
      // All iframes on the game page; BetssonShell picks the largest visible one as the game.
      gameFrame: (p) => p.locator('iframe'),
      // Verified in the site's traffic: the gaming-session check answers ~10 s after the game page loads,
      // and only then the dialogs below show up.
      entryStateApi: /\/api\/v1\/gaming\/dgoj\/Session\/Check$/,
      // Verified on the live site (DGOJ rules). They show up depending on the account's session state.
      gameEntryDialogs: [
        {
          // "Atención. Hace menos de 60 mins. que finalizaste tu sesión de juego." → start a new one.
          name: 'recent gaming session warning',
          dialog: (p) => p.getByRole('dialog').filter({ hasText: /hace menos de \d+ min/i }).first(),
          steps: [(d) => startButton(d)],
        },
        {
          // "Se ha sobrepasado el límite de tiempo de sesión": play time + loss limit, then start.
          // 1 hour and 25% of the balance are enough for a test session.
          name: 'gaming session limits',
          dialog: (p) => p.getByRole('dialog').filter({ hasText: /tiempo de juego/i }).first(),
          steps: [
            (d) => d.getByRole('button', { name: /^1 hora$/i }).first(),
            (d) => d.getByRole('button', { name: /^25%/ }).first(),
            (d) => startButton(d),
          ],
        },
      ],
      // Only dialogs seen on the live site; generic "Aceptar" matching clicked things it should not.
      prompts: [
        // Tournaments side panel on game pages.
        (p) => p.getByText(/^cerrar y no volver a mostrar$/i),
      ],
      // Betsson marks personal data (account holder name...) for its own session-recording masking.
      sensitive: [(p) => p.locator('[data-cs-mask], [data-hj-suppress]')],
    },
  },
};

export function getMarket(id: string): MarketConfig {
  if (!(id in markets)) throw new Error(`Unknown market "${id}". Expected one of: ${Object.keys(markets).join(', ')}`);
  return markets[id as MarketId];
}
