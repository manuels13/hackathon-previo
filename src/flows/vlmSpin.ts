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

  // 1. What the player sees before the spin: the only screenshot the VLM reads.
  const beforeShot = await game.screenshot();
  await evidence('before-spin', beforeShot);
  const before = await vlm.readPreSpin(beforeShot);

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
  return { before, reelsMoved, server, vlmCalls: 1 };
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
