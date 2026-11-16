import type { ConcatWorkerExportSpeedCurvePoint } from '../../services/project-service';

/**
 * Mini-gráfico SVG de la `speed_curve` de un clip del concat-worker.
 *
 * Es puramente presentacional: recibe los puntos YA parseados (números) y
 * dibuja lo que el worker va a evaluar. Replica la semántica de
 * `concat_core::SpeedCurve::with_tangents` (vendor/concat):
 *
 * - Los puntos se ordenan por `at`, se clampean a `at` 0..1 y a la velocidad
 *   0.0625..16, y la curva se extiende plana hasta los extremos si no llegan.
 * - Con pendiente en TODOS los puntos interpola Hermite cúbico con el límite
 *   monótono de Fritsch-Carlson (radio 3); si falta alguna, líneas rectas.
 * - La línea punteada marca velocidad = 1× (referencia de "sin cambio").
 *
 * El eje Y se normaliza al rango visible `[0, max(1, vmax)]`: la referencia
 * 1× siempre entra en el gráfico.
 */

const WIDTH = 200;
const HEIGHT = 60;
const PAD_X = 8;
const PAD_Y = 8;
const PLOT_W = WIDTH - PAD_X * 2;
const PLOT_H = HEIGHT - PAD_Y * 2;

/** Mismos topes que `SpeedCurve::MIN_SPEED/MAX_SPEED` del worker. */
const MIN_SPEED = 0.0625;
const MAX_SPEED = 16;
/** `FLAT_RISE` y `MONOTONE_RADIUS` de `limit_to_monotone` (retime.rs). */
const FLAT_RISE = 1e-12;
const MONOTONE_RADIUS = 3;
/** Muestras por tramo: sobra para una curva suave a este tamaño. */
const SAMPLES_PER_SEGMENT = 24;

function toX(at: number): number {
  return PAD_X + at * PLOT_W;
}

function toY(speed: number, top: number): number {
  return HEIGHT - PAD_Y - (speed / top) * PLOT_H;
}

interface TidiedCurve {
  /** `(at, speed)` ordenados y clampeados, con extensión plana a los extremos. */
  readonly points: readonly (readonly [number, number])[];
  /** Un tangente por punto (speed por unidad de `at`), o null = líneas rectas. */
  readonly tangents: readonly number[] | null;
  /** Los puntos que el usuario cargó (sin la extensión automática de extremos). */
  readonly markers: readonly (readonly [number, number])[];
}

/**
 * Port de `SpeedCurve::with_tangents`: filtra puntos no finitos, ordena
 * estable por `at`, clampea y extiende plana hasta 0 y 1. Devuelve null si
 * no queda ningún punto usable.
 */
function tidyCurve(
  points: readonly ConcatWorkerExportSpeedCurvePoint[],
): TidiedCurve | null {
  const usable = points
    .map((point, index) => ({
      at: point.at,
      speed: point.speed,
      slope: point.slope,
      index,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.at) && Number.isFinite(point.speed) && point.speed > 0,
    );
  if (usable.length === 0) return null;

  // La pendiente sólo dobla la curva si TODOS los puntos la traen
  // (misma regla que `parse_speed_curve` del worker).
  const smooth = usable.every(
    (point) => point.slope !== undefined && Number.isFinite(point.slope),
  );

  usable.sort((a, b) => a.at - b.at || a.index - b.index);
  const tidied = usable.map((point) => ({
    at: Math.min(1, Math.max(0, point.at)),
    speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, point.speed)),
    tangent: smooth ? (point.slope as number) : 0,
    marker: true,
  }));
  const markers = tidied.map((point) => [point.at, point.speed] as const);
  if (tidied[0]!.at > 0) {
    tidied.unshift({ at: 0, speed: tidied[0]!.speed, tangent: 0, marker: false });
  }
  const last = tidied[tidied.length - 1]!;
  if (last.at < 1) {
    tidied.push({ at: 1, speed: last.speed, tangent: 0, marker: false });
  }

  const pairs = tidied.map((point) => [point.at, point.speed] as const);
  const tangents = smooth
    ? limitToMonotone(pairs, tidied.map((point) => point.tangent))
    : null;
  return { points: pairs, tangents, markers };
}

