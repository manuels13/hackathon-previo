import type { Page } from '@playwright/test';

/**
 * Types secrets (login, password) into the focused field of a page in a Chrome reached over CDP,
 * without going through Playwright's API. Anything passed to Playwright (fill, pressSequentially,
 * even CDPSession.send) is written to the test's trace; a separate DevTools connection is not.
 * Verified: neither value appears anywhere in the trace.zip.
 */
export class SecretTyper {
  private constructor(
    private readonly endpoint: string,
    private readonly targetId: string,
  ) {}

  /** Null when the browser is not reached over CDP (the page then has to be typed into normally). */
  static async forPage(page: Page, cdpUrl: string | undefined): Promise<SecretTyper | null> {
    if (!cdpUrl) return null;
    const session = await page.context().newCDPSession(page);
    const { targetInfo } = await session.send('Target.getTargetInfo');
    await session.detach();
    const { host } = new URL(cdpUrl);
    return new SecretTyper(`ws://${host}/devtools/page/${targetInfo.targetId}`, targetInfo.targetId);
  }

  /** Inserts the text into the focused element, like a paste: the page gets its input events. */
  async type(text: string): Promise<void> {
    const ws = new WebSocket(this.endpoint);
    try {
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error(`Cannot open a DevTools connection to page ${this.targetId}`));
      });
      await new Promise<void>((resolve, reject) => {
        ws.onmessage = (event) => {
          const answer = JSON.parse(String(event.data));
          if (answer.id !== 1) return;
          if (answer.error) reject(new Error(`Input.insertText failed: ${answer.error.message}`));
          else resolve();
        };
        ws.send(JSON.stringify({ id: 1, method: 'Input.insertText', params: { text } }));
      });
    } finally {
      ws.close();
    }
  }
}
