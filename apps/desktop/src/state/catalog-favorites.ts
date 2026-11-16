import { useSyncExternalStore } from 'react';

/**
 * Favoritos del catálogo de efectos y transiciones.
 *
 * CapCut guarda favoritos a nivel de plataforma (`favorite_count`,
 * `has_favorited`, `_fav_scene` en `EffectPlatform.dll` / `res_pool.dll`) y
 * los usa como filtro del explorador de efectos. Olyvia ya tenía favoritos de
 * MEDIOS dentro del proyecto; este módulo cubre el catálogo de efectos y
 * transiciones, que no son assets del documento y por eso viven en
 * `localStorage` y no en el `.editoria.json`.
 *
 * La clave es `kind:id` para que un efecto y una transición con el mismo id
 * (`iris`, por ejemplo) no colisionen. El snapshot se cachea para que
 * `useSyncExternalStore` reciba siempre la misma referencia hasta que haya un
 * cambio real.
 */

export type CatalogFavoriteKind = 'effect' | 'transition' | 'look' | 'template';

export const CATALOG_FAVORITES_STORAGE_KEY = 'olyvia.catalog-favorites.v1';

function readStorage(): ReadonlySet<string> {
  try {
    const raw = globalThis.localStorage?.getItem(CATALOG_FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    // localStorage puede no existir (SSR) o estar bloqueado: sin favoritos.
    return new Set();
  }
}

let cache: ReadonlySet<string> = readStorage();
const listeners = new Set<() => void>();

function persist(next: ReadonlySet<string>): void {
  try {
    globalThis.localStorage?.setItem(
      CATALOG_FAVORITES_STORAGE_KEY,
      JSON.stringify([...next].sort()),
    );
  } catch {
    // Cuota llena o almacenamiento privado: el favorito vive sólo en memoria.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function catalogFavoriteKey(kind: CatalogFavoriteKind, id: string): string {
  return `${kind}:${id}`;
}

export function getCatalogFavorites(): ReadonlySet<string> {
  return cache;
}

export function isCatalogFavorite(
  kind: CatalogFavoriteKind,
  id: string,
  favorites: ReadonlySet<string> = cache,
): boolean {
  return favorites.has(catalogFavoriteKey(kind, id));
}

/** Alterna un favorito, lo persiste y notifica a los suscriptores. */
export function toggleCatalogFavorite(
  kind: CatalogFavoriteKind,
  id: string,
): ReadonlySet<string> {
  const next = new Set(cache);
  const key = catalogFavoriteKey(kind, id);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  cache = next;
  persist(next);
  emit();
  return cache;
}

export function subscribeCatalogFavorites(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hook del catálogo: se re-renderiza sólo cuando cambia un favorito. */
export function useCatalogFavorites(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeCatalogFavorites,
    getCatalogFavorites,
    getCatalogFavorites,
  );
}

/** Sólo para tests: deja el módulo y el almacenamiento en cero. */
export function resetCatalogFavoritesForTests(): void {
  cache = new Set();
  persist(cache);
  emit();
}
