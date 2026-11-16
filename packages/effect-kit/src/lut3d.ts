/**
 * LUTs 3D para la preview WebGL.
 *
 * Dos orígenes:
 * - `parseCubeLut`: archivos `.cube` del proyecto (`effects.lutFile`,
 *   mismos que consume `lut3d=file=` de FFmpeg en el export).
 * - `cameraProfileLut`: perfiles log → Rec.709 (`effects.cameraProfile`),
 *   port exacto de `camera_log.rs` — el export genera el `.cube` 33³ en
 *   Rust; acá se evalúa la misma fórmula una vez por perfil.
 *
 * `Lut3DData.data` es RGBA8 con el rojo como dimensión más rápida, el
 * mismo orden que espera `texImage3D`/`lut3d` de FFmpeg.
 */

export interface Lut3DData {
  readonly size: number;
  readonly data: Uint8Array;
}

export interface Lut3DSource {
  readonly lut: Lut3DData;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
}

const MIN_LUT_SIZE = 2;
const MAX_LUT_SIZE = 256;

/**
 * Parsea el formato `.cube` de Iridas/Resolve: `TITLE`, `LUT_3D_SIZE N`,
 * `DOMAIN_MIN`/`DOMAIN_MAX` opcionales y N³ líneas `r g b` con el rojo
 * variando más rápido. Devuelve `null` si falta el tamaño o no hay
 * suficientes entradas numéricas.
 */
export function parseCubeLut(text: string): Lut3DSource | null {
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const entries: number[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('TITLE') || line.startsWith('COMMENT')) {
      continue;
    }
    const upper = line.toUpperCase();
    if (upper.startsWith('LUT_3D_SIZE')) {
      const parsed = Number.parseInt(line.slice(11).trim(), 10);
      if (Number.isFinite(parsed)) size = parsed;
      continue;
    }
    if (upper.startsWith('DOMAIN_MIN')) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      const [d0, d1, d2] = parts;
      if (d0 !== undefined && d1 !== undefined && d2 !== undefined &&
          [d0, d1, d2].every(Number.isFinite)) {
        domainMin = [d0, d1, d2];
      }
      continue;
    }
    if (upper.startsWith('DOMAIN_MAX')) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      const [d0, d1, d2] = parts;
      if (d0 !== undefined && d1 !== undefined && d2 !== undefined &&
          [d0, d1, d2].every(Number.isFinite)) {
        domainMax = [d0, d1, d2];
      }
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;
    entries.push(r, g, b);
  }
  if (size < MIN_LUT_SIZE || size > MAX_LUT_SIZE) return null;
  const needed = size * size * size;
  if (entries.length / 3 < needed) return null;
  const data = new Uint8Array(needed * 4);
  for (let i = 0; i < needed; i += 1) {
    const o = i * 4;
    data[o] = Math.round(Math.min(1, Math.max(0, entries[i * 3] ?? 0)) * 255);
    data[o + 1] = Math.round(Math.min(1, Math.max(0, entries[i * 3 + 1] ?? 0)) * 255);
    data[o + 2] = Math.round(Math.min(1, Math.max(0, entries[i * 3 + 2] ?? 0)) * 255);
    data[o + 3] = 255;
  }
  return { lut: { size, data }, domainMin, domainMax };
}

// ---------------------------------------------------------------------------
// Perfiles de cámara log → Rec.709 (port de `camera_log.rs`, paridad
// `luts_camera.js` de AlaukCut).
// ---------------------------------------------------------------------------

const D65: readonly [number, number] = [0.3127, 0.329];
type Vec3 = [number, number, number];
type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

interface Curve {
  /** true si la entrada legal de 10 bits se expande a full range antes de decodificar. */
  readonly legal: boolean;
  readonly dec: (y: number) => number;
}

const decSlog3 = (y: number): number =>
  y >= 171.2102946929 / 1023.0
    ? 10 ** ((y * 1023.0 - 420.0) / 261.5) * (0.18 + 0.01) - 0.01
    : ((y * 1023.0 - 95.0) * 0.01125) / (171.2102946929 - 95.0);

const decVlog = (y: number): number =>
  y < 0.181 ? (y - 0.125) / 5.6 : 10 ** ((y - 0.598206) / 0.241514) - 0.00873;

const decNlog = (y: number): number =>
  y < 452.0 / 1023.0
    ? (y / (650.0 / 1023.0)) ** 3 - 0.0075
    : Math.exp((y - 619.0 / 1023.0) / (150.0 / 1023.0));

