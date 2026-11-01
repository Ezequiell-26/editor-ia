/**
 * LUT `.cube` para la preview en vivo.
 *
 * El export usa `lut3d` de FFmpeg; para que la preview no quede en "sin
 * efecto" se parsea el mismo archivo y se aplica con un shader WebGL2
 * (`lut-renderer.ts`). Este módulo es puro: sin DOM, sin canvas. Los tests
 * cubren el parser, la interpolación trilineal y la mezcla por intensidad,
 * que son la misma matemática que hace el shader.
 *
 * Orden del archivo `.cube`: cada línea es un RGB y el rojo varía más rápido,
 * después el verde y por último el azul. La textura 3D usa el mismo orden, así
 * que el índice `((b * size + g) * size + r)` sirve para ambos.
 */

export const MAX_CUBE_SIZE = 128;
export const MAX_CUBE_1D_SIZE = 4096;

export interface CubeLut {
  /** 1 = rampa por canal; 3 = cubo trilineal. */
  readonly dimension: 1 | 3;
  readonly size: number;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
  /** 3D: `size³ * 3`; 1D: `size * 3` floats en 0..1. */
  readonly data: Float32Array;
}

function toNumber(token: string, line: number): number {
  const value = Number(token);
  if (!Number.isFinite(value)) {
    throw new Error(`LUT inválido en la línea ${line}: "${token}" no es un número`);
  }
  return value;
}

function parseVector(tokens: readonly string[], line: number): [number, number, number] {
  if (tokens.length !== 3) {
    throw new Error(`LUT inválido en la línea ${line}: se esperaban 3 valores`);
  }
  return [
    toNumber(tokens[0]!, line),
    toNumber(tokens[1]!, line),
    toNumber(tokens[2]!, line),
  ];
}

/** Parsea un `.cube` 1D o 3D. */
export function parseCube(text: string): CubeLut {
  let dimension: 1 | 3 | 0 = 0;
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const trimmed = lines[index]!.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const tokens = trimmed.split(/\s+/);
    const keyword = tokens[0]!.toUpperCase();
    if (
      keyword === 'TITLE' ||
      keyword === 'LUT_3D_INPUT_RANGE' ||
      keyword === 'LUT_1D_INPUT_RANGE'
    ) {
      if (keyword.endsWith('INPUT_RANGE')) {
        const min = toNumber(tokens[1] ?? '', line);
        const max = toNumber(tokens[2] ?? '', line);
        domainMin = [min, min, min];
        domainMax = [max, max, max];
      }
      continue;
    }
    if (keyword === 'LUT_3D_SIZE') {
      if (dimension === 1) {
        throw new Error(`LUT inválido en la línea ${line}: mezcla tamaños 1D y 3D`);
      }
      const parsed = toNumber(tokens[1] ?? '', line);
      if (!Number.isInteger(parsed) || parsed < 2) {
        throw new Error(`LUT inválido en la línea ${line}: tamaño 3D inválido`);
      }
      if (parsed > MAX_CUBE_SIZE) {
        throw new Error(
          `LUT de ${parsed}³ demasiado grande para la preview (máximo ${MAX_CUBE_SIZE}³)`,
        );
      }
      dimension = 3;
      size = parsed;
      continue;
    }
    if (keyword === 'LUT_1D_SIZE') {
      if (dimension === 3) {
        throw new Error(`LUT inválido en la línea ${line}: mezcla tamaños 1D y 3D`);
      }
      const parsed = toNumber(tokens[1] ?? '', line);
      if (!Number.isInteger(parsed) || parsed < 2) {
        throw new Error(`LUT inválido en la línea ${line}: tamaño 1D inválido`);
      }
      if (parsed > MAX_CUBE_1D_SIZE) {
        throw new Error(
          `LUT 1D de ${parsed} puntos demasiado grande para la preview (máximo ${MAX_CUBE_1D_SIZE})`,
        );
      }
      dimension = 1;
      size = parsed;
      continue;
    }
    if (keyword === 'DOMAIN_MIN') {
      domainMin = parseVector(tokens.slice(1), line);
      continue;
    }
    if (keyword === 'DOMAIN_MAX') {
      domainMax = parseVector(tokens.slice(1), line);
      continue;
    }
    if (/^[A-Z_]+$/.test(keyword) && keyword !== 'LUT') {
      // Palabras clave desconocidas se ignoran para tolerar extensiones.
      continue;
    }
    for (const token of tokens) values.push(toNumber(token, line));
  }
  if (dimension === 0) {
    throw new Error('LUT inválido: falta LUT_3D_SIZE o LUT_1D_SIZE');
  }
  for (let channel = 0; channel < 3; channel += 1) {
    if (!(domainMax[channel]! > domainMin[channel]!)) {
      throw new Error('LUT inválido: DOMAIN_MAX debe ser mayor que DOMAIN_MIN');
    }
  }
  const expected =
    dimension === 1 ? size * 3 : size * size * size * 3;
  if (values.length !== expected) {
    throw new Error(
      `LUT incompleto: se esperaban ${expected / 3} colores y llegaron ${Math.floor(values.length / 3)}`,
    );
  }
  return {
    dimension,
    size,
    domainMin,
    domainMax,
    data: Float32Array.from(values),
  };
}

