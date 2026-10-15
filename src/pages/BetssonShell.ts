import type { Locator, Page } from '@playwright/test';
import { type AccountKind, accountKindOf, type Credentials, getCredentials, hasCredentials } from '../config/credentials';
import type { MarketConfig } from '../config/markets';
import type { ResolvedGame } from '../games/catalog';
import { type BetssonGame, pickGame } from '../games/discover';
import { parseCents } from '../utils/money';
import { SecretTyper } from '../utils/secretInput';
import { GameFrame } from './GameFrame';

export interface BalanceReading {
  cents: number | null;
  text: string;
  currencyVisible: boolean;
  /** Screenshot of the balance amount only (no account holder data), as evidence. */
  screenshot: Buffer;
}

export interface AccountSnapshot {
  /** Wallet as Betsson's API reported it to the page; null if the page did not load it (logged out). */
  wallet: { amount: number; currency: string } | null;
  /** Seconds left in the login session (it lasts ~19 min); 0 when logged out. */
  sessionSecondsLeft: number;
  /** Which configured account is logged in; null when the lobby did not load the customer. */
  account: AccountKind | 'other' | null;
}

/** Betsson's own site (lobby, login, wallet balance): regular DOM around the provider game. */
export class BetssonShell {
  /** Dialogs handled by the last launchGame(), for the report. */
  entryDialogsHandled: string[] = [];

  constructor(
    readonly page: Page,
    readonly market: MarketConfig,
  ) {}

  private get ui() {
    return this.market.shell;
  }

  async openLobby(): Promise<void> {
    await this.page.goto(this.market.baseUrl + this.market.casinoPath);
    await this.acceptCookies();
  }

  async acceptCookies(): Promise<void> {
    const button = this.ui.acceptCookies(this.page);
    // isVisible() does not wait, so wait explicitly for the banner to show up.
    const shown = await button.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    if (shown) await button.click();
  }

  /**
   * Logs in typing like a person. Credentials never reach any evidence:
   * - with CDP they are typed through a separate DevTools connection (SecretTyper), not Playwright's
   *   API, and the browser trace is paused meanwhile (its DOM snapshots and network log would keep
   *   the field values and the login request). What the trace recorded before the login is dropped;
   * - on failure the page is cleared before rethrowing, so the error snapshot shows no form.
   */
  async login(credentials: Credentials): Promise<void> {
    const typer = await SecretTyper.forPage(this.page, process.env.CDP_URL);
    const tracing = this.page.context().tracing;
    // Fails when this test does not trace (setup project): then there is nothing to pause.
    const paused = typer ? await tracing.stopChunk().then(() => true, () => false) : false;
    const type = async (field: ReturnType<MarketConfig['shell']['username']>, text: string) => {
      // Clear first: the browser may have autofilled a saved email, and typing would append to it.
      await field.click();
      await field.fill('');
      if (typer) await typer.type(text);
      else await field.pressSequentially(text, { delay: 40 });
    };
    let step = 'open login dialog';
    try {
      await this.ui.openLogin(this.page).click();
      step = 'type username';
      await type(this.ui.username(this.page), credentials.username);
      step = 'type password';
      await type(this.ui.password(this.page), credentials.password);
      step = 'submit';
      await this.ui.submitLogin(this.page).click();
      step = 'wait for logged-in state';
      await this.ui.loggedOutMarker(this.page).waitFor({ state: 'hidden', timeout: 30_000 });
    } catch (error) {
      const alert = await this.page.getByRole('alert').allInnerTexts().catch(() => []);
      await this.page.goto('about:blank').catch(() => undefined);
      const reason = String(error instanceof Error ? error.message : error).split('\n')[0];
      throw new Error(`Login failed at "${step}": ${reason}. Site message: ${alert.join(' ').trim() || 'none'}`);
    } finally {
      // The login form is gone by now (or the page is blank): tracing can go on.
      if (paused) await tracing.startChunk().catch(() => undefined);
    }
    await this.dismissPrompts();
  }

