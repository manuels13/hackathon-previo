import { EventEmitter } from 'node:events';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { RoundRecorder } from '../../src/network/RoundRecorder';
import { pragmaticPlay } from '../../src/providers/pragmatic';

// A Sweet Bonanza round recorded on betsson.es (15/10/2026), reduced to the fields we read.
// Session keys and reel data removed.
const URL = 'https://x.example.net/gs2c/ge/v3/gameService';
const ROUND = [
  { post: 'action=doInit&symbol=vs20fruitsw_cv31', body: 'tw=0.00&balance=99.48&na=s&c=0.01&l=20' },
  { post: 'action=doSpin&symbol=vs20fruitsw_cv31&c=0.01&l=20&bl=0', body: 'tw=0.05&balance=99.28&na=s&rs=t&w=0.05' },
  { post: 'action=doSpin&symbol=vs20fruitsw_cv31&c=0.01&l=20&bl=0', body: 'tw=0.05&balance=99.28&na=c&rs_t=1&w=0.00' },
  { post: 'symbol=vs20fruitsw_cv31&action=doCollect', body: 'balance=99.33&na=s' },
];

const parser = pragmaticPlay.traffic!;

test('recognises Pragmatic game-service calls only', () => {
  expect(parser.isGameCall(URL)).toBe(true);
  expect(parser.isGameCall('https://www.betsson.es/api/v2/wallet/balance')).toBe(false);
});

test('decodes stake, balance, win and round state', () => {
  const [init, spin, cascade, collect] = ROUND.map((c) => parser.parse(c.post, c.body)!);
  expect(init).toMatchObject({ kind: 'init', balance: 99.48 });
  expect(spin).toMatchObject({ kind: 'spin', wager: 0.2, balance: 99.28, totalWin: 0.05 });
  expect(cascade).toMatchObject({ kind: 'spin', roundClosed: false });
  expect(collect).toMatchObject({ kind: 'collect', balance: 99.33, roundClosed: true });
});

test('ante bet (bl=1) costs 1.25× the base stake', () => {
  expect(parser.parse('action=doSpin&c=0.10&l=20&bl=1', 'balance=1&na=s')!.wager).toBe(2.5);
});

/** Feeds recorded calls to a RoundRecorder through a fake page that emits Playwright-like responses. */
function replay(calls: typeof ROUND) {
  const page = new EventEmitter() as unknown as Page;
  const recorder = new RoundRecorder(page, parser);
  const emit = (call: (typeof ROUND)[number]) =>
    (page as unknown as EventEmitter).emit('response', {
      request: () => ({ url: () => URL, postData: () => call.post }),
      text: async () => call.body,
    });
  return { recorder, emit };
}

test('a spin round is the calls from the spin to the one that closes it', async () => {
  const { recorder, emit } = replay(ROUND);
  emit(ROUND[0]);
  await new Promise((r) => setImmediate(r));
  const mark = recorder.mark();
  for (const call of ROUND.slice(1)) emit(call);
  const round = await recorder.waitForRound(mark, 2_000);
  expect(round).toMatchObject({ wager: 0.2, balanceBefore: 99.48, balanceAfter: 99.33, payout: 0.05, calls: 3 });
  // The balance rule holds on the server's own numbers.
  expect(round!.balanceBefore! - round!.wager + round!.payout).toBeCloseTo(round!.balanceAfter, 2);
});

test('no round while the server has not closed it', async () => {
  const { recorder, emit } = replay(ROUND);
  emit(ROUND[1]);
  emit(ROUND[2]);
  expect(await recorder.waitForRound(0, 500)).toBeNull();
});

// SingleSessionAPI/data as the game received it on betsson.es, reduced to the fields we read.
const SESSION = {
  url: 'https://x.example.net/gs2c/SingleSessionAPI/data',
  post: '',
  body: JSON.stringify({
    error: 0,
    data: { lang: 'es', balance: { cash: 99.48, bonus: 0, total: 99.48 }, currency: 'EUR', currencyCode: 'EUR', jurisdiction: 'ES' },
  }),
};

