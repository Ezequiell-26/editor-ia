/**
 * Cálculo puro de la grilla de Medios para la virtualización.
 * El CSS usa `repeat(auto-fill, minmax(300px, 1fr))` con gap de 12 px; estas
 * funciones replican esa cuenta para agrupar assets en filas.
 */
export const ASSET_CARD_MIN_WIDTH = 300;
export const ASSET_GRID_GAP = 12;

export function assetGridColumns(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(
    1,
    Math.floor((width + ASSET_GRID_GAP) / (ASSET_CARD_MIN_WIDTH + ASSET_GRID_GAP)),
  );
}

export function chunkIntoRows<T>(items: readonly T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}
