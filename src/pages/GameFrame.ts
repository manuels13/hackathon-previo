import type { Locator, Page } from '@playwright/test';
import type { MarketConfig } from '../config/markets';
import type { ResolvedGame } from '../games/catalog';
import { FULL_FRAME, type OcrFilter, type Point, type Region } from '../providers/types';
import { amountAfterLabel, parseCents } from '../utils/money';
import { colorfulness, crop, diffRatio, prepareForOcr } from '../vision/image';
import { readText } from '../vision/ocr';

export interface HudReading {
  credit: number | null;
  bet: number | null;
  win: number | null;
  currencyVisible: boolean;
  text: string;
  screenshot: Buffer;
}

export interface EnterObservation {
  /** The game finished loading: its frame turned from the loading screen into a coloured screen. */
  loaded: boolean;
  /** The intro/splash screen was clicked through and the screen changed. */
  introPassed: boolean;
  loadMs: number;
}

export interface SpinObservation {
  started: boolean;
  settled: boolean;
  /** How the spin was triggered: the provider key or the on-screen button. */
  method: string | null;
  /** Largest fraction of reel pixels that changed while starting. */
  maxReelChange: number;
  durationMs: number;
}

/** Most frequent non-null value; null when nothing was read. */
function mostFrequent(values: (number | null)[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  for (const [value, count] of counts) if (best === null || count > counts.get(best)!) best = value;
  return best;
}

/**
 * The provider game as the player sees it. It has no usable DOM: it is read only through
 * screenshots of the iframe and driven through the keyboard and mouse clicks at screen positions.
 * Nothing here is specific to a provider; differences come from `game.visual` and the provider labels.
 */
export class GameFrame {
  constructor(
    private readonly page: Page,
    private readonly frame: Locator,
    private readonly market: MarketConfig,
    readonly game: ResolvedGame,
  ) {}

  private get visual() {
    return this.game.visual;
  }

  async screenshot(region: Region = FULL_FRAME): Promise<Buffer> {
    const shot = await this.frame.screenshot({ animations: 'allow' });
    return region === FULL_FRAME ? shot : crop(shot, region);
  }

  async click(point: Point): Promise<void> {
    const box = await this.frame.boundingBox();
    if (!box) throw new Error('Game frame is not visible');
    await this.page.mouse.click(box.x + point.x * box.width, box.y + point.y * box.height);
  }

  /** Reads the text visible in a region. `screenshot` is what the player sees, kept as evidence. */
  async readText(region: Region = FULL_FRAME, filter: OcrFilter = 'none'): Promise<{ text: string; screenshot: Buffer }> {
    const screenshot = await this.screenshot(region);
    return { text: await readText(prepareForOcr(screenshot, filter), this.market.ocrLang), screenshot };
  }

  /** One OCR pass over the HUD. */
  private async readHudOnce(): Promise<HudReading> {
    const { text, screenshot } = await this.readText(this.visual.hud ?? FULL_FRAME, this.visual.ocrFilter);
    const labels = this.game.provider.labels[this.market.language];
    const fieldText = { credit: '', bet: '' };
    for (const field of ['credit', 'bet'] as const) {
      const region = this.visual.fields?.[field];
      if (region) fieldText[field] = await this.readAmountText(region);
    }
    return {
      credit: this.visual.fields?.credit ? parseCents(fieldText.credit) : amountAfterLabel(text, labels.credit),
      bet: this.visual.fields?.bet ? parseCents(fieldText.bet) : amountAfterLabel(text, labels.bet),
      win: amountAfterLabel(text, labels.win),
      currencyVisible: this.market.currencyMarks.test(`${text} ${fieldText.credit} ${fieldText.bet}`),
      text: [text, fieldText.credit, fieldText.bet].filter(Boolean).join('\n'),
      screenshot,
    };
  }

  /** Digits-only OCR of a region that holds just an amount. */
  private async readAmountText(region: Region): Promise<string> {
    const shot = await this.screenshot(region);
    return readText(prepareForOcr(shot, this.visual.ocrFilter), this.market.ocrLang, 'amount');
  }

  /**
   * Reads the HUD several times and keeps, per field, the value seen most often, so a single OCR
   * slip (a 2 read as 4) does not decide a check.
   */
  async readHud(passes = 3): Promise<HudReading> {
    const readings: HudReading[] = [];
    for (let i = 0; i < passes; i++) {
      readings.push(await this.readHudOnce());
      if (i < passes - 1) await this.page.waitForTimeout(300);
    }
    const consensus = (field: 'credit' | 'bet' | 'win') => mostFrequent(readings.map((r) => r[field]));
    const last = readings[readings.length - 1];
    return {
      credit: consensus('credit'),
      bet: consensus('bet'),
      win: consensus('win'),
      currencyVisible: readings.filter((r) => r.currencyVisible).length * 2 > readings.length,
      text: last.text,
      screenshot: last.screenshot,
    };
  }

  /**
   * Waits until the game has loaded and gets past its intro screen, without reading any text: a
   * loading screen is black/white, the game is coloured. Leaves the player on the game screen.
   */
  async enterGame(timeoutMs = 120_000): Promise<EnterObservation> {
    const startedAt = Date.now();
    await this.frame.waitFor({ state: 'visible', timeout: timeoutMs });
    let loaded = false;
    let colouredSince: number | null = null;
    while (!loaded && Date.now() - startedAt < timeoutMs) {
      const coloured = colorfulness(await this.screenshot()) > 0.3;
      colouredSince = coloured ? (colouredSince ?? Date.now()) : null;
      loaded = colouredSince !== null && Date.now() - colouredSince >= 2_000;
      if (!loaded) await this.page.waitForTimeout(500);
    }
    const loadMs = Date.now() - startedAt;
    if (!loaded) return { loaded, introPassed: false, loadMs };

    const before = await this.screenshot();
    await this.click(this.visual.introDismiss);
    await this.page.waitForTimeout(2_500);
    const introPassed = diffRatio(before, await this.screenshot()) > 0.1;
    return { loaded, introPassed, loadMs };
  }

  /** Waits until the HUD shows a readable credit and bet, getting past the intro screen like a player would. */
  async waitUntilReady(timeoutMs = 90_000): Promise<HudReading> {
    await this.frame.waitFor({ state: 'visible', timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    let lastIntroClick = Date.now();
    let hud: HudReading | undefined;
    while (Date.now() < deadline) {
      hud = await this.readHudOnce();
      if (hud.credit !== null && hud.bet !== null) return this.readHud();
      if (Date.now() - lastIntroClick > 8_000) {
        await this.click(this.visual.introDismiss);
        lastIntroClick = Date.now();
      }
      await this.page.waitForTimeout(1_000);
    }
    throw new Error(`The game never showed a readable balance/bet. Last OCR text: "${hud?.text.replace(/\s+/g, ' ')}"`);
  }

  /** Ways to trigger a spin, in order of preference. */
  private spinTriggers(): { method: string; run: () => Promise<void> }[] {
    const { spinKey, spinButton, focusPoint } = this.visual;
    const triggers = [];
    if (spinKey) {
      triggers.push({
        method: `key ${spinKey}`,
        run: async () => {
          await this.click(focusPoint);
          await this.page.keyboard.press(spinKey);
        },
      });
    }
    if (spinButton) triggers.push({ method: 'spin button', run: () => this.click(spinButton) });
    return triggers;
  }

  /** Triggers a spin and watches the reels: did they start moving, and did they settle again? */
  async spinAndObserve(): Promise<SpinObservation> {
    const startedAt = Date.now();
    let maxReelChange = 0;
    for (const trigger of this.spinTriggers()) {
      const before = await this.screenshot(this.visual.reels);
      await trigger.run();
      const change = await this.watchReels(before, 8_000, this.visual.spinStartDiff);
      maxReelChange = Math.max(maxReelChange, change);
      if (change >= this.visual.spinStartDiff) {
        const settled = await this.waitForStill(this.visual.reels, startedAt + this.visual.spinTimeoutMs);
        return { started: true, settled, method: trigger.method, maxReelChange, durationMs: Date.now() - startedAt };
      }
    }
    return { started: false, settled: false, method: null, maxReelChange, durationMs: Date.now() - startedAt };
  }

  /** Attempts a spin that should be rejected and watches the reels for a while instead of waiting for a spin. */
  async attemptSpinAndWatch(watchMs = 6_000): Promise<{ maxReelChange: number }> {
    const before = await this.screenshot(this.visual.reels);
    let maxReelChange = 0;
    for (const trigger of this.spinTriggers()) {
      await trigger.run();
      maxReelChange = Math.max(maxReelChange, await this.watchReels(before, watchMs / 2));
    }
    return { maxReelChange };
  }

  /** Returns the largest reel change seen within `ms`, stopping early once it reaches `stopAt`. */
  private async watchReels(before: Buffer, ms: number, stopAt = Infinity): Promise<number> {
    const end = Date.now() + ms;
    let max = 0;
    while (Date.now() < end && max < stopAt) {
      max = Math.max(max, diffRatio(before, await this.screenshot(this.visual.reels)));
    }
    return max;
  }

  private async waitForStill(region: Region, deadline: number): Promise<boolean> {
    let previous = await this.screenshot(region);
    let stillSince = Date.now();
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(250);
      const current = await this.screenshot(region);
      if (diffRatio(previous, current) > this.visual.stableDiff) stillSince = Date.now();
      else if (Date.now() - stillSince >= this.visual.stableForMs) return true;
      previous = current;
    }
    return false;
  }
}
