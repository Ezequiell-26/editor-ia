import { useSyncExternalStore } from 'react';
import { MAX_FREEHAND_MASK_POINTS, type MaskPoint } from '@editor-ia/project-schema';

/**
 * Modo «dibujar máscara a mano» (paridad del `pincel`/`caneta` de
 * `mascara_desenho.js` de AlaukCut): el Inspector lo arma y el monitor
 * captura el lazo libre; al soltar se suaviza con Catmull–Rom cerrado y
 * se guarda como máscara `freehand` (≤64 puntos, el tope del schema).
 * Estado de UI efímero: no entra en el documento ni en el historial de
 * deshacer.
 */
let armed = false;
const listeners = new Set<() => void>();

export function isMaskDrawArmed(): boolean {
  return armed;
}

export function setMaskDrawArmed(value: boolean): void {
  if (armed === value) return;
  armed = value;
  for (const listener of listeners) listener();
}

export function subscribeMaskDraw(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMaskDrawArmed(): boolean {
  return useSyncExternalStore(subscribeMaskDraw, isMaskDrawArmed, isMaskDrawArmed);
}

function distance(a: MaskPoint, b: MaskPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distancia perpendicular de `point` al segmento a→b (en unidades 0..1). */
function perpendicular(point: MaskPoint, a: MaskPoint, b: MaskPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return distance(point, a);
  return Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) / length;
}

/**
 * Douglas–Peucker sobre el lazo cerrado: conserva los vértices que definen
 * la forma y reduce a `maxPoints`. Si ni así entra, remuestrea uniforme.
 */
export function simplifyMaskPoints(
  points: readonly MaskPoint[],
  maxPoints = 16,
): MaskPoint[] {
  if (points.length <= maxPoints) return points.map((point) => ({ ...point }));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let distanceMax = 0;
    for (let index = first + 1; index < last; index += 1) {
      const d = perpendicular(points[index]!, points[first]!, points[last]!);
      if (d > distanceMax) {
        distanceMax = d;
        farthest = index;
      }
    }
    if (farthest > 0 && distanceMax > 0.004) {
      keep[farthest] = true;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  const simplified = points.filter((_, index) => keep[index]);
  if (simplified.length <= maxPoints) return simplified;
  // D-P no alcanzó: muestreo uniforme sobre el índice.
  const stride = (points.length - 1) / (maxPoints - 1);
  const sampled: MaskPoint[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push({ ...points[Math.round(index * stride)]! });
  }
  return sampled;
}

/** Subdivisiones de Catmull–Rom por segmento antes del remuestreo. */
const SPLINE_STEPS_PER_SEGMENT = 8;

function catmullRom(
  p0: MaskPoint,
  p1: MaskPoint,
  p2: MaskPoint,
  p3: MaskPoint,
  t: number,
): MaskPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  const coord = (a: number, b: number, c: number, d: number): number =>
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (-a + 3 * b - 3 * c + d) * t3);
  return {
    x: coord(p0.x, p1.x, p2.x, p3.x),
    y: coord(p0.y, p1.y, p2.y, p3.y),
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Plumilla de máscara: convierte el trazo libre capturado por pointer
 * events en un contorno cerrado y suave. El lazo se trata como spline
 * cerrada de Catmull–Rom (sin puntos duplicados al cierre), se muestrea
 * denso y se remuestrea a `maxPoints` puntos equiespaciados por longitud
 * de arco, así el polígono resultante no muestra facetas ni amontonamiento
 * donde la mano se movió despacio. La salida queda en 0..1 (el spline
 * puede sobresalir levemente fuera del trazo).
 */
export function smoothMaskStroke(
  points: readonly MaskPoint[],
  maxPoints = MAX_FREEHAND_MASK_POINTS,
): MaskPoint[] {
  // Quita duplicados consecutivos (y el cierre si repite el primero).
  const clean: MaskPoint[] = [];
  for (const point of points) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 1e-6) {
      clean.push({ x: point.x, y: point.y });
    }
  }
  if (
    clean.length > 1 &&
    Math.hypot(clean[0]!.x - clean[clean.length - 1]!.x, clean[0]!.y - clean[clean.length - 1]!.y) <=
      1e-6
  ) {
    clean.pop();
  }
  if (clean.length < 3) return clean.map((point) => ({ ...point }));

  const count = clean.length;
  const at = (index: number): MaskPoint => clean[((index % count) + count) % count]!;
  // Muestreo denso de la spline cerrada.
  const dense: MaskPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const p1 = at(index);
    const p2 = at(index + 1);
    for (let step = 0; step < SPLINE_STEPS_PER_SEGMENT; step += 1) {
      dense.push(
        catmullRom(at(index - 1), p1, p2, at(index + 2), step / SPLINE_STEPS_PER_SEGMENT),
      );
    }
  }
  // Longitudes acumuladas desde dense[0]; el lazo cierra sobre sí mismo,
  // así que el último tramo va de dense[last] a dense[0].
  const denseCount = dense.length;
  const lengths = new Array<number>(denseCount);
  lengths[0] = 0;
  for (let index = 1; index < denseCount; index += 1) {
    lengths[index] =
      lengths[index - 1]! +
      Math.hypot(dense[index]!.x - dense[index - 1]!.x, dense[index]!.y - dense[index - 1]!.y);
  }
  const total =
    lengths[denseCount - 1]! +
    Math.hypot(dense[0]!.x - dense[denseCount - 1]!.x, dense[0]!.y - dense[denseCount - 1]!.y);
  if (total < 1e-6) {
    return simplifyMaskPoints(clean, Math.min(3, maxPoints));
  }
  // Remuestreo uniforme por longitud de arco sobre el lazo cerrado.
  const target = Math.max(3, Math.min(maxPoints, MAX_FREEHAND_MASK_POINTS));
  const result: MaskPoint[] = [];
  let segment = 0;
  for (let index = 0; index < target; index += 1) {
    const goal = (index / target) * total;
    // Avanza hasta el segmento cuyo extremo supera `goal`.
    while (segment < denseCount - 1) {
      const end = segment + 1 < denseCount ? lengths[segment + 1]! : total;
      if (goal < end) break;
      segment += 1;
    }
    const from = dense[segment]!;
    const to = dense[(segment + 1) % denseCount]!;
    const start = lengths[segment]!;
    const end = segment + 1 < denseCount ? lengths[segment + 1]! : total;
    const span = Math.max(1e-9, end - start);
    const t = Math.min(1, Math.max(0, (goal - start) / span));
    result.push({
      x: clampUnit(from.x + (to.x - from.x) * t),
      y: clampUnit(from.y + (to.y - from.y) * t),
    });
  }
  return result;
}
