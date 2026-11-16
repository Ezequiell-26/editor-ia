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
  MonitorFrame,
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
  transitionOut?: ClipTransition;
  animationIn?: ClipAnimation;
  animationOut?: ClipAnimation;
  colorTag?: ClipColorTag;
  monitorFrame?: MonitorFrame;
  audio?: NonNullable<Clip['audio']>;
}

let clipboard: ClipAttributes | null = null;

/**
 * Grupos de atributos copiables (paridad con el diálogo `colarAtributos`
 * de AlaukCut, que deja tildar qué grupos pegar). El pegado filtra el
 * portapapeles por estos grupos antes de `applyClipAttributes`.
 */
export type ClipAttributeGroup = 'efectos' | 'movimiento' | 'color' | 'audio';

export const ATTRIBUTE_GROUPS: readonly {
  readonly id: ClipAttributeGroup;
  readonly label: string;
}[] = [
  { id: 'efectos', label: 'Efectos y máscara' },
  { id: 'movimiento', label: 'Movimiento y transiciones' },
  { id: 'color', label: 'Color y marco' },
  { id: 'audio', label: 'Audio' },
];

/** Grupos presentes en un portapapeles de atributos (para el diálogo). */
export function attributeGroupsOf(
  attributes: ClipAttributes,
): ClipAttributeGroup[] {
  const groups: ClipAttributeGroup[] = [];
  if (
    attributes.effects ||
    attributes.chromaKey ||
    attributes.mask ||
    attributes.blendMode
  ) {
    groups.push('efectos');
  }
  if (
    attributes.motion ||
    attributes.transitionIn ||
    attributes.transitionOut ||
    attributes.animationIn ||
    attributes.animationOut
  ) {
    groups.push('movimiento');
  }
  if (attributes.colorTag || 'monitorFrame' in attributes) {
    groups.push('color');
  }
  if (attributes.audio) groups.push('audio');
  return groups;
}

/**
 * Devuelve una copia del portapapeles sólo con los grupos elegidos.
 * `monitorFrame` se trata como opcional-borrable (`'monitorFrame' in
 * attributes` distingue "sin marco" de "no tocar"), así que el filtro lo
 * conserva sólo si el grupo `color` está tildado.
 */
export function pickClipAttributes(
  attributes: ClipAttributes,
  groups: ReadonlySet<ClipAttributeGroup>,
): ClipAttributes {
  const picked: ClipAttributes = {};
  if (groups.has('efectos')) {
    if (attributes.effects) picked.effects = clone(attributes.effects);
    if (attributes.chromaKey) picked.chromaKey = clone(attributes.chromaKey);
    if (attributes.mask) picked.mask = clone(attributes.mask);
    if (attributes.blendMode) picked.blendMode = attributes.blendMode;
  }
  if (groups.has('movimiento')) {
    if (attributes.motion) picked.motion = clone(attributes.motion);
    if (attributes.transitionIn) {
      picked.transitionIn = clone(attributes.transitionIn);
    }
    if (attributes.transitionOut) {
      picked.transitionOut = clone(attributes.transitionOut);
    }
    if (attributes.animationIn) {
      picked.animationIn = clone(attributes.animationIn);
    }
    if (attributes.animationOut) {
      picked.animationOut = clone(attributes.animationOut);
    }
  }
  if (groups.has('color')) {
    if (attributes.colorTag) picked.colorTag = attributes.colorTag;
    if ('monitorFrame' in attributes) {
      picked.monitorFrame = attributes.monitorFrame;
    }
  }
  if (groups.has('audio') && attributes.audio) {
    picked.audio = clone(attributes.audio);
  }
  return picked;
}

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
  if (source.transitionOut?.type) attributes.transitionOut = clone(source.transitionOut);
  if (source.animationIn) attributes.animationIn = clone(source.animationIn);
  if (source.animationOut) attributes.animationOut = clone(source.animationOut);
  if (clip.colorTag) attributes.colorTag = clip.colorTag;
  if (clip.monitorFrame) attributes.monitorFrame = clone(clip.monitorFrame);
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
    if (attributes.transitionOut?.type) {
      const transition = clone(attributes.transitionOut);
      transition.frames = Math.max(
        1,
        Math.min(transition.frames, clip.durationFrames),
      );
      patch.transitionOut = transition;
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
  if (visual) {
    if ('monitorFrame' in attributes) {
      patch.monitorFrame = attributes.monitorFrame;
    }
  }
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
