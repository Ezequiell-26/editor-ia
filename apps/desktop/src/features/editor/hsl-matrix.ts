/**
 * Matriz del filtro `huesaturation` de FFmpeg (LGPL-2.1-or-later) para el
 * camino completo (`colors=a`, `strength=100`, `lightness=true`). La
 * composición y las rotaciones siguen `init_matrix` del filtro; se validó
 * contra el binario empaquetado con diferencias ≤1/255.
 */
type Matrix = number[][];

export interface HslInput {
  readonly hue?: number | undefined;
  readonly saturation?: number | undefined;
  readonly intensity?: number | undefined;
}

const WEIGHTS: [number, number, number] = [0.333, 0.334, 0.333];

function identity(): Matrix {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

/** FFmpeg: temp = b·a (columnas sobre filas). */
function multiply(a: Matrix, b: Matrix): Matrix {
  const temp: Matrix = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      temp[y]![x] =
        b[y]![0]! * a[0]![x]! +
        b[y]![1]! * a[1]![x]! +
        b[y]![2]! * a[2]![x]! +
        b[y]![3]! * a[3]![x]!;
    }
  }
  return temp;
}

function left(rotation: Matrix, matrix: Matrix): Matrix {
  return multiply(rotation, matrix);
}

function xRotate(rs: number, rc: number): Matrix {
  const m = identity();
  m[1]![1] = rc;
  m[1]![2] = rs;
  m[2]![1] = -rs;
  m[2]![2] = rc;
  return m;
}

function yRotate(rs: number, rc: number): Matrix {
  const m = identity();
  m[0]![0] = rc;
  m[0]![2] = -rs;
  m[2]![0] = rs;
  m[2]![2] = rc;
  return m;
}

function zRotate(rs: number, rc: number): Matrix {
  const m = identity();
  m[0]![0] = rc;
  m[0]![1] = rs;
  m[1]![0] = -rs;
  m[1]![1] = rc;
  return m;
}

function zShear(dx: number, dy: number): Matrix {
  const m = identity();
  m[0]![2] = dx;
  m[1]![2] = dy;
  return m;
}

function transformPoint(m: Matrix, x: number, y: number, z: number): [number, number, number] {
  return [
    x * m[0]![0]! + y * m[1]![0]! + z * m[2]![0]! + m[3]![0]!,
    x * m[0]![1]! + y * m[1]![1]! + z * m[2]![1]! + m[3]![1]!,
    x * m[0]![2]! + y * m[1]![2]! + z * m[2]![2]! + m[3]![2]!,
  ];
}

function hueRotate(matrix: Matrix, degrees: number, weights: [number, number, number]): Matrix {
  let m = matrix;
  m = left(xRotate(1 / Math.SQRT2, 1 / Math.SQRT2), m);
  m = left(yRotate(-1 / Math.sqrt(3), Math.SQRT2 / Math.sqrt(3)), m);
  const l = transformPoint(m, weights[0], weights[1], weights[2]);
  const sx = l[2] !== 0 ? l[0] / l[2] : 0;
  const sy = l[2] !== 0 ? l[1] / l[2] : 0;
  m = left(zShear(sx, sy), m);
  const angle = (degrees * Math.PI) / 180;
  m = left(zRotate(Math.sin(angle), Math.cos(angle)), m);
  m = left(zShear(-sx, -sy), m);
  m = left(yRotate(1 / Math.sqrt(3), Math.SQRT2 / Math.sqrt(3)), m);
  m = left(xRotate(-1 / Math.SQRT2, 1 / Math.SQRT2), m);
  return m;
}

function saturationMatrix(
  matrix: Matrix,
  saturation: number,
  weights: [number, number, number],
): Matrix {
  const s = 1 - saturation;
  const m = identity();
  m[0]![0] = s * weights[0] + saturation;
  m[0]![1] = s * weights[0];
  m[0]![2] = s * weights[0];
  m[1]![0] = s * weights[1];
  m[1]![1] = s * weights[1] + saturation;
  m[1]![2] = s * weights[1];
  m[2]![0] = s * weights[2];
  m[2]![1] = s * weights[2];
  m[2]![2] = s * weights[2] + saturation;
  return left(m, matrix);
}

function colorscale(matrix: Matrix, scale: number): Matrix {
  const m = identity();
  m[0]![0] = scale;
  m[1]![1] = scale;
  m[2]![2] = scale;
  return left(m, matrix);
}

