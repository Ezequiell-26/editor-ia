/**
 * Movimiento de foto en la preview (CSS transform). Las mismas fórmulas las
 * usa Preview para cada capa; el export las replica con `zoompan`. Al ser
 * lineales en la intensidad, dos capas con intensidades distintas producen
 * parallax relativo.
 */
import type { ClipMotion } from '@editor-ia/project-schema';

export interface PreviewMotion {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export function motionPreview(motion: ClipMotion, progress: number): PreviewMotion {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const intensity = motion.intensity ?? 0.12;
  if (motion.type === 'zoom-in') {
    return { scale: 1 + intensity * clamped, x: 0, y: 0 };
  }
  if (motion.type === 'zoom-out') {
    return { scale: 1 + intensity * (1 - clamped), x: 0, y: 0 };
  }
  const scale = 1 + intensity;
  if (motion.type === 'pan-left') {
    return { scale, x: (0.5 - clamped) * intensity * 50, y: 0 };
  }
  if (motion.type === 'pan-right') {
    return { scale, x: (clamped - 0.5) * intensity * 50, y: 0 };
  }
  if (motion.type === 'pan-up') {
    return { scale, x: 0, y: (0.5 - clamped) * intensity * 50 };
  }
  return { scale, x: 0, y: (clamped - 0.5) * intensity * 50 };
}
