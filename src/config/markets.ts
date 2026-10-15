import type { Locator, Page } from '@playwright/test';
import type { Language } from '../providers/types';

export type MarketId = 'es';

type LocatorFn = (page: Page) => Locator;

/**
 * A DOM dialog Betsson may show between opening a game page and the game itself (regulatory
 * session limits, responsible-gaming warnings...). `steps` are clicked in order inside the dialog;
 * `optionalSteps` are clicked only when the dialog shows them (it changes with the account's state).
 */
export interface EntryDialog {
  name: string;
  dialog: LocatorFn;
  steps: ((dialog: Locator) => Locator)[];
  optionalSteps?: ((dialog: Locator) => Locator)[];
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
    /** Opens the account menu that holds "log out". */
    openAccountMenu: LocatorFn;
    logout: LocatorFn;
    /** Close button of the dialog shown after logging out (e.g. a session summary), if any. */
    logoutSummaryClose?: LocatorFn;
    /**
     * API the lobby loads with the logged-in customer. Only its login name is compared, in memory, with
     * the configured accounts to know which one is logged in; nothing from it is stored or reported.
     */
    customerApi: RegExp;
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
    /** Betsson's game catalog, which the lobby loads when the game search opens. */
    gameCatalogApi: RegExp;
    openGameSearch: LocatorFn;
    gameSearchInput: LocatorFn;
    /** Link to a game's page among the search results, by its catalog slug. */
    gameSearchResult: (page: Page, slug: string) => Locator;
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

/** Loss limit of the DGOJ session form: 25% of the balance, enough for a test session. */
const lossLimit25 = (dialog: Locator) => dialog.getByRole('button', { name: /^25%/ }).first();

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
      // Verified logged in: the header balance opens the account menu, which ends with "Cerrar sesión".
      openAccountMenu: (p) => p.locator('[data-test-id="balance-button"]').first(),
      logout: (p) => p.locator('[data-test-id="site-menu-link-anchor-cerrar-sesión"]').first(),
      // DGOJ: logging out shows "Sesión finaliza" (time played, total bets, net losses) with "Cerrar".
      logoutSummaryClose: (p) =>
        p.getByRole('dialog').filter({ hasText: /sesi[óo]n finaliza/i }).getByRole('button', { name: /^cerrar$/i }).first(),
      customerApi: /\/api\/v2\/es\/currentcustomer$/,
      // Verified logged in: the lobby header shows the balance; game pages hide it in a "Saldo" dropdown.
      balanceToggle: (p) => p.locator('[data-test-id="in-game-balance-button"]'),
      balance: (p) =>
        p.locator('[data-test-id="balance-button"], [data-test-id="user-summary-balance"]').filter({ visible: true }).first(),
      // Verified: there is no extra "play for real" step; logged-in players go straight to Real Play.
      // Verified: the search loads the whole catalog (/api/v2/games?countryCode=ES, ~2200 games with
      // name, slug and provider) and filters it in the page; results link to the game page.
      gameCatalogApi: /\/api\/v2\/games$/,
      openGameSearch: (p) => p.locator('[data-test-id="gaming-search-icon"], [data-test-id="gaming-search-text"]').first(),
      gameSearchInput: (p) => p.getByPlaceholder(/b[úu]squeda de juegos/i),
      gameSearchResult: (p, slug) =>
        p.locator(`a[data-test-id="game-thumbnail-title"][href$="/${slug}"]`).filter({ visible: true }).first(),
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
            lossLimit25,
            (d) => startButton(d),
          ],
          // Verified with the account without balance: there is no loss limit to choose (no % buttons),
          // only "No dispones de saldo, pero puedes crear la sesión...". The session still starts.
          optionalSteps: [lossLimit25],
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
