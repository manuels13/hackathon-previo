// Runs a scenario, optionally on a game found on Betsson by name:
//   npm run scenario1 -- "gates of olympus"
//   npm run scenario2 -- "big bass splash"
// Without a game name, the catalog's default game is used. Extra flags after the name go to Playwright.
const { spawnSync } = require('node:child_process');

const [spec, ...args] = process.argv.slice(2);
const game = args[0] && !args[0].startsWith('-') ? args.shift() : undefined;
const env = { ...process.env };
if (game) env.GAME = game;
else delete env.GAME;

const result = spawnSync('npx', ['playwright', 'test', spec, ...args], { stdio: 'inherit', env, shell: true });
process.exit(result.status ?? 1);
