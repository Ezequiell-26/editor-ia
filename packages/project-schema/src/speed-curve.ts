import { cubicBezierProgress } from './keyframes.ts';
import type { CubicBezier, KeyframeEasing } from './timeline.ts';

/**
 * Matemática de las curvas de velocidad, sin dependencias.
 *
 * La curva se define sobre el tiempo de SALIDA normalizado `t ∈ [0,1]`:
 * `speed` es el multiplicador de reproducción (2 = el doble de rápido, 0.5 =
 * mitad de velocidad). El clip conserva su ventana de origen completa, así que
 * la duración resultante es `sourceFrames / media(speed)`.
 *
 * El render usa `buildSpeedKnots` para construir un `setpts` por tramos: cada
 * knot dice qué fracción de la fuente (`input`) corresponde a cada fracción de
 * la salida (`output`). Rust reimplementa la misma regla en
 * `render/ffmpeg.rs`; un test de render compara ambos caminos.
 */

export interface SpeedCurvePointLike {
  readonly t: number;
  readonly speed: number;
  readonly easing?: KeyframeEasing | undefined;
  readonly bezier?: CubicBezier | undefined;
}

export interface SpeedCurveLike {
  readonly points: readonly SpeedCurvePointLike[];
}

/** Muestras por integral: suficiente para 50 puntos sin sesgo medible. */
export const SPEED_CURVE_INTEGRAL_STEPS = 1024;

/** Knots máximos del `setpts`; el grafo tiene un tope de 32.767 caracteres. */
export const SPEED_CURVE_MAX_KNOTS = 64;

/** Misma tabla que `keyframes.ts`, para que preview y render no discrepen. */
export function speedEasingProgress(easing: KeyframeEasing | undefined, progress: number): number {
  switch (easing) {
    case 'ease-in':
      return progress ** 3;
    case 'ease-out':
      return 1 - (1 - progress) ** 3;
    case 'ease-in-out':
      return progress * progress * (3 - 2 * progress);
    case 'hold':
      return 0;
    case 'linear':
    default:
      return progress;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Velocidad instantánea en `t` (tiempo de salida normalizado). */
export function sampleSpeedCurve(curve: SpeedCurveLike, t: number): number {
  const points = curve.points;
  if (points.length === 0) return 1;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const at = clamp01(Number.isFinite(t) ? t : 0);
  if (at <= first.t) return first.speed;
  if (at >= last.t) return last.speed;
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]!;
    const right = points[index + 1]!;
    if (at >= left.t && at <= right.t) {
      const span = right.t - left.t;
      if (span <= 0) return right.speed;
      const local = (at - left.t) / span;
      const eased =
        left.bezier !== undefined
          ? cubicBezierProgress(
              local,
              left.bezier.cp1X,
              left.bezier.cp1Y,
              left.bezier.cp2X,
              left.bezier.cp2Y,
            )
          : speedEasingProgress(left.easing, local);
      return left.speed + (right.speed - left.speed) * eased;
    }
  }
  return last.speed;
}

/** Media de la velocidad por regla del punto medio (exacta para tramos lineales). */
export function meanSpeedCurve(curve: SpeedCurveLike): number {
  const steps = SPEED_CURVE_INTEGRAL_STEPS;
  let total = 0;
  for (let index = 0; index < steps; index += 1) {
    total += sampleSpeedCurve(curve, (index + 0.5) / steps);
  }
  const mean = total / steps;
  return Number.isFinite(mean) && mean > 0 ? mean : 1;
}

/** Duración en frames que produce la curva para una ventana de origen. */
export function curveDurationFrames(sourceFrames: number, curve: SpeedCurveLike): number {
  const source = Math.max(1, Math.round(sourceFrames));
  return Math.max(1, Math.round(source / meanSpeedCurve(curve)));
}

/**
 * Fracción de la fuente consumida al llegar a la fracción `output` de la salida,
 * normalizada para que en `output = 1` valga exactamente 1.
 */
export function curveSourceFraction(curve: SpeedCurveLike, output: number): number {
  const tau = clamp01(output);
  if (tau <= 0) return 0;
  if (tau >= 1) return 1;
  const steps = Math.max(16, Math.round(SPEED_CURVE_INTEGRAL_STEPS * tau));
  let partial = 0;
  for (let index = 0; index < steps; index += 1) {
    partial += sampleSpeedCurve(curve, ((index + 0.5) / steps) * tau);
  }
  const totalSteps = SPEED_CURVE_INTEGRAL_STEPS;
  let total = 0;
  for (let index = 0; index < totalSteps; index += 1) {
    total += sampleSpeedCurve(curve, (index + 0.5) / totalSteps);
  }
  if (total <= 0) return tau;
  return clamp01(partial / steps * tau / (total / totalSteps));
}

export interface SpeedKnot {
  /** Fracción de la fuente consumida (0..1). */
  readonly input: number;
  /** Fracción del tiempo de salida (0..1). */
  readonly output: number;
}

/** Knots monótonos `input → output` para el `setpts` por tramos del render. */
export function buildSpeedKnots(
  curve: SpeedCurveLike,
  count = SPEED_CURVE_MAX_KNOTS,
): SpeedKnot[] {
  const steps = Math.max(2, Math.min(SPEED_CURVE_MAX_KNOTS, Math.round(count)));
  const knots: SpeedKnot[] = [{ input: 0, output: 0 }];
  for (let index = 1; index < steps; index += 1) {
    const output = index / steps;
    const input = curveSourceFraction(curve, output);
    const previous = knots[knots.length - 1]!;
    knots.push({ input: Math.max(previous.input, input), output });
  }
  knots.push({ input: 1, output: 1 });
  return knots;
}
