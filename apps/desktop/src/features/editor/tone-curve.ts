import { curveTable } from './curves-lut';

/**
 * Curva maestra de sombras/luces/fade, idéntica a `tone_curve_filter` del
 * export: se aplica antes de las curvas creativas del clip.
 */
export interface ToneInput {
  readonly shadows?: number | undefined;
  readonly highlights?: number | undefined;
  readonly fade?: number | undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function toneCurveTable(input: ToneInput): Uint8Array | null {
  const shadows = clamp(Number.isFinite(input.shadows) ? input.shadows! : 0, -1, 1);
  const highlights = clamp(
    Number.isFinite(input.highlights) ? input.highlights! : 0,
    -1,
    1,
  );
  const fade = clamp(Number.isFinite(input.fade) ? input.fade! : 0, 0, 1);
  if (Math.abs(shadows) <= 0.001 && Math.abs(highlights) <= 0.001 && fade <= 0.001) {
    return null;
  }
  return curveTable([
    { x: 0, y: clamp(fade * 0.1, 0, 1) },
    { x: 0.25, y: clamp(0.25 + shadows * 0.12 + fade * 0.05, 0, 1) },
    { x: 0.5, y: clamp(0.5 + fade * 0.02, 0, 1) },
    { x: 0.75, y: clamp(0.75 + highlights * 0.12 - fade * 0.02, 0, 1) },
    { x: 1, y: clamp(1 - fade * 0.05, 0, 1) },
  ]);
}

/**
 * Compone la curva de tono antes de la tabla RGBA de curvas del clip. La
 * tabla resultante se puede pasar tal cual al shader (`setCurve`).
 */
export function composeToneWithCurves(
  tone: Uint8Array | null,
  curves: Uint8Array | null,
): Uint8Array | null {
  if (!tone) return curves;
  if (!curves) {
    const table = new Uint8Array(256 * 4);
    for (let index = 0; index < 256; index += 1) {
      const value = tone[index] ?? index;
      table[index * 4] = value;
      table[index * 4 + 1] = value;
      table[index * 4 + 2] = value;
      table[index * 4 + 3] = 255;
    }
    return table;
  }
  const table = new Uint8Array(256 * 4);
  for (let index = 0; index < 256; index += 1) {
    const graded = (tone[index] ?? index) * 4;
    table[index * 4] = curves[graded] ?? 0;
    table[index * 4 + 1] = curves[graded + 1] ?? 0;
    table[index * 4 + 2] = curves[graded + 2] ?? 0;
    table[index * 4 + 3] = 255;
  }
  return table;
}
