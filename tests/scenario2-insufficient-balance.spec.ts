import { formatCents as fmt } from '../src/utils/money';
import { test } from './fixtures';

test.use({ account: 'empty' });

test('Scenario 2 — insufficient balance', async ({ shell, market, game: gameConfig, checks }) => {
  await test.step('Open lobby (already authenticated)', async () => {
    await shell.openLobby();
    await shell.dismissPrompts();
  });

  const walletBefore = await test.step('Read Betsson balance before the attempt', async () => {
    const reading = await shell.readBalance();
    await checks.evidence('Betsson balance before', reading.screenshot);
    return reading;
  });

  const game = await test.step(`Launch ${gameConfig.name} (${gameConfig.provider.name}) in Real Play`, () =>
    shell.launchGame(gameConfig),
  );

  const hudBefore = await test.step('Read credit, wager and currency in the game', async () => {
    const hud = await game.waitUntilReady();
    await checks.evidence('Game HUD before attempt', hud.screenshot);
    return hud;
  });

  await checks.check(
    'Currency matches market',
    walletBefore.currencyVisible && hudBefore.currencyVisible,
    `expected ${market.currency}; Betsson shows "${walletBefore.text}", game HUD shows currency: ${hudBefore.currencyVisible}`,
    hudBefore.screenshot,
  );

  const attempt = await test.step('Attempt a spin', () => game.attemptSpinAndWatch());

  const message = await test.step('Read the message the player sees', async () => {
    const reading = await game.readText();
    await checks.evidence('Game after spin attempt', reading.screenshot);
    return reading;
  });
  const expectedMessage = gameConfig.provider.insufficientBalance[market.language];
  const otherLanguages = Object.entries(gameConfig.provider.insufficientBalance)
    .filter(([language]) => language !== market.language)
    .map(([, pattern]) => pattern);
  const shown = message.text.match(expectedMessage);
  await checks.check(
    'Insufficient-balance message shown',
    shown !== null,
    shown ? `read "${shown[0]}"` : `no matching message in OCR text: "${message.text.replace(/\s+/g, ' ').slice(0, 200)}"`,
    message.screenshot,
  );
  await checks.check(
    `Message in expected language (${market.language})`,
    shown !== null && !otherLanguages.some((pattern) => pattern.test(message.text)),
    shown ? 'message matches the market language' : 'no message to check',
  );

  const hudAfter = await game.readHud();
  await checks.check(
    'Spin rejected (not a paid spin)',
    hudBefore.credit !== null && hudAfter.credit === hudBefore.credit && hudAfter.win === null,
    `game credit ${fmt(hudBefore.credit)} → ${fmt(hudAfter.credit)}; reels changed up to ${(attempt.maxReelChange * 100).toFixed(1)}%`,
  );
  await checks.check(
    'In-game balance unchanged',
    hudBefore.credit !== null && hudAfter.credit === hudBefore.credit,
    `${fmt(hudBefore.credit)} → ${fmt(hudAfter.credit)}`,
    hudAfter.screenshot,
  );

  const walletAfter = await test.step('Read Betsson balance after the attempt', async () => {
    const reading = await shell.readBalanceSettled(walletBefore.cents, 10_000);
    await checks.evidence('Betsson balance after', reading.screenshot);
    return reading;
  });
  await checks.check(
    'Betsson balance unchanged',
    walletBefore.cents !== null && walletAfter.cents === walletBefore.cents,
    `${fmt(walletBefore.cents)} → ${fmt(walletAfter.cents)}`,
  );

  checks.assertAll();
});