test('recognises the game session call', () => {
  expect(parser.isGameCall(SESSION.url)).toBe(true);
  expect(parser.parse(SESSION.post, SESSION.body)).toMatchObject({
    kind: 'session',
    session: { currency: 'EUR', language: 'es', jurisdiction: 'ES', balance: 99.48 },
    roundClosed: false,
  });
});

test('the recorder keeps the game session it saw', async () => {
  const { recorder, emit } = replay(ROUND);
  emit(SESSION);
  await new Promise((r) => setImmediate(r));
  expect(recorder.session()).toMatchObject({ currency: 'EUR', language: 'es' });
});

test('a losing spin is closed by its single answer, with no payout', async () => {
  const { recorder, emit } = replay(ROUND);
  emit(ROUND[0]);
  await new Promise((r) => setImmediate(r));
  const mark = recorder.mark();
  emit({ post: 'action=doSpin&c=0.01&l=20&bl=0', body: 'tw=0.00&balance=99.28&na=s' });
  const round = await recorder.waitForRound(mark, 2_000);
  expect(round).toMatchObject({ wager: 0.2, balanceBefore: 99.48, balanceAfter: 99.28, payout: 0, calls: 1 });
});

test('two rounds in a row: waitForRound only takes the one after the mark', async () => {
  const { recorder, emit } = replay(ROUND);
  for (const call of ROUND) emit(call); // first round: 99.48 → 99.33
  await new Promise((r) => setImmediate(r));
  const mark = recorder.mark();
  emit({ post: 'action=doSpin&c=0.01&l=20&bl=0', body: 'tw=0.00&balance=99.13&na=s' });
  const round = await recorder.waitForRound(mark, 2_000);
  expect(round).toMatchObject({ balanceBefore: 99.33, balanceAfter: 99.13, payout: 0 });
});

test('a refused spin (not enough money) is decoded as rejected and charges nothing', async () => {
  expect(parser.parse('action=doSpin&c=0.01&l=20&bl=0', 'balance=0.00&nomoney=1&na=s')).toMatchObject({
    kind: 'spin',
    rejected: true,
    balance: 0,
  });
  expect(parser.parse('action=doSpin&c=0.01&l=20&bl=0', 'tw=0.00&balance=99.28&na=s')!.rejected).toBeUndefined();
});

test('the recorder lists the calls after a mark and the last balance seen', async () => {
  const { recorder, emit } = replay(ROUND);
  emit(SESSION);
  await new Promise((r) => setImmediate(r));
  expect(recorder.lastBalance()).toBe(99.48);
  const mark = recorder.mark();
  emit({ post: 'action=doSpin&c=0.01&l=20&bl=0', body: 'balance=99.48&nomoney=1&na=s' });
  await new Promise((r) => setImmediate(r));
  expect(recorder.callsSince(mark)).toEqual([expect.objectContaining({ kind: 'spin', rejected: true, balance: 99.48 })]);
  expect(recorder.lastBalance()).toBe(99.48);
});

// A winning Gates of Olympus round recorded on betsson.es: its pending tumble is rs=mc, not rs=t.
const GATES_ROUND = [
  { post: 'action=doInit', body: 'balance=97.93&na=s&c=0.10&l=20' },
  { post: 'action=doSpin&c=0.01&l=20&bl=0', body: 'tw=0.10&w=0.10&balance=97.73&na=s&rs=mc&rs_p=0' },
  { post: 'action=doSpin&c=0.01&l=20&bl=0', body: 'tw=0.10&w=0.00&balance=97.73&na=c&rs_t=1' },
  { post: 'action=doCollect', body: 'balance=97.83&na=s' },
];

test('Gates of Olympus: a tumble pending as rs=mc keeps the round open until the collect', async () => {
  const { recorder, emit } = replay(GATES_ROUND);
  emit(GATES_ROUND[0]);
  await new Promise((r) => setImmediate(r));
  const mark = recorder.mark();
  for (const call of GATES_ROUND.slice(1)) emit(call);
  const round = await recorder.waitForRound(mark, 2_000);
  expect(round).toMatchObject({ wager: 0.2, balanceBefore: 97.93, balanceAfter: 97.83, payout: 0.1, calls: 3 });
});
