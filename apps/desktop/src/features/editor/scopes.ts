/**
 * Scope sampling for the preview. The source frame is drawn to a small
 * offscreen canvas and these pure functions turn its RGBA bytes into a luma
 * histogram, RGB histograms, a luma waveform and a chroma vectorscope.
 */
export const WAVEFORM_COLUMNS = 96;
export const WAVEFORM_LEVELS = 64;
export const VECTOR_SIZE = 64;
export const PARADE_COLUMNS = 96;
export const PARADE_LEVELS = 64;
const MAX_SAMPLES = 40_000;

export interface ScopeData {
  readonly width: number;
  readonly height: number;
  readonly sampleCount: number;
  readonly luma: Uint32Array;
  readonly red: Uint32Array;
  readonly green: Uint32Array;
  readonly blue: Uint32Array;
  /** Row-major waveform: level * WAVEFORM_COLUMNS + column. */
  readonly waveform: Uint32Array;
  /** Row-major vectorscope: V * VECTOR_SIZE + U. */
  readonly vectorscope: Uint32Array;
  /**
   * Parade (RGB parade, como en DaVinci): tres waveforms apilados por canal,
   * cada uno en su tercio de columnas. Row-major: level * PARADE_COLUMNS + column.
   */
  readonly parade: Uint32Array;
}

function emptyScopes(width = 0, height = 0): ScopeData {
  return {
    width,
    height,
    sampleCount: 0,
    luma: new Uint32Array(256),
    red: new Uint32Array(256),
    green: new Uint32Array(256),
    blue: new Uint32Array(256),
    waveform: new Uint32Array(WAVEFORM_COLUMNS * WAVEFORM_LEVELS),
    vectorscope: new Uint32Array(VECTOR_SIZE * VECTOR_SIZE),
    parade: new Uint32Array(PARADE_COLUMNS * PARADE_LEVELS),
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function bump(values: Uint32Array, index: number): void {
  values[index] = (values[index] ?? 0) + 1;
}

export function computeScopes(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): ScopeData {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.length < width * height * 4
  ) {
    return emptyScopes(Math.max(0, width || 0), Math.max(0, height || 0));
  }
  const scopes = emptyScopes(width, height);
  const luma = scopes.luma as Uint32Array;
  const red = scopes.red as Uint32Array;
  const green = scopes.green as Uint32Array;
  const blue = scopes.blue as Uint32Array;
  const waveform = scopes.waveform as Uint32Array;
  const vectorscope = scopes.vectorscope as Uint32Array;
  const parade = scopes.parade as Uint32Array;
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_SAMPLES)));
  let samples = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      const r = pixels[offset] ?? 0;
      const g = pixels[offset + 1] ?? 0;
      const b = pixels[offset + 2] ?? 0;
      const yValue = clampByte(0.2126 * r + 0.7152 * g + 0.0722 * b);
      bump(luma, yValue);
      bump(red, r);
      bump(green, g);
      bump(blue, b);
      const column = Math.min(
        WAVEFORM_COLUMNS - 1,
        Math.floor((x / width) * WAVEFORM_COLUMNS),
      );
      const level = Math.min(
        WAVEFORM_LEVELS - 1,
        Math.floor((yValue / 256) * WAVEFORM_LEVELS),
      );
      bump(waveform, level * WAVEFORM_COLUMNS + column);
      const u = clampByte(-0.168736 * r - 0.331264 * g + 0.5 * b + 128);
      const v = clampByte(0.5 * r - 0.418688 * g - 0.081312 * b + 128);
      const vx = Math.min(VECTOR_SIZE - 1, Math.floor((u / 256) * VECTOR_SIZE));
      const vy = Math.min(VECTOR_SIZE - 1, Math.floor((v / 256) * VECTOR_SIZE));
      bump(vectorscope, vy * VECTOR_SIZE + vx);
      // Parade: cada canal ocupa un tercio de las columnas, como en DaVinci.
      const third = Math.floor(PARADE_COLUMNS / 3);
      const columnInChannel = Math.min(third - 1, Math.floor((x / width) * third));
      for (const [channel, value] of [
        [0, r],
        [1, g],
        [2, b],
      ] as const) {
        // Un canal en cero no dibuja nada: sin esto el parade llena la fila
        // inferior con los canales apagados y el balance de color se oculta.
        if (value === 0) continue;
        const column = Math.min(PARADE_COLUMNS - 1, channel * third + columnInChannel);
        const level = Math.min(
          PARADE_LEVELS - 1,
          Math.floor((value / 256) * PARADE_LEVELS),
        );
        bump(parade, level * PARADE_COLUMNS + column);
      }
      samples += 1;
    }
  }
  return { ...scopes, sampleCount: samples };
}

export function maxScopeCount(values: Uint32Array): number {
  let max = 0;
  for (const value of values) {
    if (value > max) max = value;
  }
  return max;
}
