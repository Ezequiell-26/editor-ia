import type { AudioPeaks } from '../services/project-service';
import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import { fpsOf, removeCaptionRange, rippleDeleteClip, splitClipAtFrames } from './project-actions';

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
 * Plan mínimo para cortar tramos: lo comparten el detector de silencios y el
 * de pausas de voz. `cutFrames` son frames absolutos de timeline; `spans` son
 * los tramos que se eliminan con ripple.
 */
export interface CutSpanPlan {
  readonly cutFrames: readonly number[];
  readonly spans: readonly { readonly startFrame: number; readonly endFrame: number }[];
  readonly removedSeconds: number;
  readonly excessive: boolean;
}

/**
 * Ejecuta el plan: divide el clip en los bordes de cada tramo y elimina con
 * ripple los que caen dentro de ellos. Respeta las reglas del repo (pistas
 * bloqueadas, clips compuestos) a través de las acciones existentes.
 * Devuelve el proyecto sin tocar si el plan está vacío o es excesivo.
 */
export function applyCutSpans(
  project: ProjectDocument,
  clipId: string,
  plan: CutSpanPlan,
): ProjectDocument {
  if (plan.excessive || plan.spans.length === 0 || plan.cutFrames.length === 0) {
    return project;
  }
  const split = splitClipAtFrames(project, clipId, plan.cutFrames);
  if (!split) return project;

  const pieces = split.project.timeline.clips.filter((clip) =>
    split.clipIds.includes(clip.id),
  );
  // Qué piezas caen dentro de un tramo se decide con las coordenadas del plan
  // (las originales). Al borrar, cada ripple corre a las siguientes: `shift`
  // lleva esa cuenta para recortar los subtítulos en la posición correcta.
  const doomed = pieces.filter((piece) => {
    const center = piece.startFrame + piece.durationFrames / 2;
    return plan.spans.some((span) => center >= span.startFrame && center <= span.endFrame);
  });
  let next = split.project;
  let shift = 0;
  for (const piece of doomed) {
    const start = piece.startFrame - shift;
    const end = start + piece.durationFrames;
    next = rippleDeleteClip(next, piece.id);
    next = removeCaptionRange(next, start, end);
    shift += piece.durationFrames;
  }
  return next;
}

/**
 * Ejecuta el plan de silencios. Se mantiene el nombre porque es el que usa la
 * UI; la implementación es la misma que la de cualquier otro corte por tramos.
 */
export function applySilenceCuts(
  project: ProjectDocument,
  clipId: string,
  plan: SilenceCutPlan,
): ProjectDocument {
  return applyCutSpans(project, clipId, plan);
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

/** Factor de velocidad del clip; 1 cuando no declara `speed`. */
function speedFactorOf(clip: Clip): number {
  const speed = 'speed' in clip ? clip.speed : undefined;
  if (!speed) return 1;
  return speed.num / Math.max(1, speed.den);
}

/**
 * Clips que el motor puede cortar sin inventar frames.
 *
 * Excluye lo que el mapeo de silencios no puede representar: clips sin asset
 * (compuestos, gráficos), pistas bloqueadas y clips a velocidad distinta de 1×
 * (los picos miden el asset, no el tiempo estirado).
 */
export function silenceCutCandidates(
  project: ProjectDocument,
  clipIds?: readonly string[],
): Clip[] {
  if (!(fpsOf(project) > 0)) return [];
  const wanted = clipIds ? new Set(clipIds) : null;
  return project.timeline.clips.filter((clip) => {
    if (wanted && !wanted.has(clip.id)) return false;
    if (clip.kind !== 'video' && clip.kind !== 'audio') return false;
    if (clip.source.type !== 'asset') return false;
    if (Math.abs(speedFactorOf(clip) - 1) > 0.001) return false;
    const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
    if (track?.locked === true) return false;
    return true;
  });
}

export interface SilenceCutTarget {
  readonly clipId: string;
  readonly peaks: AudioPeaks;
}

export interface SilenceCutOutcome {
  readonly project: ProjectDocument;
  readonly clips: number;
  readonly cuts: number;
  readonly removedSeconds: number;
}

/**
 * Aplica el corte sobre varios clips, rearmando el plan contra el proyecto
 * vigente en cada paso: el ripple de un clip corre a los siguientes de la
 * misma pista y un plan viejo cortaría en frames equivocados.
 *
 * Un plan excesivo (>80 % del clip) se saltea en lugar de destruir la toma.
 */
export function applySilenceCutsToTargets(
  project: ProjectDocument,
  targets: readonly SilenceCutTarget[],
  options: SilenceCutOptions = {},
): SilenceCutOutcome {
  let next = project;
  let clips = 0;
  let cuts = 0;
  let removedSeconds = 0;
  for (const target of targets) {
    const fresh = planSilenceCutsForProject(next, target.clipId, target.peaks, options);
    if (!fresh || fresh.excessive) continue;
    const after = applySilenceCuts(next, target.clipId, fresh);
    if (after === next) continue;
    clips += 1;
    cuts += fresh.spans.length;
    removedSeconds += fresh.removedSeconds;
    next = after;
  }
  return { project: next, clips, cuts, removedSeconds };
}

export interface SilenceCutRunOptions extends SilenceCutOptions {
  /** Si se omite, se analizan todos los clips con audio del proyecto. */
  readonly clipIds?: readonly string[] | undefined;
}

export interface SilenceCutRunResult extends SilenceCutOutcome {
  /** Clips que el motor podía cortar antes de pedir picos. */
  readonly candidates: number;
  /** Clips descartados porque el asset no tenía picos medibles. */
  readonly skipped: number;
}

/**
 * Orquesta el corte completo: elige candidatos, pide los picos al servicio con
 * caché por asset y aplica en lote. Es el camino que comparten la UI y la IA,
 * para que un comando del asistente y un clic del menú hagan exactamente lo
 * mismo.
 */
export async function runSilenceCuts(
  project: ProjectDocument,
  fetchPeaks: (assetId: string) => Promise<AudioPeaks>,
  options: SilenceCutRunOptions = {},
): Promise<SilenceCutRunResult> {
  const candidates = silenceCutCandidates(project, options.clipIds);
  const cache = new Map<string, AudioPeaks | null>();
  const targets: SilenceCutTarget[] = [];
  let skipped = 0;
  for (const clip of candidates) {
    if (clip.source.type !== 'asset') continue;
    const assetId = clip.source.assetId;
    let peaks = cache.get(assetId);
    if (peaks === undefined) {
      try {
        peaks = await fetchPeaks(assetId);
      } catch {
        peaks = null;
      }
      cache.set(assetId, peaks);
    }
    if (!peaks) {
      skipped += 1;
      continue;
    }
    targets.push({ clipId: clip.id, peaks });
  }
  const applied = applySilenceCutsToTargets(project, targets, options);
  return { ...applied, candidates: candidates.length, skipped };
}
