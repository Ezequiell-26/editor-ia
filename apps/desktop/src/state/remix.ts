import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks } from '../services/project-service';
import { detectSilences, applyCutSpans, type CutSpanPlan } from './silence-cuts';
import { fpsOf } from './project-actions';

/**
 * Remix (paridad Premiere "Remix"): acorta UN clip a una duración objetivo
 * conservando los tramos con más voz/energía y eliminando el resto con
 * ripple. No es "cortar silencios" (eso saca todo lo callado): elige qué
 * partes QUEDAN según cuánto habla o suena cada ventana.
 *
 * Reglas honestas:
 * - Sin transcripción NI picos de audio no hay señal para decidir → null.
 * - La transcripción llega en segundos del ASSET completo; los bordes de
 *   chunk se ajustan a los bordes de frase (±`snapSeconds`) para no cortar
 *   palabras a la mitad.
 * - El primer y el último chunk siempre quedan (apertura y cierre).
 * - Sólo clips de video/audio con fuente asset y velocidad 1× (misma
 *   guarda que `silenceCutCandidates`).
 */

export interface RemixSpeechSegment {
  /** Segundos desde el inicio del ASSET (no del clip ni del timeline). */
  readonly start: number;
  readonly end: number;
}

export interface RemixOptions {
  /** Duración objetivo del clip resultante, en segundos. */
  readonly targetSeconds: number;
  /** Segmentos de habla del asset completo (transcripción), si existe. */
  readonly speech?: readonly RemixSpeechSegment[] | null;
  /** Picos de audio del asset completo, si existe (respaldo sin transcripción). */
  readonly peaks?: AudioPeaks | null;
  /** Tamaño base de cada ventana candidata, en segundos (default 3). */
  readonly chunkSeconds?: number;
  /** Distancia máxima para ajustar un borde de chunk a una frase (default 0.6 s). */
  readonly snapSeconds?: number;
}

export interface RemixSpan {
  readonly startFrame: number;
  readonly endFrame: number;
}

export interface RemixPlan {
  /** Tramos (frames de timeline) que se CONSERVAN, en orden. */
  readonly keepSpans: readonly RemixSpan[];
  /** Plan de eliminación listo para `applyCutSpans` (el complemento). */
  readonly removePlan: CutSpanPlan;
  readonly keptSeconds: number;
  readonly removedSeconds: number;
  readonly keptChunks: number;
  readonly totalChunks: number;
}

