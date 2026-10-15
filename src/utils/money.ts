/**
 * Money is always handled as integer cents.
 *
 * The decimal separator is inferred from the text instead of taken from the market: the Betsson
 * shell in .es writes "1.234,56 €" but the provider game may still write "€1,234.56". Currency
 * amounts always have two decimals, so the separator followed by exactly two final digits is the
 * decimal one.
 */
const AMOUNT = /\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?/;

export function parseCents(raw: string): number | null {
  const match = raw.replace(/[Oo](?=[\d.,])/g, '0').match(AMOUNT);
  if (!match) return null;
  const text = match[0].replace(/\s/g, '');
  const decimal = text.match(/[.,](\d{2})$/);
  const integerPart = decimal ? text.slice(0, -3) : text;
  const units = Number(integerPart.replace(/[.,]/g, ''));
  if (Number.isNaN(units)) return null;
  return units * 100 + (decimal ? Number(decimal[1]) : 0);
}

/** Finds the first amount that follows `label` in OCR text, on the same line or the next one. */
export function amountAfterLabel(text: string, label: RegExp): number | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(label);
    if (!match) continue;
    const rest = lines[i].slice(match.index! + match[0].length);
    const sameLine = parseCents(rest);
    if (sameLine !== null) return sameLine;
    const nextLine = lines[i + 1] ? parseCents(lines[i + 1]) : null;
    if (nextLine !== null) return nextLine;
  }
  return null;
}

export function formatCents(cents: number | null): string {
  return cents === null ? 'n/a' : (cents / 100).toFixed(2);
}
