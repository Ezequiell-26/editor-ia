import type {
  BlendMode,
  ChromaKey,
  Clip,
  ClipAnimation,
  ClipColorTag,
  ClipEffects,
  ClipMask,
  ClipMotion,
  ClipTransition,
  ProjectDocument,
} from '@editor-ia/project-schema';
import { updateClip } from './project-actions';

export interface ClipAttributes {
  effects?: ClipEffects;
  motion?: ClipMotion;
  chromaKey?: ChromaKey;
  mask?: ClipMask;
  blendMode?: BlendMode;
  transitionIn?: ClipTransition;
  animationIn?: ClipAnimation;
  animationOut?: ClipAnimation;
  colorTag?: ClipColorTag;
  audio?: NonNullable<Clip['audio']>;
}

let clipboard: ClipAttributes | null = null;

export function setClipAttributesClipboard(attributes: ClipAttributes | null): void {
  clipboard = attributes;
}

export function getClipAttributesClipboard(): ClipAttributes | null {
  return clipboard;
}

export function hasClipAttributesClipboard(): boolean {
  return clipboard !== null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function copyClipAttributes(clip: Clip): ClipAttributes | null {
  const source = clip as Clip & Partial<ClipAttributes>;
  const attributes: ClipAttributes = {};
  if (source.effects) attributes.effects = clone(source.effects);
  if (source.motion) attributes.motion = clone(source.motion);
  if (source.chromaKey) attributes.chromaKey = clone(source.chromaKey);
  if (source.mask) attributes.mask = clone(source.mask);
  if (source.blendMode) attributes.blendMode = source.blendMode;
  if (source.transitionIn?.type) attributes.transitionIn = clone(source.transitionIn);
  if (source.animationIn) attributes.animationIn = clone(source.animationIn);
  if (source.animationOut) attributes.animationOut = clone(source.animationOut);
  if (clip.colorTag) attributes.colorTag = clip.colorTag;
  if (clip.audio) {
    const audio = clone(clip.audio);
    delete audio.muted;
    delete audio.gainKeyframes;
    if (Object.keys(audio).length > 0) attributes.audio = audio;
  }
  return Object.keys(attributes).length > 0 ? attributes : null;
}

export function applyClipAttributes(
  project: ProjectDocument,
  clipId: string,
  attributes: ClipAttributes,
): ProjectDocument {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return project;
  const visual = clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze';
  const patch: Parameters<typeof updateClip>[2] = {};
  if (attributes.effects && (visual || clip.kind === 'adjustment')) {
    const effects = clone(attributes.effects);
    if (effects.fadeInFrames !== undefined && effects.fadeInFrames > clip.durationFrames) {
      delete effects.fadeInFrames;
    }
    if (effects.fadeOutFrames !== undefined && effects.fadeOutFrames > clip.durationFrames) {
      delete effects.fadeOutFrames;
    }
    if (Object.keys(effects).length > 0) patch.effects = effects;
  }
  if (visual) {
    if (attributes.motion) patch.motion = clone(attributes.motion);
    if (attributes.chromaKey) patch.chromaKey = clone(attributes.chromaKey);
    if (attributes.mask) {
      const mask = clone(attributes.mask);
      if (mask.keyframes) {
        const keyframes = mask.keyframes.filter(
          (keyframe) => keyframe.frame < clip.durationFrames,
        );
        if (keyframes.length > 0) mask.keyframes = keyframes;
        else delete mask.keyframes;
      }
      patch.mask = mask;
    }
    if (attributes.blendMode) patch.blendMode = attributes.blendMode;
    if (attributes.transitionIn?.type) {
      const transition = clone(attributes.transitionIn);
      transition.frames = Math.max(
        1,
        Math.min(transition.frames, clip.durationFrames),
      );
      patch.transitionIn = transition;
    }
    if (attributes.animationIn) {
      patch.animationIn = {
        ...clone(attributes.animationIn),
        durationFrames: Math.max(
          1,
          Math.min(attributes.animationIn.durationFrames, clip.durationFrames),
        ),
      };
    }
    if (attributes.animationOut) {
      patch.animationOut = {
        ...clone(attributes.animationOut),
        durationFrames: Math.max(
          1,
          Math.min(attributes.animationOut.durationFrames, clip.durationFrames),
        ),
      };
    }
  }
  if (attributes.colorTag) patch.colorTag = attributes.colorTag;
  if (attributes.audio && (clip.kind === 'video' || clip.kind === 'audio')) {
    const audio = clone(attributes.audio);
    if (audio.fadeInFrames !== undefined && audio.fadeInFrames > clip.durationFrames) {
      delete audio.fadeInFrames;
    }
    if (audio.fadeOutFrames !== undefined && audio.fadeOutFrames > clip.durationFrames) {
      delete audio.fadeOutFrames;
    }
    patch.audio = { ...(clip.audio ?? {}), ...audio };
  }
  if (Object.keys(patch).length === 0) return project;
  return updateClip(project, clipId, patch);
}

export function pasteAttributesToColor(
  project: ProjectDocument,
  color: ClipColorTag,
  attributes: ClipAttributes,
): { project: ProjectDocument; applied: number; skipped: number } {
  let next = project;
  let applied = 0;
  let skipped = 0;
  const targets = project.timeline.clips.filter((clip) => clip.colorTag === color);
  for (const clip of targets) {
    const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
    if (!track || track.locked) {
      skipped += 1;
      continue;
    }
    const updated = applyClipAttributes(next, clip.id, attributes);
    if (updated !== next) {
      next = updated;
      applied += 1;
    }
  }
  return { project: next, applied, skipped };
}
