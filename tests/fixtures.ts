import fs from 'node:fs';
import { type Browser, test as base, type Page } from '@playwright/test';
import { type AccountKind, applyExtraHeaders, authFile } from '../src/config/credentials';
import { getMarket, type MarketConfig, type MarketId } from '../src/config/markets';
import { type ResolvedGame, resolveGame } from '../src/games/catalog';
import { BetssonShell } from '../src/pages/BetssonShell';
import { Checks } from '../src/report/Checks';
import { terminateOcr } from '../src/vision/ocr';

/**
 * CDP_URL=http://127.0.0.1:9222 attaches to a Chrome that a person started with
 * --remote-debugging-port and logged into by hand. Betsson blocks logins from browsers opened by
 * automation, so in this mode the tests never log in: they reuse that window's session and only
 * open (and close) their own tabs in it.
 */
export const cdpUrl = process.env.CDP_URL;

interface Options {
  /** Set per Playwright project in playwright.config.ts. */
  marketId: MarketId;
  gameId: string;
  /** Which test account the spec logs in with. */
  account: AccountKind;
}

interface Fixtures {
  market: MarketConfig;
  game: ResolvedGame;
  shell: BetssonShell;
  checks: Checks;
}

interface WorkerFixtures {
  ocr: void;
  cdpBrowser: Browser;
}

/** A new tab in the person's logged-in Chrome. Playwright traces and screenshots it like its own pages. */
async function cdpPage(browser: Browser, use: (page: Page) => Promise<void>) {
  const context = browser.contexts()[0];
  if (!context) throw new Error(`No browser window found at ${cdpUrl}`);
  const page = await context.newPage();
  await page.bringToFront();
  await page.setViewportSize({ width: 1600, height: 900 });
  try {
    await use(page);
  } finally {
    // Only the tab this test opened is closed (KEEP_OPEN=1 leaves it for the person to carry on);
    // the person's window and session stay as they were.
    if (!process.env.KEEP_OPEN) await page.close();
  }
}

export const test = base.extend<Fixtures & Options, WorkerFixtures>({
  marketId: ['es', { option: true }],
  gameId: ['', { option: true }],
  account: ['funded', { option: true }],
  market: async ({ marketId }, use) => use(getMarket(marketId)),
  game: async ({ gameId, marketId }, use) => use(resolveGame(gameId, marketId)),
  // Reuse the session saved by auth.setup.ts, so logins (and passwords) never appear in traces.
  // With CDP the session lives in the attached Chrome instead.
  storageState: async ({ marketId, account }, use, testInfo) => {
    if (cdpUrl) return use(undefined);
    const file = authFile(marketId, account);
    testInfo.skip(!fs.existsSync(file), `No saved session for the ${account} account: its credentials are not set`);
    await use(file);
  },
  cdpBrowser: [async ({ playwright }, use) => {
    const browser = await playwright.chromium.connectOverCDP(cdpUrl!).catch((error) => {
      throw new Error(
        `Cannot reach Chrome at ${cdpUrl}. Start it and log in by hand first:\n` +
          `  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\\chrome-betsson"\n` +
          `Or remove CDP_URL from .env to let Playwright open its own browser. (${String(error).split('\n')[0]})`,
      );
    });
    await use(browser);
    // For a CDP connection this only disconnects; the person's Chrome keeps running.
    await browser.close();
  }, { scope: 'worker' }],
  // Only overridden in CDP mode, so the default mode never connects and CDP mode never launches a browser.
  ...(cdpUrl
    ? {
        page: async ({ cdpBrowser }, use) => cdpPage(cdpBrowser, use),
      }
    : {}),
  shell: async ({ page, market }, use) => {
    await applyExtraHeaders(page.context(), market);
    await use(new BetssonShell(page, market));
    // The attached Chrome outlives the test: leave its context as it was.
    if (cdpUrl) await page.context().unrouteAll({ behavior: 'ignoreErrors' });
  },
  checks: async ({ page, market, game }, use, testInfo) => {
    const checks = new Checks(page, market, testInfo, testInfo.title, game.name, game.provider.name);
    await use(checks);
    await checks.attachSummary();
  },
  ocr: [async ({}, use) => {
    await use();
    await terminateOcr();
  }, { scope: 'worker', auto: true }],
});

export { expect } from '@playwright/test';
