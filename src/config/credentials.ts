import path from 'node:path';
import type { BrowserContext } from '@playwright/test';
import type { MarketConfig, MarketId } from './markets';

/** funded: account with balance (scenario 1). empty: account with no usable balance (scenario 2). */
export type AccountKind = 'funded' | 'empty';

export interface Credentials {
  username: string;
  password: string;
}

/** Reads credentials from the environment (GitHub Secrets in CI, .env locally). Never log the result. */
export function getCredentials(market: MarketId, account: AccountKind): Credentials {
  const prefix = `BETSSON_${market.toUpperCase()}_${account.toUpperCase()}`;
  const username = process.env[`${prefix}_USER`];
  const password = process.env[`${prefix}_PASS`];
  if (!username || !password) {
    throw new Error(`Missing credentials: set ${prefix}_USER and ${prefix}_PASS in .env`);
  }
  return { username, password };
}

export function hasCredentials(market: MarketId, account: AccountKind): boolean {
  const prefix = `BETSSON_${market.toUpperCase()}_${account.toUpperCase()}`;
  return Boolean(process.env[`${prefix}_USER`] && process.env[`${prefix}_PASS`]);
}

/**
 * Which configured account a login name belongs to, compared in memory only. 'other' when it is none
 * of them (e.g. the person's own account).
 */
export function accountKindOf(market: MarketId, login: string): AccountKind | 'other' {
  for (const account of ['funded', 'empty'] as const) {
    const username = process.env[`BETSSON_${market.toUpperCase()}_${account.toUpperCase()}_USER`];
    if (username && username.trim().toLowerCase() === login.trim().toLowerCase()) return account;
  }
  return 'other';
}

/**
 * Extra HTTP headers Betsson gave us to mark our automated traffic as internal testing. They let
 * traffic past anti-bot protection, so they live in the environment (BETSSON_<MARKET>_EXTRA_HEADERS,
 * a JSON object) and never in the repository.
 */
export function extraHeaders(market: MarketId): Record<string, string> {
  const name = `BETSSON_${market.toUpperCase()}_EXTRA_HEADERS`;
  const raw = process.env[name];
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be a JSON object, e.g. {"x-header":"value"}`);
  }
}

/**
 * Adds the extra headers only to requests for the market's own hosts. Sent to the game provider they
 * break its CORS checks and the game never loads, so they cannot be set browser-wide.
 */
export async function applyExtraHeaders(context: BrowserContext, market: MarketConfig): Promise<void> {
  const headers = extraHeaders(market.id);
  if (!Object.keys(headers).length) return;
  await context.route(
    (url) => market.ownHosts.test(url.hostname),
    (route) => route.continue({ headers: { ...route.request().headers(), ...headers } }),
  );
}

/** Saved session for an account. The .auth folder is gitignored and never uploaded as an artifact. */
export function authFile(market: MarketId, account: AccountKind): string {
  return path.join(__dirname, '..', '..', '.auth', `${market}-${account}.json`);
}
