import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import { fpsOf } from './project-actions';
import { applyCutSpans, type CutSpanPlan } from './silence-cuts';

/**
 * Corte por pausas de voz.
 *
 * El detector de silencios mira amplitud: corta donde no hay energía. Eso
 * confunde una respiración con una pausa y, sobre todo, no sabe dónde termina
 * una frase. Este módulo usa los tiempos de los subtítulos (palabra por
 * palabra) para cortar **entre frases**, que es lo que un editor hace a mano:
 * se respeta el silencio interno de una frase y se elimina el aire entre una
 * idea y la siguiente.
 *
 * Los subtítulos son la fuente natural: ya tienen los tiempos medidos por
 * Whisper y viven en la timeline, así que no hay que volver a analizar el
 * audio. Si el clip no tiene subtítulos, la UI lo dice en vez de adivinar.
 */

export interface SpeechInterval {
  /** Frame absoluto de timeline donde empieza el habla. */
  readonly startFrame: number;
  /** Frame absoluto donde termina. */
  readonly endFrame: number;
}

export interface SpeechCutOptions {
  /** Pausa mínima para recortar, en segundos (0,35). */
  readonly minPauseSeconds?: number;
  /** Aire que se conserva a cada lado del corte, en segundos (0,08). */
  readonly paddingSeconds?: number;
  /** Si el plan elimina más de esta fracción del clip, se rechaza (0,6). */
  readonly maxRemovedRatio?: number;
}

export interface SpeechCutPlan extends CutSpanPlan {
  /** Pausas detectadas. */
  readonly pauses: number;
  /** Segundos de habla dentro del clip. */
  readonly speechSeconds: number;
}

const DEFAULTS = {
  minPauseSeconds: 0.35,
  paddingSeconds: 0.08,
  maxRemovedRatio: 0.6,
} as const;

interface ClipWindow {
  readonly startFrame: number;
  readonly durationFrames: number;
}

function mergeIntervals(intervals: readonly SpeechInterval[]): SpeechInterval[] {
  const sorted = [...intervals]
    .filter((interval) => interval.endFrame > interval.startFrame)
    .sort((a, b) => a.startFrame - b.startFrame);
  const merged: SpeechInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startFrame <= last.endFrame + 1) {
      merged[merged.length - 1] = {
        startFrame: last.startFrame,
        endFrame: Math.max(last.endFrame, interval.endFrame),
      };
      continue;
    }
    merged.push({ ...interval });
  }
  return merged;
}

/** Plan a partir de intervalos de habla ya en frames de timeline. */
export function planSpeechCutsFromIntervals(
  intervals: readonly SpeechInterval[],
  clip: ClipWindow,
  fps: number,
  options: SpeechCutOptions = {},
): SpeechCutPlan | null {
  if (!(fps > 0) || clip.durationFrames <= 0) return null;
  const minPause = Math.max(0.05, options.minPauseSeconds ?? DEFAULTS.minPauseSeconds);
  const padding = Math.max(0, options.paddingSeconds ?? DEFAULTS.paddingSeconds);
  const maxRatio = Math.min(0.9, Math.max(0.1, options.maxRemovedRatio ?? DEFAULTS.maxRemovedRatio));
  const clipStart = clip.startFrame;
  const clipEnd = clip.startFrame + clip.durationFrames;

  const clipped = intervals
    .map((interval) => ({
      startFrame: Math.max(clipStart, Math.round(interval.startFrame)),
      endFrame: Math.min(clipEnd, Math.round(interval.endFrame)),
    }))
    .filter((interval) => interval.endFrame > interval.startFrame);
  const speech = mergeIntervals(clipped);
  if (speech.length < 2) return null;

  const minPauseFrames = minPause * fps;
  const paddingFrames = padding * fps;
  const spans: { startFrame: number; endFrame: number }[] = [];
  for (let index = 1; index < speech.length; index += 1) {
    const previous = speech[index - 1]!;
    const next = speech[index]!;
    const gap = next.startFrame - previous.endFrame;
    if (gap < minPauseFrames) continue;
    const start = Math.round(previous.endFrame + paddingFrames);
    const end = Math.round(next.startFrame - paddingFrames);
    if (end - start < 2) continue;
    spans.push({ startFrame: start, endFrame: end });
  }
  if (spans.length === 0) return null;

  const cutFrames = [
    ...new Set(spans.flatMap((span) => [span.startFrame, span.endFrame])),
  ]
    .filter((frame) => frame > clipStart && frame < clipEnd)
    .sort((a, b) => a - b);
  if (cutFrames.length === 0) return null;

  const removedFrames = spans.reduce((sum, span) => sum + (span.endFrame - span.startFrame), 0);
  const removedSeconds = removedFrames / fps;
  const speechFrames = speech.reduce((sum, interval) => sum + (interval.endFrame - interval.startFrame), 0);
  return {
    cutFrames,
    spans,
    removedSeconds,
    excessive: removedSeconds > (clip.durationFrames / fps) * maxRatio,
    pauses: spans.length,
    speechSeconds: speechFrames / fps,
  };
}

