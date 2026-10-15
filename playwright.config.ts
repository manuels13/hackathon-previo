import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
import { markets, type MarketId } from './src/config/markets';
import { games } from './src/games/catalog';

// One project per market and game (`es-sweet-bonanza`), each depending on its market's login setup.
// Adding a game to src/games/catalog.ts adds its project here and its run in CI.
// GAME="gates of olympus" replaces them with one project for that game, found on Betsson by name.
const gameQuery = process.env.GAME?.trim();
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const marketProjects = (Object.keys(markets) as MarketId[]).flatMap((marketId) => [
  {
    name: `setup-${marketId}`,
    testMatch: /auth\.setup\.ts/,
    // No evidence while logging in: credentials must never reach traces, videos or screenshots.
    use: {
      marketId,
      trace: 'off' as const,
      video: 'off' as const,
      screenshot: 'off' as const,
    },
  },
  ...(gameQuery
    ? [{ id: slug(gameQuery), use: { gameQuery } }]
    : games.filter((game) => game.paths[marketId]).map((game) => ({ id: game.id, use: { gameId: game.id } }))
  ).map((game) => ({
    name: `${marketId}-${game.id}`,
    testMatch: /scenario\d.*\.spec\.ts|enter-game\.spec\.ts|fault-injection\.spec\.ts/,
    dependencies: [`setup-${marketId}`],
    use: { marketId, ...game.use },
  })),
]);

/** Custom options consumed by tests/fixtures.ts. */
interface ProjectOptions {
  marketId: MarketId;
  gameId: string;
  gameQuery: string;
}

export default defineConfig<ProjectOptions>({
  testDir: './tests',
  timeout: 5 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'report/html', open: 'never' }],
    ['./src/report/ChecksReporter.ts'],
  ],
  use: {
    ...devices['Desktop Chrome'],
    // Real Google Chrome, as a player would use. With CDP_URL the person's own Chrome is used instead.
    channel: 'chrome',
    viewport: { width: 1600, height: 900 },
    // Sharper canvas screenshots for OCR; mouse coordinates stay in CSS pixels.
    deviceScaleFactor: 2,
    headless: !process.env.HEADED,
    // Fail fast on a missing element instead of waiting for the whole test timeout.
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    // Traces record request headers and session cookies, so they are never produced in CI, where the
    // report is published. Video and screenshots are the public evidence.
    trace: process.env.CI ? 'off' : 'on',
    video: 'on',
    screenshot: 'on',
  },
  projects: [
    { name: 'unit', testMatch: /unit\/.*\.spec\.ts/ },
    ...marketProjects,
  ],
});
