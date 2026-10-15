import { pragmaticPlay } from './pragmatic';
import type { ProviderProfile } from './types';

/**
 * Providers the scenarios know how to play, keyed by the provider id Betsson's game catalog uses.
 * Adding a provider: write its profile and register it here; games are then found on Betsson by name.
 */
export const providersByBetssonId: Record<string, ProviderProfile> = {
  PragmaticPlay: pragmaticPlay,
};
