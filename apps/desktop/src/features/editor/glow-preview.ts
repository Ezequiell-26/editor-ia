/**
 * Preview aproximada de glow con un filtro SVG: se desenfoca una copia de la
 * imagen, se umbraliza con `feComponentTransfer` y se mezcla en `screen` sobre
 * el original, ponderada por la intensidad. FFmpeg sigue siendo el exportador
 * (split + colorlevels + gblur + blend); esto evita un segundo renderer y da
 * una referencia visual honesta de radio, umbral e intensidad.
 */

export const GLOW_FILTER_PREFIX = 'olyvia-glow-';

export interface GlowPreview {
  readonly intensity: number;
  readonly radius: number;
  readonly threshold: number;
}

export function normalizeGlow(value: {
  readonly intensity?: number;
  readonly radius?: number;
  readonly threshold?: number;
}): GlowPreview {
  const clamp = (input: number | undefined, min: number, max: number, fallback: number) =>
    input === undefined || !Number.isFinite(input)
      ? fallback
      : Math.max(min, Math.min(max, input));
  return {
    intensity: clamp(value.intensity, 0, 1, 0.35),
    radius: clamp(value.radius, 1, 80, 20),
    threshold: clamp(value.threshold, 0, 1, 0.5),
  };
}

export function glowFilterId(clipId: string): string {
  return `${GLOW_FILTER_PREFIX}${clipId}`;
}

/** Radio de desenfoque SVG; el filtro de FFmpeg usa píxeles de pantalla. */
export function glowStdDeviation(radius: number): number {
  return Math.max(0.5, Math.min(24, radius / 3));
}

/**
 * Curva suave para restar el fondo sin apagar el halo: pendiente 1 y un
 * intercepto acotado por `threshold` (a más umbral, menos glow).
 */
export function glowThresholdCurve(threshold: number): {
  readonly slope: number;
  readonly intercept: number;
} {
  const slope = 1;
  return {
    slope,
    intercept: -Math.max(0, Math.min(1, threshold)) * 0.3,
  };
}

/** Agrega la referencia SVG al final de una lista de filtros CSS existente. */
export function appendGlowFilter(
  filter: string,
  clipId: string,
  glow: GlowPreview | undefined,
): string {
  if (!glow || glow.intensity <= 0.01) return filter;
  const reference = `url(#${glowFilterId(clipId)})`;
  return filter ? `${filter} ${reference}` : reference;
}
