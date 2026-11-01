/**
 * Preview real de nitidez con un filtro SVG `feConvolveMatrix`. FFmpeg usa
 * `unsharp` (5x5, luma); acá se aproxima con un núcleo 3x3 sobre RGB, la misma
 * familia visual: realza bordes y conserva el alfa. Es una aproximación de
 * preview, no un segundo renderer: el export sigue siendo FFmpeg.
 */

export const SHARPEN_FILTER_PREFIX = 'olyvia-sharpen-';

export function clampSharpen(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Núcleo 3x3 de sharpening; `amount` 0..1 controla cuánto separa los bordes. */
export function sharpenKernel(amount: number): string {
  const strength = clampSharpen(amount) * 0.6;
  const center = 1 + strength * 4;
  return [
    `0 ${-strength} 0`,
    `${-strength} ${center} ${-strength}`,
    `0 ${-strength} 0`,
  ].join(' ');
}

export function sharpenFilterId(clipId: string): string {
  return `${SHARPEN_FILTER_PREFIX}${clipId}`;
}

/** Agrega la referencia SVG al final de una lista de filtros CSS existente. */
export function appendSharpenFilter(
  filter: string,
  clipId: string,
  amount: number,
): string {
  if (clampSharpen(amount) <= 0.01) return filter;
  const reference = `url(#${sharpenFilterId(clipId)})`;
  return filter ? `${filter} ${reference}` : reference;
}
