import type {
  CaptionCue,
  CaptionMotion,
  CaptionMotionKeyframe,
  CaptionMotionPreset,
} from '@editor-ia/project-schema';

export interface CaptionMotionValues {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotationDeg: number;
  readonly opacity: number;
}

function valueAt(
  from: number | undefined,
  to: number | undefined,
  fallback: number,
  progress: number,
): number {
  const start = from ?? fallback;
  const end = to ?? from ?? fallback;
  return start + (end - start) * progress;
}

/**
 * Interpolates the two motion keyframes at a frame. Position is normalized to
 * the frame and scale is uniform, matching what the ASS renderer emits.
 */
export function captionMotionPreset(
  preset: CaptionMotionPreset,
  durationFrames: number,
): CaptionMotion {
  const end = Math.max(1, Math.round(durationFrames));
  const keyframe = (
    frame: number,
    values: Omit<CaptionMotionKeyframe, 'frame'>,
  ): CaptionMotionKeyframe => ({ frame, ...values });
  switch (preset) {
    case 'fade':
      return {
        preset,
        keyframes: [keyframe(0, { opacity: 0 }), keyframe(end, { opacity: 1 })],
      };
    case 'zoom':
      return {
        preset,
        keyframes: [
          keyframe(0, { scale: 0.85, opacity: 0 }),
          keyframe(end, { scale: 1, opacity: 1 }),
        ],
      };
    case 'slide-left':
      return {
        preset,
        keyframes: [
          keyframe(0, { x: -0.8, opacity: 0 }),
          keyframe(end, { x: 0, opacity: 1 }),
        ],
      };
    case 'slide-right':
      return {
        preset,
        keyframes: [
          keyframe(0, { x: 0.8, opacity: 0 }),
          keyframe(end, { x: 0, opacity: 1 }),
        ],
      };
    case 'zoom-out':
      return {
        preset,
        keyframes: [
          keyframe(0, { scale: 1, opacity: 1 }),
          keyframe(end, { scale: 1.15, opacity: 0 }),
        ],
      };
  }
}

export function captionMotionAt(
  cue: CaptionCue,
  playheadFrame: number,
): CaptionMotionValues | null {
  const keyframes = cue.motion?.keyframes;
  if (!keyframes || keyframes.length !== 2) return null;
  const from = keyframes[0];
  const to = keyframes[1];
  if (!from || !to) return null;
  const cueFrames = cue.endFrame - cue.startFrame;
  if (cueFrames <= 0) return null;
  const local = Math.max(
    0,
    Math.min(cueFrames, playheadFrame - cue.startFrame),
  );
  const span = to.frame - from.frame;
  const progress =
    span <= 0 ? 1 : Math.max(0, Math.min(1, (local - from.frame) / span));
  return {
    x: valueAt(from.x, to.x, 0, progress),
    y: valueAt(from.y, to.y, 0, progress),
    scale: valueAt(from.scale, to.scale, 1, progress),
    rotationDeg: valueAt(from.rotationDeg, to.rotationDeg, 0, progress),
    opacity: valueAt(from.opacity, to.opacity, 1, progress),
  };
}
