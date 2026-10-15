import { providersByBetssonId } from '../providers';
import type { ProviderProfile } from '../providers/types';

/** A game as Betsson's own catalog (/api/v2/games) describes it; only the fields we use. */
export interface BetssonGame {
  id: string;
  name: string;
  slug: string;
  provider: string;
  gameStudio?: string;
  primaryType?: string;
}

const normalise = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Picks the game a person asked for by name, slug or id ("gates of olympus", "gates-of-olympus").
 * An exact match wins; otherwise the query must match exactly one playable game, so a vague query
 * fails with the candidates instead of silently spinning on another game.
 */
export function pickGame(catalog: BetssonGame[], query: string): { game: BetssonGame; provider: ProviderProfile } {
  const wanted = normalise(query);
  if (!wanted) throw new Error('Empty game name');
  const exact = catalog.filter((g) => [g.name, g.slug, g.id].some((v) => v && normalise(v) === wanted));
  const candidates = exact.length ? exact : catalog.filter((g) => normalise(g.name).includes(wanted));
  if (!candidates.length) throw new Error(`No game named "${query}" in Betsson's catalog`);
  const supported = candidates.filter((g) => providersByBetssonId[g.provider]);
  if (!supported.length) {
    const studios = [...new Set(candidates.map((g) => g.gameStudio ?? g.provider))].join(', ');
    throw new Error(`"${query}" is a game by ${studios}; supported providers: ${Object.keys(providersByBetssonId).join(', ')}`);
  }
  if (supported.length > 1) {
    const names = supported.slice(0, 10).map((g) => `"${g.name}"`).join(', ');
    throw new Error(`"${query}" matches ${supported.length} games: ${names}. Use the full name.`);
  }
  return { game: supported[0], provider: providersByBetssonId[supported[0].provider] };
}
