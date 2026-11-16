import {
  sampleGainKeyframes,
  sampleTransformKeyframes,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import {
  assignGainKeyframes,
  assignTransformKeyframes,
  trimEndKeyframes,
  trimStartKeyframes,
} from './keyframe-actions';
import {
  ProjectActionError,
  canPlaceClip,
  cloneProject,
  gcd,
  isWindowed,
  speedOf,
  touch,
  type WindowedClip,
} from './project-actions-core';

/**
 * Trim and fine cut adjustments: edge trims that re-time the source window,
 * plus the slip/slide/roll gestures that move the cut without leaving gaps.
 * Extracted from `project-actions.ts`; `project-actions.ts` re-exports the
 * public API.
 */

export function trimClip(
  project: ProjectDocument,
  clipId: string,
  edge: 'start' | 'end',
  targetFrame: number,
): ProjectDocument | null {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    return null;
  }
  if (clip.kind === 'compound') {
    throw new ProjectActionError(
      'un clip compuesto no se recorta; deshacelo para editar los clips internos',
    );
  }
  const target = Math.round(targetFrame);
  const owner = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (owner?.locked) {
    return null;
  }
  const oldStart = clip.startFrame;
  const oldDuration = clip.durationFrames;
  const originalTransformKeyframes = clip.transform?.keyframes
    ? [...clip.transform.keyframes]
    : undefined;
  const originalGainKeyframes = clip.audio?.gainKeyframes
    ? [...clip.audio.gainKeyframes]
    : undefined;
  if (edge === 'start') {
    const maxStart = clip.startFrame + clip.durationFrames - 1;
    let newStart = Math.min(Math.max(0, target), maxStart);
    let delta = newStart - clip.startFrame;
    if (isWindowed(clip)) {
      const { num, den } = speedOf(clip);
      const step = den / gcd(num, den);
      delta = Math.round(delta / step) * step;
      newStart = clip.startFrame + delta;
      if (newStart < 0 || newStart > maxStart) {
        return null;
      }
      const sourceDelta = (delta * num) / den;
      if (!Number.isInteger(sourceDelta)) {
        return null;
      }
      const newIn = clip.source.inFrame + sourceDelta;
      if (newIn < 0 || newIn >= clip.source.outFrame) {
        return null;
      }
      clip.source.inFrame = newIn;
    }
    const newDuration = maxStart + 1 - newStart;
    if (!canPlaceClip(next, clip.trackId, newStart, newDuration, clip.id)) {
      return null;
    }
    clip.startFrame = newStart;
    clip.durationFrames = newDuration;
  } else {
    const source = clip.source;
    const asset = source.type === 'asset'
      ? next.assets.find((item) => item.id === source.assetId)
      : undefined;
    let newEnd = Math.max(clip.startFrame + 1, target);
    let newDuration = newEnd - clip.startFrame;
    if (isWindowed(clip)) {
      const { num, den } = speedOf(clip);
      const step = den / gcd(num, den);
      newDuration = Math.round(newDuration / step) * step;
      newDuration = Math.max(step, newDuration);
      newEnd = clip.startFrame + newDuration;
      const sourceOut = clip.source.inFrame + (newDuration * num) / den;
      if (!Number.isInteger(sourceOut)) {
        return null;
      }
      const maxSource =
        asset && 'media' in asset && asset.media && 'durationFrames' in asset.media
          ? asset.media.durationFrames
          : undefined;
      if (maxSource !== undefined && sourceOut > maxSource) {
        return null;
      }
      if (sourceOut <= clip.source.inFrame) {
        return null;
      }
      clip.source.outFrame = sourceOut;
    }
    if (!canPlaceClip(next, clip.trackId, clip.startFrame, newDuration, clip.id)) {
      return null;
    }
    clip.durationFrames = newDuration;
  }
  if (originalTransformKeyframes) {
    if (edge === 'start') {
      assignTransformKeyframes(
        clip,
        trimStartKeyframes(
          originalTransformKeyframes,
          clip.startFrame - oldStart,
          (frame) => sampleTransformKeyframes(originalTransformKeyframes, frame),
        ),
      );
    } else if (clip.durationFrames !== oldDuration) {
      assignTransformKeyframes(
        clip,
        trimEndKeyframes(originalTransformKeyframes, clip.durationFrames, (frame) =>
          sampleTransformKeyframes(originalTransformKeyframes, frame),
        ),
      );
    }
  }
  if (originalGainKeyframes) {
    const sample = (frame: number) => ({
      gainDb: sampleGainKeyframes(originalGainKeyframes, frame) ?? 0,
    });
    if (edge === 'start') {
      assignGainKeyframes(
        clip,
        trimStartKeyframes(originalGainKeyframes, clip.startFrame - oldStart, sample),
      );
    } else if (clip.durationFrames !== oldDuration) {
      assignGainKeyframes(
        clip,
        trimEndKeyframes(originalGainKeyframes, clip.durationFrames, sample),
      );
    }
  }
  touch(next);
  return next;
}

