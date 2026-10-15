/**
 * Parses an amount as displayed (Betsson's header writes "1.234,56 €", other places "€1,234.56")
 * into integer cents. Currency amounts always have two decimals, so the separator followed by
 * exactly two final digits is the decimal one.
 */
const AMOUNT = /\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?/;

export function parseCents(raw: string): number | null {
  const match = raw.match(AMOUNT);
  if (!match) return null;
  const text = match[0].replace(/\s/g, '');
  const decimal = text.match(/[.,](\d{2})$/);
  const integerPart = decimal ? text.slice(0, -3) : text;
  const units = Number(integerPart.replace(/[.,]/g, ''));
  if (Number.isNaN(units)) return null;
  return units * 100 + (decimal ? Number(decimal[1]) : 0);
}
