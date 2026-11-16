// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATALOG_FAVORITES_STORAGE_KEY,
  catalogFavoriteKey,
  getCatalogFavorites,
  isCatalogFavorite,
  resetCatalogFavoritesForTests,
  subscribeCatalogFavorites,
  toggleCatalogFavorite,
} from './catalog-favorites';

beforeEach(() => {
  window.localStorage.clear();
  resetCatalogFavoritesForTests();
});

describe('favoritos del catálogo de efectos y transiciones', () => {
  it('alterna y persiste la clave kind:id', () => {
    expect(isCatalogFavorite('effect', 'soft')).toBe(false);
    toggleCatalogFavorite('effect', 'soft');
    expect(isCatalogFavorite('effect', 'soft')).toBe(true);
    expect(
      JSON.parse(window.localStorage.getItem(CATALOG_FAVORITES_STORAGE_KEY) ?? '[]'),
    ).toEqual(['effect:soft']);

    toggleCatalogFavorite('effect', 'soft');
    expect(isCatalogFavorite('effect', 'soft')).toBe(false);
    expect(getCatalogFavorites().size).toBe(0);
  });

  it('separa efecto, transición y filtro aunque compartan id', () => {
    toggleCatalogFavorite('transition', 'iris');
    expect(isCatalogFavorite('transition', 'iris')).toBe(true);
    expect(isCatalogFavorite('effect', 'iris')).toBe(false);
    expect(catalogFavoriteKey('effect', 'iris')).toBe('effect:iris');

    toggleCatalogFavorite('look', 'iris');
    expect(isCatalogFavorite('look', 'iris')).toBe(true);
    expect(isCatalogFavorite('transition', 'iris')).toBe(true);
    expect(isCatalogFavorite('effect', 'iris')).toBe(false);
  });

  it('notifica a los suscriptores y corta al desuscribirse', () => {
    const listener = vi.fn();
    const off = subscribeCatalogFavorites(listener);

    toggleCatalogFavorite('transition', 'persiana');
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    toggleCatalogFavorite('transition', 'persiana');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignora un almacenamiento corrupto al cargar', async () => {
    window.localStorage.setItem(CATALOG_FAVORITES_STORAGE_KEY, '{no-es-json');
    vi.resetModules();
    const fresh = await import('./catalog-favorites');
    expect(fresh.getCatalogFavorites().size).toBe(0);
  });
});
