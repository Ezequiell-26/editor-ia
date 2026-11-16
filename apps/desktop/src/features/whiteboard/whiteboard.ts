/**
 * Motor procedural de la animación "pizarra blanca" (mano que dibuja trazo
 * por trazo). Lógica pura y testeable: la matemática está inspirada en
 * Inkplainer-OS (`animations.js`/`index.html`, Apache-2.0) — velocidad en
 * px/s, pausa entre trazos con la mano viajando al siguiente inicio, y un
 * tope de desplazamiento por frame para el "glide" de la mano.
 *
 * Sistema de coordenadas: los puntos de los trazos están normalizados 0..1
 * respecto al lienzo. Los cálculos de distancia se hacen en "unidades de
 * altura" (`x * aspect`, `y`) para que la velocidad sea isótropa: con
 * `aspect = width / height`, una unidad equivale a la altura del video.
 * Una velocidad de 0.35 ≈ 378 px/s en un video de 1080p de alto.
 */

export interface WhiteboardPoint {
  readonly x: number;
  readonly y: number;
}

export type WhiteboardTool = 'pencil' | 'marker';

export interface WhiteboardStroke {
  readonly id: string;
  /** Polilínea en coordenadas normalizadas 0..1 (x = ancho, y = alto). */
  readonly points: readonly WhiteboardPoint[];
  /** Grosor del trazo como fracción de la altura del lienzo. */
  readonly width: number;
  readonly tool?: WhiteboardTool;
}

export interface WhiteboardScheduleEntry {
  readonly stroke: WhiteboardStroke;
  /** Inicio del tramo de dibujo, en segundos desde t=0. */
  readonly start: number;
  /** Fin del tramo de dibujo (excluye la pausa de viaje). */
  readonly end: number;
  /** Duración del dibujo en segundos. */
  readonly duration: number;
  /** Longitud del trazo en unidades de altura. */
  readonly length: number;
  /** Fin del intervalo completo (dibujo + pausa de viaje). */
  readonly slotEnd: number;
}

export interface WhiteboardSchedule {
  readonly aspect: number;
  readonly speed: number;
  readonly gap: number;
  readonly entries: readonly WhiteboardScheduleEntry[];
  readonly totalDuration: number;
}

export interface WhiteboardTip {
  /** Posición normalizada 0..1 sobre el lienzo. */
  readonly x: number;
  readonly y: number;
  /** Ángulo de avance del trazo en radianes (0 = derecha, π/2 = abajo). */
  readonly angle: number;
}

export type WhiteboardEasing = 'linear' | 'smooth';

export interface WhiteboardFrame {
  /** Fracción dibujada de cada trazo, alineada con `schedule.entries`. */
  readonly drawn: readonly number[];
  /** Punta de la mano en coordenadas normalizadas; null si no hay trazos. */
  readonly tip: WhiteboardTip | null;
  /** Índice del trazo que se está dibujando, o -1 durante pausas/fin. */
  readonly activeIndex: number;
  /** true cuando todos los trazos terminaron de dibujarse. */
  readonly complete: boolean;
}

export interface WhiteboardScheduleOptions {
  /** Ancho / alto del lienzo (16/9 para landscape, 9/16 para portrait). */
  readonly aspect: number;
  /** Velocidad de dibujo en unidades de altura por segundo. */
  readonly speed: number;
  /** Pausa entre trazos (viaje de la mano) en segundos. */
  readonly gap?: number;
}

const DEFAULT_GAP = 0.18;
const MIN_STROKE_DURATION = 0.05;

function toUnits(p: WhiteboardPoint, aspect: number): WhiteboardPoint {
  return { x: p.x * aspect, y: p.y };
}

function fromUnits(u: WhiteboardPoint, aspect: number): WhiteboardPoint {
  return { x: aspect > 0 ? u.x / aspect : u.x, y: u.y };
}

