/**
 * Aplica un plan de "video desde carpeta" al documento: monta las imágenes en
 * la pista de video con su duración, Ken Burns y transición, y coloca la
 * narración en una pista de audio. No toca clips existentes.
 */
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { addClipFromAsset, addTrack } from '../../state/project-actions';
import type { FolderFilmPlan } from './folder-film';

export interface FolderFilmApplyResult {
  readonly project: ProjectDocument;
  readonly clipIds: readonly string[];
  readonly audioClipId: string | null;
}

function ensureTrack(
  project: ProjectDocument,
  kind: 'image' | 'narration' | 'audio',
): { project: ProjectDocument; trackId: string } {
  const existing = project.timeline.tracks.find(
    (track) => track.kind === kind && !track.locked,
  );
  if (existing) return { project, trackId: existing.id };
  const created = addTrack(project, kind);
  const track = created.project.timeline.tracks.find((item) => item.id === created.trackId);
  if (!track) throw new Error('no se pudo crear la pista');
  return { project: created.project, trackId: track.id };
}

function patchClip(
  project: ProjectDocument,
  clipId: string,
  patch: Record<string, unknown>,
): ProjectDocument {
  return {
    ...project,
    timeline: {
      ...project.timeline,
      clips: project.timeline.clips.map((clip) =>
        clip.id === clipId ? ({ ...clip, ...patch } as typeof clip) : clip,
      ),
    },
  };
}

export function applyFolderFilm(
  project: ProjectDocument,
  plan: FolderFilmPlan,
  assetsById: ReadonlyMap<string, Asset>,
): FolderFilmApplyResult {
  let next = project;
  const clipIds: string[] = [];
  const imageTrack = ensureTrack(next, 'image');
  next = imageTrack.project;

  for (const slide of plan.slides) {
    const asset = assetsById.get(slide.assetId);
    if (!asset) continue;
    const placed = addClipFromAsset(next, asset, {
      trackId: imageTrack.trackId,
      atFrame: slide.startFrame,
      durationFrames: slide.durationFrames,
    });
    next = placed.project;
    clipIds.push(placed.clipId);
    next = patchClip(next, placed.clipId, {
      motion: { type: slide.motion, intensity: 0.14 },
      ...(slide.transitionFrames > 0
        ? { transitionIn: { type: 'dissolve', frames: slide.transitionFrames } }
        : {}),
    });
  }

  let audioClipId: string | null = null;
  if (plan.audioAssetId) {
    const audio = assetsById.get(plan.audioAssetId);
    if (audio) {
      const audioTrack = ensureTrack(next, 'narration');
      next = audioTrack.project;
      const placed = addClipFromAsset(next, audio, {
        trackId: audioTrack.trackId,
        atFrame: 0,
      });
      next = placed.project;
      audioClipId = placed.clipId;
    }
  }

  return { project: next, clipIds, audioClipId };
}
