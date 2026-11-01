/**
 * Preview de grano de película con `feTurbulence` + `feBlend overlay`. FFmpeg
 * exporta con `noise` (temporal); la textura SVG es estática y de la misma
 * familia visual, sin assets externos ni un segundo renderer.
 */

export const GRAIN_FILTER_PREFIX = 'olyvia-grain-';

export function clampGrain(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function grainFilterId(clipId: string): string {
  return `${GRAIN_FILTER_PREFIX}${clipId}`;
}

/** Matriz que convierte el ruido en gris medio con alfa = intensidad. */
export function grainMatrix(amount: number): string {
  const alpha = clampGrain(amount).toFixed(3);
  return `0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 ${alpha} 0`;
}

export function appendGrainFilter(
  filter: string,
  clipId: string,
  amount: number | undefined,
): string {
  if (clampGrain(amount) <= 0.01) return filter;
  const reference = `url(#${grainFilterId(clipId)})`;
  return filter ? `${filter} ${reference}` : reference;
}
