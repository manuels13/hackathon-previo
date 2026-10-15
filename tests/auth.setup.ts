import fs from 'node:fs';
import { applyExtraHeaders, authFile, getCredentials, hasCredentials } from '../src/config/credentials';
import { BetssonShell } from '../src/pages/BetssonShell';
import { cdpUrl, test } from './fixtures';

// Makes sure each account has a logged-in session before the scenarios run.
// - CDP mode: the person logged in by hand in the attached Chrome; only check that the session is there.
// - Otherwise: log in once and save the session. Betsson rate-limits logins ("Actualiza la página y
//   vuelve a intentarlo en breve"), so a saved session that is still valid is reused instead.
// This project runs with trace, video and screenshots off so the credentials never end up in any evidence.
test.use({ storageState: { cookies: [], origins: [] } });

test('logged-in session in the attached Chrome', async ({ shell }) => {
  test.skip(!cdpUrl, 'Only with CDP_URL');
  const loggedIn = await shell.isLoggedIn();
  if (!loggedIn) throw new Error(`Not logged in, or the Betsson session expired (it lasts ~19 min): log in by hand in the Chrome window at ${cdpUrl} and run again`);
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
