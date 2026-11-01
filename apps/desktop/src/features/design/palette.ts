/**
 * Extracción local de paleta desde una imagen. No usa red ni modelos: agrupa
 * píxeles por cubos RGB, promedia cada grupo y elige los colores dominantes
 * con un acento legible. Es la parte visual de design-extract que se puede
 * hacer de forma determinista y offline.
 */
export interface ExtractedPalette {
  readonly colors: readonly string[];
  readonly accent: string;
  readonly accentOn: string;
  readonly bg: string;
  readonly fg: string;
}

interface Bucket {
  count: number;
  r: number;
  g: number;
  b: number;
}

function channel(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function components(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function luminance(hex: string): number {
  const values = components(hex);
  const r = values[0]! / 255;
  const g = values[1]! / 255;
  const b = values[2]! / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(hex: string): number {
  const values = components(hex);
  const r = values[0]! / 255;
  const g = values[1]! / 255;
  const b = values[2]! / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  if (max === min) return 0;
  return light > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function distance(a: string, b: string): number {
  const first = components(a);
  const second = components(b);
  const ar = first[0]!;
  const ag = first[1]!;
  const ab = first[2]!;
  const br = second[0]!;
  const bg = second[1]!;
  const bb = second[2]!;
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

export function extractPalette(
  data: Uint8ClampedArray,
  maxColors = 5,
): ExtractedPalette {
  const buckets = new Map<number, Bucket>();
  const stride = Math.max(4, Math.floor(data.length / 4 / 30_000) * 4);
  for (let index = 0; index + 3 < data.length; index += stride) {
    const alpha = data[index + 3]!;
    if (alpha < 128) continue;
    const r = data[index]!;
    const g = data[index + 1]!;
    const b = data[index + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }
  const candidates = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 28)
    .map((bucket) => ({
      count: bucket.count,
      hex: rgbToHex(
        bucket.r / bucket.count,
        bucket.g / bucket.count,
        bucket.b / bucket.count,
      ),
    }));
  const merged: { count: number; hex: string }[] = [];
  for (const candidate of candidates) {
    const close = merged.find((entry) => distance(entry.hex, candidate.hex) < 30);
    if (close) {
      close.count += candidate.count;
    } else {
      merged.push({ ...candidate });
    }
  }
  merged.sort((a, b) => b.count - a.count);
  const colors = merged.slice(0, Math.max(1, maxColors)).map((entry) => entry.hex);
  return paletteFromColors(colors);
}

export function paletteFromColors(colorsInput: readonly string[]): ExtractedPalette {
  const colors = [...new Set(
    colorsInput
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^#[0-9a-f]{6}$/.test(value)),
  )];
  if (colors.length === 0) {
    return {
      colors: ['#5b8cff'],
      accent: '#5b8cff',
      accentOn: '#ffffff',
      bg: '#0b1118',
      fg: '#f5f7fb',
    };
  }
  const sortedByLight = [...colors].sort((a, b) => luminance(a) - luminance(b));
  let bg = sortedByLight[sortedByLight.length - 1]!;
  let fg = sortedByLight[0]!;
  if (contrast(bg, fg) < 4.5) {
    fg = luminance(bg) > 0.5 ? '#111111' : '#f7f7f7';
  }
  const accent =
    [...colors]
      .filter((color) => saturation(color) >= 0.16 && luminance(color) > 0.02 && luminance(color) < 0.95)
      .sort((a, b) => saturation(b) - saturation(a))[0] ??
    colors.reduce((best, color) => (distance(color, bg) > distance(best, bg) ? color : best), colors[0]!);
  const accentOn = contrast(accent, '#ffffff') >= contrast(accent, '#111111')
    ? '#ffffff'
    : '#111111';
  return { colors, accent, accentOn, bg, fg };
}
