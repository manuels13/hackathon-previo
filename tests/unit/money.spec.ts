import { expect, test } from '@playwright/test';
import { amountAfterLabel, parseCents } from '../../src/utils/money';

test.describe('parseCents', () => {
  for (const [raw, cents] of [
    ['€1,234.56', 123456],
    ['1.234,56 €', 123456],
    ['€0.20', 20],
    ['0,20 €', 20],
    ['€100', 10000],
    ['EUR 12,345.00', 1234500],
    ['€1O0.00', 10000],
  ] as const) {
    test(`${raw} → ${cents}`, () => expect(parseCents(raw)).toBe(cents));
  }

  test('no amount', () => expect(parseCents('GOOD LUCK')).toBeNull());
});

test.describe('amountAfterLabel', () => {
  test('label and amount on the same line', () => {
    const text = 'CREDIT €99,980.00   BET €0.20';
    expect(amountAfterLabel(text, /CREDIT/i)).toBe(9998000);
    expect(amountAfterLabel(text, /\bBET\b/i)).toBe(20);
  });

  test('amount on the line below the label', () => {
    expect(amountAfterLabel('CRÉDITO\n1.000,00 €', /CR[ÉE]DITO/i)).toBe(100000);
  });

  test('missing label', () => expect(amountAfterLabel('BET €0.20', /\bWIN\b/i)).toBeNull());
});
