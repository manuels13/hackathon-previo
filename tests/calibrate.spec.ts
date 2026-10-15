import { FULL_FRAME } from '../src/providers/types';
import { test } from './fixtures';

// Helper to adjust a provider/game visual profile against the live game: saves the full game frame
// and every configured region, plus what OCR reads in them.
// Run with `npm run calibrate -- --project=es-sweet-bonanza`.
test.skip(!process.env.CALIBRATE, 'Only runs with CALIBRATE=1');

test('calibrate game regions', async ({ shell, game: gameConfig }) => {
  await shell.openLobby();
  const game = await shell.launchGame(gameConfig);
  await game.waitUntilReady().catch((e) => console.log(String(e)));
  const { visual } = gameConfig;
  for (const [name, region] of Object.entries({ frame: FULL_FRAME, reels: visual.reels, hud: visual.hud ?? FULL_FRAME })) {
    const { text, screenshot } = await game.readText(region);
    await test.info().attach(`${name}.png`, { body: screenshot, contentType: 'image/png' });
    await test.info().attach(`${name}.txt`, { body: text, contentType: 'text/plain' });
  }
  const hud = await game.readHud();
  console.log(`HUD → credit=${hud.credit} bet=${hud.bet} win=${hud.win} currency=${hud.currencyVisible}`);
});
