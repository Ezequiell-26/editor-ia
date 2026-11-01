import type { ClipEffects, ClipMotion } from '@editor-ia/project-schema';

/** Automatic photo movement used by the assembly flows. */
export type AutoPhotoMotion = 'auto' | 'none';

export const DEFAULT_MOTION_INTENSITY = 0.12;

const MOTION_CYCLE = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'] as const;

/**
 * Alternate motion so a slideshow does not repeat the same move. The cycle is
 * deterministic: the same photo order always yields the same edit.
 *
 * Con las medidas de la foto y del encuadre, el movimiento se elige por lo que
 * sobra de imagen: una foto apaisada en un encuadre vertical se recorre en
 * horizontal (paneo) en vez de hacerle zoom, y una foto vertical en un encuadre
 * apaisado se recorre en vertical. Si la relación es parecida, alterna zoom.
 */
export interface PhotoMotionInput {
  readonly index: number;
  readonly imageWidth?: number;
  readonly imageHeight?: number;
  readonly frameWidth?: number;
  readonly frameHeight?: number;
  readonly intensity?: number;
}

/** Cuánto puede diferir la relación de aspecto antes de tratarla como distinta. */
const ASPECT_TOLERANCE = 1.15;

export function automaticPhotoMotion(indexOrInput: number | PhotoMotionInput): ClipMotion {
  const input: PhotoMotionInput =
    typeof indexOrInput === 'number' ? { index: indexOrInput } : indexOrInput;
  const index = Math.abs(input.index);
  const intensity = input.intensity ?? DEFAULT_MOTION_INTENSITY;
  const imageWidth = input.imageWidth;
  const imageHeight = input.imageHeight;
  const frameWidth = input.frameWidth;
  const frameHeight = input.frameHeight;
  const measurable =
    imageWidth !== undefined &&
    imageHeight !== undefined &&
    frameWidth !== undefined &&
    frameHeight !== undefined &&
    imageWidth > 0 &&
    imageHeight > 0 &&
    frameWidth > 0 &&
    frameHeight > 0;
  if (!measurable) {
    const type = MOTION_CYCLE[index % MOTION_CYCLE.length] ?? 'zoom-in';
    return { type, intensity };
  }
  const imageAspect = imageWidth / imageHeight;
  const frameAspect = frameWidth / frameHeight;
  const even = index % 2 === 0;
  if (imageAspect > frameAspect * ASPECT_TOLERANCE) {
    return { type: even ? 'pan-right' : 'pan-left', intensity };
  }
  if (imageAspect * ASPECT_TOLERANCE < frameAspect) {
    return { type: even ? 'pan-down' : 'pan-up', intensity };
  }
  return { type: even ? 'zoom-in' : 'zoom-out', intensity };
}

/**
 * Fade-in/out around each photo. Clamped to half the clip so a short photo can
 * never produce overlapping fades; zero disables the transition entirely.
 */
export function photoTransitionEffects(
  fadeFrames: number,
  durationFrames: number,
): ClipEffects | undefined {
  const requested = Number.isFinite(fadeFrames) ? Math.floor(fadeFrames) : 0;
  const frames = Math.max(0, Math.min(requested, Math.floor(durationFrames / 2)));
  if (frames < 1) return undefined;
  return { fadeInFrames: frames, fadeOutFrames: frames };
}
