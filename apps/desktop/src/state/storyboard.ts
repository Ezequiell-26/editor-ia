import type { Asset, JsonValue, ProjectDocument } from '@editor-ia/project-schema';
import {
  ProjectActionError,
  addClipFromAsset,
  addTrack,
  fpsOf,
  newId,
  secondsToFrames,
  updateClip,
} from './project-actions';
import {
  automaticPhotoMotion,
  photoTransitionEffects,
  type AutoPhotoMotion,
} from './photo-motion';

/**
 * Deterministic storyboard assembly.
 *
 * Mirrors the useful part of the reference editor: images plus one narration
 * track become a timeline in order. It does not pretend to align words to
 * images; without per-scene audio or forced alignment the honest distribution
 * is the narration duration divided across the images.
 */

export interface StoryboardOptions {
  readonly images: readonly Asset[];
  readonly audio?: Asset | null;
  readonly defaultImageSeconds?: number;
  readonly photoMotion?: AutoPhotoMotion;
  readonly transitionFrames?: number;
}

export type StoryboardDistribution = 'audio' | 'scenes' | 'default';

export interface StoryboardResult {
  readonly project: ProjectDocument;
  readonly imageClipIds: readonly string[];
  readonly audioClipId: string | null;
  readonly imageTrackId: string;
  readonly audioTrackId: string | null;
  readonly totalFrames: number;
  readonly perImageFrames: readonly number[];
  readonly distribution: StoryboardDistribution;
}

function storedAsset<K extends 'image' | 'audio'>(
  project: ProjectDocument,
  asset: Asset,
  kind: K,
): Extract<Asset, { kind: K }> {
  const stored = project.assets.find((item) => item.id === asset.id);
  if (!stored) {
    throw new ProjectActionError(`"${asset.label}" no está en el proyecto; agregalo antes de montarlo`);
  }
  if (stored.kind !== kind) {
    throw new ProjectActionError(`"${asset.label}" no es un material de tipo ${kind}`);
  }
  if (stored.status !== 'ready') {
    throw new ProjectActionError(
      `confirmá los derechos de "${asset.label}" antes de montarlo en el storyboard`,
    );
  }
  return stored as Extract<Asset, { kind: K }>;
}

function emptyTrack(project: ProjectDocument, kinds: readonly string[]): string | null {
  const used = new Set(project.timeline.clips.map((clip) => clip.trackId));
  return (
    project.timeline.tracks.find(
      (track) => kinds.includes(track.kind) && !track.locked && !used.has(track.id),
    )?.id ?? null
  );
}

function ensureTrack(
  project: ProjectDocument,
  kinds: readonly string[],
  createKind: 'image' | 'narration',
  label: string,
): { project: ProjectDocument; trackId: string } {
  const existing = emptyTrack(project, kinds);
  if (existing) {
    return { project, trackId: existing };
  }
  const created = addTrack(project, createKind, label);
  return { project: created.project, trackId: created.trackId };
}

export function buildStoryboard(
  project: ProjectDocument,
  options: StoryboardOptions,
): StoryboardResult {
  if (options.images.length === 0) {
    throw new ProjectActionError('el storyboard necesita al menos una imagen');
  }

  const images = [...options.images].sort((a, b) =>
    a.label.localeCompare(b.label, 'es', { numeric: true, sensitivity: 'base' }),
  );
  const storedImages = images.map((image) => storedAsset(project, image, 'image'));
  const audio = options.audio ? storedAsset(project, options.audio, 'audio') : null;

  const fps = fpsOf(project);
  const audioFrames = audio?.media?.durationFrames ?? 0;
  const sceneFrames = project.scenes.reduce(
    (sum, scene) => sum + Math.max(0, scene.narration.estimatedDurationFrames ?? 0),
    0,
  );

  let distribution: StoryboardDistribution;
  let totalFrames: number;
  if (audioFrames > 0) {
    distribution = 'audio';
    totalFrames = audioFrames;
  } else if (sceneFrames > 0) {
    distribution = 'scenes';
    totalFrames = sceneFrames;
  } else {
    distribution = 'default';
    const seconds = Math.max(1, Math.min(60, options.defaultImageSeconds ?? 5));
    totalFrames = images.length * secondsToFrames(seconds, fps);
  }
  totalFrames = Math.max(images.length, Math.floor(totalFrames));

  const base = Math.floor(totalFrames / images.length);
  const remainder = totalFrames % images.length;
  const perImageFrames = images.map((_, index) => Math.max(1, base + (index < remainder ? 1 : 0)));

  let next = project;
  const imageTrack = ensureTrack(next, ['image'], 'image', 'Storyboard');
  next = imageTrack.project;
  const imageClipIds: string[] = [];
  let cursor = 0;
  for (let index = 0; index < storedImages.length; index += 1) {
    const image = storedImages[index];
    if (!image) continue;
    const durationFrames = perImageFrames[index] ?? 1;
    const added = addClipFromAsset(next, image, {
      trackId: imageTrack.trackId,
      atFrame: cursor,
      durationFrames,
    });
    next = added.project;
    const motion = options.photoMotion === 'auto' ? automaticPhotoMotion(index) : undefined;
    const transition = photoTransitionEffects(options.transitionFrames ?? 0, durationFrames);
    if (motion || transition) {
      next = updateClip(next, added.clipId, {
        ...(motion ? { motion } : {}),
        ...(transition ? { effects: transition } : {}),
      });
    }
    imageClipIds.push(added.clipId);
    cursor += durationFrames;
  }

  let audioClipId: string | null = null;
  let audioTrackId: string | null = null;
  if (audio) {
    const narrationTrack = ensureTrack(next, ['narration', 'audio'], 'narration', 'Narración');
    next = narrationTrack.project;
    audioTrackId = narrationTrack.trackId;
    const added = addClipFromAsset(next, audio, {
      trackId: narrationTrack.trackId,
      atFrame: 0,
      narration: true,
    });
    next = added.project;
    audioClipId = added.clipId;
  }

  const addedClipIds = audioClipId ? [...imageClipIds, audioClipId] : imageClipIds;
  const patch = addedClipIds.flatMap((clipId) => {
    const clip = next.timeline.clips.find((item) => item.id === clipId);
    if (!clip) return [];
    return [
      {
        op: 'add' as const,
        path: '/timeline/clips/-',
        value: JSON.parse(JSON.stringify(clip)) as JsonValue,
      },
    ];
  });

  next = {
    ...next,
    revision: next.revision + 1,
    updatedAt: new Date().toISOString(),
    provenance: {
      ...next.provenance,
      operations: [
        ...next.provenance.operations,
        {
          id: newId(),
          role: 'editor',
          summary: `Storyboard automático: ${images.length} imagen(es)${audio ? ' + narración' : ''}`,
          createdAt: new Date().toISOString(),
          cost: { items: [], disclosed: true, approved: true },
          patch,
          expectedRevision: project.revision,
          appliedStatus: 'applied',
        },
      ],
    },
  };

  return {
    project: next,
    imageClipIds,
    audioClipId,
    imageTrackId: imageTrack.trackId,
    audioTrackId,
    totalFrames,
    perImageFrames,
    distribution,
  };
}
