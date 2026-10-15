import { runVlmSpin } from '../src/flows/vlmSpin';
import { RoundRecorder } from '../src/network/RoundRecorder';
import { VlmClient, vlmConfigFromEnv } from '../src/vision/vlm';
import { test } from './fixtures';

// Scenario 1 — completed Real Play spin.
// Before the spin the screen is read the way a player reads it (one VLM call): balance, currency,
// wager and where the spin button is. After the spin no screenshot is analysed: the outcome is
// verified on the HTTP traffic of the provider's game server (stake, payout, balances, round closed)
// and on Betsson's wallet, and both must agree with what the screen showed.
// Spins for real money on the test account. Needs VLM_BASE_URL / VLM_API_KEY in .env.
const vlmConfig = vlmConfigFromEnv();
const eur = (amount: number | undefined | null) => (amount === undefined || amount === null ? 'n/a' : amount.toFixed(2));
const same = (a: number | undefined | null, b: number | undefined | null) =>
  a !== undefined && a !== null && b !== undefined && b !== null && Math.abs(a - b) < 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

test('Scenario 1 — completed Real Play spin', async ({ page, shell, game: gameConfig, market, checks }) => {
  test.skip(!vlmConfig, 'Set VLM_BASE_URL in .env to run the VLM flow');
  const traffic = gameConfig.provider.traffic;
  test.skip(!traffic, `${gameConfig.provider.name} has no traffic parser: the outcome cannot be read from HTTP`);
  test.setTimeout(8 * 60_000);

  // Listens from the start, so the game session the provider opens is captured too.
  const recorder = new RoundRecorder(page, traffic!);

  const walletBefore = await test.step('Read Betsson balance before the spin', async () => {
    const account = await shell.openLobbyAndReadAccount();
    // Betsson's login lasts ~19 minutes: do not start a paid spin the session cannot finish.
    const ok = await checks.check(
      'Betsson session active',
      account.wallet !== null && account.sessionSecondsLeft >= 120,
      `${account.sessionSecondsLeft}s left in the login session; wallet ${account.wallet ? 'loaded' : 'not loaded'}`,
    );
    if (!ok) checks.assertAll();
    const shown = await shell.readBalance();
    await checks.evidence('Betsson balance before (header)', shown.screenshot);
    await checks.check(
      'Betsson balance before: header matches wallet',
      shown.cents !== null && same(shown.cents / 100, account.wallet!.amount),
      `header shows "${shown.text}", wallet API ${eur(account.wallet!.amount)} ${account.wallet!.currency}`,
    );
    return account.wallet!;
  });

  const game = await test.step(`Open ${gameConfig.name} (${gameConfig.provider.name}) in Real Play`, () =>
    shell.launchGame(gameConfig),
  );
  const entered = await test.step('Wait for the game to load', () => game.enterGame());
  if (!(await checks.check('Game loaded', entered.loaded, `after ${entered.loadMs} ms`, await game.screenshot()))) {
    checks.assertAll();
  }

  const spin = await test.step('Spin: VLM reads the screen and clicks; HTTP follows the round', () =>
    runVlmSpin(game, new VlmClient(vlmConfig!), {
      evidenceDir: test.info().outputPath('vlm'),
      recorder,
      maxWager: Number(process.env.MAX_WAGER ?? 1),
      onEvidence: (name, png) => checks.evidence(`Spin ${name}`, png),
    }),
  );
  recorder.stop();
  const { before, server } = spin;
  const session = recorder.session();

  // ── What the screen showed before the spin, against the HTTP traffic ──
  await checks.check(
    'Game session opened in the market currency and language',
    session?.currency === market.currency && session?.language === market.language,
    `game server: currency ${session?.currency ?? 'n/a'}, language ${session?.language ?? 'n/a'}, ` +
      `jurisdiction ${session?.jurisdiction ?? 'n/a'}; expected ${market.currency} / ${market.language}`,
  );
  await checks.check(
    'Currency shown on screen matches market',
    market.currencyMarks.test(before.currency) && walletBefore.currency === market.currency,
    `screen "${before.currency}", wallet ${walletBefore.currency}, expected ${market.currency}`,
  );
  await checks.check(
    'Game credit on screen matches Betsson balance',
    same(before.balance, walletBefore.amount) && same(before.balance, server?.balanceBefore),
    `screen ${eur(before.balance)}, Betsson wallet ${eur(walletBefore.amount)}, game server ${eur(server?.balanceBefore)}`,
  );

  // ── The spin, from the HTTP traffic ──
  await checks.check(
    'Spin started',
    spin.reelsMoved && recorder.spinSentSince(0),
    `reels moved on screen: ${spin.reelsMoved}; spin request sent to the game server: ${recorder.spinSentSince(0)}`,
  );
  await checks.check(
    'Spin completed',
    server !== null,
    server ? `game server closed the round: ${server.calls} calls in ${server.durationMs} ms` : 'the game server never closed the round',
  );
  await checks.check(
    'Displayed wager is the wager used',
    same(before.wager, server?.wager),
    `screen shows ${eur(before.wager)}, spin request charged ${eur(server?.wager)}`,
  );
  await checks.check(
    'In-game balance consistent with the spin (after = before − wager + payout)',
    server !== null && server.balanceBefore !== undefined && same(server.balanceAfter, server.balanceBefore - server.wager + server.payout),
    server
      ? `${eur(server.balanceBefore)} − ${eur(server.wager)} + ${eur(server.payout)} = ` +
          `${eur(server.balanceBefore !== undefined ? round2(server.balanceBefore - server.wager + server.payout) : null)}; ` +
          `game server reports ${eur(server.balanceAfter)}`
      : 'no settled round',
  );

  // ── Betsson's wallet after the round ──
  const expectedWallet = server ? round2(walletBefore.amount - server.wager + server.payout) : null;
  const walletAfter = await test.step('Read Betsson balance after the spin', async () => {
    // Back to the lobby, as a player checking their balance; the wallet may take a moment to update.
    let account = await shell.openLobbyAndReadAccount();
    for (let i = 0; i < 3 && !same(account.wallet?.amount, expectedWallet); i++) {
      await page.waitForTimeout(3_000);
      account = await shell.openLobbyAndReadAccount();
    }
    const shown = await shell.readBalance().catch(() => null);
    if (shown) await checks.evidence('Betsson balance after (header)', shown.screenshot);
    return { amount: account.wallet?.amount, shown };
  });
  await checks.check(
    'Betsson balance reconciles (after = before − wager + payout)',
    same(walletAfter.amount, expectedWallet),
    `${eur(walletBefore.amount)} − ${eur(server?.wager)} + ${eur(server?.payout)} = ${eur(expectedWallet)}; ` +
      `wallet ${eur(walletAfter.amount)}${walletAfter.shown ? `, header "${walletAfter.shown.text}"` : ''}`,
  );
  await checks.check(
    'Betsson wallet matches the game server balance',
    same(walletAfter.amount, server?.balanceAfter),
    `Betsson wallet ${eur(walletAfter.amount)}, game server ${eur(server?.balanceAfter)}`,
  );

  test.info().annotations.push({
    type: 'cost',
    description: `${spin.vlmCalls} VLM call(s) (pre-spin screenshot, plus intro screens); outcome verified on HTTP traffic`,
  });
  checks.assertAll();
});
