import { formatCents as fmt } from '../src/utils/money';
import { test } from './fixtures';

test.use({ account: 'funded' });

test('Scenario 1 — completed Real Play spin', async ({ shell, market, game: gameConfig, checks }) => {
  await test.step('Open lobby (already authenticated)', async () => {
    await shell.openLobby();
    await shell.dismissPrompts();
  });

  const walletBefore = await test.step('Read Betsson balance before the spin', async () => {
    const reading = await shell.readBalance();
    await checks.evidence('Betsson balance before', reading.screenshot);
    return reading;
  });

  const game = await test.step(`Launch ${gameConfig.name} (${gameConfig.provider.name}) in Real Play`, () =>
    shell.launchGame(gameConfig),
  );

  const hudBefore = await test.step('Read wager, credit and currency in the game', async () => {
    const hud = await game.waitUntilReady();
    await checks.evidence('Game HUD before spin', hud.screenshot);
    return hud;
  });

  await checks.check(
    'Currency matches market',
    walletBefore.currencyVisible && hudBefore.currencyVisible,
    `expected ${market.currency}; Betsson shows "${walletBefore.text}", game HUD shows currency: ${hudBefore.currencyVisible}`,
    hudBefore.screenshot,
  );
  await checks.check(
    'Game credit matches Betsson balance',
    hudBefore.credit !== null && hudBefore.credit === walletBefore.cents,
    `game ${fmt(hudBefore.credit)} vs Betsson ${fmt(walletBefore.cents)}`,
  );

  const spin = await test.step('Trigger a spin and watch the reels', () => game.spinAndObserve());
  await checks.check(
    'Spin started',
    spin.started,
    `reels changed up to ${(spin.maxReelChange * 100).toFixed(1)}% of pixels`,
    await game.screenshot(),
  );
  await checks.check(
    'Spin completed',
    spin.settled,
    spin.started ? `triggered with ${spin.method}; reels settled: ${spin.settled} after ${spin.durationMs} ms` : 'no spin to complete',
  );

  const hudAfter = await test.step('Read the settled outcome in the game', async () => {
    const hud = await game.readHud();
    await checks.evidence('Game HUD after spin', hud.screenshot);
    return hud;
  });

  const wager = hudBefore.bet;
  const payout = hudAfter.win ?? 0;
  await checks.check(
    'Displayed wager is the wager used',
    wager !== null && hudBefore.credit !== null && hudAfter.credit !== null &&
      hudBefore.credit - hudAfter.credit + payout === wager,
    `displayed bet ${fmt(wager)}; credit went ${fmt(hudBefore.credit)} → ${fmt(hudAfter.credit)} with payout ${fmt(payout)}`,
  );

  const expectedGameCredit =
    hudBefore.credit !== null && wager !== null ? hudBefore.credit - wager + payout : null;
  await checks.check(
    'In-game balance consistent with spin',
    expectedGameCredit !== null && hudAfter.credit === expectedGameCredit,
    `expected ${fmt(expectedGameCredit)}, game shows ${fmt(hudAfter.credit)}`,
    hudAfter.screenshot,
  );

  const expectedWallet =
    walletBefore.cents !== null && wager !== null ? walletBefore.cents - wager + payout : null;
  const walletAfter = await test.step('Read Betsson balance after the spin', async () => {
    const reading = await shell.readBalanceSettled(expectedWallet);
    await checks.evidence('Betsson balance after', reading.screenshot);
    return reading;
  });
  await checks.check(
    'Betsson balance reconciles (after = before − wager + payout)',
    expectedWallet !== null && walletAfter.cents === expectedWallet,
    `${fmt(walletBefore.cents)} − ${fmt(wager)} + ${fmt(payout)} = ${fmt(expectedWallet)}; Betsson shows ${fmt(walletAfter.cents)}`,
  );

  checks.assertAll();
});