const decDlog = (y: number): number =>
  y <= 0.14
    ? (y - 0.0929) / 6.025
    : (10 ** (3.89616 * y - 2.27752) - 0.0108) / 0.9892;

const decClog3 = (y: number): number =>
  0.9 *
  (y < 0.097465473
    ? -(10 ** ((0.12783901 - y) / 0.36726845) - 1.0) / 14.98325
    : y <= 0.15277891
      ? (y - 0.12512219) / 1.9754798
      : (10 ** ((y - 0.12240537) / 0.36726845) - 1.0) / 14.98325);

const decGplog = (y: number): number => (400 ** y - 1.0) / 399.0;

const CURVES: Readonly<Record<string, Curve>> = {
  slog3: { legal: true, dec: decSlog3 },
  vlog: { legal: true, dec: decVlog },
  nlog: { legal: true, dec: decNlog },
  dlog: { legal: true, dec: decDlog },
  clog3: { legal: true, dec: decClog3 },
  gplog: { legal: false, dec: decGplog },
};

/** Legal 10-bit code value (0..1) → full-range float. */
const legal = (v: number): number => (876.0 * v + 64.0) / 1023.0;

function primaries(gamut: string): [[number, number], [number, number], [number, number]] | null {
  switch (gamut) {
    case 'rec709':
      return [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]];
    case 'sgamut3cine':
      return [[0.766, 0.275], [0.225, 0.8], [0.089, -0.087]];
    case 'vgamut':
      return [[0.73, 0.28], [0.165, 0.84], [0.1, -0.03]];
    case 'ngamut':
      return [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]];
    case 'dgamut':
      return [[0.71, 0.31], [0.21, 0.88], [0.09, -0.08]];
    case 'cinemagamut':
      return [[0.74, 0.27], [0.17, 1.14], [0.08, -0.1]];
    default:
      return null;
  }
}

const mulv = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const mul = (a: Mat3, b: Mat3): Mat3 => [
  [a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
   a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
   a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2]],
  [a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
   a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
   a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2]],
  [a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
   a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
   a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2]],
];

