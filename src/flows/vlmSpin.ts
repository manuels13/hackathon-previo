import fs from 'node:fs';
import path from 'node:path';
import type { RoundRecorder, ServerRound } from '../network/RoundRecorder';
import type { GameFrame } from '../pages/GameFrame';
import type { Region } from '../providers/types';
import { markPoint } from '../vision/annotate';
import { diffRatio } from '../vision/image';
import type { PostSpinReading, PreSpinReading, VlmClient } from '../vision/vlm';

export interface VlmSpinOptions {
  /** Folder where every screenshot of the run is written. */
  evidenceDir: string;
  /** Game-server witness of the round; without it the round end is detected from the screen only. */
  recorder?: RoundRecorder;
  /** Max difference accepted in the balance rule, in currency units. */
  tolerance?: number;
  startTimeoutMs?: number;
  settleTimeoutMs?: number;
  /** Called for each evidence image, e.g. to attach it to the Playwright report. */
  onEvidence?: (name: string, png: Buffer) => Promise<void>;
}

export interface VlmSpinResult {
  /** What the VLM read on screen before and after the spin. */
  before: PreSpinReading;
  after: PostSpinReading | null;
  /** Why the final reading is missing, when the VLM could not answer (the round is still judged). */
  afterError?: string;
  /** The reels visibly moved after the click (pixel comparison). */
  reelsMoved: boolean;
  /** The screen came to rest after the round. */
  screenSettled: boolean;
  /** The round as the provider's server settled it (null without recorder or if it never closed). */
  server: ServerRound | null;
  /** On-screen rule: after = before − wager + payout, with the VLM readings. */
  expectedBalance: number;
  difference: number | null;
  balanceRuleHolds: boolean;
  vlmCalls: number;
  screenshots: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The game interaction block:
 * 1. VLM reads balance, currency, wager and the spin button position from a screenshot
 * 2. jimp marks the spin button on that screenshot, kept as evidence
 * 3. Playwright clicks those exact coordinates
 * 4. the round is followed without asking the VLM: the reels must visibly move (pixel comparison),
 *    the provider's server must close the round (network) and the screen must come to rest
 * 5. VLM reads the final balance and payout; balance_after = balance_before − wager + payout
 *
 * Only two VLM calls per spin: the network says when the round ends, so no screenshots are spent
 * polling, and it is an independent witness of the amounts the VLM reads.
 */
export async function runVlmSpin(game: GameFrame, vlm: VlmClient, options: VlmSpinOptions): Promise<VlmSpinResult> {
  const { evidenceDir, recorder, tolerance = 0.01, startTimeoutMs = 10_000, settleTimeoutMs = 90_000 } = options;
  fs.mkdirSync(evidenceDir, { recursive: true });
  let screenshots = 0;
  let vlmCalls = 0;
  const evidence = async (name: string, png: Buffer) => {
    const file = path.join(evidenceDir, `${String(++screenshots).padStart(2, '0')}-${name}.png`);
    fs.writeFileSync(file, png);
    await options.onEvidence?.(name, png);
  };

  // 1. What the player sees before the spin.
  const beforeShot = await game.screenshot();
  await evidence('before-spin', beforeShot);
  const before = await vlm.readPreSpin(beforeShot);
  vlmCalls++;

  // 2. Where we are going to click. Normalised 0..1000 → screenshot pixels.
  const width = beforeShot.readUInt32BE(16);
  const height = beforeShot.readUInt32BE(20);
  const px = (before.spinButton.x / 1000) * width;
  const py = (before.spinButton.y / 1000) * height;
  await evidence('spin-button-marked', await markPoint(beforeShot, px, py));

  // 3. Click the same point. Relative coordinates do not depend on the screenshot's pixel density.
  const { reels, spinStartDiff, stableDiff, stableForMs } = game.game.visual;
  const reelsBefore = await game.screenshot(reels);
  const mark = recorder?.mark() ?? 0;
  await game.click({ x: before.spinButton.x / 1000, y: before.spinButton.y / 1000 });

  // 4a. The game reacted: the reels move. The first moving frame is kept as evidence.
  const startDeadline = Date.now() + startTimeoutMs;
  let reelsMoved = false;
  while (!reelsMoved && Date.now() < startDeadline) {
    reelsMoved = diffRatio(reelsBefore, await game.screenshot(reels)) >= spinStartDiff;
  }
  if (reelsMoved) await evidence('spinning', await game.screenshot());

  // 4b. The server closes the round (it answers before the animation ends)...
  const settleDeadline = Date.now() + settleTimeoutMs;
  const server = recorder ? await recorder.waitForRound(mark, settleTimeoutMs) : null;
  // ...and then the screen comes to rest, so the final reading shows the settled result.
  const settledShot = reelsMoved ? await waitForStill(game, reels, stableDiff, stableForMs, settleDeadline) : null;
  const screenSettled = settledShot !== null;

  // 5. What the player sees after the spin, and the balance rule on those readings.
  // The money has already moved: a VLM outage here must not hide the rest of the verification.
  let after: PostSpinReading | null = null;
  let afterError: string | undefined;
  if (settledShot) {
    await evidence('after-spin', settledShot);
    vlmCalls++;
    after = await vlm.readPostSpin(settledShot).catch((error) => {
      afterError = String(error instanceof Error ? error.message : error).slice(0, 300);
      return null;
    });
  }
  const expectedBalance = round2(before.balance - before.wager + (after?.payout ?? 0));
  const difference = after ? round2(Math.abs(after.balance - expectedBalance)) : null;
  const balanceRuleHolds = difference !== null && difference <= tolerance;
  return { before, after, afterError, reelsMoved, screenSettled, server, expectedBalance, difference, balanceRuleHolds, vlmCalls, screenshots };
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
