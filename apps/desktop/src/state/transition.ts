import type { Clip, ClipTransition } from '@editor-ia/project-schema';

/**
 * Live-preview mirror of the Rust `transition_lead_seconds` rule: a transition
 * may overlap at most its own frames, the incoming clip, the space before it
 * and two seconds. The export, the native frame and the preview must all use
 * the same window or the cut lands on a different frame.
 */
export const MAX_TRANSITION_SECONDS = 2;

export interface TransitionSample {
  /** Overlap window in frames, measured backwards from the clip start. */
  readonly leadFrames: number;
  /** 0 at the start of the lead, 1 at the clip's nominal start. */
  readonly progress: number;
  readonly opacity: number;
  readonly translateXPercent: number;
  readonly translateYPercent: number;
  readonly clipPath?: string;
  readonly filter?: string;
}

export function transitionOf(clip: Clip): ClipTransition | undefined {
  const value = 'transitionIn' in clip ? clip.transitionIn : undefined;
  return value && value.type && value.frames > 0 ? value : undefined;
}

export function transitionLeadFrames(clip: Clip, fps: number): number {
  const transition = transitionOf(clip);
  if (!transition) return 0;
  if (!['video', 'image', 'freeze'].includes(clip.kind)) return 0;
  const seconds = transition.frames / Math.max(1, fps);
  const lead = Math.min(
    seconds,
    clip.durationFrames / Math.max(1, fps),
    clip.startFrame / Math.max(1, fps),
    MAX_TRANSITION_SECONDS,
  );
  return Math.max(0, lead) * Math.max(1, fps);
}

function eased(progress: number, easing: ClipTransition['easing']): number {
  switch (easing) {
    case 'ease-in':
      return progress ** 3;
    case 'ease-out':
      return 1 - (1 - progress) ** 3;
    case 'ease-in-out':
      return progress * progress * (3 - 2 * progress);
    case 'hold':
      return 0;
    case 'linear':
    default:
      return progress;
  }
}

function fraction(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function percent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function transitionSample(
  clip: Clip,
  playheadFrame: number,
  fps: number,
): TransitionSample | null {
  const transition = transitionOf(clip);
  if (!transition) return null;
  const leadFrames = transitionLeadFrames(clip, fps);
  if (leadFrames <= 0.001) return null;
  const from = clip.startFrame - leadFrames;
  if (playheadFrame < from || playheadFrame >= clip.startFrame) return null;
  const progress = eased(
    Math.max(0, Math.min(1, (playheadFrame - from) / leadFrames)),
    transition.easing,
  );
  const remaining = 1 - progress;
  const sample = {
    leadFrames,
    progress,
    opacity: 1,
    translateXPercent: 0,
    translateYPercent: 0,
  };
  switch (transition.type) {
    case 'dissolve':
      return { ...sample, opacity: progress };
    case 'fade-black':
      return { ...sample, filter: `brightness(${fraction(progress)})` };
    case 'fade-white':
      // invert → dim → invert mixes every channel towards white while keeping
      // the layer opaque, matching the export's affine white fade.
      return { ...sample, filter: `invert(1) brightness(${fraction(progress)}) invert(1)` };
    case 'slide-left':
      return { ...sample, translateXPercent: percent(remaining * 100) };
    case 'slide-right':
      return { ...sample, translateXPercent: -percent(remaining * 100) };
    case 'slide-up':
      return { ...sample, translateYPercent: percent(remaining * 100) };
    case 'slide-down':
      return { ...sample, translateYPercent: -percent(remaining * 100) };
    case 'wipe-left':
      return { ...sample, clipPath: `inset(0% ${percent(remaining * 100)}% 0% 0%)` };
    case 'wipe-right':
      return { ...sample, clipPath: `inset(0% 0% 0% ${percent(remaining * 100)}%)` };
    case 'wipe-up':
      return { ...sample, clipPath: `inset(${percent(remaining * 100)}% 0% 0% 0%)` };
    case 'wipe-down':
      return { ...sample, clipPath: `inset(0% 0% ${percent(remaining * 100)}% 0%)` };
    case 'iris':
      // El radio del círculo usa la base de porcentaje de CSS (diagonal/√2),
      // así que 70,7 % equivale a la mitad de la diagonal y cubre las esquinas,
      // igual que el radio de `hypot(W/2,H/2)` del export.
      return {
        ...sample,
        clipPath: `circle(${percent(progress * Math.SQRT1_2 * 100)}% at 50% 50%)`,
      };
    default:
      return null;
  }
}
