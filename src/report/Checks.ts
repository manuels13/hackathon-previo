import type { Page, TestInfo } from '@playwright/test';
import type { MarketConfig } from '../config/markets';

export interface CheckResult {
  name: string;
  passed: boolean;
  details: string;
}

/** Content of the `checks` attachment that the summary reporter reads. */
export interface ChecksAttachment {
  market: string;
  scenario: string;
  game: string;
  provider: string;
  checks: CheckResult[];
}

export const CHECKS_ATTACHMENT = 'checks';

/**
 * Soft checks: each verification is recorded as pass/fail with its evidence and the scenario
 * keeps going, so the report always shows every check. `assertAll()` fails the test at the end.
 */
export class Checks {
  readonly results: CheckResult[] = [];

  constructor(
    private readonly page: Page,
    private readonly market: MarketConfig,
    private readonly testInfo: TestInfo,
    private readonly scenario: string,
    private readonly game: string,
    private readonly provider: string,
  ) {}

  async evidence(name: string, png?: Buffer): Promise<void> {
    const body =
      png ??
      (await this.page.screenshot({ mask: this.market.shell.sensitive.map((s) => s(this.page)) }));
    await this.testInfo.attach(name, { body, contentType: 'image/png' });
  }

  async check(name: string, passed: boolean, details: string, png?: Buffer): Promise<boolean> {
    this.results.push({ name, passed, details });
    this.testInfo.annotations.push({ type: passed ? 'PASS' : 'FAIL', description: `${name} — ${details}` });
    if (png) await this.evidence(`${passed ? 'PASS' : 'FAIL'} ${name}`, png);
    return passed;
  }

  async attachSummary(): Promise<void> {
    const body: ChecksAttachment = {
      market: this.market.id,
      scenario: this.scenario,
      game: this.game,
      provider: this.provider,
      checks: this.results,
    };
    await this.testInfo.attach(CHECKS_ATTACHMENT, {
      body: JSON.stringify(body, null, 2),
      contentType: 'application/json',
    });
  }

  assertAll(): void {
    const failed = this.results.filter((r) => !r.passed);
    if (failed.length) {
      throw new Error(`Failed checks:\n${failed.map((f) => `- ${f.name}: ${f.details}`).join('\n')}`);
    }
  }
}
