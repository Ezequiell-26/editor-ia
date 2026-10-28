/**
 * Nombres de emoji en español para la búsqueda del selector.
 *
 * Los nombres del dataset base están en inglés: buscar "cara" no encontraba
 * nada. Acá se carga el catálogo compacto en español (emojibase-data, MIT) y se
 * indexa por el propio emoji, que es la clave estable entre ambos conjuntos.
 */

import compact from 'emojibase-data/es/compact.json';

interface CompactEntry {
  readonly hexcode: string;
  readonly label: string;
  readonly unicode: string;
  readonly group?: number;
}

const SPANISH = new Map<string, string>();
for (const item of compact as readonly CompactEntry[]) {
  if (item.unicode && item.label) {
    SPANISH.set(item.unicode, item.label);
  }
}

/** Nombre en español de un emoji, si el catálogo lo tiene. */
export function spanishName(emoji: string): string | undefined {
  return SPANISH.get(emoji);
}

/** Cantidad de emojis con nombre en español (para diagnóstico y tests). */
export const SPANISH_TOTAL = SPANISH.size;
