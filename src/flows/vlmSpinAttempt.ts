import fs from 'node:fs';
import path from 'node:path';
import type { RoundRecorder } from '../network/RoundRecorder';
import type { GameFrame } from '../pages/GameFrame';
import type { GameCall } from '../providers/types';
import { markPoint } from '../vision/annotate';
import { diffRatio } from '../vision/image';
import type { PreSpinReading, SpinAttemptReading, VlmClient } from '../vision/vlm';

export interface SpinAttemptOptions {
  /** Folder where every screenshot of the run is written. */
  evidenceDir: string;
  /** Game-server traffic, when the provider has a parser: tells whether the server played or refused the spin. */
  recorder?: RoundRecorder;
  /** Betsson wallet before the attempt. If it covers the wager, the spin is not attempted. */
  walletBefore: number;
  /** How long to watch the screen for the game's answer after the click. */
  watchMs?: number;
  /** Called for each evidence image, e.g. to attach it to the Playwright report. */
  onEvidence?: (name: string, png: Buffer) => Promise<void>;
}

export interface SpinAttemptResult {
  /** What the VLM read on screen before the attempt. */
  before: PreSpinReading;
  /** False when the account could afford the wager: the click was not made, no money was at stake. */
  attempted: boolean;
  /** What the VLM read on the screen that changed most after the click (the game's answer). */
  after: SpinAttemptReading | null;
  /** The reels area changed like a spin would change it (local pixel comparison, no VLM). */
  reelsMoved: boolean;
  /** Game-server calls made after the click, decoded (numbers only). */
  calls: GameCall[];
  vlmCalls: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A spin attempt with a balance below the wager, spending two VLM calls:
 * 1. VLM reads balance, currency, wager and the spin button position before the attempt
 * 2. safety: if the screen or the wallet cover the wager, stop here (that would be a paid spin)
 * 3. jimp marks the spin button, Playwright clicks it
 * 4. the screen is watched for a few seconds and the frame that changed most (the game's message) is kept
 * 5. VLM reads that frame: message, its language, balance and currency
 * The game-server calls made after the click tell whether a spin was played or refused.
 */
export async function runSpinAttempt(game: GameFrame, vlm: VlmClient, options: SpinAttemptOptions): Promise<SpinAttemptResult> {
  const { evidenceDir, recorder, walletBefore, watchMs = 6_000 } = options;
  fs.mkdirSync(evidenceDir, { recursive: true });
  let shot = 0;
  const evidence = async (name: string, png: Buffer) => {
    fs.writeFileSync(path.join(evidenceDir, `${String(++shot).padStart(2, '0')}-${name}.png`), png);
    await options.onEvidence?.(name, png);
  };

  // 1. What the player sees before the attempt.
  const beforeShot = await game.screenshot();
  await evidence('before-attempt', beforeShot);
  const before = await vlm.readPreSpin(beforeShot);

  // 2. Never click when the money is there: it would be a real paid spin, not this scenario.
  if (before.balance >= before.wager || walletBefore >= before.wager) {
    return { before, attempted: false, after: null, reelsMoved: false, calls: [], vlmCalls: 1 };
  }

  // 3. Mark and click the spin button.
  const px = (before.spinButton.x / 1000) * beforeShot.readUInt32BE(16);
  const py = (before.spinButton.y / 1000) * beforeShot.readUInt32BE(20);
  await evidence('spin-button-marked', await markPoint(beforeShot, px, py));
  const { reels, spinStartDiff } = game.game.visual;
  const reelsBefore = await game.screenshot(reels);
  const mark = recorder?.mark() ?? 0;
  await game.click({ x: before.spinButton.x / 1000, y: before.spinButton.y / 1000 });

  // 4. The game's answer: the frame that differs most from the screen before the click. A message
  //    may be a short-lived toast, so the screen is sampled instead of taking one late screenshot.
  let reaction = await game.screenshot();
  let reactionDiff = diffRatio(beforeShot, reaction);
  let reelsMoved = false;
  const deadline = Date.now() + watchMs;
  while (Date.now() < deadline) {
    await sleep(250);
    const current = await game.screenshot();
    const diff = diffRatio(beforeShot, current);
    if (diff > reactionDiff) {
      reaction = current;
      reactionDiff = diff;
    }
    reelsMoved ||= diffRatio(reelsBefore, await game.screenshot(reels)) >= spinStartDiff;
  }
  await evidence('after-attempt', reaction);

  // 5. What the player was told.
  const after = await vlm.readSpinAttempt(reaction);
  return { before, attempted: true, after, reelsMoved, calls: recorder?.callsSince(mark) ?? [], vlmCalls: 2 };
}
