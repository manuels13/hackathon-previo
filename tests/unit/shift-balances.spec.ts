import { expect, test } from '@playwright/test';
import { shiftBalances } from '../../src/network/faultInjection';
import { pragmaticPlay } from '../../src/providers/pragmatic';

const parser = pragmaticPlay.traffic!;

test('moves the balances of a game-service answer and nothing else', () => {
  const body = 'tw=0.10&balance=97.73&balance_cash=97.73&balance_bonus=0.00&na=s&sa=4,9,7';
  expect(shiftBalances(body, 5)).toBe('tw=0.10&balance=102.73&balance_cash=102.73&balance_bonus=0.00&na=s&sa=4,9,7');
  expect(parser.parse('action=doInit', shiftBalances('balance=97.93&na=s', 5))!.balance).toBe(102.93);
});

test('moves the balance of the session JSON', () => {
  const body = JSON.stringify({ error: 0, data: { currency: 'EUR', balance: { cash: 97.55, bonus: 0, total: 97.55 } } });
  expect(JSON.parse(shiftBalances(body, 5)).data.balance).toEqual({ cash: 102.55, bonus: 0, total: 102.55 });
});