function dist(a: WhiteboardPoint, b: WhiteboardPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Largo total de la polilínea en unidades de altura. */
export function strokeLength(stroke: WhiteboardStroke, aspect: number): number {
  let total = 0;
  for (let i = 1; i < stroke.points.length; i += 1) {
    total += dist(toUnits(stroke.points[i - 1]!, aspect), toUnits(stroke.points[i]!, aspect));
  }
  return total;
}

/**
 * Punto sobre el trazo a `distance` unidades de altura desde el inicio.
 * Devuelve la posición en coordenadas normalizadas y el ángulo del segmento.
 * Con distancia <= 0 devuelve el primer punto; más allá del final, el último.
 */
export function pointAtDistance(
  stroke: WhiteboardStroke,
  aspect: number,
  distance: number,
): { readonly point: WhiteboardPoint; readonly angle: number; readonly reached: number } {
  const pts = stroke.points;
  if (pts.length === 0) {
    return { point: { x: 0, y: 0 }, angle: 0, reached: 0 };
  }
  if (pts.length === 1 || distance <= 0) {
    const first = pts[0]!;
    const second = pts[1] ?? first;
    const a = toUnits(first, aspect);
    const b = toUnits(second, aspect);
    return {
      point: first,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      reached: 0,
    };
  }
  let travelled = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = toUnits(pts[i - 1]!, aspect);
    const b = toUnits(pts[i]!, aspect);
    const segLen = dist(a, b);
    if (segLen <= 0) continue;
    if (travelled + segLen >= distance) {
      const t = (distance - travelled) / segLen;
      const u = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      return {
        point: fromUnits(u, aspect),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        reached: distance,
      };
    }
    travelled += segLen;
  }
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2]!;
  const a = toUnits(prev, aspect);
  const b = toUnits(last, aspect);
  return {
    point: last,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    reached: travelled,
  };
}

/** Punto final de un trazo (último vértice), en coordenadas normalizadas. */
export function strokeEndPoint(stroke: WhiteboardStroke): WhiteboardPoint | null {
  const pts = stroke.points;
  return pts.length > 0 ? pts[pts.length - 1]! : null;
}

/** Punto inicial de un trazo (primer vértice), en coordenadas normalizadas. */
export function strokeStartPoint(stroke: WhiteboardStroke): WhiteboardPoint | null {
  const pts = stroke.points;
  return pts.length > 0 ? pts[0]! : null;
}

/**
 * Arma la línea de tiempo: cada trazo se dibuja a velocidad constante
 * (`speed` unidades de altura por segundo) y después hay una pausa `gap`
 * durante la cual la mano viaja al inicio del siguiente trazo.
 */
export function buildWhiteboardSchedule(
  strokes: readonly WhiteboardStroke[],
  options: WhiteboardScheduleOptions,
): WhiteboardSchedule {
  const aspect = options.aspect > 0 ? options.aspect : 16 / 9;
  const speed = options.speed > 0 ? options.speed : 0.35;
  const gap = Math.max(0, options.gap ?? DEFAULT_GAP);
  const entries: WhiteboardScheduleEntry[] = [];
  let cursor = 0;
  for (const stroke of strokes) {
    const length = strokeLength(stroke, aspect);
    const duration = Math.max(MIN_STROKE_DURATION, length / speed);
    const start = cursor;
    const end = start + duration;
    entries.push({ stroke, start, end, duration, length, slotEnd: end + gap });
    cursor = end + gap;
  }
  const totalDuration = entries.length > 0 ? entries[entries.length - 1]!.slotEnd - gap : 0;
  return { aspect, speed, gap, entries, totalDuration };
}

/** Easing lineal o suave (coseno, el mismo que usa MotionPreview para strokes). */
export function easeWhiteboardProgress(t: number, easing: WhiteboardEasing = 'linear'): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (easing === 'smooth') {
    return clamped >= 1 ? 1 : (1 - Math.cos(Math.PI * clamped)) / 2;
  }
  return clamped;
}

function lerpPoint(a: WhiteboardPoint, b: WhiteboardPoint, t: number): WhiteboardPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Estado del cuadro en el instante `time` (segundos). `drawn[i]` es la
 * fracción ya trazada del trazo i; `tip` es la posición de la mano — durante
 * la pausa entre trazos interpola suavemente del fin del trazo anterior al
 * inicio del siguiente (el "lift" de Inkplainer).
 */
