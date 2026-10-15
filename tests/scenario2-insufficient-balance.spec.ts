import { runSpinAttempt } from '../src/flows/vlmSpinAttempt';
import { RoundRecorder } from '../src/network/RoundRecorder';
import { VlmClient, vlmConfigFromEnv } from '../src/vision/vlm';
import { cdpUrl, test } from './fixtures';

// Scenario 2 — insufficient balance.
// With the account without balance, the spin is attempted and the player must be refused: the game
// shows an insufficient-balance message in the market's language, and neither the game balance nor
// Betsson's wallet move. The screen is read by the VLM before the attempt and on the game's answer;
// the game server's HTTP traffic and Betsson's wallet are the independent witnesses.
// Needs BETSSON_ES_EMPTY_USER/PASS and VLM_BASE_URL / VLM_API_KEY in .env.
const vlmConfig = vlmConfigFromEnv();
const eur = (amount: number | undefined | null) => (amount === undefined || amount === null ? 'n/a' : amount.toFixed(2));
const same = (a: number | undefined | null, b: number | undefined | null) =>
  a !== undefined && a !== null && b !== undefined && b !== null && Math.abs(a - b) < 0.005;

// Without CDP, the saved session of the empty account is used.
test.use({ account: 'empty' });

test('Scenario 2 — insufficient balance', async ({ page, shell, game: gameConfig, market, checks }) => {
  test.skip(!vlmConfig, 'Set VLM_BASE_URL in .env to run the VLM flow');
  test.setTimeout(6 * 60_000);

  // Listens from the start, so the game session the provider opens is captured too.
  const traffic = gameConfig.provider.traffic;
  const recorder = traffic ? new RoundRecorder(page, traffic) : null;

  const walletBefore = await test.step('Log in with the account without balance and read its balance', async () => {
    // The person's Chrome (CDP) is usually logged in with the funded account: switch here, so the test
    // also works on its own. The credentials are kept out of the trace (see BetssonShell.login).
    // auth.setup.ts switches back to the funded account on the next run of the other scenarios.
    const account = cdpUrl ? await shell.useAccount('empty') : await shell.openLobbyAndReadAccount();
    const ok = await checks.check(
      'Betsson session active with the account without balance',
      account.wallet !== null && account.sessionSecondsLeft >= 60 && account.account !== 'funded',
      `${account.sessionSecondsLeft}s left in the login session; wallet ${account.wallet ? 'loaded' : 'not loaded'}; ` +
        `account: ${account.account ?? 'not identified'}`,
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
  // Without balance the DGOJ session form has no loss limit; the session must still start.
  await checks.check(
    'Betsson dialogs before the game handled',
    true,
    shell.entryDialogsHandled.length ? shell.entryDialogsHandled.join(', ') : 'none shown',
  );
  const entered = await test.step('Wait for the game to load', () => game.enterGame());
  if (!(await checks.check('Game loaded', entered.loaded, `after ${entered.loadMs} ms`, await game.screenshot()))) {
    checks.assertAll();
  }

  const attempt = await test.step('Attempt a spin: VLM reads the screen, clicks and reads the answer', () =>
    runSpinAttempt(game, new VlmClient(vlmConfig!), {
      evidenceDir: test.info().outputPath('vlm'),
      recorder: recorder ?? undefined,
      walletBefore: walletBefore.amount,
      onEvidence: (name, png) => checks.evidence(`Attempt ${name}`, png),
    }),
  );
  recorder?.stop();
  const { before, after, calls } = attempt;
  const session = recorder?.session();

  // ── Before the attempt ──
  await checks.check(
    'Game session opened in the market currency and language',
    !recorder || (session?.currency === market.currency && session?.language === market.language),
    recorder
      ? `game server: currency ${session?.currency ?? 'n/a'}, language ${session?.language ?? 'n/a'}, ` +
          `jurisdiction ${session?.jurisdiction ?? 'n/a'}; expected ${market.currency} / ${market.language}`
      : `${gameConfig.provider.name} has no traffic parser: not checked`,
  );
  await checks.check(
    'Game credit on screen matches Betsson balance',
    same(before.balance, walletBefore.amount) && (!session || same(before.balance, session.balance)),
    `screen ${eur(before.balance)}, Betsson wallet ${eur(walletBefore.amount)}, game server ${eur(session?.balance)}`,
  );
  const insufficient = await checks.check(
    'Balance is below the wager',
    attempt.attempted,
    `screen balance ${eur(before.balance)}, wallet ${eur(walletBefore.amount)}, wager ${eur(before.wager)}` +
      (attempt.attempted ? '' : ': the account can afford the spin, so it was not attempted (it would be a paid spin)'),
  );
  if (!insufficient) checks.assertAll();

  // ── The game's answer ──
  const spins = calls.filter((c) => c.kind === 'spin');
  const paid = spins.filter((c) => !c.rejected && c.balance !== undefined && !same(c.balance, before.balance));
  await checks.check(
    'Spin rejected, not played as a paid spin',
    paid.length === 0 && !after!.spinPlayed,
    `screen: ${after!.spinPlayed ? 'reels played' : 'no spin played'} (reels area ${attempt.reelsMoved ? 'changed' : 'unchanged'}); ` +
      (recorder
        ? `game server: ${spins.length} spin request(s), ${spins.filter((c) => c.rejected).length} refused, ${paid.length} charged`
        : 'no traffic parser'),
  );
  const expected = gameConfig.provider.insufficientBalance[market.language];
  await checks.check(
    'Insufficient-balance message shown in the expected language',
    after!.insufficientBalance && after!.language === market.language && expected.test(after!.message ?? ''),
    `message "${after!.message ?? 'none'}"; language ${after!.language ?? 'n/a'} (expected ${market.language}); ` +
      `VLM: ${after!.insufficientBalance ? 'insufficient balance' : 'not an insufficient-balance message'}; ` +
      `provider wording ${expected.test(after!.message ?? '') ? 'matches' : 'does not match'}`,
  );
  await checks.check(
    'Currency shown matches market',
    market.currencyMarks.test(before.currency) &&
      (after!.currency === null || market.currencyMarks.test(after!.currency)) &&
      walletBefore.currency === market.currency,
    `screen before "${before.currency}", after "${after!.currency ?? 'not shown'}", wallet ${walletBefore.currency}, expected ${market.currency}`,
  );
  const serverAfter = recorder?.lastBalance();
  await checks.check(
    'In-game balance does not change',
    (after!.balance === null || same(after!.balance, before.balance)) && (!recorder || serverAfter === undefined || same(serverAfter, before.balance)),
    `screen ${eur(before.balance)} → ${after!.balance === null ? 'hidden by the message' : eur(after!.balance)}; ` +
      `game server last balance ${eur(serverAfter)}`,
  );

  // ── Betsson's wallet after the attempt ──
  const walletAfter = await test.step('Read Betsson balance after the attempt', async () => {
    const account = await shell.openLobbyAndReadAccount();
    const shown = await shell.readBalance().catch(() => null);
    if (shown) await checks.evidence('Betsson balance after (header)', shown.screenshot);
    return { amount: account.wallet?.amount, shown };
  });
  await checks.check(
    'Betsson balance does not change',
    same(walletAfter.amount, walletBefore.amount) &&
      (!walletAfter.shown || (walletAfter.shown.cents !== null && same(walletAfter.shown.cents / 100, walletBefore.amount))),
    `wallet ${eur(walletBefore.amount)} → ${eur(walletAfter.amount)}${walletAfter.shown ? `, header "${walletAfter.shown.text}"` : ''}`,
  );

  // Decoded game-server calls (numbers only), as evidence of what the server did with the attempt.
  await test.info().attach('game-server calls after the click', {
    body: JSON.stringify(calls, null, 2),
    contentType: 'application/json',
  });
  test.info().annotations.push({
    type: 'cost',
    description: `${attempt.vlmCalls} VLM calls (before the attempt and on the game's answer)`,
  });
  checks.assertAll();
});
