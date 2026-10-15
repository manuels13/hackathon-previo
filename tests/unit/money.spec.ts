import { expect, test } from '@playwright/test';
import { parseCents } from '../../src/utils/money';

test.describe('parseCents', () => {
  for (const [raw, cents] of [
    ['€1,234.56', 123456],
    ['1.234,56 €', 123456],
    ['99,33 €', 9933],
    ['€0.20', 20],
    ['0,20 €', 20],
    ['€100', 10000],
    ['EUR 12,345.00', 1234500],
  ] as const) {
    test(`${raw} → ${cents}`, () => expect(parseCents(raw)).toBe(cents));
  }

  test('no amount', () => expect(parseCents('Saldo')).toBeNull());
});