function measuredSourceFrames(project: ProjectDocument, clip: WindowedClip): number {
  if (clip.source.type !== 'asset') {
    throw new ProjectActionError('el clip no referencia un material local');
  }
  const asset = project.assets.find((item) => item.id === clip.source.assetId);
  const media = asset && 'media' in asset ? asset.media : undefined;
  const duration =
    media && 'durationFrames' in media ? media.durationFrames : undefined;
  if (typeof duration !== 'number' || duration <= 0) {
    throw new ProjectActionError('el material no declara una duración medida');
  }
  return duration;
}

function trimGuards(
  project: ProjectDocument,
  clip: WindowedClip,
  options: { allowKeyframes: boolean },
): void {
  const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
  if (!track || track.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const speed = speedOf(clip);
  if (speed.num !== speed.den) {
    throw new ProjectActionError('el ajuste fino requiere velocidad 1×');
  }
  if ('stabilization' in clip && clip.stabilization) {
    throw new ProjectActionError(
      'quitá la estabilización antes de mover la ventana de origen',
    );
  }
  if (options.allowKeyframes) return;
  const maskKeyframes = 'mask' in clip ? clip.mask?.keyframes?.length : undefined;
  if (
    clip.transform?.keyframes?.length ||
    clip.audio?.gainKeyframes?.length ||
    maskKeyframes
  ) {
    throw new ProjectActionError(
      'quitá los keyframes de los clips afectados antes de mover el corte',
    );
  }
}

/**
 * Slip: moves the source window inside the clip without moving the clip on the
 * timeline. The duration and every neighbour stay untouched.
 */
export function slipClip(
  project: ProjectDocument,
  clipId: string,
  deltaFrames: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !isWindowed(clip)) {
    throw new ProjectActionError('el slip necesita un clip de video o audio');
  }
  trimGuards(next, clip, { allowKeyframes: true });
  const delta = Math.round(deltaFrames);
  if (delta === 0) return project;
  const max = measuredSourceFrames(next, clip);
  const inFrame = clip.source.inFrame + delta;
  const outFrame = clip.source.outFrame + delta;
  if (inFrame < 0 || outFrame > max) {
    throw new ProjectActionError(
      'el slip se sale de la ventana disponible del material',
    );
  }
  clip.source.inFrame = inFrame;
  clip.source.outFrame = outFrame;
  touch(next);
  return next;
}

/**
 * Slide: moves the clip on the timeline and absorbs the difference in its two
 * contiguous neighbours. The middle clip keeps its duration and source window.
 */
