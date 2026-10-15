export type Language = 'en' | 'es';

/** Rectangle relative to the game frame: all values are fractions (0..1) of its width/height. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Point relative to the game frame (fractions of width/height). */
export interface Point {
  x: number;
  y: number;
}

export const FULL_FRAME: Region = { x: 0, y: 0, w: 1, h: 1 };

/**
 * How the game reacts on screen. The game is a canvas inside an iframe, so everything here is
 * screen geometry and timing, never DOM selectors. Reading amounts and finding the spin button is
 * the VLM's job; this only covers what is checked locally, without spending VLM calls. A provider
 * sets the defaults for all its games and a game overrides only what differs.
 */
export interface VisualProfile {
  /** Where to click to get past the intro/splash screen ("Continue", "Press to play"...). */
  introDismiss: Point;
  /** Reels area, used to detect that the spin starts and stops. */
  reels: Region;
  /** Fraction of changed reel pixels that counts as "the reels started moving". */
  spinStartDiff: number;
  /** Below this fraction of changed pixels between frames the screen counts as still. */
  stableDiff: number;
  /** How long the screen has to stay still to count the spin as settled. */
  stableForMs: number;
}

/** How the provider's server set up the player's game session (currency, language, rules). */
export interface GameSession {
  currency?: string;
  language?: string;
  jurisdiction?: string;
  balance?: number;
}

/** One request/response between the game client and the provider's game server, already decoded. */
export interface GameCall {
  kind: 'session' | 'init' | 'spin' | 'collect' | 'other';
  /** Session settings, on the call that opens the game session. */
  session?: GameSession;
  /** Stake of the spin, from the request (spin calls only). */
  wager?: number;
  /** Balance the server reports after this call. */
  balance?: number;
  /** Win accumulated so far in the current round. */
  totalWin?: number;
  /** The server is ready for a new spin: the round is over and settled. */
  roundClosed: boolean;
  /** The server refused the call (e.g. not enough money for the stake): nothing was played. */
  rejected?: boolean;
}

/**
 * Reads a provider's game-server traffic. It is an independent witness of what the screen shows (bet,
 * win, balance) and tells exactly when a round starts and ends, so no screenshots are spent polling.
 */
export interface TrafficParser {
  isGameCall(url: string): boolean;
  parse(requestBody: string, responseBody: string): GameCall | null;
}

/**
 * Everything specific to a game studio. Adding a provider means adding one of these, without
 * touching the scenarios.
 */
export interface ProviderProfile {
  id: string;
  name: string;
  /** Insufficient-balance message per player language (scenario 2). */
  insufficientBalance: Record<Language, RegExp>;
  visual: VisualProfile;
  /** Decoder for the game-server traffic, when known. */
  traffic?: TrafficParser;
}
