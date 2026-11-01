import type { KeyframeEasing, SpeedCurve } from '@editor-ia/project-schema';
import { cubicBezierProgress } from '@editor-ia/project-schema';

/**
 * Remap de velocidad por frame para clips con `speedCurve`.
 *
 * La curva describe la velocidad instantánea `dSource/dTimeline` en función
 * del tiempo normalizado del clip. La posición de origen se obtiene
 * integrando esa velocidad; el frame visible para cada frame local es el que
 * contiene la coordenada integrada en su centro. La integral se normaliza a la
 * ventana real del clip (`outFrame - inFrame`), así una curva decorativa de un
 * proyecto viejo no rompe la geometría ni queda en 1×.
 *
 * La misma matemática vive en Rust (`render/time_remap.rs`) y ambos leen el
 * fixture compartido `packages/project-schema/fixtures/time-remap.fixture.json`.
 */

const BEZIER_SAMPLES = 64;
const EPSILON = 1e-9;

interface BezierCurve {
  readonly cp1X: number;
  readonly cp1Y: number;
  readonly cp2X: number;
  readonly cp2Y: number;
}

interface Segment {
  readonly t0: number;
  readonly t1: number;
  readonly s0: number;
  readonly s1: number;
  /** Integral de la curva de easing en [0,1]. */
  readonly easingArea: number;
  /** Integral de la curva de easing en [0,u]. */
  readonly easingMoment: (u: number) => number;
}

export interface TimeRemap {
  readonly durationFrames: number;
  readonly sourceFrames: number;
  /** Frame de origen (0..sourceFrames-1) que se ve en `localFrame`. */
  readonly sourceFrameAt: (localFrame: number) => number;
  /** Segundos dentro del asset, listo para `currentTime` de la preview. */
  readonly sourceSecondsAt: (localFrame: number, inFrame: number, fps: number) => number;
  /** Posición de timeline (en frames) para cada frame de origen. */
  readonly timelineFrames: readonly number[];
  /** Expresión `setpts` con N = frame de origen. */
  readonly setptsExpression: string;
  readonly averageSpeed: number;
  readonly identity: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Integral exacta de los easings preset que usa el esquema. */
function presetTables(easing: KeyframeEasing): {
  area: number;
  moment: (u: number) => number;
} {
  switch (easing) {
    case 'ease-in':
      return { area: 1 / 4, moment: (u) => u ** 4 / 4 };
    case 'ease-out':
      return {
        area: 3 / 4,
        // ∫ (3u − 3u² + u³) du = 1,5u² − u³ + 0,25u⁴
        moment: (u) => 1.5 * u ** 2 - u ** 3 + 0.25 * u ** 4,
      };
    case 'ease-in-out':
      return {
        area: 1 / 2,
        // ∫ (3u² − 2u³) du = u³ − 0,5u⁴
        moment: (u) => u ** 3 - 0.5 * u ** 4,
      };
    case 'hold':
      return { area: 0, moment: () => 0 };
    case 'linear':
    default:
      return { area: 1 / 2, moment: (u) => (u * u) / 2 };
  }
}

/**
 * Bézier: la curva paramétrica se resuelve como y(x) con la misma función del
 * esquema (`cubicBezierProgress`) y se integra como polilínea de 64 tramos.
 * Es la misma aproximación que usa el export para sus keyframes.
 */
function bezierTables(bezier: BezierCurve): {
  area: number;
  moment: (u: number) => number;
} {
  const ys: number[] = [];
  for (let index = 0; index <= BEZIER_SAMPLES; index += 1) {
    ys.push(
      cubicBezierProgress(
        index / BEZIER_SAMPLES,
        bezier.cp1X,
        bezier.cp1Y,
        bezier.cp2X,
        bezier.cp2Y,
      ),
    );
  }
  const prefixes: number[] = [0];
  for (let index = 1; index <= BEZIER_SAMPLES; index += 1) {
    const width = 1 / BEZIER_SAMPLES;
    prefixes.push(prefixes[index - 1]! + ((ys[index - 1]! + ys[index]!) / 2) * width);
  }
  const area = prefixes[BEZIER_SAMPLES]!;
  return {
    area,
    moment: (u) => {
      const clamped = clamp(u, 0, 1);
      const position = clamped * BEZIER_SAMPLES;
      const index = Math.min(BEZIER_SAMPLES - 1, Math.floor(position));
      const remainder = (position - index) / BEZIER_SAMPLES;
      const slope = ys[index + 1]! - ys[index]!;
      return prefixes[index]! + ys[index]! * remainder + 0.5 * slope * remainder ** 2;
    },
  };
}

function segmentsOf(curve: SpeedCurve): Segment[] {
  const points = [...curve.points].sort((left, right) => left.t - right.t);
  const segments: Segment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const t0 = clamp(start.t, 0, 1);
    const t1 = clamp(end.t, 0, 1);
    if (t1 - t0 <= EPSILON) continue;
    const tables =
      start.bezier !== undefined
        ? bezierTables(start.bezier)
        : presetTables(start.easing ?? 'linear');
    segments.push({
      t0,
      t1,
      s0: start.speed,
      s1: end.speed,
      easingArea: tables.area,
      easingMoment: tables.moment,
    });
  }
  return segments;
}