function coordinate(value: number, min: number, max: number, size: number): number {
  const normalized = (value - min) / (max - min);
  const clamped = Number.isFinite(normalized) ? Math.min(1, Math.max(0, normalized)) : 0;
  return clamped * (size - 1);
}

function cornerIndex(size: number, r: number, g: number, b: number): number {
  return ((b * size + g) * size + r) * 3;
}

/** Muestrea el LUT en RGB 0..1. 3D: trilineal; 1D: una rampa por canal. */
export function sampleCube(
  lut: CubeLut,
  red: number,
  green: number,
  blue: number,
): [number, number, number] {
  const size = lut.size;
  if (lut.dimension === 1) {
    const inputs = [red, green, blue];
    const result: [number, number, number] = [0, 0, 0];
    for (let channel = 0; channel < 3; channel += 1) {
      const position = coordinate(
        inputs[channel]!,
        lut.domainMin[channel]!,
        lut.domainMax[channel]!,
        size,
      );
      const low = Math.floor(position);
      const high = Math.min(size - 1, low + 1);
      const fraction = position - low;
      const a = lut.data[low * 3 + channel]!;
      const b = lut.data[high * 3 + channel]!;
      result[channel] = a + (b - a) * fraction;
    }
    return result;
  }
  const r = coordinate(red, lut.domainMin[0], lut.domainMax[0], size);
  const g = coordinate(green, lut.domainMin[1], lut.domainMax[1], size);
  const b = coordinate(blue, lut.domainMin[2], lut.domainMax[2], size);
  const r0 = Math.floor(r);
  const g0 = Math.floor(g);
  const b0 = Math.floor(b);
  const r1 = Math.min(size - 1, r0 + 1);
  const g1 = Math.min(size - 1, g0 + 1);
  const b1 = Math.min(size - 1, b0 + 1);
  const fr = r - r0;
  const fg = g - g0;
  const fb = b - b0;
  const data = lut.data;
  const sample = (ri: number, gi: number, bi: number, channel: number): number =>
    data[cornerIndex(size, ri, gi, bi) + channel]!;
  const result: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const c000 = sample(r0, g0, b0, channel);
    const c100 = sample(r1, g0, b0, channel);
    const c010 = sample(r0, g1, b0, channel);
    const c110 = sample(r1, g1, b0, channel);
    const c001 = sample(r0, g0, b1, channel);
    const c101 = sample(r1, g0, b1, channel);
    const c011 = sample(r0, g1, b1, channel);
    const c111 = sample(r1, g1, b1, channel);
    const c00 = c000 + (c100 - c000) * fr;
    const c10 = c010 + (c110 - c010) * fr;
    const c01 = c001 + (c101 - c001) * fr;
    const c11 = c011 + (c111 - c011) * fr;
    const c0 = c00 + (c10 - c00) * fg;
    const c1 = c01 + (c11 - c01) * fg;
    result[channel] = c0 + (c1 - c0) * fb;
  }
  return result;
}

/** Aplica el LUT a un buffer RGBA en sitio, mezclado por `intensity` (0..1). */
export function applyCubeToPixels(
  lut: CubeLut,
  pixels: Uint8ClampedArray,
  intensity: number,
): void {
  const mix = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 1;
  if (mix <= 0) return;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset]! / 255;
    const green = pixels[offset + 1]! / 255;
    const blue = pixels[offset + 2]! / 255;
    const [gr, gg, gb] = sampleCube(lut, red, green, blue);
    pixels[offset] = Math.round(Math.min(1, Math.max(0, red + (gr - red) * mix)) * 255);
    pixels[offset + 1] = Math.round(Math.min(1, Math.max(0, green + (gg - green) * mix)) * 255);
    pixels[offset + 2] = Math.round(Math.min(1, Math.max(0, blue + (gb - blue) * mix)) * 255);
  }
}

/**
 * Datos RGBA8 listos para `texImage3D` (ancho = rojo, alto = verde, profundo =
 * azul). El alfa queda en 255 porque el LUT no toca la opacidad.
 */
export function lutTextureData(lut: CubeLut): Uint8Array {
  const entries = lut.dimension === 1 ? lut.size : lut.size * lut.size * lut.size;
  const rgba = new Uint8Array(entries * 4);
  for (let index = 0; index < entries; index += 1) {
    const source = index * 3;
    const target = index * 4;
    const r = Math.min(1, Math.max(0, lut.data[source]!));
    const g = Math.min(1, Math.max(0, lut.data[source + 1]!));
    const b = Math.min(1, Math.max(0, lut.data[source + 2]!));
    rgba[target] = Math.round(r * 255);
    rgba[target + 1] = Math.round(g * 255);
    rgba[target + 2] = Math.round(b * 255);
    rgba[target + 3] = 255;
  }
  return rgba;
}
