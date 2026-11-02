import { CATEGORY_LABELS, EFFECT_CATEGORIES } from './types.ts';
import type { EffectCategory, EffectKind, EffectManifest } from './types.ts';

export interface EffectRegistry {
  readonly all: readonly EffectManifest[];
  get(id: string): EffectManifest | undefined;
  byKind(kind: EffectKind): readonly EffectManifest[];
  byCategory(category: EffectCategory, kind?: EffectKind): readonly EffectManifest[];
  /** Búsqueda por nombre, descripción, palabras clave e id, sin acentos. */
  search(query: string, kind?: EffectKind): readonly EffectManifest[];
  categories(kind?: EffectKind): readonly { category: EffectCategory; label: string; count: number }[];
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compare(a: EffectManifest, b: EffectManifest): number {
  const orderA = a.order ?? 1000;
  const orderB = b.order ?? 1000;
  if (orderA !== orderB) return orderA - orderB;
  return a.name.localeCompare(b.name, 'es');
}

export function createRegistry(manifests: readonly EffectManifest[]): EffectRegistry {
  const seen = new Set<string>();
  const all: EffectManifest[] = [];
  for (const manifest of manifests) {
    if (seen.has(manifest.id)) continue;
    seen.add(manifest.id);
    all.push(manifest);
  }
  all.sort(compare);

  const byId = new Map(all.map((manifest) => [manifest.id, manifest]));

  return {
    all,
    get: (id) => byId.get(id),
    byKind: (kind) => all.filter((manifest) => manifest.kind === kind),
    byCategory: (category, kind) =>
      all.filter(
        (manifest) =>
          manifest.category === category && (kind === undefined || manifest.kind === kind),
      ),
    search: (query, kind) => {
      const needle = fold(query.trim());
      const pool = kind ? all.filter((manifest) => manifest.kind === kind) : all;
      if (needle.length === 0) return pool;
      const terms = needle.split(/\s+/).filter(Boolean);
      return pool.filter((manifest) => {
        const haystack = fold(
          [manifest.name, manifest.description, manifest.id, ...manifest.keywords].join(' '),
        );
        return terms.every((term) => haystack.includes(term));
      });
    },
    categories: (kind) => {
      const pool = kind ? all.filter((manifest) => manifest.kind === kind) : all;
      return EFFECT_CATEGORIES.flatMap((category) => {
        const count = pool.filter((manifest) => manifest.category === category).length;
        if (count === 0) return [];
        return [{ category, label: CATEGORY_LABELS[category], count }];
      });
    },
  };
}
