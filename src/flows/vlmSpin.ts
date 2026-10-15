import fs from 'node:fs';
import path from 'node:path';
import type { RoundRecorder, ServerRound } from '../network/RoundRecorder';
import type { GameFrame } from '../pages/GameFrame';
import type { Region } from '../providers/types';
import { markPoint } from '../vision/annotate';
import { diffRatio } from '../vision/image';
import type { PreSpinReading, VlmClient } from '../vision/vlm';

export interface VlmSpinOptions {
  /** Folder where every screenshot of the run is written. */
  evidenceDir: string;
  /** Game-server traffic: the outcome of the round is read from it. */
  recorder: RoundRecorder;
  /** Highest wager allowed: above it the spin is not made (a new game may default to a high bet). */
  maxWager?: number;
  startTimeoutMs?: number;
  settleTimeoutMs?: number;
  /** Called for each evidence image, e.g. to attach it to the Playwright report. */
  onEvidence?: (name: string, png: Buffer) => Promise<void>;
}

export interface VlmSpinResult {
  /** What the VLM read on screen before the spin: balance, currency, wager, spin button. */
  before: PreSpinReading;
  /** The reels visibly moved after the click (local pixel comparison, no VLM). */
  reelsMoved: boolean;
  /** The round as the provider's server settled it; null if it never closed. */
  server: ServerRound | null;
  vlmCalls: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The spin, spending one VLM call:
 * 1. VLM reads balance, currency, wager and the spin button position from a screenshot
 * 2. jimp marks the spin button on that screenshot, kept as evidence
 * 3. Playwright clicks those exact coordinates
 * 4. the reels must visibly move (local pixel comparison)
 * 5. the outcome comes from the game server's HTTP traffic: the round is over when the server
 *    closes it, with its stake, payout and balances. A final screenshot is kept as evidence only;
 *    it is not sent to the VLM.
 */
export async function runVlmSpin(game: GameFrame, vlm: VlmClient, options: VlmSpinOptions): Promise<VlmSpinResult> {
  const { evidenceDir, recorder, startTimeoutMs = 10_000, settleTimeoutMs = 90_000 } = options;
  fs.mkdirSync(evidenceDir, { recursive: true });
  let shot = 0;
  const evidence = async (name: string, png: Buffer) => {
    fs.writeFileSync(path.join(evidenceDir, `${String(++shot).padStart(2, '0')}-${name}.png`), png);
    await options.onEvidence?.(name, png);
  };

  // 1. What the player sees before the spin: the only screenshot the VLM reads (plus one per intro
  //    screen it had to click through).
  let { shot: beforeShot, before, vlmCalls } = await readPlayableScreen(game, vlm, evidence, 'before-spin');

  // A game opened for the first time may come with a high default bet: bring it down to the minimum
  // with the game's own "−" button, then read the screen again. Never spin above the limit.
  if (options.maxWager !== undefined && before.wager > options.maxWager && before.betDecrease) {
    const { x, y } = before.betDecrease;
    await evidence('bet-decrease-marked', await markPoint(beforeShot, (x / 1000) * beforeShot.readUInt32BE(16), (y / 1000) * beforeShot.readUInt32BE(20)));
    // More clicks than any bet ladder has steps: at the minimum the button does nothing.
    for (let i = 0; i < 25; i++) {
      await game.click({ x: x / 1000, y: y / 1000 });
      await sleep(150);
    }
    await sleep(1_000);
    const reread = await readPlayableScreen(game, vlm, evidence, 'before-spin-lowered-bet');
    ({ shot: beforeShot, before } = reread);
    vlmCalls += reread.vlmCalls;
  }
  if (options.maxWager !== undefined && before.wager > options.maxWager) {
    throw new Error(
      `The game's wager is ${before.wager.toFixed(2)}, above the ${options.maxWager.toFixed(2)} limit (MAX_WAGER): ` +
        'the spin was not made. Lower the bet in the game or raise MAX_WAGER.',
    );
  }

  // 2. Where we are going to click. Normalised 0..1000 → screenshot pixels.
  const px = (before.spinButton.x / 1000) * beforeShot.readUInt32BE(16);
  const py = (before.spinButton.y / 1000) * beforeShot.readUInt32BE(20);
  await evidence('spin-button-marked', await markPoint(beforeShot, px, py));

  // 3. Click the same point. Relative coordinates do not depend on the screenshot's pixel density.
  const { reels, spinStartDiff, stableDiff, stableForMs } = game.game.visual;
  const reelsBefore = await game.screenshot(reels);
  const mark = recorder.mark();
  await game.click({ x: before.spinButton.x / 1000, y: before.spinButton.y / 1000 });

  // 4. The game reacted on screen: the reels move.
  const startDeadline = Date.now() + startTimeoutMs;
  let reelsMoved = false;
  while (!reelsMoved && Date.now() < startDeadline) {
    reelsMoved = diffRatio(reelsBefore, await game.screenshot(reels)) >= spinStartDiff;
    if (!reelsMoved) await sleep(100);
  }

  // 5. The server closes the round; then one screenshot of the settled screen for the report.
  const settleDeadline = Date.now() + settleTimeoutMs;
  const server = await recorder.waitForRound(mark, settleTimeoutMs);
  if (reelsMoved) {
    const settled = await waitForStill(game, reels, stableDiff, stableForMs, settleDeadline);
    await evidence('after-spin', settled ?? (await game.screenshot()));
  }
  return { before, reelsMoved, server, vlmCalls };
}

/**
 * Screenshot of the playable game and the VLM's reading of it. A game still on its intro screen
 * (where its "continue" button is differs per game) is clicked through where the VLM says, up to
 * twice, so no per-game coordinates are needed.
 */
export async function readPlayableScreen(
  game: GameFrame,
  vlm: VlmClient,
  evidence: (name: string, png: Buffer) => Promise<void>,
  name: string,
): Promise<{ shot: Buffer; before: PreSpinReading; vlmCalls: number }> {
  for (let vlmCalls = 1; vlmCalls <= 3; vlmCalls++) {
    const shot = await game.screenshot();
    const reading = await vlm.readPreSpin(shot);
    if (!('introContinue' in reading)) {
      await evidence(name, shot);
      return { shot, before: reading, vlmCalls };
    }
    const { x, y } = reading.introContinue;
    await evidence('intro-continue-marked', await markPoint(shot, (x / 1000) * shot.readUInt32BE(16), (y / 1000) * shot.readUInt32BE(20)));
    await game.click({ x: x / 1000, y: y / 1000 });
    await sleep(3_000);
  }
  throw new Error('The game is still on its intro screen after clicking "continue" twice');
}

/** Waits until the region stops changing for `stillForMs`; returns a full game screenshot taken then. */
async function waitForStill(
  game: GameFrame,
  region: Region,
  maxDiff: number,
  stillForMs: number,
  deadline: number,
): Promise<Buffer | null> {
  let previous = await game.screenshot(region);
  let stillSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(250);
    const current = await game.screenshot(region);
    if (diffRatio(previous, current) > maxDiff) stillSince = Date.now();
    else if (Date.now() - stillSince >= stillForMs) return game.screenshot();
    previous = current;
  }
  return null;
}
