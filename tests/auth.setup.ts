import fs from 'node:fs';
import { applyExtraHeaders, authFile, getCredentials, hasCredentials } from '../src/config/credentials';
import { BetssonShell } from '../src/pages/BetssonShell';
import { cdpUrl, test } from './fixtures';

// Makes sure each account has a logged-in session before the scenarios run.
// - CDP mode: the attached Chrome is the person's own window. If its Betsson session is closed (it
//   expires after ~19 min idle), log in there with the funded account: it is a real browser the
//   person already uses, not a fresh automated window, which is what Betsson blocks.
// - Otherwise: log in once and save the session. Betsson rate-limits logins ("Actualiza la página y
//   vuelve a intentarlo en breve"), so a saved session that is still valid is reused instead.
// This project runs with trace, video and screenshots off so the credentials never end up in any evidence.
test.use({ storageState: { cookies: [], origins: [] } });

test('logged-in session in the attached Chrome', async ({ shell, market }) => {
  test.skip(!cdpUrl, 'Only with CDP_URL');
  if (await shell.isLoggedIn()) return;
  if (!hasCredentials(market.id, 'funded')) {
    throw new Error(`The Betsson session in the Chrome at ${cdpUrl} is closed and BETSSON_ES_FUNDED_* are not set: log in by hand`);
  }
  // isLoggedIn() left the lobby open, logged out.
  await shell.login(getCredentials(market.id, 'funded'));
  if (!(await shell.isLoggedIn())) {
    throw new Error('Logged in, but Betsson did not load the account (wallet/session): check the Chrome window');
  }
});

for (const account of ['funded', 'empty'] as const) {
  test(`login ${account} account`, async ({ browser, shell, market, page }) => {
    test.skip(Boolean(cdpUrl), 'CDP mode: the person logs in by hand');
    test.skip(!hasCredentials(market.id, account), `Credentials for the ${account} account are not set`);
    const file = authFile(market.id, account);

    if (fs.existsSync(file)) {
      const saved = await browser.newContext({ storageState: file });
      await applyExtraHeaders(saved, market);
      const savedShell = new BetssonShell(await saved.newPage(), market);
      const valid = await savedShell.isLoggedIn();
      if (valid) await saved.storageState({ path: file });
      await saved.close();
      if (valid) return;
    }

    await shell.openLobby();
    await shell.login(getCredentials(market.id, account));
    await page.context().storageState({ path: file });
  });
}