  /** True when the current session is logged in (used to reuse a saved session). */
  /** The lobby shows the "log in" button, i.e. the session is really closed. */
  async canLogIn(): Promise<boolean> {
    return this.ui
      .loggedOutMarker(this.page)
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true, () => false);
  }

  async isLoggedIn(minSecondsLeft = 0): Promise<boolean> {
    // The header can still show a logged-in layout after the session expired; the wallet and the
    // session's time to live that the site loads are the reliable signal.
    const account = await this.openLobbyAndReadAccount();
    return account.wallet !== null && account.sessionSecondsLeft > minSecondsLeft;
  }

  /** Closes known non-blocking panels if they show up. Best effort: never fails the test. */
  async dismissPrompts(): Promise<void> {
    for (const prompt of this.ui.prompts) {
      const target = prompt(this.page).first();
      if (await target.isVisible().catch(() => false)) await target.click({ timeout: 3_000 }).catch(() => undefined);
    }
  }

  async readBalance(): Promise<BalanceReading> {
    const toggle = this.ui.balanceToggle?.(this.page);
    const balance = this.ui.balance(this.page);
    const opened = Boolean(toggle) && !(await balance.isVisible()) && (await toggle!.isVisible());
    if (opened) await toggle!.click();
    const text = (await balance.innerText({ timeout: 15_000 })).trim();
    const screenshot = await balance.screenshot();
    if (opened) await toggle!.click();
    return { cents: parseCents(text), text, currencyVisible: this.market.currencyMarks.test(text), screenshot };
  }

  /**
   * Gets through the market's DOM dialogs between the game page and the game, in whatever order
   * they appear. Returns the names of the dialogs handled. Done once none has shown up for `quietMs`.
   */
  async passGameEntryDialogs(siteDecided: Promise<unknown>, timeoutMs = 60_000, quietMs = 4_000): Promise<string[]> {
    const handled: string[] = [];
    const deadline = Date.now() + timeoutMs;
    // The quiet period only counts once the site has checked the gaming session: before that, "no
    // dialog yet" means nothing (the recent-session warning shows up ~10 s after the page loads).
    let decided = false;
    void siteDecided.finally(() => (decided = true));
    let quietSince = Date.now();
    while (Date.now() < deadline && !(decided && Date.now() - quietSince >= quietMs)) {
      if (!decided) quietSince = Date.now();
      const entry = await this.visibleEntryDialog();
      if (!entry) {
        await this.page.waitForTimeout(500);
        continue;
      }
      const dialog = entry.dialog(this.page);
      for (const step of entry.steps) {
        const target = step(dialog);
        // An optional step the dialog does not show (e.g. no loss limit without balance) is skipped.
        if (entry.optionalSteps?.includes(step)) {
          const shown = await target.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false);
          if (!shown) continue;
        }
        await target.click();
      }
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      handled.push(entry.name);
      quietSince = Date.now();
    }
    return handled;
  }

  private async visibleEntryDialog() {
    for (const entry of this.ui.gameEntryDialogs) {
      if (await entry.dialog(this.page).isVisible().catch(() => false)) return entry;
    }
    return undefined;
  }

  /**
   * Opens the lobby and keeps what Betsson's own frontend loads with it: the wallet balance
   * (/api/v2/wallet/balance) and the login session's time to live. Nothing is requested by us and
   * no session token is touched: the responses the site fetches for the player are only read.
   */
  async openLobbyAndReadAccount(): Promise<AccountSnapshot> {
    const json = (pattern: RegExp) =>
      this.page
        .waitForResponse((r) => pattern.test(new URL(r.url()).pathname), { timeout: 20_000 })
        .then((r) => (r.ok() ? r.json() : null))
        .catch(() => null);
    const wallet = json(/\/api\/v2\/wallet\/balance$/);
    const session = json(/\/api\/v1\/current-single-sign-on-session$/);
    const customer = json(this.ui.customerApi);
    await this.openLobby();
    const [w, s, c] = await Promise.all([wallet, session, customer]);
    // Only the login name is used, to tell the accounts apart; the rest of the customer is personal data.
    const login: unknown = c?.loginInformation?.username;
    return {
      wallet: w ? { amount: w.balance.totalAmount, currency: w.balance.currencyCode } : null,
      sessionSecondsLeft: s ? Math.floor(s.timeToLiveSeconds) : 0,
      account: typeof login === 'string' ? accountKindOf(this.market.id, login) : null,
    };
  }

  /** Logs out from the lobby through the account menu, as a player would. */
  async logout(): Promise<void> {
    await this.ui.openAccountMenu(this.page).click();
    await this.ui.logout(this.page).click();
    const loggedOut = this.ui.loggedOutMarker(this.page);
    const summary = this.ui.logoutSummaryClose?.(this.page);
    const deadline = Date.now() + 30_000;
    while (!(await loggedOut.isVisible().catch(() => false))) {
      if (Date.now() > deadline) throw new Error('Logged out, but the lobby never showed the "Iniciar sesión" button');
      if (summary && (await summary.isVisible().catch(() => false))) await summary.click();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Leaves the lobby logged in with the given test account: keeps the session when it already is,
   * otherwise logs out whoever is logged in and logs in with that account. Used with the person's own
   * Chrome (CDP), where both scenarios share one window but need different accounts. Safe inside a
   * traced test: login() keeps the credentials out of the trace.
   */
  async useAccount(kind: AccountKind): Promise<AccountSnapshot> {
    // The wallet the lobby loads is the logged-in signal; it can be slow, so a miss is retried once.
    let account = await this.openLobbyAndReadAccount();
    if (account.wallet === null) account = await this.openLobbyAndReadAccount();
    const loggedIn = account.wallet !== null && account.sessionSecondsLeft > 0;
    // An unidentified customer is kept: the scenarios check the account state themselves.
    if (loggedIn && (account.account === kind || account.account === null)) return account;

    if (!hasCredentials(this.market.id, kind)) {
      throw new Error(`The ${kind} account is not logged in and BETSSON_${this.market.id.toUpperCase()}_${kind.toUpperCase()}_* are not set`);
    }
    if (loggedIn) await this.logout();
    else if (!(await this.canLogIn())) {
      throw new Error('Betsson did not load the account and shows no "Iniciar sesión" button: check the Chrome window');
    }
    await this.login(getCredentials(this.market.id, kind));
    account = await this.openLobbyAndReadAccount();
    if (account.wallet === null) throw new Error(`Logged in with the ${kind} account, but Betsson did not load its wallet`);
    if (account.account !== null && account.account !== kind) {
      throw new Error(`Logged in, but Betsson reports another account (${account.account}) instead of ${kind}`);
    }
    return account;
  }

  /**
   * Finds a game on Betsson the way a player does: opens the game search, picks the game in the
   * catalog the search loads (by name, slug or id) and follows its result to the game page.
   * Nothing about the game is configured in the repository.
   */
  async findGame(query: string): Promise<ResolvedGame> {
    await this.openLobby();
    const catalog = this.page
      .waitForResponse((r) => this.ui.gameCatalogApi.test(new URL(r.url()).pathname), { timeout: 30_000 })
      .then((r) => r.json() as Promise<BetssonGame[]>);
    await this.ui.openGameSearch(this.page).click();
    const { game, provider } = pickGame(await catalog, query);
    await this.ui.gameSearchInput(this.page).fill(game.name);
    const result = this.ui.gameSearchResult(this.page, game.slug);
    const path = await result.getAttribute('href', { timeout: 15_000 });
    if (!path) throw new Error(`Betsson's search shows no link for "${game.name}"`);
    return { id: game.slug, name: game.name, provider, path, visual: provider.visual };
  }

  async launchGame(game: ResolvedGame): Promise<GameFrame> {
    const { entryStateApi } = this.ui;
    const siteDecided = entryStateApi
      ? this.page
          .waitForResponse((r) => entryStateApi.test(new URL(r.url()).pathname), { timeout: 30_000 })
          .catch(() => null)
      : Promise.resolve(null);
    await this.page.goto(this.market.baseUrl + game.path);
    this.entryDialogsHandled = await this.passGameEntryDialogs(siteDecided);
    await this.dismissPrompts();
    return new GameFrame(this.page, await this.findGameFrame(), game);
  }

  /**
   * The provider game is the largest visible iframe on the page. Other iframes (anti-fraud,
   * analytics) are tiny or hidden. This works for any provider without knowing its URLs.
   */
  private async findGameFrame(timeoutMs = 60_000): Promise<Locator> {
    const frames = this.ui.gameFrame(this.page);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const areas = await frames.evaluateAll((els) =>
        els.map((el) => {
          const { width, height } = el.getBoundingClientRect();
          return width * height;
        }),
      );
      const largest = areas.indexOf(Math.max(0, ...areas));
      if (largest >= 0 && areas[largest] > 200 * 200) {
        // Tag it: the page keeps adding iframes, so a positional nth() would drift to another one.
        await frames.nth(largest).evaluate((el) => el.setAttribute('data-validation-game', ''));
        return this.page.locator('iframe[data-validation-game]');
      }
      await this.page.waitForTimeout(1_000);
    }
    throw new Error('No game iframe appeared on the page');
  }
}
