import type { Page, Response } from '@playwright/test';
import type { GameCall, GameSession, TrafficParser } from '../providers/types';

interface RecordedCall extends GameCall {
  at: number;
}

/** A spin round as the provider's server settled it. */
export interface ServerRound {
  wager: number;
  balanceBefore: number | undefined;
  balanceAfter: number;
  /** Total won in the round (0 when nothing was won). */
  payout: number;
  /** Calls that made up the round: spin, cascades, collect... */
  calls: number;
  /** Time from the spin request to the call that closed the round. */
  durationMs: number;
}

/**
 * Listens to the game-server traffic of a page (iframes included) through the provider's parser.
 * Only the decoded numbers are kept: no raw bodies, tokens or personal data are stored.
 */
export class RoundRecorder {
  private readonly calls: RecordedCall[] = [];
  private readonly listener = (response: Response) => void this.onResponse(response);

  constructor(
    private readonly page: Page,
    private readonly parser: TrafficParser,
  ) {
    page.on('response', this.listener);
  }

  stop(): void {
    this.page.off('response', this.listener);
  }

  /** Position to use with waitForRound(): only calls after it count. */
  mark(): number {
    return this.calls.length;
  }

  /** Game session as the provider's server opened it (currency, language...), if seen. */
  session(): GameSession | undefined {
    return [...this.calls].reverse().find((c) => c.kind === 'session')?.session;
  }

  /** Whether a spin request has been answered since `mark`. */
  spinSentSince(mark: number): boolean {
    return this.calls.slice(mark).some((c) => c.kind === 'spin');
  }

  /** Waits for the first round that starts after `mark` to be closed by the server. */
  async waitForRound(mark: number, timeoutMs = 90_000): Promise<ServerRound | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const round = this.roundSince(mark);
      if (round) return round;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
  }

  private roundSince(mark: number): ServerRound | null {
    const start = this.calls.findIndex((c, i) => i >= mark && c.kind === 'spin');
    if (start < 0) return null;
    const end = this.calls.findIndex((c, i) => i >= start && c.roundClosed);
    if (end < 0) return null;
    const round = this.calls.slice(start, end + 1);
    const closing = this.calls[end];
    if (closing.balance === undefined || round[0].wager === undefined) return null;
    const balanceBefore = [...this.calls.slice(0, start)].reverse().find((c) => c.balance !== undefined)?.balance;
    const payout = [...round].reverse().find((c) => c.totalWin !== undefined)?.totalWin ?? 0;
    return {
      wager: round[0].wager,
      balanceBefore,
      balanceAfter: closing.balance,
      payout,
      calls: round.length,
      durationMs: closing.at - round[0].at,
    };
  }

  private async onResponse(response: Response): Promise<void> {
    const request = response.request();
    if (!this.parser.isGameCall(request.url())) return;
    try {
      const call = this.parser.parse(request.postData() ?? '', await response.text());
      if (call) this.calls.push({ ...call, at: Date.now() });
    } catch {
      // A body that cannot be read (navigation, closed frame) is simply not counted.
    }
  }
}
