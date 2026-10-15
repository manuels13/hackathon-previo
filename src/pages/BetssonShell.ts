import type { Locator, Page } from '@playwright/test';
import type { Credentials } from '../config/credentials';
import type { MarketConfig } from '../config/markets';
import type { ResolvedGame } from '../games/catalog';
import { parseCents } from '../utils/money';
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
   * Logs in typing like a person. On failure the page is cleared before rethrowing: Playwright's
   * error snapshot would otherwise record the typed password in the report.
   */
  async login(credentials: Credentials): Promise<void> {
    let step = 'open login dialog';
    try {
      await this.ui.openLogin(this.page).click();
      step = 'type username';
      await this.ui.username(this.page).pressSequentially(credentials.username, { delay: 40 });
      step = 'type password';
      await this.ui.password(this.page).pressSequentially(credentials.password, { delay: 40 });
      step = 'submit';
      await this.ui.submitLogin(this.page).click();
      step = 'wait for logged-in state';
      await this.ui.loggedOutMarker(this.page).waitFor({ state: 'hidden', timeout: 30_000 });
    } catch (error) {
      const alert = await this.page.getByRole('alert').allInnerTexts().catch(() => []);
      await this.page.goto('about:blank').catch(() => undefined);
      const reason = String(error instanceof Error ? error.message : error).split('\n')[0];
      throw new Error(`Login failed at "${step}": ${reason}. Site message: ${alert.join(' ').trim() || 'none'}`);
    }
    await this.dismissPrompts();
  }

  /** True when the current session is logged in (used to reuse a saved session). */
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
  async passGameEntryDialogs(timeoutMs = 45_000, quietMs = 4_000): Promise<string[]> {
    const handled: string[] = [];
    const deadline = Date.now() + timeoutMs;
    let quietSince = Date.now();
    while (Date.now() < deadline && Date.now() - quietSince < quietMs) {
      const entry = await this.visibleEntryDialog();
      if (!entry) {
        await this.page.waitForTimeout(500);
        continue;
      }
      const dialog = entry.dialog(this.page);
      for (const step of entry.steps) await step(dialog).click();
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
    await this.openLobby();
    const [w, s] = await Promise.all([wallet, session]);
    return {
      wallet: w ? { amount: w.balance.totalAmount, currency: w.balance.currencyCode } : null,
      sessionSecondsLeft: s ? Math.floor(s.timeToLiveSeconds) : 0,
    };
  }

  /**
   * Reads the wallet balance after a game round. The header may refresh with a delay, so it is
   * polled until it reaches `expected`; if it never does, the last reading is returned as is and
   * the check reports the mismatch.
   */
  async readBalanceSettled(expected: number | null, timeoutMs = 30_000): Promise<BalanceReading> {
    const deadline = Date.now() + timeoutMs;
    let reading = await this.readBalance();
    while (reading.cents !== expected && Date.now() < deadline) {
      await this.page.waitForTimeout(2_000);
      reading = await this.readBalance();
    }
    return reading;
  }

  async launchGame(game: ResolvedGame): Promise<GameFrame> {
    await this.page.goto(this.market.baseUrl + game.path);
    this.entryDialogsHandled = await this.passGameEntryDialogs();
    const playReal = this.ui.playReal(this.page);
    if (await playReal.isVisible({ timeout: 10_000 }).catch(() => false)) await playReal.click();
    await this.dismissPrompts();
    return new GameFrame(this.page, await this.findGameFrame(), this.market, game);
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
