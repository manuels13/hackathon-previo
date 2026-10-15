import { runVlmSpin } from '../src/flows/vlmSpin';
import { RoundRecorder } from '../src/network/RoundRecorder';
import { VlmClient, vlmConfigFromEnv } from '../src/vision/vlm';
import { test } from './fixtures';

// Scenario 1 — completed Real Play spin, read by a vision-language model as the player sees it and
// cross-checked against two independent witnesses: the provider's game-server traffic and Betsson's
// wallet API. Spins for real money on the test account. Needs VLM_BASE_URL / VLM_API_KEY in .env.
const vlmConfig = vlmConfigFromEnv();
const eur = (amount: number | undefined | null) => (amount === undefined || amount === null ? 'n/a' : amount.toFixed(2));
const same = (a: number | undefined | null, b: number | undefined | null) =>
  a !== undefined && a !== null && b !== undefined && b !== null && Math.abs(a - b) < 0.005;

test('Scenario 1 — completed Real Play spin (VLM + server witness)', async ({ page, shell, game: gameConfig, market, checks }) => {
  test.skip(!vlmConfig, 'Set VLM_BASE_URL in .env to run the VLM flow');
  test.setTimeout(8 * 60_000);

  const recorder = gameConfig.provider.traffic ? new RoundRecorder(page, gameConfig.provider.traffic) : undefined;

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
      shown.cents !== null && Math.abs(shown.cents / 100 - account.wallet!.amount) < 0.005,
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

  const spin = await test.step('Spin: VLM reads, marks and clicks; network follows the round', () =>
    runVlmSpin(game, new VlmClient(vlmConfig!), {
      evidenceDir: test.info().outputPath('vlm'),
      recorder,
      onEvidence: (name, png) => checks.evidence(`VLM ${name}`, png),
    }),
  );
  recorder?.stop();
  const { before, after, server } = spin;

  await checks.check(
    'Currency matches market',
    market.currencyMarks.test(before.currency) && (!after || market.currencyMarks.test(after.currency)) && walletBefore.currency === market.currency,
    `expected ${market.currency}; screen "${before.currency}"${after ? ` / "${after.currency}"` : ''}, wallet ${walletBefore.currency}`,
  );
  await checks.check(
    'Game credit matches Betsson balance before the spin',
    same(before.balance, walletBefore.amount),
    `screen ${eur(before.balance)}, wallet ${eur(walletBefore.amount)}`,
  );
  await checks.check(
    'Spin started',
    spin.reelsMoved && server !== null,
    `reels moved on screen: ${spin.reelsMoved}; server received the spin: ${recorder?.spinSentSince(0) ?? 'n/a'}`,
  );
  await checks.check(
    'Spin completed',
    spin.screenSettled && server !== null,
    `server closed the round: ${server ? `yes, ${server.calls} calls in ${server.durationMs} ms` : 'no'}; screen settled: ${spin.screenSettled}`,
  );
  await checks.check(
    'Displayed wager is the wager used',
    same(before.wager, server?.wager),
    `screen shows ${eur(before.wager)}, server charged ${eur(server?.wager)}`,
  );
  if (spin.afterError) await checks.check('Final screen read by the VLM', false, spin.afterError);
  await checks.check(
    'Payout read on screen matches the round',
    same(after?.payout, server?.payout),
    `screen shows ${eur(after?.payout)}, server paid ${eur(server?.payout)}`,
  );
  await checks.check(
    'In-game balance consistent with the spin',
    spin.balanceRuleHolds && same(after?.balance, server?.balanceAfter),
    `screen: ${eur(before.balance)} − ${eur(before.wager)} + ${eur(after?.payout)} = ${eur(spin.expectedBalance)}, ` +
      `shows ${eur(after?.balance)}; server balance ${eur(server?.balanceAfter)}`,
  );

  const expectedWallet = server ? Math.round((walletBefore.amount - server.wager + server.payout) * 100) / 100 : null;
  // Back to the lobby, as a player checking their balance; the wallet may take a moment to update.
  const walletAfter = await test.step('Read Betsson balance after the spin', async () => {
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

  test.info().annotations.push({
    type: 'cost',
    description: `${spin.vlmCalls} VLM calls, ${spin.screenshots} game screenshots (model: ${vlmConfig!.models.join(' → ')})`,
  });
  checks.assertAll();
});
