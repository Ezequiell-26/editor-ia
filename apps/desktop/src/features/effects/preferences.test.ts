import { describe, expect, it } from 'vitest';
import type { EffectPreferences } from './preferences';
import {
  EFFECT_PREFS_KEY,
  loadEffectPreferences,
  pushRecent,
  saveEffectPreferences,
  toggleFavorite,
} from './preferences';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe('effect preferences', () => {
  it('starts empty when there is no stored value', () => {
    expect(loadEffectPreferences(memoryStorage())).toEqual({ favorites: [], recent: [] });
  });

  it('reads valid stored preferences and drops invalid data', () => {
    const storage = memoryStorage({
      [EFFECT_PREFS_KEY]: JSON.stringify({ favorites: ['glow', 3], recent: ['brightness'] }),
    });
    expect(loadEffectPreferences(storage)).toEqual({
      favorites: ['glow'],
      recent: ['brightness'],
    });
    expect(
      loadEffectPreferences(memoryStorage({ [EFFECT_PREFS_KEY]: '{broken' })),
    ).toEqual({ favorites: [], recent: [] });
  });

  it('toggles a favorite', () => {
    const once = toggleFavorite({ favorites: [], recent: [] }, 'glow');
    expect(once.favorites).toEqual(['glow']);
    expect(toggleFavorite(once, 'glow').favorites).toEqual([]);
  });

  it('pushes recents to the front without duplicates and caps them at six', () => {
    let state: EffectPreferences = { favorites: [], recent: [] };
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) state = pushRecent(state, id);
    expect(state.recent).toEqual(['g', 'f', 'e', 'd', 'c', 'b']);
    expect(pushRecent(state, 'd').recent).toEqual(['d', 'g', 'f', 'e', 'c', 'b']);
  });

  it('persists preferences as JSON', () => {
    const storage = memoryStorage();
    saveEffectPreferences({ favorites: ['glow'], recent: ['brightness'] }, storage);
    expect(JSON.parse(storage.data[EFFECT_PREFS_KEY]!)).toEqual({
      favorites: ['glow'],
      recent: ['brightness'],
    });
  });
});
