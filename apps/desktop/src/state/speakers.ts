import type { ProjectDocument } from '@editor-ia/project-schema';
import { fpsOf } from './project-actions';

/**
 * Hablantes en los subtítulos.
 *
 * El proveedor de diarización devuelve tramos con un identificador de hablante
 * (Deepgram usa números, AssemblyAI letras). Acá se asignan a cada subtítulo
 * por **solapamiento mayor**: si un cue cruza dos hablantes, gana el que ocupa
 * más tiempo. No se inventan hablantes: si el proveedor no devuelve tramos, no
 * se toca nada.
 */

export interface SpeakerSegment {
  /** Segundos desde el inicio del material. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly speaker: string;
}

export interface SpeakerApplyOptions {
  /** Antepone «Hablante N: » al texto del cue. */
  readonly prefix?: boolean | undefined;
  /** Nombres visibles por identificador crudo. */
  readonly labels?: Readonly<Record<string, string>> | undefined;
}

/** Etiqueta legible para el identificador que devuelve el proveedor. */
export function speakerLabel(raw: string, labels?: Readonly<Record<string, string>>): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'Hablante';
  const mapped = labels?.[trimmed];
  if (mapped) return mapped;
  if (/^\d+$/.test(trimmed)) return `Hablante ${Number(trimmed) + 1}`;
  if (/^[A-Za-z]$/.test(trimmed)) return `Hablante ${trimmed.toUpperCase()}`;
  return trimmed.slice(0, 40);
}

function overlaps(
  cueStart: number,
  cueEnd: number,
  segmentStart: number,
  segmentEnd: number,
): number {
  return Math.max(0, Math.min(cueEnd, segmentEnd) - Math.max(cueStart, segmentStart));
}

export function applySpeakerSegments(
  project: ProjectDocument,
  clipId: string,
  segments: readonly SpeakerSegment[],
  options: SpeakerApplyOptions = {},
): { project: ProjectDocument; labelled: number } {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip || segments.length === 0) return { project, labelled: 0 };
  const fps = fpsOf(project);
  if (!(fps > 0)) return { project, labelled: 0 };
  const clipStart = clip.startFrame;
  const clipEnd = clip.startFrame + clip.durationFrames;

  const next = {
    ...project,
    captions: {
      ...project.captions,
      cues: project.captions.cues.map((cue) => {
        if (cue.endFrame <= clipStart || cue.startFrame >= clipEnd) return cue;
        let best: { speaker: string; overlap: number } | null = null;
        for (const segment of segments) {
          const start = clipStart + segment.start * fps;
          const end = clipStart + segment.end * fps;
          const overlap = overlaps(cue.startFrame, cue.endFrame, start, end);
          if (overlap > 0 && (!best || overlap > best.overlap)) {
            best = { speaker: segment.speaker, overlap };
          }
        }
        if (!best) return cue;
        const label = speakerLabel(best.speaker, options.labels);
        const text =
          options.prefix && !cue.text.startsWith(`${label}:`)
            ? `${label}: ${cue.text}`
            : cue.text;
        return { ...cue, speaker: label, text };
      }),
    },
  } as ProjectDocument;

  const labelled = next.captions.cues.filter(
    (cue) => cue.speaker !== undefined && cue.endFrame > clipStart && cue.startFrame < clipEnd,
  ).length;
  return { project: next, labelled };
}
