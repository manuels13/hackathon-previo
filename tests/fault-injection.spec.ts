import { readPlayableScreen } from '../src/flows/vlmSpin';
import { injectBalanceOffset } from '../src/network/faultInjection';
import { RoundRecorder } from '../src/network/RoundRecorder';
import { VlmClient, vlmConfigFromEnv } from '../src/vision/vlm';
import { test } from './fixtures';

// Negative test: proves the validation catches a defect instead of always passing.
// The game-server answers are altered on their way to the game so the player is shown 5,00 € more
// than Betsson's wallet holds. The same check as scenario 1 ("game credit on screen matches Betsson
// balance") must catch it from what the screen shows, and the test must fail with that error in the
// trace and the report. No spin is made: it costs no money.
// test.fail() marks the failure as the expected outcome, so the suite stays green while the report and
// the trace show the error exactly as a real defect would.
const vlmConfig = vlmConfigFromEnv();
const INJECTED_OFFSET = 5;
const eur = (amount: number | undefined | null) => (amount === undefined || amount === null ? 'n/a' : amount.toFixed(2));
const same = (a: number | undefined | null, b: number | undefined | null) =>
  a !== undefined && a !== null && b !== undefined && b !== null && Math.abs(a - b) < 0.005;

test('Fault injection — game shows a balance that is not Betsson\'s', async ({ page, shell, game: gameConfig, checks }) => {
  test.skip(!vlmConfig, 'Set VLM_BASE_URL in .env to run the VLM flow');
  const traffic = gameConfig.provider.traffic;
  test.skip(!traffic, `${gameConfig.provider.name} has no traffic parser: no answers to alter`);
  test.fail(true, `Injected fault: the game shows ${INJECTED_OFFSET.toFixed(2)} € more than Betsson's wallet; the checks must catch it`);
  test.setTimeout(5 * 60_000);

  const wallet = await test.step('Read Betsson balance', async () => {
    const account = await shell.openLobbyAndReadAccount();
    if (!(await checks.check('Betsson session active', account.wallet !== null, `wallet ${account.wallet ? 'loaded' : 'not loaded'}`))) {
      checks.assertAll();
    }
    return account.wallet!;
  });

  await test.step(`Inject the fault: game-server balances + ${INJECTED_OFFSET.toFixed(2)} €`, () =>
    injectBalanceOffset(page, traffic!, INJECTED_OFFSET),
  );
  const recorder = new RoundRecorder(page, traffic!);
  const game = await test.step(`Open ${gameConfig.name} (${gameConfig.provider.name}) in Real Play`, () => shell.launchGame(gameConfig));
  const entered = await test.step('Wait for the game to load', () => game.enterGame());
  if (!(await checks.check('Game loaded', entered.loaded, `after ${entered.loadMs} ms`, await game.screenshot()))) {
    checks.assertAll();
  }

  // What the player sees, read like in scenario 1. No click on spin follows.
  const { before } = await test.step('VLM reads the game screen (no spin)', () =>
    readPlayableScreen(game, new VlmClient(vlmConfig!), (name, png) => checks.evidence(`Fault ${name}`, png), 'game-screen'),
  );
  recorder.stop();
  const server = recorder.session()?.balance;

  await checks.check(
    'Game credit on screen matches Betsson balance',
    same(before.balance, wallet.amount),
    `screen ${eur(before.balance)}, Betsson wallet ${eur(wallet.amount)}, game server (as the game received it) ${eur(server)}` +
      `; difference ${eur(before.balance - wallet.amount)}`,
  );
  test.info().annotations.push({ type: 'cost', description: 'No spin made: no money spent' });
  // Throws "Failed checks: ..." — the error the trace must show.
  checks.assertAll();
});
