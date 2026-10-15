import { createWorker, PSM, type Worker } from 'tesseract.js';

/** text: free text in the given languages. amount: a single line of digits, separators and currency. */
export type OcrMode = 'text' | 'amount';

const workers = new Map<string, Promise<Worker>>();

async function newWorker(lang: string, mode: OcrMode): Promise<Worker> {
  const worker = await createWorker(mode === 'amount' ? 'eng' : lang);
  if (mode === 'amount') {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789,.€ ', tessedit_pageseg_mode: PSM.SINGLE_LINE });
  }
  return worker;
}

function getWorker(lang: string, mode: OcrMode): Promise<Worker> {
  const key = mode === 'amount' ? 'amount' : lang;
  let worker = workers.get(key);
  if (!worker) {
    worker = newWorker(lang, mode);
    workers.set(key, worker);
  }
  return worker;
}

/** Reads the visible text in a PNG screenshot. */
export async function readText(png: Buffer, lang: string, mode: OcrMode = 'text'): Promise<string> {
  const worker = await getWorker(lang, mode);
  const { data } = await worker.recognize(png);
  return data.text;
}

export async function terminateOcr(): Promise<void> {
  const all = [...workers.values()];
  workers.clear();
  await Promise.all(all.map(async (w) => (await w).terminate()));
}
