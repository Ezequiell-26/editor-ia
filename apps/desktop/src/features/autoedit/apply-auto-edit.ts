import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import type { MediaAnalysis } from '../../services/project-service';
import {
  addCaptionCueWindows,
  addClipFromAsset,
  addTrack,
  cloneProject,
  setTransformKeyframe,
  totalFrames,
  touch,
  updateClip,
} from '../../state/project-actions';
import type { AutoEditVariant } from './auto-edit';

export interface ApplyAutoEditOptions {
  /** Reemplaza los clips actuales en vez de agregar la variante al final. */
  readonly replace: boolean;
  /** High-pass, denoise, compressor y gain según la medición de loudness. */
  readonly improveAudio: boolean;
  /** Agrega los subtítulos disponibles (si la variante los tiene). */
  readonly addCaptions: boolean;
}

export interface ApplyAutoEditResult {
  readonly project: ProjectDocument;
  readonly clipCount: number;
  readonly captionCount: number;
}

/**
 * Convierte una variante del editor automático en clips reales de la timeline.
 * Los clips conservan el material original, se pueden recortar, mover y
 * deshacer; no se exporta nada hasta que el usuario lo pida.
 */
export function applyAutoEditVariant(
  project: ProjectDocument,
  asset: Asset,
  variant: AutoEditVariant,
  analysis: MediaAnalysis,
  options: ApplyAutoEditOptions,
): ApplyAutoEditResult {
  const fps = project.video.frameRate.num / Math.max(1, project.video.frameRate.den);
  const mediaFrames =
    'media' in asset && asset.media && 'durationFrames' in asset.media
      ? asset.media.durationFrames
      : undefined;
  if (!mediaFrames) throw new Error('el material no declara duración medida');
  let next = cloneProject(project);
  const offset = options.replace ? 0 : totalFrames(next);
  if (options.replace) {
    next.timeline.clips = [];
    next.timeline.tracks = next.timeline.tracks.filter((track) => track.kind === 'caption');
    next.captions.cues = [];
    touch(next);
  }
  const track = addTrack(next, 'video', `Auto · ${variant.name}`);
  const trackId = track.trackId;
  next = track.project;
  const loudness = analysis.loudness?.integratedLufs ?? null;
  const gainDb = options.improveAudio && loudness !== null
    ? Math.max(-6, Math.min(6, Math.round((-14 - loudness) * 10) / 10))
    : 0;
  let cursor = offset;
  let clipCount = 0;
  for (const [index, cut] of variant.cuts.entries()) {
    const inFrame = Math.max(0, Math.min(mediaFrames - 1, Math.round(cut.startSeconds * fps)));
    const outFrame = Math.max(inFrame + 1, Math.min(mediaFrames, Math.round(cut.endSeconds * fps)));
    const added = addClipFromAsset(next, asset, {
      trackId,
      atFrame: cursor,
      inFrame,
      outFrame,
    });
    next = added.project;
    clipCount += 1;
    next = updateClip(next, added.clipId, {
      label: `${variant.name} · ${String(index + 1).padStart(2, '0')}`,
      ...(index > 0
        ? { transitionIn: { type: 'dissolve' as const, frames: variant.style === 'impact' ? 5 : 8 } }
        : {}),
    });
    if (cut.zoom) {
      const last = outFrame - inFrame - 1;
      next = setTransformKeyframe(next, added.clipId, 0, { scale: 1.14, opacity: 1 });
      next = setTransformKeyframe(next, added.clipId, Math.min(last, 10), {
        scale: 1,
        opacity: 1,
      });
      if (last > 12) {
        next = setTransformKeyframe(next, added.clipId, last, {
          scale: 1.04,
          opacity: 1,
        });
      }
    }
    if (options.improveAudio) {
      next = updateClip(next, added.clipId, {
        audio: {
          highPassHz: 80,
          lowPassHz: 16_000,
          denoise: 0.12,
          compressor: true,
          deesser: true,
          eqMidDb: 1.5,
          gainDb,
        },
      });
    }
    cursor += outFrame - inFrame;
  }
  let captionCount = 0;
  if (options.addCaptions && variant.captions.length > 0) {
    const result = addCaptionCueWindows(
      next,
      variant.captions.map((caption) => ({
        text: caption.text,
        startFrame: offset + Math.round(caption.startSeconds * fps),
        endFrame: offset + Math.round(caption.endSeconds * fps),
      })),
      { replaceTrack: options.replace },
    );
    next = result.project;
    captionCount = result.added;
  }
  return { project: next, clipCount, captionCount };
}