/** Frame de origen donde empieza el clip dentro de su asset (0 si no aplica). */
function sourceInFrame(clip: Clip): number {
  const source = (clip as { source?: { inFrame?: unknown } }).source;
  const value = source && typeof source === 'object' ? source.inFrame : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Segundos de asset → frames de timeline del clip (misma convención que silence-cuts). */
function assetSecondsToTimeline(
  seconds: number,
  clip: { startFrame: number; durationFrames: number; inFrame: number },
  fps: number,
): number {
  const assetFrame = seconds * fps;
  const local = Math.max(0, Math.min(clip.durationFrames, assetFrame - clip.inFrame));
  return clip.startFrame + local;
}

interface ScoredChunk {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly score: number;
}

/**
 * Arma el plan de remix para un clip. Devuelve null cuando no hay señal
 * (ni habla ni picos), cuando el objetivo no es menor que el clip, o cuando
 * el clip no es candidato (sin asset, velocidad distinta de 1×).
 */
export function planRemix(
  clip: Clip,
  fps: number,
  options: RemixOptions,
): RemixPlan | null {
  if (clip.kind !== 'video' && clip.kind !== 'audio') return null;
  if (clip.source.type !== 'asset') return null;
  const speed = 'speed' in clip ? clip.speed : undefined;
  if (speed && speed.num / Math.max(1, speed.den) !== 1) return null;
  if (!(fps > 0) || clip.durationFrames <= 0) return null;

  const clipSeconds = clip.durationFrames / fps;
  const targetSeconds = Math.min(options.targetSeconds, clipSeconds * 0.98);
  if (!(targetSeconds > 0.2)) return null;

  const window = {
    startFrame: clip.startFrame,
    durationFrames: clip.durationFrames,
    inFrame: sourceInFrame(clip),
  };
  const windowStart = window.startFrame;
  const windowEnd = window.startFrame + window.durationFrames;

  const chunkFrames = Math.max(
    Math.round((options.chunkSeconds ?? 3) * fps),
    Math.round(0.8 * fps),
  );
  const snapFrames = Math.round((options.snapSeconds ?? 0.6) * fps);

  // 1) Bordes candidatos: grilla + snap a bordes de frase/picos.
  const edges = new Set<number>([windowStart, windowEnd]);
  for (let frame = windowStart + chunkFrames; frame < windowEnd; frame += chunkFrames) {
    edges.add(frame);
  }

  // Segmentos de "señal" en frames de timeline: habla (transcripción) o
  // silencios (picos). Sirven para snap de bordes y para puntuar cobertura.
  const signalSpans: RemixSpan[] = [];
  if (options.speech && options.speech.length > 0) {
    for (const segment of options.speech) {
      if (!(segment.end > segment.start)) continue;
      signalSpans.push({
        startFrame: assetSecondsToTimeline(segment.start, window, fps),
        endFrame: assetSecondsToTimeline(segment.end, window, fps),
      });
    }
  } else if (options.peaks) {
    // Sin transcripción: la señal es "no silencio" = complemento de detectSilences.
    const silent = detectSilences(options.peaks, fps);
    const silentTimeline = silent
      .map((span) => ({
        startFrame: Math.max(
          windowStart,
          windowStart + Math.max(0, Math.min(window.durationFrames, span.startFrame - window.inFrame)),
        ),
        endFrame: Math.max(
          windowStart,
          windowStart + Math.max(0, Math.min(window.durationFrames, span.endFrame - window.inFrame)),
        ),
      }))
      .filter((span) => span.endFrame > span.startFrame);
    let cursor = windowStart;
    for (const span of silentTimeline.sort((a, b) => a.startFrame - b.startFrame)) {
      if (span.startFrame > cursor) {
        signalSpans.push({ startFrame: cursor, endFrame: span.startFrame });
      }
      cursor = Math.max(cursor, span.endFrame);
    }
    if (cursor < windowEnd) signalSpans.push({ startFrame: cursor, endFrame: windowEnd });
  }
  if (signalSpans.length === 0) return null;

  const signalEdges = new Set<number>();
  for (const span of signalSpans) {
    signalEdges.add(Math.round(span.startFrame));
    signalEdges.add(Math.round(span.endFrame));
  }

  // Snap: cada borde interior de la grilla se mueve al borde de señal más
  // cercano dentro de snapFrames, para no cortar palabras a la mitad.
  const snapped = [...edges]
    .filter((frame) => frame > windowStart && frame < windowEnd)
    .map((frame) => {
      let best = frame;
      let bestDistance = snapFrames + 1;
      for (const edge of signalEdges) {
        if (edge <= windowStart || edge >= windowEnd) continue;
        const distance = Math.abs(edge - frame);
        if (distance <= snapFrames && distance < bestDistance) {
          best = edge;
          bestDistance = distance;
        }
      }
      return best;
    });
  const boundaries = [...new Set([windowStart, ...snapped, windowEnd])].sort(
    (a, b) => a - b,
  );

  // 2) Chunks entre bordes consecutivos, puntuados por cobertura de señal.
  const chunks: ScoredChunk[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startFrame = boundaries[index]!;
    const endFrame = boundaries[index + 1]!;
    if (endFrame <= startFrame) continue;
    let covered = 0;
    for (const span of signalSpans) {
      covered += Math.max(
        0,
        Math.min(endFrame, span.endFrame) - Math.max(startFrame, span.startFrame),
      );
    }
    const length = endFrame - startFrame;
    chunks.push({
      startFrame,
      endFrame,
      score: length > 0 ? covered / length : 0,
    });
  }
  if (chunks.length < 3) return null;

  // 3) Selección: primero y último siempre; el resto por score hasta el objetivo.
  const targetFrames = Math.round(targetSeconds * fps);
  const first = chunks[0]!;
  const last = chunks[chunks.length - 1]!;
  const middle = chunks.slice(1, -1);
  const ranked = [...middle].sort((a, b) => b.score - a.score || a.startFrame - b.startFrame);

  const keptSet = new Set<ScoredChunk>([first, last]);
  let keptFrames = first.endFrame - first.startFrame + (last.endFrame - last.startFrame);
  for (const chunk of ranked) {
    if (keptFrames >= targetFrames) break;
    keptSet.add(chunk);
    keptFrames += chunk.endFrame - chunk.startFrame;
  }

  const keepSpans: RemixSpan[] = chunks
    .filter((chunk) => keptSet.has(chunk))
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((chunk) => ({ startFrame: chunk.startFrame, endFrame: chunk.endFrame }));
  if (keepSpans.length >= chunks.length) return null; // nada que recortar

  // 4) Complemento → plan de eliminación para applyCutSpans.
  const removeSpans: RemixSpan[] = [];
  let cursor = windowStart;
  for (const span of keepSpans) {
    if (span.startFrame > cursor) {
      removeSpans.push({ startFrame: cursor, endFrame: span.startFrame });
    }
    cursor = Math.max(cursor, span.endFrame);
  }
  if (cursor < windowEnd) {
    removeSpans.push({ startFrame: cursor, endFrame: windowEnd });
  }

  const cutFrames = [
    ...new Set(
      removeSpans.flatMap((span) => [Math.round(span.startFrame), Math.round(span.endFrame)]),
    ),
  ]
    .filter((frame) => frame > windowStart && frame < windowEnd)
    .sort((a, b) => a - b);

  const removedFrames = removeSpans.reduce(
    (total, span) => total + (span.endFrame - span.startFrame),
    0,
  );
  const keptSeconds = (window.durationFrames - removedFrames) / fps;
  const removedSeconds = removedFrames / fps;
  const removePlan: CutSpanPlan = {
    cutFrames,
    spans: removeSpans,
    removedSeconds,
    // Guard: si quedaría menos del 15% del clip, el objetivo era irreal.
    excessive: keptSeconds < clipSeconds * 0.15,
  };

  return {
    keepSpans,
    removePlan,
    keptSeconds,
    removedSeconds,
    keptChunks: keepSpans.length,
    totalChunks: chunks.length,
  };
}

/**
 * Aplica el plan de remix: elimina con ripple los tramos no conservados.
 * Devuelve el proyecto sin tocar si el plan está vacío o es excesivo.
 */
export function applyRemix(
  project: ProjectDocument,
  clipId: string,
  plan: RemixPlan,
): ProjectDocument {
  return applyCutSpans(project, clipId, plan.removePlan);
}

/** Conveniencia para la UI/agentes: fps del proyecto + plan en una llamada. */
export function planRemixForProject(
  project: ProjectDocument,
  clipId: string,
  options: RemixOptions,
): RemixPlan | null {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return null;
  return planRemix(clip, fpsOf(project), options);
}