/** Port de `limit_to_monotone` (Fritsch-Carlson, radio 3) de retime.rs. */
function limitToMonotone(
  points: readonly (readonly [number, number])[],
  tangents: number[],
): number[] {
  const limited = [...tangents];
  for (let stretch = 0; stretch < points.length - 1; stretch += 1) {
    const [xl, vl] = points[stretch]!;
    const [xr, vr] = points[stretch + 1]!;
    const run = xr - xl;
    if (run <= 0) continue;
    const gain = (vr - vl) / run;
    if (Math.abs(gain) < FLAT_RISE) {
      limited[stretch] = 0;
      limited[stretch + 1] = 0;
      continue;
    }
    const a = Math.max(0, limited[stretch]! / gain);
    const b = Math.max(0, limited[stretch + 1]! / gain);
    const norm = Math.hypot(a, b);
    const shrink = norm > MONOTONE_RADIUS ? MONOTONE_RADIUS / norm : 1;
    limited[stretch] = shrink * a * gain;
    limited[stretch + 1] = shrink * b * gain;
  }
  return limited;
}

/** Velocidad en `u` (0..1) dentro del tramo, igual que `SpeedCurve::speed_on`. */
function speedOn(curve: TidiedCurve, stretch: number, u: number): number {
  const [xl, vl] = curve.points[stretch]!;
  const [xr, vr] = curve.points[stretch + 1]!;
  const run = xr - xl;
  if (curve.tangents === null) return vl + (vr - vl) * u;
  const m0 = curve.tangents[stretch]! * run;
  const m1 = curve.tangents[stretch + 1]! * run;
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * vl +
    (u3 - 2 * u2 + u) * m0 +
    (-2 * u3 + 3 * u2) * vr +
    (u3 - u2) * m1
  );
}

function curvePath(curve: TidiedCurve, top: number): string {
  const parts: string[] = [];
  const [x0] = curve.points[0]!;
  parts.push(`M${toX(x0).toFixed(2)} ${toY(curve.points[0]![1], top).toFixed(2)}`);
  for (let stretch = 0; stretch < curve.points.length - 1; stretch += 1) {
    const [xl] = curve.points[stretch]!;
    const [xr] = curve.points[stretch + 1]!;
    const run = xr - xl;
    if (run <= 0) continue;
    for (let sample = 1; sample <= SAMPLES_PER_SEGMENT; sample += 1) {
      const u = sample / SAMPLES_PER_SEGMENT;
      const x = xl + run * u;
      const speed = speedOn(curve, stretch, u);
      parts.push(
        `L${toX(x).toFixed(2)} ${toY(speed, top).toFixed(2)}`,
      );
    }
  }
  return parts.join(' ');
}

export interface SpeedCurvePreviewProps {
  /** Puntos parseados de `speed_curve` (números, no los strings del form). */
  readonly points: readonly ConcatWorkerExportSpeedCurvePoint[];
  /** Etiqueta accesible del gráfico. */
  readonly label?: string;
}

export function SpeedCurvePreview({ points, label }: SpeedCurvePreviewProps) {
  const curve = tidyCurve(points);
  if (!curve) return null;

  const top = Math.max(
    1,
    ...curve.points.map(([, speed]) => speed),
  );
  const refY = toY(1, top);

  return (
    <svg
      className="concat-worker-curve-preview"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={label ?? 'Curva de velocidad del clip'}
    >
      <line
        className="concat-worker-curve-preview-ref"
        x1={PAD_X}
        y1={refY}
        x2={WIDTH - PAD_X}
        y2={refY}
      />
      <path
        className="concat-worker-curve-preview-path"
        d={curvePath(curve, top)}
      />
      {curve.markers.map(([at, speed], index) => (
        <circle
          key={index}
          className="concat-worker-curve-preview-point"
          cx={toX(at)}
          cy={toY(speed, top)}
          r={2.5}
        />
      ))}
    </svg>
  );
}
