import type { Locator, Page } from '@playwright/test';
import type { ResolvedGame } from '../games/catalog';
import { FULL_FRAME, type Point, type Region } from '../providers/types';
import { colorfulness, crop, diffRatio } from '../vision/image';

export interface EnterObservation {
  /** The game finished loading: its frame turned from the loading screen into a coloured screen. */
  loaded: boolean;
  /** The intro/splash screen was clicked through and the screen changed. */
  introPassed: boolean;
  loadMs: number;
}

/**
 * The provider game as the player sees it. It has no usable DOM: it is seen only through
 * screenshots of its iframe and driven with mouse clicks at positions relative to that frame.
 */
export class GameFrame {
  constructor(
    private readonly page: Page,
    private readonly frame: Locator,
    readonly game: ResolvedGame,
  ) {}

  async screenshot(region: Region = FULL_FRAME): Promise<Buffer> {
    const shot = await this.frame.screenshot({ animations: 'allow' });
    return region === FULL_FRAME ? shot : crop(shot, region);
  }

  /** Clicks a point given as fractions (0..1) of the frame's width and height. */
  async click(point: Point): Promise<void> {
    const box = await this.frame.boundingBox();
    if (!box) throw new Error('Game frame is not visible');
    await this.page.mouse.click(box.x + point.x * box.width, box.y + point.y * box.height);
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
    await this.click(this.game.visual.introDismiss);
    await this.page.waitForTimeout(2_500);
    const introPassed = diffRatio(before, await this.screenshot()) > 0.1;
    return { loaded, introPassed, loadMs };
  }
}
