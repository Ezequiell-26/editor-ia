import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { ProjectActionError, addClipFromAsset, totalFrames, updateClip } from './project-actions';

/**
 * Monta una carpeta de imágenes/audio en la timeline: imágenes en orden
 * numérico, 3 s cada una con Ken Burns alternado y disolvencia de entrada; los
 * videos completos; el primer audio desde el inicio. Se agrega al final de la
 * timeline existente, sin borrar nada.
 */

export interface FolderTimelineMedia {
  readonly images: readonly Asset[];
  readonly videos: readonly Asset[];
  readonly audio: readonly Asset[];
}

export interface FolderTimelineOptions {
  /** Duración de cada imagen en frames; por defecto 3 segundos. */
  readonly imageFrames?: number;
  /** Frames de la disolvencia entre imágenes; por defecto 8. */
  readonly fadeFrames?: number;
}

export interface FolderTimelineResult {
  readonly project: ProjectDocument;
  readonly firstClipId: string | null;
  readonly imageCount: number;
  readonly videoCount: number;
  readonly audioCount: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly warnings: readonly string[];
}

function fpsOf(project: ProjectDocument): number {
  const rate = project.video.frameRate;
  return Math.max(1, rate.num / Math.max(1, rate.den));
}

function byName(left: Asset, right: Asset): number {
  return left.label.localeCompare(right.label, 'es', { numeric: true, sensitivity: 'base' });
}

export function buildFolderTimeline(
  project: ProjectDocument,
  media: FolderTimelineMedia,
  options: FolderTimelineOptions = {},
): FolderTimelineResult {
  const images = [...media.images].filter((asset) => asset.status === 'ready').sort(byName);
  const videos = [...media.videos].filter((asset) => asset.status === 'ready').sort(byName);
  const audio = [...media.audio].filter((asset) => asset.status === 'ready').sort(byName);
  if (images.length + videos.length === 0) {
    throw new ProjectActionError('la carpeta no tiene imágenes ni videos listos para montar');
  }
  const fps = fpsOf(project);
  const imageFrames = Math.max(2, Math.round(options.imageFrames ?? fps * 3));
  const fadeFrames = Math.max(0, Math.min(imageFrames - 1, Math.round(options.fadeFrames ?? 8)));
  const startFrame = totalFrames(project);
  const warnings: string[] = [];
  let next = project;
  let cursor = startFrame;
  let firstClipId: string | null = null;
  let placed = 0;

  for (const image of images) {
    const added = addClipFromAsset(next, image, {
      atFrame: cursor,
      durationFrames: imageFrames,
    });
    const withMotion = updateClip(added.project, added.clipId, {
      motion: {
        type: placed % 2 === 0 ? 'zoom-in' : 'zoom-out',
        intensity: 0.12,
      },
      ...(placed > 0 && fadeFrames > 0
        ? { transitionIn: { type: 'dissolve', frames: fadeFrames } }
        : {}),
    });
    next = withMotion;
    firstClipId ??= added.clipId;
    cursor += imageFrames;
    placed += 1;
  }

  for (const video of videos) {
    const added = addClipFromAsset(next, video, { atFrame: cursor });
    const clip = added.project.timeline.clips.find((item) => item.id === added.clipId);
    const duration = clip?.durationFrames ?? Math.round(fps * 5);
    next =
      placed > 0 && fadeFrames > 0
        ? updateClip(added.project, added.clipId, {
            transitionIn: { type: 'dissolve', frames: fadeFrames },
          })
        : added.project;
    firstClipId ??= added.clipId;
    cursor += duration;
    placed += 1;
  }

  let audioCount = 0;
  const [firstAudio, ...restAudio] = audio;
  if (firstAudio) {
    const added = addClipFromAsset(next, firstAudio, { atFrame: startFrame });
    next = added.project;
    audioCount = 1;
    if (restAudio.length > 0) {
      warnings.push(
        `Se usó el primer audio (${firstAudio.label}); ${restAudio.length} audio(s) más quedaron en Medios.`,
      );
    }
  }

  const endFrame = Math.max(
    cursor,
    ...next.timeline.clips.map((clip) => clip.startFrame + clip.durationFrames),
  );
  return {
    project: next,
    firstClipId,
    imageCount: images.length,
    videoCount: videos.length,
    audioCount,
    startFrame,
    endFrame,
    warnings,
  };
}
