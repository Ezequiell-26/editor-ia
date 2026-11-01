import type { ClipCurves, CurvePoint } from '@editor-ia/project-schema';

/**
 * Tabla de curvas del clip para la preview. FFmpeg construye una LUT de 256
 * entradas por canal con spline cúbico natural y, si hay curva maestra, la
 * aplica **después** de la curva de cada canal (índice sobre el resultado).
 * Aquí se reproduce ese orden para que el shader sólo consulte una tabla.
 */

export const CURVE_LUT_SIZE = 256;

function ordered(points: readonly CurvePoint[]): CurvePoint[] {
  return points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: Math.min(1, Math.max(0, point.x)),
      y: Math.min(1, Math.max(0, point.y)),
    }))
    .sort((a, b) => a.x - b.x)
    .filter((point, index, list) => index === 0 || Math.abs(point.x - list[index - 1]!.x) > 1e-9);
}

/** El export ignora un canal si no arranca en 0 y termina en 1. */
function usable(points: readonly CurvePoint[]): points is readonly CurvePoint[] {
  const list = ordered(points);
  return (
    list.length >= 2 &&
    Math.abs(list[0]!.x) <= 1e-9 &&
    Math.abs(list[list.length - 1]!.x - 1) <= 1e-9
  );
}

function splineAt(points: readonly CurvePoint[], x: number): number {
  const n = points.length;
  if (n < 2) return x;
  if (n === 2) {
    const [left, right] = points;
    const span = right!.x - left!.x;
    if (span <= 0) return right!.y;
    const t = Math.min(1, Math.max(0, (x - left!.x) / span));
    return left!.y + (right!.y - left!.y) * t;
  }
  const h: number[] = [];
  for (let i = 0; i < n - 1; i += 1) h.push(points[i + 1]!.x - points[i]!.x);
  // Spline cúbico natural: segundas derivadas con extremos 0.
  const m = new Array<number>(n).fill(0);
  const diag = new Array<number>(n).fill(1);
  const rhs = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i += 1) {
    const left = h[i - 1]!;
    const right = h[i]!;
    diag[i] = 2 * (left + right);
    rhs[i] =
      6 *
      ((points[i + 1]!.y - points[i]!.y) / right -
        (points[i]!.y - points[i - 1]!.y) / left);
    if (i > 1) {
      const factor = left / diag[i - 1]!;
      diag[i] = diag[i]! - factor * left;
      rhs[i] = rhs[i]! - factor * rhs[i - 1]!;
    }
  }
  for (let i = n - 2; i >= 1; i -= 1) {
    m[i] = (rhs[i]! - h[i]! * m[i + 1]!) / diag[i]!;
  }
  let segment = 0;
  while (segment < n - 2 && x > points[segment + 1]!.x) segment += 1;
  const left = points[segment]!;
  const right = points[segment + 1]!;
  const span = h[segment]!;
  if (span <= 0) return right.y;
  const dx = Math.min(right.x, Math.max(left.x, x)) - left.x;
  const b =
    (right.y - left.y) / span - (span * (2 * m[segment]! + m[segment + 1]!)) / 6;
  const value =
    left.y +
    b * dx +
    (m[segment]! / 2) * dx * dx +
    ((m[segment + 1]! - m[segment]!) / (6 * span)) * dx * dx * dx;
  return Math.min(1, Math.max(0, value));
}

/** Tabla de 8 bits de una curva con los puntos del editor. */
export function curveTable(
  points: readonly CurvePoint[] | undefined,
  size = CURVE_LUT_SIZE,
): Uint8Array | null {
  if (!points || !usable(points)) return null;
  const list = ordered(points);
  const table = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    const x = size > 1 ? index / (size - 1) : 0;
    table[index] = Math.round(splineAt(list, x) * 255);
  }
  return table;
}

function isIdentity(table: Uint8Array): boolean {
  for (let index = 0; index < table.length; index += 1) {
    if (table[index] !== index) return false;
  }
  return true;
}

/**
 * Tabla RGBA (256×1) que combina curvas por canal y maestra en el orden del
 * export: `master[canal[x]]`. Devuelve null si no hay curvas útiles.
 */
export function curvesToLut(curves: ClipCurves | undefined): Uint8Array | null {
  if (!curves) return null;
  let master = curveTable(curves.master);
  if (master && isIdentity(master)) master = null;
  const red = curveTable(curves.red);
  const green = curveTable(curves.green);
  const blue = curveTable(curves.blue);
  const channels = [red, green, blue];
  if (!master && channels.every((table) => !table || isIdentity(table))) {
    return null;
  }
  const out = new Uint8Array(CURVE_LUT_SIZE * 4);
  for (let index = 0; index < CURVE_LUT_SIZE; index += 1) {
    let r = red ? red[index]! : index;
    let g = green ? green[index]! : index;
    let b = blue ? blue[index]! : index;
    if (master) {
      r = master[r]!;
      g = master[g]!;
      b = master[b]!;
    }
    out[index * 4] = r;
    out[index * 4 + 1] = g;
    out[index * 4 + 2] = b;
    out[index * 4 + 3] = 255;
  }
  return out;
}

/** Aplica la tabla en el fallback 2D de imágenes (alfa intacto). */
export function applyCurveToPixels(
  table: Uint8Array,
  data: Uint8ClampedArray,
): void {
  for (let index = 0; index + 3 < data.length; index += 4) {
    data[index] = table[data[index]! * 4]!;
    data[index + 1] = table[data[index + 1]! * 4 + 1]!;
    data[index + 2] = table[data[index + 2]! * 4 + 2]!;
  }
}

export function curvesEqual(
  a: Uint8Array | null,
  b: Uint8Array | null,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}
