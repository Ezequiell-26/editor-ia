import type { GradeQualifier, PowerWindow } from '@editor-ia/project-schema';

/**
 * Real per-pixel keying for the Color studio viewer.
 *
 * The generated PNG is used as `mask-image` on the graded layer, so the
 * correction is genuinely limited to the keyed colour range / power windows —
 * it is not a decorative overlay. `trackKeyCentroid` performs an actual
 * centroid measurement on the live frame so window tracking is real too.
 */

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta < 1e-6) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1) || 1);
  let h = 0;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h = (h / 6 + 1) % 1;
  return { h, s: clamp01(s), l };
}

function smoothBand(value: number, min: number, max: number, feather: number): number {
  const edge = Math.max(0.001, feather * 0.25 + 0.01);
  // `+ edge` keeps both boundaries inclusive: a fully saturated pixel must
  // pass satMax=1, and a black pixel must pass lumMin=0.
  const lower = clamp01((value - min + edge) / edge);
  const upper = clamp01((max - value + edge) / edge);
  return Math.min(lower, upper);
}

function pointInPolygon(x: number, y: number, points: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-6) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function windowWeight(window: PowerWindow, x: number, y: number): number {
  const cx = clamp01(window.x + window.dx);
  const cy = clamp01(window.y + window.dy);
  const feather = Math.max(0.01, window.feather * 0.5);
  if (window.kind === 'gradient') {
    // Linear ramp along X: left fully graded, right untouched.
    return clamp01((window.x + window.width / 2 + 0.5 - x) / Math.max(0.05, window.width + feather));
  }
  if (window.kind === 'polygon' && window.points && window.points.length >= 3) {
    return pointInPolygon(x, y, window.points) ? 1 : 0;
  }
  const nx = Math.abs(x - cx) / Math.max(0.01, window.width / 2);
  const ny = Math.abs(y - cy) / Math.max(0.01, window.height / 2);
  const distance = window.kind === 'circle'
    ? Math.hypot(nx, ny)
    : Math.max(nx, ny);
  return clamp01((1 - distance) / feather);
}

/** Compute the mask weight for a single pixel. Exported for unit tests. */
export function gradeMaskWeight(
  r: number, g: number, b: number,
  x: number, y: number,
  qualifier: GradeQualifier,
  windows: readonly PowerWindow[],
): number {
  const { h, s, l } = rgbToHsl(r / 255, g / 255, b / 255);
  let weight = 1;
  if (qualifier.enabled) {
    const hueTarget = qualifier.hue;
    const distance = Math.min(Math.abs(h - hueTarget), 1 - Math.abs(h - hueTarget));
    const hueWidth = Math.max(0.005, qualifier.hueWidth / 2);
    const hueWeight = clamp01(1 - (distance - hueWidth) / Math.max(0.01, qualifier.feather * 0.2 + 0.01));
    const band = hueWeight
      * smoothBand(s, qualifier.satMin, qualifier.satMax, qualifier.feather)
      * smoothBand(l, qualifier.lumMin, qualifier.lumMax, qualifier.feather);
    weight = qualifier.invert ? 1 - band : band;
  }
  const active = windows.filter((window) => window.enabled);
  if (active.length > 0) {
    let spatial = 0;
    for (const window of active) spatial = Math.max(spatial, windowWeight(window, x, y));
    weight *= spatial;
  }
  return clamp01(weight);
}

export interface MaskResult {
  readonly url: string;
  readonly centroid: { x: number; y: number } | null;
}

/** Build a mask PNG from a still frame (data URL) and return its centroid. */
export function buildGradeMask(
  image: HTMLImageElement | HTMLVideoElement,
  qualifier: GradeQualifier,
  windows: readonly PowerWindow[],
  width = 160,
  height = 90,
): MaskResult | null {
  if (!qualifier.enabled && windows.every((window) => !window.enabled)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, width, height);
    const frame = context.getImageData(0, 0, width, height);
    const out = context.createImageData(width, height);
    let sumX = 0;
    let sumY = 0;
    let total = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const weight = gradeMaskWeight(
          frame.data[index]!, frame.data[index + 1]!, frame.data[index + 2]!,
          x / (width - 1), y / (height - 1), qualifier, windows,
        );
        const alpha = Math.round(weight * 255);
        out.data[index] = 255;
        out.data[index + 1] = 255;
        out.data[index + 2] = 255;
        out.data[index + 3] = alpha;
        sumX += (x / (width - 1)) * weight;
        sumY += (y / (height - 1)) * weight;
        total += weight;
      }
    }
    context.putImageData(out, 0, 0);
    return {
      url: canvas.toDataURL('image/png'),
      centroid: total > 0.5 ? { x: sumX / total, y: sumY / total } : null,
    };
  } catch {
    // A tainted canvas (unexpected media origin) degrades to "no mask".
    return null;
  }
}

/** Load a data-URL still into an Image element. */
export function loadStill(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('no se pudo cargar el fotograma'));
    image.src = src;
  });
}

/** The live preview media element, if the editor has one on screen. */
export function livePreviewMedia(): HTMLVideoElement | HTMLImageElement | null {
  const elements = document.querySelectorAll<HTMLVideoElement | HTMLImageElement>('.preview-stage .preview-media');
  const source = elements[elements.length - 1] ?? null;
  if (!source) return null;
  if (source.tagName === 'IMG') {
    const img = source as HTMLImageElement;
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
  const video = source as HTMLVideoElement;
  return video.readyState >= 2 && video.videoWidth > 0 ? video : null;
}
