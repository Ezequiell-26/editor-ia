import type { ClipEffects, ClipMotion } from '@editor-ia/project-schema';

/** Automatic photo movement used by the assembly flows. */
export type AutoPhotoMotion = 'auto' | 'none';

export const DEFAULT_MOTION_INTENSITY = 0.12;

const MOTION_CYCLE = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'] as const;

/**
 * Alternate motion so a slideshow does not repeat the same move. The cycle is
 * deterministic: the same photo order always yields the same edit.
 */
export function automaticPhotoMotion(index: number): ClipMotion {
  const type = MOTION_CYCLE[Math.abs(index) % MOTION_CYCLE.length] ?? 'zoom-in';
  return { type, intensity: DEFAULT_MOTION_INTENSITY };
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