export function whiteboardFrameAt(
  schedule: WhiteboardSchedule,
  time: number,
  easing: WhiteboardEasing = 'linear',
): WhiteboardFrame {
  const { entries, aspect, gap } = schedule;
  const count = entries.length;
  const drawn = new Array<number>(count).fill(0);

  if (count === 0) {
    return { drawn, tip: null, activeIndex: -1, complete: true };
  }

  const first = entries[0]!;
  const firstStart = strokeStartPoint(first.stroke);
  if (time <= 0) {
    return {
      drawn,
      tip: firstStart ? { x: firstStart.x, y: firstStart.y, angle: 0 } : null,
      activeIndex: -1,
      complete: false,
    };
  }

  for (let i = 0; i < count; i += 1) {
    const entry = entries[i]!;
    const prevDrawn = i; // trazos anteriores ya están completos
    for (let j = 0; j < prevDrawn; j += 1) drawn[j] = 1;

    if (time < entry.start) {
      // Pausa previa al trazo i: la mano viaja del fin del trazo i-1 al
      // inicio del trazo i.
      if (i === 0) {
        const start = strokeStartPoint(entry.stroke);
        return {
          drawn,
          tip: start ? { x: start.x, y: start.y, angle: 0 } : null,
          activeIndex: -1,
          complete: false,
        };
      }
      const prev = entries[i - 1]!;
      const from = strokeEndPoint(prev.stroke);
      const to = strokeStartPoint(entry.stroke);
      if (from === null || to === null) {
        return { drawn, tip: null, activeIndex: -1, complete: false };
      }
      const gapStart = prev.end;
      const u = gap > 0 ? smoothstep((time - gapStart) / gap) : 1;
      const p = lerpPoint(from, to, u);
      const angle = Math.atan2(to.y - from.y, (to.x - from.x) * aspect);
      return { drawn, tip: { x: p.x, y: p.y, angle }, activeIndex: -1, complete: false };
    }

    if (time < entry.end) {
      // Tramo de dibujo del trazo i.
      const raw = entry.duration > 0 ? (time - entry.start) / entry.duration : 1;
      const frac = easeWhiteboardProgress(raw, easing);
      drawn[i] = frac;
      const at = pointAtDistance(entry.stroke, aspect, frac * entry.length);
      return {
        drawn,
        tip: { x: at.point.x, y: at.point.y, angle: at.angle },
        activeIndex: i,
        complete: false,
      };
    }

    // Ya pasó el dibujo: si hay pausa y siguiente trazo, el próximo loop lo
    // resuelve; si es el último, cae al cierre.
    drawn[i] = 1;
    if (i === count - 1) {
      const last = strokeEndPoint(entry.stroke);
      return {
        drawn,
        tip: last ? { x: last.x, y: last.y, angle: 0 } : null,
        activeIndex: -1,
        complete: time >= schedule.totalDuration,
      };
    }
    // Pausa de viaje después del trazo i (hasta el inicio del siguiente):
    // interpolar hacia el siguiente. Si ya arrancó el siguiente trazo, el
    // próximo loop lo resuelve.
    const next = entries[i + 1]!;
    if (time >= next.start) {
      continue;
    }
    const from = strokeEndPoint(entry.stroke);
    const to = strokeStartPoint(next.stroke);
    if (from === null || to === null) {
      continue;
    }
    const u = gap > 0 ? smoothstep((time - entry.end) / gap) : 1;
    const p = lerpPoint(from, to, u);
    const angle = Math.atan2(to.y - from.y, (to.x - from.x) * aspect);
    return { drawn, tip: { x: p.x, y: p.y, angle }, activeIndex: -1, complete: false };
  }

  const lastEntry = entries[count - 1]!;
  const last = strokeEndPoint(lastEntry.stroke);
  return {
    drawn: drawn.map(() => 1),
    tip: last ? { x: last.x, y: last.y, angle: 0 } : null,
    activeIndex: -1,
    complete: true,
  };
}

/**
 * "Glide" de la mano (Inkplainer `drawHand`, tope de ~34 px/frame): la
 * posición renderizada se acerca al objetivo como máximo `maxStep` por
 * frame, en el mismo espacio de coordenadas que reciban los puntos.
 */
export function glideToward(
  current: WhiteboardPoint | null,
  target: WhiteboardPoint,
  maxStep: number,
): WhiteboardPoint {
  if (current === null) return target;
  const d = dist(current, target);
  if (d <= maxStep || d === 0) return target;
  const t = maxStep / d;
  return { x: current.x + (target.x - current.x) * t, y: current.y + (target.y - current.y) * t };
}