/**
 * Plan a partir de los subtítulos del proyecto.
 *
 * Usa las palabras cuando el cue las tiene (Whisper las devuelve) y cae al
 * rango del cue cuando no. Así un subtítulo manual también sirve como guía,
 * aunque con menos precisión.
 */
export function planSpeechCutsFromCues(
  cues: readonly {
    readonly startFrame: number;
    readonly endFrame: number;
    readonly words?: readonly { readonly startFrame: number; readonly endFrame: number }[] | undefined;
  }[],
  clip: ClipWindow,
  fps: number,
  options: SpeechCutOptions = {},
): SpeechCutPlan | null {
  const intervals: SpeechInterval[] = [];
  for (const cue of cues) {
    const words = cue.words ?? [];
    if (words.length > 0) {
      for (const word of words) {
        intervals.push({ startFrame: word.startFrame, endFrame: word.endFrame });
      }
      continue;
    }
    intervals.push({ startFrame: cue.startFrame, endFrame: cue.endFrame });
  }
  return planSpeechCutsFromIntervals(intervals, clip, fps, options);
}

/**
 * Plan a partir de una transcripción cruda (segundos relativos al clip), para
 * el camino de la IA que transcribe y corta en el mismo pedido.
 */
export function planSpeechCutsFromTranscript(
  segments: readonly {
    readonly start: number;
    readonly end: number;
    readonly words?: readonly { readonly start: number; readonly end: number }[];
  }[],
  clip: ClipWindow,
  fps: number,
  options: SpeechCutOptions = {},
): SpeechCutPlan | null {
  const intervals: SpeechInterval[] = [];
  for (const segment of segments) {
    const words = segment.words ?? [];
    if (words.length > 0) {
      for (const word of words) {
        intervals.push({
          startFrame: clip.startFrame + word.start * fps,
          endFrame: clip.startFrame + word.end * fps,
        });
      }
      continue;
    }
    intervals.push({
      startFrame: clip.startFrame + segment.start * fps,
      endFrame: clip.startFrame + segment.end * fps,
    });
  }
  return planSpeechCutsFromIntervals(intervals, clip, fps, options);
}

/** Cues del proyecto que tocan la ventana del clip. */
export function cuesForClip(
  project: ProjectDocument,
  clipId: string,
): {
  startFrame: number;
  endFrame: number;
  words?: readonly { startFrame: number; endFrame: number }[] | undefined;
}[] {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return [];
  const start = clip.startFrame;
  const end = clip.startFrame + clip.durationFrames;
  return project.captions.cues.filter((cue) => cue.startFrame < end && cue.endFrame > start);
}

/** Aplica el plan con la misma maquinaria de split + ripple que los silencios. */
export function applySpeechCuts(
  project: ProjectDocument,
  clipId: string,
  plan: SpeechCutPlan,
): ProjectDocument {
  return applyCutSpans(project, clipId, plan);
}

/** fps del proyecto, para no repetir el import en cada llamador. */
export function speechCutFps(project: ProjectDocument): number {
  return fpsOf(project);
}

export type SpeechCutClip = Pick<Clip, 'id' | 'startFrame' | 'durationFrames'>;
