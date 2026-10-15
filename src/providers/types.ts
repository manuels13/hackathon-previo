export type Language = 'en' | 'es';

/** Rectangle relative to the game frame: all values are fractions (0..1) of its width/height. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Image filter applied before OCR on the HUD.
 * - none: grayscale only.
 * - warm-text: keeps yellow/white text and drops pink/blue/purple backgrounds (Pragmatic Play style).
 */
export type OcrFilter = 'none' | 'warm-text';

/** Point relative to the game frame (fractions of width/height). */
export interface Point {
  x: number;
  y: number;
}

export const FULL_FRAME: Region = { x: 0, y: 0, w: 1, h: 1 };

/**
 * How the game looks and reacts on screen. The game is a canvas inside an iframe, so everything
 * here is screen geometry and timing, never DOM selectors. A provider sets the defaults for all of
 * its games and a game overrides only what differs.
 */
export interface VisualProfile {
  /** Where to click to get past the intro/splash screen ("Continue", "Press to play"...). */
  introDismiss: Point;
  /** Neutral spot clicked to give the game keyboard focus before pressing `spinKey`. */
  focusPoint: Point;
  /** Keyboard key that spins, tried first when the provider supports it. */
  spinKey?: string;
  /** Spin button position, used when there is no key or the key did not start a spin. */
  spinButton?: Point;
  /** Reels area, used to detect that the spin starts and stops. */
  reels: Region;
  /** Area searched for balance/bet/win. Defaults to the whole frame: labels are found by OCR wherever they are. */
  hud?: Region;
  /** How to clean up the HUD image before OCR. Defaults to 'none'. */
  ocrFilter?: OcrFilter;
  /**
   * Where the credit/bet numbers themselves are, read with digits-only OCR. More reliable than
   * finding the labels in decorative fonts; fields left out are found by label inside `hud`.
   */
  fields?: { credit?: Region; bet?: Region };
  /** Fraction of changed reel pixels that counts as "the reels started moving". */
  spinStartDiff: number;
  /** Below this fraction of changed pixels between frames the screen counts as still. */
  stableDiff: number;
  /** How long the screen has to stay still to count the spin as settled. */
  stableForMs: number;
  spinTimeoutMs: number;
}

export interface HudLabels {
  credit: RegExp;
  bet: RegExp;
  win: RegExp;
}

/** One request/response between the game client and the provider's game server, already decoded. */
export interface GameCall {
  kind: 'init' | 'spin' | 'collect' | 'other';
  /** Stake of the spin, from the request (spin calls only). */
  wager?: number;
  /** Balance the server reports after this call. */
  balance?: number;
  /** Win accumulated so far in the current round. */
  totalWin?: number;
  /** The server is ready for a new spin: the round is over and settled. */
  roundClosed: boolean;
  currency?: string;
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
  /** HUD labels per player language. */
  labels: Record<Language, HudLabels>;
  /** Insufficient-balance message per player language. */
  insufficientBalance: Record<Language, RegExp>;
  visual: VisualProfile;
  /** Decoder for the game-server traffic, when known. */
  traffic?: TrafficParser;
}