export interface RemapClipLike {
  readonly kind: string;
  readonly durationFrames: number;
  readonly speedCurve?: SpeedCurve | undefined;
  readonly source?: unknown;
}

/**
 * Tabla de remap de un clip, o `null` si no es un video con curva y ventana
 * válida. Centraliza la construcción para que preview e Inspector no
 * dupliquen la matemática.
 */
export function clipTimeRemap(clip: RemapClipLike): TimeRemap | null {
  if (clip.kind !== 'video' || clip.speedCurve === undefined || clip.source === undefined) {
    return null;
  }
  if (typeof clip.source !== 'object' || clip.source === null) return null;
  const source = clip.source as { inFrame?: unknown; outFrame?: unknown };
  const inFrame = source.inFrame;
  const outFrame = source.outFrame;
  if (
    typeof inFrame !== 'number' ||
    typeof outFrame !== 'number' ||
    !Number.isFinite(inFrame) ||
    !Number.isFinite(outFrame)
  ) {
    return null;
  }
  const sourceFrames = outFrame - inFrame;
  if (sourceFrames <= 0 || sourceFrames > 120_000) return null;
  return buildTimeRemap(clip.speedCurve, clip.durationFrames, sourceFrames);
}

/**
 * Construye la tabla de remap. `sourceFrames` es la ventana real del clip
 * (`outFrame - inFrame`); la curva se escala para consumirla exactamente.
 */
export function buildTimeRemap(
  curve: SpeedCurve,
  durationFrames: number,
  sourceFrames: number,
): TimeRemap {
  const duration = Math.max(1, Math.round(durationFrames));
  const source = Math.max(1, Math.round(sourceFrames));
  const segments = segmentsOf(curve);
  const cumulative: number[] = [0];
  let total = 0;
  for (const segment of segments) {
    const length = segment.t1 - segment.t0;
    const area =
      length * (segment.s0 + (segment.s1 - segment.s0) * segment.easingArea);
    total += area;
    cumulative.push(total);
  }
  const scale = total > EPSILON ? source / (duration * total) : source / duration;

  const integralAt = (x: number): number => {
    const clamped = clamp(x, 0, 1);
    if (total <= EPSILON) return clamped;
    if (clamped <= 0) return 0;
    if (clamped >= 1) return total;
    let index = segments.findIndex(
      (segment) => clamped > segment.t0 && clamped <= segment.t1,
    );
    if (index < 0) index = segments.length - 1;
    const segment = segments[index]!;
    const length = segment.t1 - segment.t0;
    const u = clamp((clamped - segment.t0) / length, 0, 1);
    const partial =
      length *
      (segment.s0 * u + (segment.s1 - segment.s0) * segment.easingMoment(u));
    return cumulative[index]! + partial;
  };

  const sigma = (x: number): number => clamp(scale * duration * integralAt(x), 0, source);

  const inverseTimelineFrame = (sourceFrame: number): number => {
    if (sourceFrame <= 0) return 0;
    if (sourceFrame >= source) return duration;
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const middle = (low + high) / 2;
      if (sigma(middle) < sourceFrame) low = middle;
      else high = middle;
    }
    return ((low + high) / 2) * duration;
  };

  const timelineFrames = Array.from({ length: source }, (_, index) =>
    Number(inverseTimelineFrame(index).toFixed(6)),
  );
  // El último frame de origen tiene que caer dentro de la duración: si la
  // curva acelera al final, su inversa puede quedar en D o más allá y el
  // frame nunca se mostraría. Se ancla al último frame de la timeline.
  for (let index = timelineFrames.length - 1; index >= 0; index -= 1) {
    const limit =
      index === timelineFrames.length - 1
        ? duration - 0.001
        : timelineFrames[index + 1]!;
    timelineFrames[index] = Math.min(timelineFrames[index]!, limit);
  }

  /**
   * La preview imita `fps=…:round=near`: el frame de origen cuyo timestamp
   * de timeline queda más cerca del centro del frame local (`k + 0.5`, el
   * instante que muestrea FFmpeg). En el ejemplo dorado el frame 60 elige el
   * origen 32.
   */
  const sourceFrameAt = (localFrame: number): number => {
    const local = clamp(localFrame, 0, duration - 1) + 0.5;
    let low = 0;
    let high = timelineFrames.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (timelineFrames[middle]! < local) low = middle + 1;
      else high = middle;
    }
    const after = low;
    const before = Math.max(0, low - 1);
    const afterDistance = Math.abs(timelineFrames[after]! - local);
    const beforeDistance = Math.abs(timelineFrames[before]! - local);
    return beforeDistance <= afterDistance ? before : after;
  };

  const identity =
    timelineFrames.every((value, index) => Math.abs(value - index) < 1e-4);

  let setpts = timelineFrames[source - 1]!.toFixed(6);
  for (let index = source - 2; index >= 0; index -= 1) {
    setpts = `if(lt(N,${index + 1}),${timelineFrames[index]!.toFixed(6)},${setpts})`;
  }

  return {
    durationFrames: duration,
    sourceFrames: source,
    sourceFrameAt,
    sourceSecondsAt: (localFrame, inFrame, fps) =>
      (inFrame + sourceFrameAt(localFrame) + 0.5) / Math.max(1, fps),
    timelineFrames,
    setptsExpression: setpts,
    averageSpeed: source / duration,
    identity,
  };
}
