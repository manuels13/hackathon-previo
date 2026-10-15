import fs from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { CHECKS_ATTACHMENT, type ChecksAttachment } from './Checks';

/**
 * Writes a pass/fail table per scenario, market and game to report/checks.md and report/checks.json,
 * and to the GitHub Actions job summary when it runs in CI.
 */
export default class ChecksReporter implements Reporter {
  private readonly runs: (ChecksAttachment & { status: string })[] = [];

  onTestEnd(_test: TestCase, result: TestResult): void {
    const attachment = result.attachments.find((a) => a.name === CHECKS_ATTACHMENT && a.body);
    if (!attachment) return;
    this.runs.push({ ...JSON.parse(attachment.body!.toString()), status: result.status });
  }

  onEnd(): void {
    if (!this.runs.length) return;
    const lines = ['# Intelligent Game Validation — results', ''];
    for (const run of this.runs) {
      const passed = run.checks.filter((c) => c.passed).length;
      lines.push(`## ${run.scenario} · ${run.market} · ${run.game} (${run.provider}) — ${passed}/${run.checks.length} checks passed`, '');
      lines.push('| Check | Result | Details |', '| --- | --- | --- |');
      for (const c of run.checks) {
        lines.push(`| ${c.name} | ${c.passed ? '✅ PASS' : '❌ FAIL'} | ${c.details.replace(/\|/g, '\\|')} |`);
      }
      lines.push('');
    }
    const markdown = lines.join('\n');
    const outDir = path.resolve('report');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'checks.md'), markdown);
    fs.writeFileSync(path.join(outDir, 'checks.json'), JSON.stringify(this.runs, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
  }
}