// ─── Constructores de trazos y escenas de ejemplo ──────────────────────────

function pt(x: number, y: number): WhiteboardPoint {
  return { x, y };
}

export function lineStroke(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  tool: WhiteboardTool = 'marker',
): WhiteboardStroke {
  return { id, points: [pt(x1, y1), pt(x2, y2)], width, tool };
}

export function polylineStroke(
  id: string,
  points: readonly WhiteboardPoint[],
  width: number,
  tool: WhiteboardTool = 'marker',
): WhiteboardStroke {
  return { id, points, width, tool };
}

export function rectStroke(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  width: number,
  tool: WhiteboardTool = 'marker',
): WhiteboardStroke {
  return {
    id,
    points: [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h), pt(x, y)],
    width,
    tool,
  };
}

/** Arco circular muestreado en `samples` puntos (>= 8 para que se vea suave). */
export function arcStroke(
  id: string,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  width: number,
  samples = 48,
  tool: WhiteboardTool = 'marker',
): WhiteboardStroke {
  const points: WhiteboardPoint[] = [];
  const n = Math.max(8, Math.floor(samples));
  for (let i = 0; i <= n; i += 1) {
    const a = startAngle + ((endAngle - startAngle) * i) / n;
    points.push(pt(cx + radius * Math.cos(a), cy + radius * Math.sin(a)));
  }
  return { id, points, width, tool };
}

/** Subtítulo/scribble: onda senoidal horizontal entre dos puntos. */
export function waveStroke(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  amplitude: number,
  waves: number,
  width: number,
  tool: WhiteboardTool = 'pencil',
): WhiteboardStroke {
  const points: WhiteboardPoint[] = [];
  const n = Math.max(16, Math.floor(waves * 8));
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const env = Math.sin(Math.PI * t); // amplitud que crece y decrece
    points.push(
      pt(
        x1 + (x2 - x1) * t,
        y1 + (y2 - y1) * t + amplitude * env * Math.sin(t * waves * Math.PI * 2),
      ),
    );
  }
  return { id, points, width, tool };
}

export type WhiteboardDemoScene = 'sketch' | 'circle';

/** Escenas de ejemplo para la preview del panel (el video real dibuja la imagen). */
export function demoWhiteboardStrokes(scene: WhiteboardDemoScene): WhiteboardStroke[] {
  const marker = 0.011;
  const pencil = 0.005;
  if (scene === 'circle') {
    return [
      arcStroke('sol', 0.5, 0.42, 0.2, 0, Math.PI * 2, marker, 64),
      lineStroke('r1', 0.34, 0.42, 0.66, 0.42, pencil, 'pencil'),
      lineStroke('r2', 0.5, 0.26, 0.5, 0.58, pencil, 'pencil'),
      waveStroke('sub', 0.3, 0.72, 0.7, 0.72, 0.012, 3, pencil, 'pencil'),
    ];
  }
  // 'sketch': título subrayado + caja con check (diagrama explicativo).
  return [
    waveStroke('titulo', 0.18, 0.16, 0.62, 0.16, 0.014, 4, pencil, 'pencil'),
    lineStroke('subrayado', 0.18, 0.22, 0.62, 0.22, pencil, 'pencil'),
    rectStroke('caja', 0.6, 0.32, 0.28, 0.34, marker, 'marker'),
    polylineStroke(
      'check',
      [pt(0.65, 0.47), pt(0.71, 0.54), pt(0.82, 0.38)],
      marker * 0.9,
      'marker',
    ),
    lineStroke('flecha', 0.16, 0.78, 0.4, 0.78, marker, 'marker'),
    polylineStroke(
      'punta',
      [pt(0.4, 0.78), pt(0.34, 0.745), pt(0.34, 0.815)],
      marker,
      'marker',
    ),
    waveStroke('firma', 0.14, 0.9, 0.5, 0.9, 0.01, 5, pencil, 'pencil'),
  ];
}

/** Ancho por defecto del trazo según la herramienta (fracción de la altura). */
export function defaultStrokeWidth(tool: WhiteboardTool): number {
  return tool === 'marker' ? 0.011 : 0.005;
}
