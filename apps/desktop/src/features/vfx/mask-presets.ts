import type { MaskPoint } from '@editor-ia/project-schema';

/**
 * Presets de máscara poligonal (paridad de `estrela`, `coracao` y
 * `dividir` de `mascara_desenho.js` de AlaukCut). Se emiten como
 * `shape:'polygon'` con puntos absolutos del fotograma (0..1): el
 * backend (`masks.rs`) y la preview ya soportan polígono, así que no
 * hace falta tocar Rust. El corazón usa el mismo trazado bézier del
 * original muestreado a 16 puntos; la estrella usa la misma razón
 * exterior/interior (1 / 0.4).
 */

const MAX_POINTS = 16;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function point(x: number, y: number): MaskPoint {
  return { x: Number(clampUnit(x).toFixed(6)), y: Number(clampUnit(y).toFixed(6)) };
}

/** Estrella de 5 puntas centrada, radio exterior ~0.32 del cuadro. */
export function starMaskPoints(
  centerX = 0.5,
  centerY = 0.5,
  outerRadius = 0.32,
): MaskPoint[] {
  const inner = outerRadius * 0.4;
  return Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const radius = index % 2 === 0 ? outerRadius : inner;
    return point(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
  });
}

function cubic(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  t: number,
): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/**
 * Corazón muestreado del trazado bézier de AlaukCut (caja 0..1 con el
 * ancho igual al alto/0.95), reescalado a ~0.56 del ancho del cuadro y
 * centrado. Devuelve 16 puntos sobre el contorno.
 */
export function heartMaskPoints(): MaskPoint[] {
  const curves: Array<readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]]> = [
    [[0.5, 0.95], [0.2, 0.75], [0.0, 0.55], [0.0, 0.32]],
    [[0.0, 0.32], [0.0, 0.12], [0.15, 0.0], [0.3, 0.0]],
    [[0.3, 0.0], [0.42, 0.0], [0.5, 0.08], [0.5, 0.18]],
    [[0.5, 0.18], [0.5, 0.08], [0.58, 0.0], [0.7, 0.0]],
    [[0.7, 0.0], [0.85, 0.0], [1.0, 0.12], [1.0, 0.32]],
    [[1.0, 0.32], [1.0, 0.55], [0.8, 0.75], [0.5, 0.95]],
  ];
  const perCurve = Math.floor(MAX_POINTS / curves.length); // 2
  const samples: [number, number][] = [];
  for (const [p0, p1, p2, p3] of curves) {
    for (let i = 0; i < perCurve; i += 1) {
      samples.push(cubic(p0, p1, p2, p3, i / perCurve));
    }
  }
  // Escala y centra: el trazado ocupa 0..1 en ambas ejes; el corazón
  // queda ~0.62 del ancho, centrado verticalmente en la mitad del cuadro.
  const scale = 0.62;
  const offsetX = 0.5 - scale / 2;
  const offsetY = 0.56 - (scale * 0.95) / 2;
  return samples.map(([x, y]) => point(offsetX + x * scale, offsetY + y * scale * 0.95));
}

/**
 * «Película» de AlaukCut como tira de cine: banda central con una
 * muesca rectangular de perforación arriba y otra abajo (12 puntos).
 * El original dibuja la tira con perforaciones internas; el polígono
 * no puede hacer huecos, así que las perforaciones se abren al borde —
 * misma silueta reconocible.
 */
export function filmMaskPoints(): MaskPoint[] {
  const x0 = 0.18;
  const x1 = 0.82;
  const y0 = 0.32;
  const y1 = 0.68;
  const depth = 0.07;
  const notchW = 0.14;
  const cx = (x0 + x1) / 2;
  const nx0 = cx - notchW / 2;
  const nx1 = cx + notchW / 2;
  const yt = y0 + depth;
  const yb = y1 - depth;
  // Recorre el borde en sentido horario desde la esquina superior
  // izquierda; cada muesca baja/sube `depth` desde su borde.
  return [
    point(x0, y0),
    point(nx0, y0),
    point(nx0, yt),
    point(nx1, yt),
    point(nx1, y0),
    point(x1, y0),
    point(x1, y1),
    point(nx1, y1),
    point(nx1, yb),
    point(nx0, yb),
    point(nx0, y1),
    point(x0, y1),
  ];
}

/**
 * «Dividir» de AlaukCut como mitad diagonal: triángulo que conserva la
 * mitad x >= y del cuadro (aproximación — el original tiene línea
 * rotatable con feather; el polígono no rota ni difumina).
 */
export const MASK_POLYGON_PRESETS = {
  star: starMaskPoints,
  heart: heartMaskPoints,
  half: () => [point(0, 0), point(1, 0), point(1, 1)],
  film: filmMaskPoints,
} as const;

export type MaskPolygonPresetId = keyof typeof MASK_POLYGON_PRESETS;

export const MASK_POLYGON_PRESET_LABELS: Record<MaskPolygonPresetId, string> = {
  star: 'Estrella',
  heart: 'Corazón',
  half: 'Mitad diagonal',
  film: 'Tira de cine',
};