export function slideClip(
  project: ProjectDocument,
  clipId: string,
  deltaFrames: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !isWindowed(clip)) {
    throw new ProjectActionError('el slide necesita un clip de video o audio');
  }
  const trackClips = next.timeline.clips
    .filter((item) => item.trackId === clip.trackId)
    .sort((a, b) => a.startFrame - b.startFrame);
  const index = trackClips.findIndex((item) => item.id === clip.id);
  const previous = trackClips[index - 1];
  const following = trackClips[index + 1];
  if (!previous || !following) {
    throw new ProjectActionError('slide necesita un clip anterior y otro posterior');
  }
  if (!isWindowed(previous) || !isWindowed(following)) {
    throw new ProjectActionError(
      'slide necesita clips de video o audio a ambos lados',
    );
  }
  if (
    previous.startFrame + previous.durationFrames !== clip.startFrame ||
    clip.startFrame + clip.durationFrames !== following.startFrame
  ) {
    throw new ProjectActionError('slide necesita tres clips contiguos');
  }
  for (const item of [previous, clip, following]) {
    trimGuards(next, item, { allowKeyframes: false });
  }
  const delta = Math.round(deltaFrames);
  if (delta === 0) return project;
  const previousMax = measuredSourceFrames(next, previous);
  const previousDuration = previous.durationFrames + delta;
  const followingDuration = following.durationFrames - delta;
  const followingIn = following.source.inFrame + delta;
  if (previousDuration < 1 || followingDuration < 1) {
    throw new ProjectActionError('slide dejaría un clip sin duración');
  }
  if (
    previous.source.outFrame + delta > previousMax ||
    previous.source.outFrame + delta <= previous.source.inFrame
  ) {
    throw new ProjectActionError(
      'slide se sale de la ventana del clip anterior',
    );
  }
  if (followingIn < 0 || followingIn >= following.source.outFrame) {
    throw new ProjectActionError(
      'slide se sale de la ventana del clip siguiente',
    );
  }
  previous.durationFrames = previousDuration;
  previous.source.outFrame += delta;
  clip.startFrame += delta;
  following.startFrame += delta;
  following.durationFrames = followingDuration;
  following.source.inFrame = followingIn;
  touch(next);
  return next;
}

/**
 * Roll: moves the cut between two contiguous clips without moving either outer
 * edge. `edge: "in"` edits the cut with the previous clip; `"out"` the next.
 */
export function rollClip(
  project: ProjectDocument,
  clipId: string,
  edge: 'in' | 'out',
  deltaFrames: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !isWindowed(clip)) {
    throw new ProjectActionError('el roll necesita un clip de video o audio');
  }
  const trackClips = next.timeline.clips
    .filter((item) => item.trackId === clip.trackId)
    .sort((a, b) => a.startFrame - b.startFrame);
  const index = trackClips.findIndex((item) => item.id === clip.id);
  const left = edge === 'in' ? trackClips[index - 1] : clip;
  const right = edge === 'in' ? clip : trackClips[index + 1];
  if (!left || !right) {
    throw new ProjectActionError(
      edge === 'in'
        ? 'el roll de entrada necesita un clip anterior'
        : 'el roll de salida necesita un clip posterior',
    );
  }
  if (!isWindowed(left) || !isWindowed(right)) {
    throw new ProjectActionError('el roll necesita clips de video o audio');
  }
  if (left.startFrame + left.durationFrames !== right.startFrame) {
    throw new ProjectActionError('los clips del corte no son contiguos');
  }
  trimGuards(next, left, { allowKeyframes: false });
  trimGuards(next, right, { allowKeyframes: false });
  const delta = Math.round(deltaFrames);
  if (delta === 0) return project;
  const leftMax = measuredSourceFrames(next, left);
  const leftDuration = left.durationFrames + delta;
  const rightDuration = right.durationFrames - delta;
  const rightIn = right.source.inFrame + delta;
  if (leftDuration < 1 || rightDuration < 1) {
    throw new ProjectActionError('el roll dejaría un clip sin duración');
  }
  if (
    left.source.outFrame + delta > leftMax ||
    left.source.outFrame + delta <= left.source.inFrame
  ) {
    throw new ProjectActionError('el roll se sale de la ventana del clip izquierdo');
  }
  if (rightIn < 0 || rightIn >= right.source.outFrame) {
    throw new ProjectActionError('el roll se sale de la ventana del clip derecho');
  }
  left.durationFrames = leftDuration;
  left.source.outFrame += delta;
  right.startFrame += delta;
  right.durationFrames = rightDuration;
  right.source.inFrame = rightIn;
  touch(next);
  return next;
}
