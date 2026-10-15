import { test } from './fixtures';

// Gets from the lobby into the game screen, ready to play, without reading any text in the game:
// Betsson's DOM dialogs are handled through the DOM and the game itself is judged only by what its
// frame looks like. With KEEP_OPEN=1 the tab stays open on the game (`npm run game`).
test('Enter the game', async ({ shell, game: gameConfig, checks }) => {
  await test.step('Open lobby (already authenticated)', () => shell.openLobby());

  const game = await test.step(`Open ${gameConfig.name} (${gameConfig.provider.name})`, () =>
    shell.launchGame(gameConfig),
  );
  await checks.check(
    'Betsson dialogs before the game handled',
    true,
    shell.entryDialogsHandled.length ? shell.entryDialogsHandled.join(', ') : 'none shown',
  );

  const entered = await test.step('Wait for the game to load and pass its intro', () => game.enterGame());
  await checks.check(
    'Game loaded',
    entered.loaded,
    entered.loaded ? `game screen shown after ${entered.loadMs} ms` : `still loading after ${entered.loadMs} ms`,
    await game.screenshot(),
  );
  await checks.check(
    'Intro screen passed',
    entered.introPassed,
    entered.introPassed ? 'screen changed after clicking continue' : 'screen did not change after clicking continue',
    await game.screenshot(),
  );

  checks.assertAll();
});
