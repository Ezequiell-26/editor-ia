import type { AudioPeaks } from '../services/project-service';
import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import { fpsOf, rippleDeleteClip, splitClipAtFrames } from './project-actions';

/**
 * "Cortar silencios" automáticos (paridad CapCut): detecta los tramos de
 * silencio de un clip a partir de los picos de audio que ya mide FFmpeg y los
 * recorta con ripple, conservando el resto de la timeline intacta. Lógica
 * pura: la UI sólo llama a `planSilenceCuts` + `applySilenceCuts`.
 */

export interface SilenceCutOptions {
  /** Umbral en dBFS debajo del cual un bucket es silencio (por defecto −45). */
  readonly thresholdDb?: number;
  /** Duración mínima del silencio para recortarlo, en segundos (0,35). */
  readonly minSilenceSeconds?: number;
  /** Silencio que se conserva a cada lado del corte, en segundos (0,15). */
  readonly paddingSeconds?: number;
}

export interface SilenceSpan {
  /** Inicio del silencio en frames del ASSET (no del timeline). */
  readonly startFrame: number;
  /** Fin del silencio en frames del ASSET. */
  readonly endFrame: number;
}

export interface SilenceCutPlan {
  /** Frames absolutos de timeline donde hay que dividir el clip. */
  readonly cutFrames: readonly number[];
  /** Rangos de silencio mapeados a frames absolutos de timeline. */
  readonly spans: readonly SilenceSpan[];
  /** Segundos de silencio que se eliminarían. */
  readonly removedSeconds: number;
  /**
   * true cuando el plan eliminaría más del 80% del clip: con un umbral mal
   * puesto eso destruye la narración, así que `applySilenceCuts` lo rechaza.
   */
  readonly excessive: boolean;
}

const AMPLITUDE_FLOOR_DB = -120;

function bucketDb(amplitude: number): number {
  if (amplitude <= 0) return AMPLITUDE_FLOOR_DB;
  return 20 * Math.log10(amplitude);
}

/**
 * Detecta los tramos de silencio del asset a partir de sus picos. Los rangos
 * resultantes están en frames del archivo de origen (no del timeline) porque
 * los picos miden el asset completo, no el tramo que usa el clip.
 */
export function detectSilences(
  peaks: AudioPeaks,
  fps: number,
  options: SilenceCutOptions = {},
): SilenceSpan[] {
  const thresholdDb = options.thresholdDb ?? -45;
  const minSilenceSeconds = options.minSilenceSeconds ?? 0.35;
  const paddingSeconds = options.paddingSeconds ?? 0.15;
  if (peaks.peaks.length === 0 || !Number.isFinite(fps) || fps <= 0) return [];

  const bucketSeconds = peaks.durationSeconds / peaks.buckets;
  const bucketFrames = bucketSeconds * fps;
  const spans: SilenceSpan[] = [];
  let silentFrom: number | null = null;
  for (let index = 0; index <= peaks.peaks.length; index += 1) {
    const bucket = peaks.peaks[index];
    const isSilent =
      bucket !== undefined &&
      bucketDb(Math.max(Math.abs(bucket.min), Math.abs(bucket.max))) < thresholdDb;
    if (isSilent && silentFrom === null) {
      silentFrom = index;
    }
    if (!isSilent && silentFrom !== null) {
      spans.push({ startFrame: silentFrom * bucketFrames, endFrame: index * bucketFrames });
      silentFrom = null;
    }
  }
  const paddingFrames = paddingSeconds * fps;
  const minSilenceFrames = minSilenceSeconds * fps;
  return spans
    .filter((span) => span.endFrame - span.startFrame >= minSilenceFrames)
    .map((span) => ({
      startFrame: span.startFrame + paddingFrames,
      endFrame: span.endFrame - paddingFrames,
    }))
    .filter((span) => span.endFrame > span.startFrame);
}

function toTimelineRange(
  span: SilenceSpan,
  clip: { startFrame: number; durationFrames: number; inFrame: number },
): SilenceSpan {
  const start = Math.max(0, Math.min(clip.durationFrames, span.startFrame - clip.inFrame));
  const end = Math.max(0, Math.min(clip.durationFrames, span.endFrame - clip.inFrame));
  return { startFrame: clip.startFrame + start, endFrame: clip.startFrame + end };
}

/** Frame de origen donde empieza el clip dentro de su asset (0 si no aplica). */
function sourceInFrame(clip: Clip): number {
  const source = (clip as { source?: { inFrame?: unknown } }).source;
  const value = source && typeof source === 'object' ? source.inFrame : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Arma el plan de recorte para un clip: mapea los silencios del asset al
 * rango que el clip realmente usa (inFrame/outFrame) y devuelve los frames
 * absolutos de división. Sin silencios útiles devuelve null.
 */
export function planSilenceCuts(
  clip: Clip,
  peaks: AudioPeaks,
  fps: number,
  options: SilenceCutOptions = {},
): SilenceCutPlan | null {
  const assetSpans = detectSilences(peaks, fps, options);
  if (assetSpans.length === 0) return null;
  const rango = {
    startFrame: clip.startFrame,
    durationFrames: clip.durationFrames,
    inFrame: sourceInFrame(clip),
  };
  const spans = assetSpans
    .map((span) => toTimelineRange(span, rango))
    .filter((span) => span.endFrame > span.startFrame + 1);
  if (spans.length === 0) return null;

  const cutFrames = [
    ...new Set(spans.flatMap((span) => [Math.round(span.startFrame), Math.round(span.endFrame)])),
  ]
    .filter((frame) => frame > clip.startFrame && frame < clip.startFrame + clip.durationFrames)
    .sort((a, b) => a - b);
  if (cutFrames.length === 0) return null;

  const removedFrames = spans.reduce((total, span) => total + (span.endFrame - span.startFrame), 0);
  const removedSeconds = removedFrames / fps;
  const clipSeconds = clip.durationFrames / fps;
  return {
    cutFrames,
    spans,
    removedSeconds,
    excessive: removedSeconds > clipSeconds * 0.8,
  };
}

/**
 * Ejecuta el plan: divide el clip en los bordes de cada silencio y elimina con
 * ripple los tramos que caen dentro de ellos. Respeta las reglas del repo
 * (pistas bloqueadas, clips compuestos) a través de las acciones existentes.
 * Devuelve el proyecto sin tocar si el plan está vacío o es excesivo.
 */
export function applySilenceCuts(
  project: ProjectDocument,
  clipId: string,
  plan: SilenceCutPlan,
): ProjectDocument {
  if (plan.excessive || plan.spans.length === 0 || plan.cutFrames.length === 0) {
    return project;
  }
  const split = splitClipAtFrames(project, clipId, plan.cutFrames);
  if (!split) return project;

  const pieces = split.project.timeline.clips.filter((clip) =>
    split.clipIds.includes(clip.id),
  );
  let next = split.project;
  for (const piece of pieces) {
    const center = piece.startFrame + piece.durationFrames / 2;
    const insideSilence = plan.spans.some(
      (span) => center >= span.startFrame && center <= span.endFrame,
    );
    if (insideSilence) {
      next = rippleDeleteClip(next, piece.id);
    }
  }
  return next;
}

/** Conveniencia para la UI: fps del proyecto + plan en una llamada. */
export function planSilenceCutsForProject(
  project: ProjectDocument,
  clipId: string,
  peaks: AudioPeaks,
  options: SilenceCutOptions = {},
): SilenceCutPlan | null {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return null;
  return planSilenceCuts(clip, peaks, fpsOf(project), options);
}
