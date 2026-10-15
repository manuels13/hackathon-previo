import OpenAI from 'openai';

/**
 * Vision-language model (Qwen2-VL by default) behind any OpenAI-compatible endpoint (vLLM, DashScope,
 * OpenRouter...). It only ever receives screenshots of the game frame: no Betsson page, no personal data.
 *
 * Coordinates: Qwen2-VL is trained to give positions normalised to 0..1000 on each axis whatever the
 * image size, which is far more reliable than asking it for raw pixels. Callers convert them.
 */

export interface VlmConfig {
  baseURL: string;
  apiKey: string;
  /** Models tried in order: when one stays rate-limited or down, the next one answers. */
  models: string[];
}

export function vlmConfigFromEnv(): VlmConfig | null {
  const baseURL = process.env.VLM_BASE_URL;
  if (!baseURL) return null;
  return {
    baseURL,
    apiKey: process.env.VLM_API_KEY ?? 'none',
    models: (process.env.VLM_MODEL ?? 'Qwen/Qwen2-VL-72B-Instruct')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  };
}

/** Point on the image, each axis normalised to 0..1000. */
export interface NormPoint {
  x: number;
  y: number;
}

export interface PreSpinReading {
  /** Balance shown in the game before spinning, in currency units (e.g. 98.5). */
  balance: number;
  /** ISO code or symbol as displayed, e.g. "EUR" or "€". */
  currency: string;
  /** Bet that the next spin will use, in currency units. */
  wager: number;
  spinButton: NormPoint;
}

const SYSTEM = [
  'You are a computer-vision system that reads screenshots of online slot games exactly as a player sees them.',
  'Answer ONLY with one JSON object, no prose, no markdown fences.',
  'Amounts are numbers in currency units with a dot as decimal separator (the screen may show "1.234,56 €": answer 1234.56).',
  'Never guess: if a value is not visible, use null.',
].join(' ');

const PRE_SPIN = `Read this slot game screen before a spin and return:
{"balance": number|null, "currency": string|null, "wager": number|null, "spin_button": {"x": number, "y": number}|null}
- balance: the player's credit/balance shown by the game (labels like CREDIT, CRÉDITO, BALANCE, SALDO).
- currency: currency code or symbol shown next to the amounts.
- wager: the current bet per spin (labels like BET, APUESTA, TOTAL BET). Ignore buy-feature or ante prices.
- spin_button: centre of the main button that starts a spin (usually a large round button with circular arrows),
  with x and y normalised to 0..1000 of the image width and height.`;

/** Extracts the JSON object from a model answer, tolerating stray prose or ``` fences. */
function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`VLM answer has no JSON object: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Worth trying another model: rate limits (429), overloaded or down providers (5xx) and models that
 * no longer exist (404, e.g. a retired Gemini version). Anything else is a real error.
 */
const isTransient = (error: unknown) => {
  const status = (error as { status?: number }).status;
  return status === 404 || status === 429 || (status !== undefined && status >= 500);
};

export class VlmClient {
  private readonly client: OpenAI;

  constructor(private readonly config: VlmConfig) {
    // Retries are done here, with longer waits than the SDK's, because free models are often saturated.
    this.client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey, maxRetries: 0 });
  }

  /** Model that answered the last request, for the report. */
  lastModel: string | undefined;
  /** Index of the model that answered last: the next request starts there. */
  private preferred = 0;

  /**
   * A saturated free model fails over to the next one at once; only when every model failed in a
   * round does it wait (5 s, 10 s, 20 s) and try again. The model that answers is remembered.
   */
  private async ask(png: Buffer, prompt: string): Promise<Record<string, unknown>> {
    const { models } = this.config;
    let lastError: unknown;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < models.length; i++) {
        const index = (this.preferred + i) % models.length;
        try {
          const answer = await this.askModel(models[index], png, prompt);
          this.preferred = index;
          this.lastModel = models[index];
          return answer;
        } catch (error) {
          lastError = error;
          if (!isTransient(error)) throw error;
          console.log(`[vlm] ${models[index]} unavailable (${(error as { status?: number }).status}), trying the next model`);
        }
      }
      if (round < 2) await sleep(5_000 * 2 ** round);
    }
    throw new Error(`All VLM models are rate-limited or unavailable (${models.join(', ')}): ${String(lastError)}`);
  }

  private async askModel(model: string, png: Buffer, prompt: string): Promise<Record<string, unknown>> {
    const completion = await this.client.chat.completions.create({
      model,
      temperature: 0,
      // Room for reasoning models, which think before writing the JSON.
      max_tokens: 2000,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    // OpenRouter sometimes answers 200 with an upstream error and no choices (saturated free provider):
    // report it as the transient error it is, so the retry/fallback logic handles it.
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      const upstream = (completion as unknown as { error?: { code?: number; message?: string } }).error;
      throw Object.assign(new Error(`Empty answer from ${model}: ${upstream?.message ?? 'no choices'}`), {
        status: upstream?.code ?? 503,
      });
    }
    return parseJsonObject(content);
  }

  async readPreSpin(png: Buffer): Promise<PreSpinReading> {
    const r = await this.ask(png, PRE_SPIN);
    const button = r.spin_button as { x?: unknown; y?: unknown } | null;
    if (!isNumber(r.balance) || !isNumber(r.wager) || typeof r.currency !== 'string' || !button) {
      throw new Error(`VLM could not read the pre-spin screen: ${JSON.stringify(r)}`);
    }
    if (!isNumber(button.x) || !isNumber(button.y) || button.x < 0 || button.x > 1000 || button.y < 0 || button.y > 1000) {
      throw new Error(`VLM returned an invalid spin button position: ${JSON.stringify(button)}`);
    }
    return { balance: r.balance, currency: r.currency, wager: r.wager, spinButton: { x: button.x, y: button.y } };
  }
}
