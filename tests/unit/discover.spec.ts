import { expect, test } from '@playwright/test';
import { type BetssonGame, pickGame } from '../../src/games/discover';

// Entries as Betsson's /api/v2/games returns them, reduced to the fields we read.
const CATALOG: BetssonGame[] = [
  { id: 'pragmaticPlayGatesOfOlympus', name: 'Gates Of Olympus', slug: 'gates-of-olympus', provider: 'PragmaticPlay' },
  { id: 'pragmaticPlayGatesOfOlympus1000', name: 'Gates Of Olympus 1000', slug: 'gates-of-olympus-1000', provider: 'PragmaticPlay' },
  { id: 'pragmaticPlaySweetBonanza', name: 'Sweet Bonanza', slug: 'sweet-bonanza', provider: 'PragmaticPlay' },
  { id: 'evolutionStarburst', name: 'Starburst', slug: 'starburst', provider: 'Evolution', gameStudio: 'NetEnt' },
];

test('finds a game by name, slug or id, ignoring case and accents', () => {
  expect(pickGame(CATALOG, 'gates of olympus').game.slug).toBe('gates-of-olympus');
  expect(pickGame(CATALOG, 'GATES-OF-OLYMPUS-1000').game.slug).toBe('gates-of-olympus-1000');
  expect(pickGame(CATALOG, 'pragmaticPlaySweetBonanza').game.name).toBe('Sweet Bonanza');
  expect(pickGame(CATALOG, 'Sweet Bonanzá').provider.id).toBe('pragmatic-play');
});

test('a partial name works when it matches a single game', () => {
  expect(pickGame(CATALOG, 'sweet').game.slug).toBe('sweet-bonanza');
});

test('an ambiguous, unknown or unsupported game fails with a clear message', () => {
  expect(() => pickGame(CATALOG, 'gates')).toThrow(/matches 2 games/);
  expect(() => pickGame(CATALOG, 'book of dead')).toThrow(/No game named/);
  expect(() => pickGame(CATALOG, 'starburst')).toThrow(/game by NetEnt/);
});
