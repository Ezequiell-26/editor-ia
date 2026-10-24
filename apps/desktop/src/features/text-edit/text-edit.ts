import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import type { TranscriptionSegment } from '../../services/project-service';
import { addClipFromAsset, addTrack, fpsOf } from '../../state/project-actions';

export interface TextEditRange {
  readonly index: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

export interface TextEditBuild {
  readonly project: ProjectDocument;
  readonly trackId: string;
  readonly clipCount: number;
  readonly durationFrames: number;
}

export function videoDurationFrames(asset: Asset): number | null {
  if (asset.kind !== 'video') return null;
  const media = 'media' in asset ? asset.media : undefined;
  if (!media || !('durationFrames' in media)) return null;
  return media.durationFrames > 0 ? media.durationFrames : null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Convierte la transcripción en rangos de fuente listos para montar.
 * Los índices excluidos son los segmentos que la persona sacó del texto.
 * Los bordes se recortan al material real y cada rango dura al menos 1 frame.
 */
export function transcriptToRanges(
  segments: readonly TranscriptionSegment[],
  fps: number,
  mediaDurationFrames: number,
  excluded: readonly number[] = [],
): TextEditRange[] {
  if (!Number.isFinite(fps) || fps <= 0 || mediaDurationFrames <= 0) return [];
  const skipped = new Set(excluded);
  const ranges: TextEditRange[] = [];
  segments.forEach((segment, index) => {
    if (skipped.has(index)) return;
    const text = cleanText(segment.text);
    if (!text) return;
    const startFrame = Math.max(
      0,
      Math.min(mediaDurationFrames - 1, Math.round(segment.start * fps)),
    );
    const endFrame = Math.max(
      startFrame + 1,
      Math.min(mediaDurationFrames, Math.round(segment.end * fps)),
    );
    if (endFrame <= startFrame) return;
    ranges.push({
      index,
      startFrame,
      endFrame,
      startSeconds: startFrame / fps,
      endSeconds: endFrame / fps,
      text,
    });
  });
  return ranges;
}

export function selectedDurationSeconds(
  ranges: readonly TextEditRange[],
  fps: number,
): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return ranges.reduce((total, range) => total + (range.endFrame - range.startFrame) / fps, 0);
}

export function clipLabelForText(text: string): string {
  const clean = cleanText(text);
  const short = clean.length > 54 ? `${clean.slice(0, 53).trimEnd()}…` : clean;
  return short ? `Texto · ${short}` : 'Texto';
}

/**
 * Crea una pista nueva con los rangos elegidos, uno detrás de otro. Es un
 * corte no destructivo: el material y las pistas originales quedan intactos.
 */
export function buildTextEditProject(
  project: ProjectDocument,
  asset: Asset,
  segments: readonly TranscriptionSegment[],
  excluded: readonly number[] = [],
  options: { readonly atFrame?: number; readonly label?: string } = {},
): TextEditBuild {
  if (asset.kind !== 'video') {
    throw new Error('la edición por texto necesita un video con audio.');
  }
  const mediaDuration = videoDurationFrames(asset);
  if (!mediaDuration) {
    throw new Error('el video no declara una duración medida; importalo de nuevo.');
  }
  const fps = fpsOf(project);
  const ranges = transcriptToRanges(segments, fps, mediaDuration, excluded);
  if (ranges.length === 0) {
    throw new Error('dejá al menos un segmento de texto seleccionado.');
  }
  const created = addTrack(project, 'video', options.label?.trim() || 'Texto');
  let next = created.project;
  let cursor = Math.max(0, Math.round(options.atFrame ?? 0));

  for (const range of ranges) {
    const added = addClipFromAsset(next, asset, {
      trackId: created.trackId,
      atFrame: cursor,
      inFrame: range.startFrame,
      outFrame: range.endFrame,
    });
    next = added.project;
    const clip = next.timeline.clips.find((item) => item.id === added.clipId);
    if (clip) clip.label = clipLabelForText(range.text);
    cursor += range.endFrame - range.startFrame;
  }

  return {
    project: next,
    trackId: created.trackId,
    clipCount: ranges.length,
    durationFrames: cursor - Math.max(0, Math.round(options.atFrame ?? 0)),
  };
}