/** Devuelve la matriz 3×3 en filas (out_i = Σ_j v_j · m[j][i]). */
export function hslMatrixRows(input: HslInput): [number, number, number, number, number, number, number, number, number] {
  const hue = Number.isFinite(input.hue) ? input.hue! : 0;
  const saturation = Number.isFinite(input.saturation) ? input.saturation! : 0;
  const intensity = Number.isFinite(input.intensity) ? input.intensity! : 0;
  let m = identity();
  m = colorscale(m, 1 + intensity);
  m = saturationMatrix(m, 1 + saturation, WEIGHTS);
  m = hueRotate(m, hue, WEIGHTS);
  return [
    m[0]![0]!,
    m[0]![1]!,
    m[0]![2]!,
    m[1]![0]!,
    m[1]![1]!,
    m[1]![2]!,
    m[2]![0]!,
    m[2]![1]!,
    m[2]![2]!,
  ];
}

/** Convierte filas a columnas para `uniformMatrix3fv` (GLSL). */
export function hslMatrixUniform(
  rows: readonly number[],
): [number, number, number, number, number, number, number, number, number] {
  return [
    rows[0] ?? 1,
    rows[3] ?? 0,
    rows[6] ?? 0,
    rows[1] ?? 0,
    rows[4] ?? 1,
    rows[7] ?? 0,
    rows[2] ?? 0,
    rows[5] ?? 0,
    rows[8] ?? 1,
  ];
}

/** Aplica la matriz a un RGB 0..255 (para referencias de test). */
export function applyHslMatrix(
  rows: readonly number[],
  rgb: readonly [number, number, number],
): [number, number, number] {
  return [0, 1, 2].map((channel) => {
    const value =
      (rgb[0] / 255) * (rows[channel] ?? 0) +
      (rgb[1] / 255) * (rows[3 + channel] ?? 0) +
      (rgb[2] / 255) * (rows[6 + channel] ?? 0);
    return Math.round(Math.min(1, Math.max(0, value)) * 255);
  }) as [number, number, number];
}

/** Bits de `huesaturation=colors` (REDS=0 … MAGENTAS=5; ALL=0x3F). */
export const HSL_COLORS_ALL = 0x3f;

const COLOR_BITS: Record<string, number> = {
  r: 1,
  y: 2,
  g: 4,
  c: 8,
  b: 16,
  m: 32,
};

/** Convierte la selección del panel al bitmask del filtro. */
export function hslColorMask(colors?: readonly string[] | null): number {
  if (!colors || colors.length === 0 || colors.length >= 6) return HSL_COLORS_ALL;
  let mask = 0;
  for (const color of colors) mask |= COLOR_BITS[color] ?? 0;
  return mask === 0 ? HSL_COLORS_ALL : mask;
}

/**
 * Peso por píxel del camino selectivo de `huesaturation` con `strength=100`:
 * FFmpeg marca el píxel según qué canal es máximo/mínimo, calcula la distancia
 * al color elegido y mezcla la matriz sólo en esos píxeles.
 */
export function hslSelectiveWeight(
  mask: number,
  rgb: readonly [number, number, number],
): number {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const flags =
    (r === max ? 1 : 0) |
    (r === min ? 8 : 0) |
    (g === max ? 4 : 0) |
    (g === min ? 32 : 0) |
    (b === max ? 16 : 0) |
    (b === min ? 2 : 0);
  if ((mask & flags) === 0) return 0;
  let f = 0;
  if (mask & 1) f = Math.max(f, r - Math.max(g, b));
  if (mask & 2) f = Math.max(f, Math.min(r, g) - b);
  if (mask & 4) f = Math.max(f, g - Math.max(r, b));
  if (mask & 8) f = Math.max(f, Math.min(g, b) - r);
  if (mask & 16) f = Math.max(f, b - Math.max(r, g));
  if (mask & 32) f = Math.max(f, Math.min(r, b) - g);
  return Math.min(1, Math.max(0, (f / 255) * 100));
}

/** Referencia JS del camino selectivo completo (para los E2E). */
export function applySelectiveHsl(
  rows: readonly number[],
  mask: number,
  rgb: readonly [number, number, number],
): [number, number, number] {
  const weight = hslSelectiveWeight(mask, rgb);
  if (weight <= 0) return [rgb[0], rgb[1], rgb[2]];
  const mapped = applyHslMatrix(rows, rgb);
  return rgb.map((value, channel) =>
    Math.round(value + (mapped[channel]! - value) * weight),
  ) as [number, number, number];
}
