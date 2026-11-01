export interface EffectPreferences {
  readonly favorites: readonly string[];
  readonly recent: readonly string[];
}

export const EFFECT_PREFS_KEY = 'olyvia.effects.preferences';
const MAX_RECENT = 6;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string'))];
}

export function loadEffectPreferences(source: StorageLike | undefined = storage()): EffectPreferences {
  if (!source) return { favorites: [], recent: [] };
  try {
    const raw = source.getItem(EFFECT_PREFS_KEY);
    if (!raw) return { favorites: [], recent: [] };
    const parsed = JSON.parse(raw) as { favorites?: unknown; recent?: unknown };
    return {
      favorites: strings(parsed.favorites),
      recent: strings(parsed.recent).slice(0, MAX_RECENT),
    };
  } catch {
    return { favorites: [], recent: [] };
  }
}

export function saveEffectPreferences(
  preferences: EffectPreferences,
  target: StorageLike | undefined = storage(),
): void {
  if (!target) return;
  try {
    target.setItem(
      EFFECT_PREFS_KEY,
      JSON.stringify({
        favorites: [...preferences.favorites],
        recent: preferences.recent.slice(0, MAX_RECENT),
      }),
    );
  } catch {
    // Almacenamiento lleno o bloqueado: la preferencia no es crítica.
  }
}

export function toggleFavorite(
  preferences: EffectPreferences,
  id: string,
): EffectPreferences {
  const favorites = preferences.favorites.includes(id)
    ? preferences.favorites.filter((item) => item !== id)
    : [...preferences.favorites, id];
  return { ...preferences, favorites };
}

export function pushRecent(preferences: EffectPreferences, id: string): EffectPreferences {
  const recent = [id, ...preferences.recent.filter((item) => item !== id)].slice(0, MAX_RECENT);
  return { ...preferences, recent };
}
