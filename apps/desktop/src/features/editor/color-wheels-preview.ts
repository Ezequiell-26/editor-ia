import type { ClipEffects } from '@editor-ia/project-schema';
import { curveTable, CURVE_LUT_SIZE } from './curves-lut';

/**
 * Ruedas de color de la preview. El export usa `colorbalance` con las nueve
 * perillas (sombras/medios/luces) y luego `curves` por canal para gamma; la
 * preview reproduce ambas fórmulas en el shader.
 */

type Wheel = { readonly r?: number; readonly g?: number; readonly b?: number } | undefined;
export type ColorWheelsInput = Pick<ClipEffects, 'lift' | 'offset' | 'gain' | 'gamma'> & {
  /** Brillo aditivo del export; se suma a las nueve perillas. */
  readonly brightness?: number | undefined;
};

export interface ColorWheelsUniforms {
  readonly lift: readonly [number, number, number];
  readonly offset: readonly [number, number, number];
  readonly gain: readonly [number, number, number];
  /** Tabla RGBA 256×1 con la curva gamma de cada canal; null si es identidad. */
  readonly gamma: Uint8Array | null;
}

function channel(value: number | undefined): number {
  return Number.isFinite(value)
    ? Math.min(1, Math.max(-1, value as number))
    : 0;
}

function wheel(values: Wheel): [number, number, number] {
  return [channel(values?.r), channel(values?.g), channel(values?.b)];
}

function active(values: readonly number[]): boolean {
  return values.some((value) => Math.abs(value) > 0.001);
}

/**
 * Curva gamma del export: `curves=r='0/0 0.5/mid 1/1'` con
 * `mid = 0.5^(1/clamp(1+valor, 0.1, 10))`.
 */
export function gammaTable(values: readonly [number, number, number]): Uint8Array | null {
  if (!active(values)) return null;
  const out = new Uint8Array(CURVE_LUT_SIZE * 4);
  for (let index = 0; index < CURVE_LUT_SIZE; index += 1) {
    out[index * 4 + 3] = 255;
  }
  let changed = false;
  values.forEach((value, channelIndex) => {
    if (Math.abs(value) <= 0.001) {
      for (let index = 0; index < CURVE_LUT_SIZE; index += 1) {
        out[index * 4 + channelIndex] = index;
      }
      return;
    }
    const gamma = Math.min(10, Math.max(0.1, 1 + value));
    const mid = Math.min(1, Math.max(0, 0.5 ** (1 / gamma)));
    const table = curveTable([
      { x: 0, y: 0 },
      { x: 0.5, y: mid },
      { x: 1, y: 1 },
    ]);
    if (!table) return;
    changed = true;
    for (let index = 0; index < CURVE_LUT_SIZE; index += 1) {
      out[index * 4 + channelIndex] = table[index]!;
    }
  });
  return changed ? out : null;
}

export function colorWheelsUniforms(
  input: ColorWheelsInput | undefined,
  options: { readonly brightnessOnly?: boolean } = {},
): ColorWheelsUniforms | null {
  if (!input) return null;
  const lift = wheel(input.lift);
  const offset = wheel(input.offset);
  const gain = wheel(input.gain);
  const gammaValues = wheel(input.gamma);
  const gamma = gammaTable(gammaValues);
  const brightness = Number.isFinite(input.brightness)
    ? Math.min(1, Math.max(-1, input.brightness as number))
    : 0;
  const tone = (values: readonly [number, number, number]): [number, number, number] =>
    brightness === 0
      ? [values[0], values[1], values[2]]
      : [
          Math.min(1, Math.max(-1, values[0] + brightness)),
          Math.min(1, Math.max(-1, values[1] + brightness)),
          Math.min(1, Math.max(-1, values[2] + brightness)),
        ];
  if (!gamma && !active(lift) && !active(offset) && !active(gain)) {
    // El brillo solo no monta el shader por su cuenta; si la capa ya está
    // activa por otro efecto, se puede aplicar con las nueve perillas.
    if (!options.brightnessOnly || brightness === 0) return null;
    return { lift: tone([0, 0, 0]), offset: tone([0, 0, 0]), gain: tone([0, 0, 0]), gamma };
  }
  return { lift: tone(lift), offset: tone(offset), gain: tone(gain), gamma };
}

/** Chequeo liviano para decidir si la capa de efectos se monta. */
export function hasColorWheels(input: ColorWheelsInput | undefined): boolean {
  if (!input) return false;
  return [input.lift, input.offset, input.gain, input.gamma].some((values) =>
    values
      ? [values.r, values.g, values.b].some(
          (value) => Number.isFinite(value) && Math.abs(value as number) > 0.001,
        )
      : false,
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Referencia JS del `colorbalance` de FFmpeg (sin preserve_lightness). */
export function colorBalancePixel(
  rgb: readonly [number, number, number],
  lift: readonly [number, number, number],
  offset: readonly [number, number, number],
  gain: readonly [number, number, number],
): [number, number, number] {
  const l = Math.max(rgb[0], rgb[1], rgb[2]) + Math.min(rgb[0], rgb[1], rgb[2]);
  const a = 4;
  const b = 0.333;
  const scale = 0.7;
  const weightShadows = clamp01((b - l) * a + 0.5);
  const weightMids =
    clamp01((l - b) * a + 0.5) * clamp01((1 - l - b) * a + 0.5);
  const weightHighlights = clamp01((l + b - 1) * a + 0.5);
  return [0, 1, 2].map((index) =>
    clamp01(
      (rgb[index] ?? 0) +
        (lift[index]! * weightShadows +
          offset[index]! * weightMids +
          gain[index]! * weightHighlights) *
          scale,
    ),
  ) as unknown as [number, number, number];
}

/** Muestreo bilineal de la tabla gamma, igual que la textura del shader. */
export function sampleGamma(
  table: Uint8Array,
  channelIndex: number,
  value: number,
): number {
  const position = clamp01(value) * (CURVE_LUT_SIZE - 1);
  const lower = Math.floor(position);
  const upper = Math.min(CURVE_LUT_SIZE - 1, lower + 1);
  const fraction = position - lower;
  const a = table[lower * 4 + channelIndex]!;
  const b = table[upper * 4 + channelIndex]!;
  return (a + (b - a) * fraction) / 255;
}

/**
 * Ruedas + gamma sobre píxeles RGBA para el fallback 2D de imágenes (sin
 * WebGL). Mismo orden que el shader; el alfa no se toca.
 */
export function applyColorWheelsToPixels(
  wheels: ColorWheelsUniforms,
  data: Uint8ClampedArray,
): void {
  for (let index = 0; index + 3 < data.length; index += 4) {
    const base = colorBalancePixel(
      [data[index]! / 255, data[index + 1]! / 255, data[index + 2]! / 255],
      wheels.lift,
      wheels.offset,
      wheels.gain,
    );
    for (let channel = 0; channel < 3; channel += 1) {
      const value = wheels.gamma
        ? sampleGamma(wheels.gamma, channel, base[channel]!)
        : base[channel]!;
      data[index + channel] = Math.round(value * 255);
    }
  }
}
