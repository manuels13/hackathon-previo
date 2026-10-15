import type { Page } from '@playwright/test';
import type { TrafficParser } from '../providers/types';

/**
 * Fault injection for the negative test: the game-server answers reach the game with every balance
 * moved by `offset`, as if the provider showed the player a balance that is not Betsson's. Only the
 * page under test sees it; nothing changes on the server or in the wallet.
 */
export async function injectBalanceOffset(page: Page, traffic: TrafficParser, offset: number): Promise<void> {
  await page.route(
    (url) => traffic.isGameCall(url.toString()),
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: shiftBalances(await response.text(), offset) });
    },
  );
}

/**
 * Moves the balances of a game-server answer: url-encoded `balance=` / `balance_cash=` (game service)
 * or `data.balance` (session JSON). The rest of the body is left byte for byte as it was.
 */
export function shiftBalances(body: string, offset: number): string {
  if (body.trimStart().startsWith('{')) {
    const json = JSON.parse(body);
    const balance = json?.data?.balance;
    if (balance) {
      for (const key of ['total', 'cash'] as const) {
        if (typeof balance[key] === 'number') balance[key] = Math.round((balance[key] + offset) * 100) / 100;
      }
    }
    return JSON.stringify(json);
  }
  return body.replace(/(^|&)(balance|balance_cash)=(-?\d+(?:\.\d+)?)/g, (_match, start, key, value) =>
    `${start}${key}=${(Number(value) + offset).toFixed(2)}`,
  );
}