function inv3(m: Mat3): Mat3 {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const aa = e * i - f * h;
  const bb = -(d * i - f * g);
  const cc = d * h - e * g;
  const det = a * aa + b * bb + c * cc;
  return [
    [aa / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [bb / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [cc / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** Matriz RGB→XYZ con blanco normalizado a D65 (equivale a `npm` de AlaukCut). */
function rgbToXyz(p: [[number, number], [number, number], [number, number]]): Mat3 {
  const column = (xy: [number, number]): Vec3 => [
    xy[0] / xy[1],
    1.0,
    (1.0 - xy[0] - xy[1]) / xy[1],
  ];
  const c0 = column(p[0]);
  const c1 = column(p[1]);
  const c2 = column(p[2]);
  const m: Mat3 = [
    [c0[0], c1[0], c2[0]],
    [c0[1], c1[1], c2[1]],
    [c0[2], c1[2], c2[2]],
  ];
  const minv = inv3(m);
  const d65xyz: Vec3 = [D65[0] / D65[1], 1.0, (1.0 - D65[0] - D65[1]) / D65[1]];
  const s = mulv(minv, d65xyz);
  const out = m;
  for (let j = 0; j < 3; j += 1) {
    const scale = s[j] ?? 0;
    for (const row of out) row[j] = (row[j] ?? 0) * scale;
  }
  return out;
}

/** Matriz gamut→Rec.709 (equivale a `PARA_709[gamut]`). */
function gamutTo709(gamut: string): Mat3 | null {
  const p709 = primaries('rec709');
  const pGamut = primaries(gamut);
  if (!p709 || !pGamut) return null;
  return mul(inv3(rgbToXyz(p709)), rgbToXyz(pGamut));
}

interface Visual {
  readonly exposure: number;
  readonly saturation: number;
  readonly warm: number;
  readonly cool: number;
}

/** Los 8 perfiles registrados por `luts_camera.js` (id, curva, gamut, acabado visual). */
const PROFILES: Readonly<Record<string, { curve: string; gamut: string; visual: Visual }>> = {
  vlog709: { curve: 'vlog', gamut: 'vgamut', visual: { exposure: 0.5, saturation: 0.9, warm: 0, cool: 0 } },
  slog3709: { curve: 'slog3', gamut: 'sgamut3cine', visual: { exposure: 0.5, saturation: 0.9, warm: 0, cool: 0 } },
  slog3cinema: { curve: 'slog3', gamut: 'sgamut3cine', visual: { exposure: 0.45, saturation: 0.75, warm: 0.04, cool: 0.04 } },
  nlog709: { curve: 'nlog', gamut: 'ngamut', visual: { exposure: 0.5, saturation: 0.9, warm: 0, cool: 0 } },
  nlogcinema: { curve: 'nlog', gamut: 'ngamut', visual: { exposure: 0.45, saturation: 0.75, warm: 0.04, cool: 0.04 } },
  gplog709: { curve: 'gplog', gamut: 'rec709', visual: { exposure: 0.5, saturation: 0.9, warm: 0, cool: 0 } },
  dlog709: { curve: 'dlog', gamut: 'dgamut', visual: { exposure: 0.5, saturation: 0.9, warm: 0, cool: 0 } },
  clog3709: { curve: 'clog3', gamut: 'cinemagamut', visual: { exposure: 0.5, saturation: 0.9, warm: 0, cool: 0 } },
};

export const CAMERA_PROFILE_IDS: readonly string[] = Object.keys(PROFILES);

const filmic = (x: number): number => {
  const v = Math.max(0, x);
  return Math.min(1, (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14));
};

const bt1886 = (l: number): number => Math.max(0, l) ** (1.0 / 2.4);

const gamutMatrixCache = new Map<string, Mat3>();
function cachedGamutTo709(gamut: string): Mat3 | null {
  const cached = gamutMatrixCache.get(gamut);
  if (cached) return cached;
  const m = gamutTo709(gamut);
  if (m) gamutMatrixCache.set(gamut, m);
  return m;
}

/** Evalúa el perfil sobre un RGB de entrada normalizado [0,1]. Réplica de `profile_rgb`. */
function profileRgb(profile: string, r: number, g: number, b: number): Vec3 | null {
  const entry = PROFILES[profile];
  if (!entry) return null;
  const curve = CURVES[entry.curve];
  const m = cachedGamutTo709(entry.gamut);
  if (!curve || !m) return null;
  const dec = (v: number): number => {
    const cv = curve.legal ? legal(Math.min(1, Math.max(0, v))) : Math.min(1, Math.max(0, v));
    return curve.dec(cv);
  };
  const c = mulv(m, [dec(r), dec(g), dec(b)]);
  const { visual } = entry;
  if (Math.abs(visual.saturation - 1.0) > 1e-9) {
    const y = 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    for (let i = 0; i < 3; i += 1) c[i] = y + ((c[i] ?? 0) - y) * visual.saturation;
  }
  for (let i = 0; i < 3; i += 1) c[i] = filmic(visual.exposure * (c[i] ?? 0));
  if (visual.warm !== 0.0 || visual.cool !== 0.0) {
    const y = 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    const luz = y * y;
    const sombra = (1.0 - y) * (1.0 - y);
    c[0] = (c[0] ?? 0) * (1.0 + visual.warm * luz - visual.cool * sombra);
    c[2] = (c[2] ?? 0) * (1.0 - visual.warm * luz + visual.cool * sombra);
  }
  return [bt1886(c[0] ?? 0), bt1886(c[1] ?? 0), bt1886(c[2] ?? 0)].map((v) =>
    Math.min(1, v),
  ) as Vec3;
}

const CAMERA_LUT_SIZE = 33;
const cameraLutCache = new Map<string, Lut3DSource>();

/**
 * LUT 3D del perfil de cámara (33³, dominio 0..1). Devuelve `null` si el id
 * no es válido — mismo comportamiento que `camera_lut_path` del export.
 */
export function cameraProfileLut(profile: string): Lut3DSource | null {
  const cached = cameraLutCache.get(profile);
  if (cached) return cached;
  if (!profileRgb(profile, 0, 0, 0)) return null;
  const size = CAMERA_LUT_SIZE;
  const data = new Uint8Array(size * size * size * 4);
  const scale = size - 1;
  let o = 0;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const rgb = profileRgb(profile, r / scale, g / scale, b / scale) ?? [0, 0, 0];
        data[o] = Math.round(Math.min(1, Math.max(0, rgb[0])) * 255);
        data[o + 1] = Math.round(Math.min(1, Math.max(0, rgb[1])) * 255);
        data[o + 2] = Math.round(Math.min(1, Math.max(0, rgb[2])) * 255);
        data[o + 3] = 255;
        o += 4;
      }
    }
  }
  const source: Lut3DSource = {
    lut: { size, data },
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
  };
  cameraLutCache.set(profile, source);
  return source;
}
