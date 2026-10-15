import type { MarketId } from '../config/markets';
import { pragmaticPlay } from '../providers/pragmatic';
import type { ProviderProfile, VisualProfile } from '../providers/types';

export interface GameConfig {
  /** Used in project names and evidence: `es-sweet-bonanza`. */
  id: string;
  name: string;
  provider: ProviderProfile;
  /** Game page per market. A game is only tested in the markets listed here. */
  paths: Partial<Record<MarketId, string>>;
  /** Only what this title does differently from its provider's defaults. */
  visual?: Partial<VisualProfile>;
}

export interface ResolvedGame {
  id: string;
  name: string;
  provider: ProviderProfile;
  path: string;
  visual: VisualProfile;
}

export const games: GameConfig[] = [
  {
    id: 'sweet-bonanza',
    name: 'Sweet Bonanza',
    provider: pragmaticPlay,
    paths: { es: '/casino/tragaperras-slots/sweet-bonanza' },
  },
];

export function resolveGame(gameId: string, market: MarketId): ResolvedGame {
  const game = games.find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game "${gameId}". Known: ${games.map((g) => g.id).join(', ')}`);
  const path = game.paths[market];
  if (!path) throw new Error(`Game "${gameId}" has no page configured for market "${market}"`);
  return { ...game, path, visual: { ...game.provider.visual, ...game.visual } };
}
