import type { Clip, ProjectDocument } from '@editor-ia/project-schema';

/**
 * «Exportar clip como Short»: convierte la ventana de fuente de un clip de
 * video en un pedido para `export_short` (vertical 1080×1920, smart reframe
 * opcional). Es el mismo camino que usa Director → Shorts, pero arrancando
 * desde un clip ya editado en la timeline.
 *
 * Límites honestos:
 * - Exporta el footage fuente del clip (inFrame..outFrame), no el clip
 *   compuesto: overlays, textos y efectos de la timeline no viajan al short.
 * - Sólo clips de video con fuente de asset, velocidad 1× y sin reverse:
 *   con speed/reverse la ventana fuente no coincide con lo que se ve.
 * - El rango debe entrar en los límites de `export_short` (3–90 s).
 */

export const SHORT_MIN_SECONDS = 3;
export const SHORT_MAX_SECONDS = 90;

export interface ClipShortRange {
  readonly assetPath: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly label: string;
}

export type ClipShortEligibility =
  | { readonly ok: true; readonly range: ClipShortRange }
  | { readonly ok: false; readonly reason: string };

function clipSpeed(clip: Clip): number {
  const speed = 'speed' in clip ? clip.speed : undefined;
  return speed ? speed.num / Math.max(1, speed.den) : 1;
}

function isReversed(clip: Clip): boolean {
  return 'reverse' in clip && clip.reverse === true;
}

export interface ClipRangeLimits {
  readonly minSeconds: number;
  readonly maxSeconds: number;
  /** Sustantivo para el mensaje de error («un short» por defecto). */
  readonly noun?: string;
}

const SHORT_LIMITS: ClipRangeLimits = {
  minSeconds: SHORT_MIN_SECONDS,
  maxSeconds: SHORT_MAX_SECONDS,
};

/** Límites de `analyze_face_track` en Rust (FACE_MIN/FACE_MAX_SECONDS). */
export const FACE_TRACK_LIMITS: ClipRangeLimits = {
  minSeconds: 0.1,
  maxSeconds: 600,
  noun: 'el análisis de rostros',
};

export function clipShortExportRange(
  project: ProjectDocument,
  clip: Clip,
  limits: ClipRangeLimits = SHORT_LIMITS,
): ClipShortEligibility {
  if (clip.kind !== 'video') {
    return { ok: false, reason: 'sólo los clips de video se exportan como short' };
  }
  const source = clip.source;
  if (source.type !== 'asset' || !('inFrame' in source)) {
    return { ok: false, reason: 'el clip no tiene una ventana de fuente exportable' };
  }
  if (isReversed(clip)) {
    return { ok: false, reason: 'los clips invertidos no se pueden exportar como short' };
  }
  const speed = clipSpeed(clip);
  if (Math.abs(speed - 1) > 0.001) {
    return { ok: false, reason: 'los clips con velocidad ≠1× no se pueden exportar como short' };
  }
  const asset = project.assets.find((item) => item.id === source.assetId);
  const assetPath = asset?.source?.path;
  if (!assetPath) {
    return { ok: false, reason: 'el clip apunta a un medio que ya no está en el proyecto' };
  }
  const fps = project.video.frameRate.num / Math.max(1, project.video.frameRate.den);
  if (!(fps > 0)) {
    return { ok: false, reason: 'el proyecto no tiene una tasa de frames válida' };
  }
  const startSeconds = source.inFrame / fps;
  const endSeconds = source.outFrame / fps;
  const duration = endSeconds - startSeconds;
  const noun = limits.noun ?? 'un short';
  if (
    startSeconds < 0 ||
    !(duration >= limits.minSeconds && duration <= limits.maxSeconds)
  ) {
    return {
      ok: false,
      reason: `${noun} debe durar entre ${limits.minSeconds} y ${limits.maxSeconds} segundos`,
    };
  }
  return {
    ok: true,
    range: {
      assetPath,
      startSeconds,
      endSeconds,
      label: clip.label ?? 'clip',
    },
  };
}
