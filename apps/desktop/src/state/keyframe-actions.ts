import {
  MAX_GAIN_KEYFRAMES,
  MAX_RAMP_SPEED,
  MAX_TRANSFORM_KEYFRAMES,
  MIN_RAMP_SPEED,
  TRANSFORM_KEYFRAME_SCALE_MAX,
  TRANSFORM_KEYFRAME_SCALE_MIN,
  curveDurationFrames,
  hasGeometryKeyframes,
  sampleGainKeyframes,
  sampleTransformKeyframes,
  type Clip,
  type ClipGainKeyframe,
  type ClipMaskKeyframe,
  type ClipTransformKeyframe,
  type CubicBezier,
  type ProjectDocument,
  type SpeedCurve,
} from '@editor-ia/project-schema';
import {
  ProjectActionError,
  cloneProject,
  gcd,
  isWindowed,
  touch,
} from './project-actions-core';

/**
 * Clip keyframe and speed mutations: mask keyframes, transform keyframes
 * (including the clipboard-style snapshot/paste helpers), gain automation and
 * constant/curve speed changes. Extracted from `project-actions.ts`;
 * `project-actions.ts` re-exports the public API and imports the shared
 * keyframe helpers (`assignTransformKeyframes`, `trimStartKeyframes`, …) that
 * trim/split still need.
 */

export function setMaskKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
  values: Partial<
    Pick<
      ClipMaskKeyframe,
      'x' | 'y' | 'width' | 'height' | 'rotationDeg' | 'feather' | 'easing'
    >
  >,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !('mask' in clip) || !clip.mask) {
    throw new ProjectActionError('el clip no tiene una máscara para animar');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const rounded = Math.round(frame);
  if (rounded < 0 || rounded >= clip.durationFrames) {
    throw new ProjectActionError('el keyframe de máscara debe caer dentro del clip');
  }
  const properties = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(properties).length === 0) {
    throw new ProjectActionError('capturá al menos una propiedad de la máscara');
  }
  const keyframe = { frame: rounded, ...properties } as ClipMaskKeyframe;
  const keyframes = [...(clip.mask.keyframes ?? [])];
  const index = keyframes.findIndex((item) => item.frame === rounded);
  if (index >= 0) keyframes[index] = keyframe;
  else keyframes.push(keyframe);
  keyframes.sort((a, b) => a.frame - b.frame);
  if (keyframes.length > 32) {
    throw new ProjectActionError('la máscara admite como máximo 32 keyframes');
  }
  clip.mask = { ...clip.mask, keyframes };
  touch(next);
  return next;
}

export function removeMaskKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !('mask' in clip) || !clip.mask?.keyframes) {
    return next;
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const keyframes = clip.mask.keyframes.filter((item) => item.frame !== frame);
  if (keyframes.length === 0) {
    const { keyframes: _keyframes, ...rest } = clip.mask;
    clip.mask = rest;
  } else {
    clip.mask = { ...clip.mask, keyframes };
  }
  touch(next);
  return next;
}

export function clearMaskKeyframes(
  project: ProjectDocument,
  clipId: string,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !('mask' in clip) || !clip.mask?.keyframes) {
    return next;
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const { keyframes: _keyframes, ...rest } = clip.mask;
  clip.mask = rest;
  touch(next);
  return next;
}

export type ClipTransformSample = {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  opacity: number;
  keyframed: boolean;
  geometryKeyframed: boolean;
};

/**
 * Transform at a clip-relative frame. A keyframed property overrides its
 * static value; `scale` is a uniform multiplier on top of the static scaleX/Y.
 */
export function clipTransformAtFrame(clip: Clip, frame: number): ClipTransformSample {
  const transform = clip.transform ?? {};
  const keyframes = transform.keyframes ?? [];
  const sampled = sampleTransformKeyframes(keyframes, frame);
  const animatedScale = sampled.scale ?? 1;
  return {
    offsetX: sampled.offsetX ?? transform.offsetX ?? 0,
    offsetY: sampled.offsetY ?? transform.offsetY ?? 0,
    scaleX: (transform.scaleX ?? 1) * animatedScale,
    scaleY: (transform.scaleY ?? 1) * animatedScale,
    rotationDeg: sampled.rotationDeg ?? transform.rotationDeg ?? 0,
    opacity: sampled.opacity ?? transform.opacity ?? 1,
    keyframed: keyframes.length > 0,
    geometryKeyframed: hasGeometryKeyframes(keyframes),
  };
}

export function clipGainAtFrame(clip: Clip, frame: number): number {
  const keyframes = clip.audio?.gainKeyframes ?? [];
  return sampleGainKeyframes(keyframes, frame) ?? clip.audio?.gainDb ?? 0;
}

/**
 * Current look at a clip-relative frame, ready to pin as a keyframe.
 *
 * `scale` is captured as the uniform keyframe multiplier on top of the static
 * scaleX/scaleY, so pinning a key does not reset a clip that was already
 * scaled. Offsets, rotation and opacity fall back to the static transform.
 */
export function captureTransformKeyframe(clip: Clip, frame: number): TransformKeyframePatch {
  const transform = clip.transform ?? {};
  const sampled = sampleTransformKeyframes(transform.keyframes ?? [], frame);
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return {
    offsetX: Math.round(sampled.offsetX ?? transform.offsetX ?? 0),
    offsetY: Math.round(sampled.offsetY ?? transform.offsetY ?? 0),
    scale: round(sampled.scale ?? 1),
    rotationDeg: round(sampled.rotationDeg ?? transform.rotationDeg ?? 0),
    opacity: round(sampled.opacity ?? transform.opacity ?? 1),
  };
}

export type TransformKeyframePatch = Omit<
  Partial<Omit<ClipTransformKeyframe, 'frame'>>,
  'bezier'
> & {
  /** `null` borra la curva Bézier guardada (vuelve a regir el `easing`). */
  bezier?: CubicBezier | null | undefined;
};
type FrameKeyframe = { frame: number };

export function assignTransformKeyframes(clip: Clip, keyframes: ClipTransformKeyframe[]): void {
  const transform = clip.transform ?? {};
  if (keyframes.length === 0) {
    delete transform.keyframes;
  } else {
    transform.keyframes = keyframes;
  }
  if (Object.keys(transform).length === 0) {
    delete clip.transform;
  } else {
    clip.transform = transform;
  }
}

export function assignGainKeyframes(clip: Clip, keyframes: ClipGainKeyframe[]): void {
  const audio = clip.audio ?? {};
  if (keyframes.length === 0) {
    delete audio.gainKeyframes;
  } else {
    audio.gainKeyframes = keyframes;
  }
  if (Object.keys(audio).length === 0) {
    delete clip.audio;
  } else {
    clip.audio = audio;
  }
}

/** Patch ya normalizado: `bezier` nunca es `null` (undefined = borrado). */
type NormalizedTransformPatch = Omit<TransformKeyframePatch, 'bezier'> & {
  bezier?: CubicBezier | undefined;
};

function normalizeTransformPatch(patch: TransformKeyframePatch): NormalizedTransformPatch {
  const clean: NormalizedTransformPatch = {};
  if (patch.offsetX !== undefined) {
    if (!Number.isFinite(patch.offsetX) || Math.abs(patch.offsetX) > 100_000) {
      throw new ProjectActionError('el desplazamiento debe estar entre -100000 y 100000');
    }
    clean.offsetX = Math.round(patch.offsetX);
  }
  if (patch.offsetY !== undefined) {
    if (!Number.isFinite(patch.offsetY) || Math.abs(patch.offsetY) > 100_000) {
      throw new ProjectActionError('el desplazamiento debe estar entre -100000 y 100000');
    }
    clean.offsetY = Math.round(patch.offsetY);
  }
  if (patch.scale !== undefined) {
    if (
      !Number.isFinite(patch.scale) ||
      patch.scale < TRANSFORM_KEYFRAME_SCALE_MIN ||
      patch.scale > TRANSFORM_KEYFRAME_SCALE_MAX
    ) {
      throw new ProjectActionError(
        `la escala animada debe estar entre ${TRANSFORM_KEYFRAME_SCALE_MIN} y ${TRANSFORM_KEYFRAME_SCALE_MAX}`,
      );
    }
    clean.scale = patch.scale;
  }
  if (patch.rotationDeg !== undefined) {
    if (!Number.isFinite(patch.rotationDeg) || Math.abs(patch.rotationDeg) > 360) {
      throw new ProjectActionError('la rotación debe estar entre -360 y 360 grados');
    }
    clean.rotationDeg = patch.rotationDeg;
  }
  if (patch.opacity !== undefined) {
    if (!Number.isFinite(patch.opacity) || patch.opacity < 0 || patch.opacity > 1) {
      throw new ProjectActionError('la opacidad debe estar entre 0 y 1');
    }
    clean.opacity = patch.opacity;
  }
  if (patch.easing !== undefined) {
    if (
      patch.easing !== 'linear' &&
      patch.easing !== 'ease-in' &&
      patch.easing !== 'ease-out' &&
      patch.easing !== 'ease-in-out' &&
      patch.easing !== 'hold'
    ) {
      throw new ProjectActionError('la curva de la clave no es válida');
    }
    clean.easing = patch.easing;
  }
  if (patch.bezier === null) {
    // Borrado explícito: la clave vuelve a regirse por `easing`.
    clean.bezier = undefined;
  } else if (patch.bezier !== undefined) {
    const { cp1X, cp1Y, cp2X, cp2Y } = patch.bezier;
    // X debe ser monótono [0,1]; Y admite overshoot [-1,2] para los presets
    // de rebote (mismo rango que CubicBezierSchema).
    const inRange = (value: number, min: number, max: number) =>
      Number.isFinite(value) && value >= min && value <= max;
    if (
      !inRange(cp1X, 0, 1) ||
      !inRange(cp2X, 0, 1) ||
      !inRange(cp1Y, -1, 2) ||
      !inRange(cp2Y, -1, 2)
    ) {
      throw new ProjectActionError(
        'los puntos de control de la curva deben tener X en 0–1 e Y en -1–2',
      );
    }
    clean.bezier = { cp1X, cp1Y, cp2X, cp2Y };
  }
  if (Object.values(clean).every((value) => value === undefined)) {
    throw new ProjectActionError('la clave necesita al menos una propiedad animada');
  }
  return clean;
}

/** Creates or updates a transform keyframe at a clip-relative frame. */
export function setTransformKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
  patch: TransformKeyframePatch,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
    throw new ProjectActionError('este tipo de clip no acepta keyframes de transformación');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const offset = Math.round(frame);
  if (offset < 0 || offset >= clip.durationFrames) {
    throw new ProjectActionError('la clave debe caer dentro del clip');
  }
  const clean = normalizeTransformPatch(patch);
  const keyframes = (clip.transform?.keyframes ?? []).map((keyframe) => ({ ...keyframe }));
  const index = keyframes.findIndex((keyframe) => keyframe.frame === offset);
  if (index < 0 && Object.keys(clean).every((key) => key === 'easing')) {
    throw new ProjectActionError('la clave necesita al menos una propiedad animada');
  }
  if (index >= 0) {
    keyframes[index] = { ...keyframes[index], ...clean, frame: offset };
  } else {
    if (keyframes.length >= MAX_TRANSFORM_KEYFRAMES) {
      throw new ProjectActionError(
        `este clip ya tiene el máximo de ${MAX_TRANSFORM_KEYFRAMES} keyframes`,
      );
    }
    keyframes.push({ frame: offset, ...clean });
  }
  keyframes.sort((a, b) => a.frame - b.frame);
  assignTransformKeyframes(clip, keyframes);
  touch(next);
  return next;
}

/**
 * Aplica la misma curva Bézier a TODOS los keyframes de transformación del
 * clip (paridad del popup de `curvas_predefinidas.js` de AlaukCut, que
 * aplica la curva a todos los keyframes del instante). Misma semántica que
 * el selector «Preset Bézier» por clave: `bezier` + `easing:'linear'` (el
 * preset vuelve a regir el segmento).
 */
export function applyTransformBezierToAllKeyframes(
  project: ProjectDocument,
  clipId: string,
  bezier: CubicBezier,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
    throw new ProjectActionError('este tipo de clip no acepta keyframes de transformación');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const keyframes = clip.transform?.keyframes ?? [];
  if (keyframes.length === 0) {
    throw new ProjectActionError('el clip no tiene keyframes de transformación');
  }
  assignTransformKeyframes(
    clip,
    keyframes.map((keyframe) => ({
      ...keyframe,
      bezier: { ...bezier },
      easing: 'linear' as const,
    })),
  );
  touch(next);
  return next;
}

/**
 * Copies every animated property stored at a clip-relative `frame`, ready to
 * paste onto another keyframe. Returns null when no keyframe exists there.
 * Equivalent of AlaukCut's `fotografar`: easing and bezier travel with the
 * values so the pasted segment keeps its curve.
 */
export function snapshotTransformKeyframes(
  clip: Clip,
  frame: number,
): TransformKeyframePatch | null {
  const offset = Math.round(frame);
  const matches = (clip.transform?.keyframes ?? []).filter(
    (keyframe) => keyframe.frame === offset,
  );
  if (matches.length === 0) return null;
  const patch: TransformKeyframePatch = {};
  for (const keyframe of matches) {
    if (keyframe.offsetX !== undefined) patch.offsetX = keyframe.offsetX;
    if (keyframe.offsetY !== undefined) patch.offsetY = keyframe.offsetY;
    if (keyframe.scale !== undefined) patch.scale = keyframe.scale;
    if (keyframe.rotationDeg !== undefined) patch.rotationDeg = keyframe.rotationDeg;
    if (keyframe.opacity !== undefined) patch.opacity = keyframe.opacity;
    if (keyframe.easing !== undefined) patch.easing = keyframe.easing;
    if (keyframe.bezier !== undefined) {
      patch.bezier = { ...keyframe.bezier };
    }
  }
  return patch;
}

/**
 * Whether `pasteTransformKeyframes` would accept this clip/frame: the clip is
 * a transformable visual on an unlocked track and the frame lands inside it.
 */
export function canPasteTransformKeyframes(
  project: ProjectDocument,
  clipId: string,
  frame: number,
): boolean {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return false;
  if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
    return false;
  }
  if (project.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    return false;
  }
  const offset = Math.round(frame);
  return offset >= 0 && offset < clip.durationFrames;
}

/**
 * Pastes a copied transform snapshot at a clip-relative frame, merging over
 * whatever the target keyframe already animates. Equivalent of AlaukCut's
 * `colarNaAgulha` for a single clip.
 */
export function pasteTransformKeyframes(
  project: ProjectDocument,
  clipId: string,
  frame: number,
  patch: TransformKeyframePatch,
): ProjectDocument {
  return setTransformKeyframe(project, clipId, frame, patch);
}

/**
 * Visual clips whose timeline window covers `timelineFrame`, topmost track
 * first excluded — returns every unlocked candidate so callers can paste to
 * all of them like AlaukCut's `colarDaTecla`.
 */
export function clipsCoveringFrame(
  project: ProjectDocument,
  timelineFrame: number,
): Clip[] {
  return project.timeline.clips.filter(
    (clip) =>
      (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze') &&
      timelineFrame >= clip.startFrame &&
      timelineFrame < clip.startFrame + clip.durationFrames,
  );
}

/**
 * Pastes the snapshot at `timelineFrame` on every visual clip under it,
 * converting to each clip's local frame. Returns the next project and how
 * many clips received the paste.
 */
export function pasteTransformKeyframesAtPlayhead(
  project: ProjectDocument,
  timelineFrame: number,
  patch: TransformKeyframePatch,
): { project: ProjectDocument; applied: number } {
  let next = project;
  let applied = 0;
  for (const clip of clipsCoveringFrame(next, timelineFrame)) {
    const localFrame = timelineFrame - clip.startFrame;
    if (!canPasteTransformKeyframes(next, clip.id, localFrame)) continue;
    try {
      next = pasteTransformKeyframes(next, clip.id, localFrame, patch);
      applied += 1;
    } catch {
      // Un clip al límite de keyframes o similar no debe frenar el resto.
    }
  }
  return { project: next, applied };
}

export function removeTransformKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const keyframes = clip.transform?.keyframes ?? [];
  const offset = Math.round(frame);
  if (!keyframes.some((keyframe) => keyframe.frame === offset)) {
    return project;
  }
  assignTransformKeyframes(
    clip,
    keyframes
      .filter((keyframe) => keyframe.frame !== offset)
      .map((keyframe) => ({ ...keyframe })),
  );
  touch(next);
  return next;
}

/** Removes the animation but freezes the value at `freezeAtFrame` in the static transform. */
export function clearTransformKeyframes(
  project: ProjectDocument,
  clipId: string,
  freezeAtFrame = 0,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  const keyframes = clip.transform?.keyframes ?? [];
  if (keyframes.length === 0) {
    return project;
  }
  const transform = { ...(clip.transform ?? {}) };
  const freeze = Math.max(0, Math.min(clip.durationFrames - 1, Math.round(freezeAtFrame)));
  const sampled = sampleTransformKeyframes(keyframes, freeze);
  if (sampled.offsetX !== undefined) transform.offsetX = sampled.offsetX;
  if (sampled.offsetY !== undefined) transform.offsetY = sampled.offsetY;
  if (sampled.scale !== undefined) {
    transform.scaleX = (transform.scaleX ?? 1) * sampled.scale;
    transform.scaleY = (transform.scaleY ?? 1) * sampled.scale;
  }
  if (sampled.rotationDeg !== undefined) transform.rotationDeg = sampled.rotationDeg;
  if (sampled.opacity !== undefined) transform.opacity = sampled.opacity;
  delete transform.keyframes;
  if (Object.keys(transform).length === 0) {
    delete clip.transform;
  } else {
    clip.transform = transform;
  }
  touch(next);
  return next;
}

/** Creates or updates a gain keyframe at a clip-relative frame. */
export function setGainKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
  gainDb: number,
  easing: NonNullable<ClipGainKeyframe['easing']> = 'linear',
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (clip.kind !== 'video' && clip.kind !== 'audio') {
    throw new ProjectActionError('este tipo de clip no tiene audio para automatizar');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (!Number.isFinite(gainDb) || gainDb < -60 || gainDb > 12) {
    throw new ProjectActionError('la ganancia debe estar entre -60 y 12 dB');
  }
  if (
    easing !== 'linear' &&
    easing !== 'ease-in' &&
    easing !== 'ease-out' &&
    easing !== 'ease-in-out' &&
    easing !== 'hold'
  ) {
    throw new ProjectActionError('la curva de la clave de volumen no es válida');
  }
  const offset = Math.round(frame);
  if (offset < 0 || offset >= clip.durationFrames) {
    throw new ProjectActionError('la clave debe caer dentro del clip');
  }
  const audio = { ...(clip.audio ?? {}) };
  const keyframes = (audio.gainKeyframes ?? []).map((keyframe) => ({ ...keyframe }));
  const index = keyframes.findIndex((keyframe) => keyframe.frame === offset);
  if (index >= 0) {
    keyframes[index] = { frame: offset, gainDb, easing };
  } else {
    if (keyframes.length >= MAX_GAIN_KEYFRAMES) {
      throw new ProjectActionError(
        `este clip ya tiene el máximo de ${MAX_GAIN_KEYFRAMES} keyframes de volumen`,
      );
    }
    keyframes.push({ frame: offset, gainDb, easing });
  }
  keyframes.sort((a, b) => a.frame - b.frame);
  audio.gainKeyframes = keyframes;
  clip.audio = audio;
  touch(next);
  return next;
}

export function removeGainKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const keyframes = clip.audio?.gainKeyframes ?? [];
  const offset = Math.round(frame);
  if (!keyframes.some((keyframe) => keyframe.frame === offset)) {
    return project;
  }
  assignGainKeyframes(
    clip,
    keyframes
      .filter((keyframe) => keyframe.frame !== offset)
      .map((keyframe) => ({ ...keyframe })),
  );
  touch(next);
  return next;
}

/** Removes gain automation but freezes the sampled gain at `freezeAtFrame`. */
export function clearGainKeyframes(
  project: ProjectDocument,
  clipId: string,
  freezeAtFrame = 0,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  const keyframes = clip.audio?.gainKeyframes ?? [];
  if (keyframes.length === 0) {
    return project;
  }
  const audio = { ...(clip.audio ?? {}) };
  const freeze = Math.max(0, Math.min(clip.durationFrames - 1, Math.round(freezeAtFrame)));
  audio.gainDb = sampleGainKeyframes(keyframes, freeze) ?? audio.gainDb ?? 0;
  delete audio.gainKeyframes;
  clip.audio = audio;
  touch(next);
  return next;
}

function sliceKeyframes<T extends FrameKeyframe>(
  keyframes: readonly T[] | undefined,
  cutFrame: number,
  sampleAt: (frame: number) => Partial<Omit<T, 'frame'>>,
): { left: T[]; right: T[] } | undefined {
  if (!keyframes || keyframes.length === 0) {
    return undefined;
  }
  const left = keyframes
    .filter((keyframe) => keyframe.frame < cutFrame)
    .map((keyframe) => ({ ...keyframe }));
  const right = keyframes
    .filter((keyframe) => keyframe.frame >= cutFrame)
    .map((keyframe) => ({ ...keyframe, frame: keyframe.frame - cutFrame }));
  if (cutFrame > 0) {
    if (!left.some((keyframe) => keyframe.frame === cutFrame - 1)) {
      left.push({ frame: cutFrame - 1, ...sampleAt(cutFrame - 1) } as T);
    }
    if (!right.some((keyframe) => keyframe.frame === 0)) {
      right.unshift({ frame: 0, ...sampleAt(cutFrame) } as T);
    }
  }
  left.sort((a, b) => a.frame - b.frame);
  right.sort((a, b) => a.frame - b.frame);
  return { left, right };
}

export function trimStartKeyframes<T extends FrameKeyframe>(
  keyframes: readonly T[],
  delta: number,
  sampleAt: (frame: number) => Partial<Omit<T, 'frame'>>,
): T[] {
  if (delta === 0) {
    return keyframes.map((keyframe) => ({ ...keyframe }));
  }
  if (delta < 0) {
    return keyframes
      .map((keyframe) => ({ ...keyframe, frame: keyframe.frame - delta }))
      .sort((a, b) => a.frame - b.frame);
  }
  const shifted = keyframes
    .filter((keyframe) => keyframe.frame >= delta)
    .map((keyframe) => ({ ...keyframe, frame: keyframe.frame - delta }));
  if (!shifted.some((keyframe) => keyframe.frame === 0)) {
    shifted.unshift({ frame: 0, ...sampleAt(delta) } as T);
  }
  return shifted.sort((a, b) => a.frame - b.frame);
}

export function trimEndKeyframes<T extends FrameKeyframe>(
  keyframes: readonly T[],
  newDuration: number,
  sampleAt: (frame: number) => Partial<Omit<T, 'frame'>>,
): T[] {
  const kept = keyframes
    .filter((keyframe) => keyframe.frame < newDuration)
    .map((keyframe) => ({ ...keyframe }));
  const boundary = Math.max(0, newDuration - 1);
  if (!kept.some((keyframe) => keyframe.frame === boundary)) {
    kept.push({ frame: boundary, ...sampleAt(boundary) } as T);
  }
  return kept.sort((a, b) => a.frame - b.frame);
}

function scaleKeyframes<T extends FrameKeyframe>(
  keyframes: readonly T[],
  factor: number,
  maxFrame: number,
): T[] {
  const merged = new Map<number, T>();
  for (const keyframe of keyframes) {
    const frame = Math.max(0, Math.min(maxFrame, Math.round(keyframe.frame * factor)));
    const previous = merged.get(frame);
    merged.set(frame, { ...(previous ?? {}), ...keyframe, frame } as T);
  }
  return [...merged.values()].sort((a, b) => a.frame - b.frame);
}

export function applySplitKeyframes(
  left: Clip,
  right: Clip,
  cutFrame: number,
  transformKeyframes: readonly ClipTransformKeyframe[] | undefined,
  gainKeyframes: readonly ClipGainKeyframe[] | undefined,
): void {
  if (transformKeyframes && transformKeyframes.length > 0) {
    const sliced = sliceKeyframes(transformKeyframes, cutFrame, (frame) =>
      sampleTransformKeyframes(transformKeyframes, frame),
    );
    if (sliced) {
      assignTransformKeyframes(left, sliced.left);
      assignTransformKeyframes(right, sliced.right);
    }
  }
  if (gainKeyframes && gainKeyframes.length > 0) {
    const sliced = sliceKeyframes(gainKeyframes, cutFrame, (frame) => ({
      gainDb: sampleGainKeyframes(gainKeyframes, frame) ?? 0,
    }));
    if (sliced) {
      assignGainKeyframes(left, sliced.left);
      assignGainKeyframes(right, sliced.right);
    }
  }
}

/** Change the playback speed of a windowed clip and ripple the rest of its track.
 * The source window is adjusted so `durationFrames x speed = sourceFrames` stays exact.
 * `smoothSlowMotion` only applies to video below 1× and turns on render interpolation. */
export function setClipSpeed(
  project: ProjectDocument,
  clipId: string,
  speed: number,
  options?: { readonly smoothSlowMotion?: boolean },
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !isWindowed(clip)) {
    throw new ProjectActionError('solo los clips de video o audio tienen velocidad');
  }
  const track = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (track?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const requested = Number.isFinite(speed) ? Math.max(0.1, Math.min(4, speed)) : 1;
  const rawDen = 1_000;
  const rawNum = Math.max(1, Math.round(requested * rawDen));
  const divisor = gcd(rawNum, rawDen);
  const num = rawNum / divisor;
  const den = rawDen / divisor;
  const sourceFrames = clip.source.outFrame - clip.source.inFrame;
  const oldDuration = clip.durationFrames;
  const asset = next.assets.find((item) => item.id === clip.source.assetId);
  const mediaFrames =
    asset && 'media' in asset && asset.media && 'durationFrames' in asset.media
      ? asset.media.durationFrames
      : undefined;
  const maxSourceFrames =
    mediaFrames !== undefined ? Math.max(1, mediaFrames - clip.source.inFrame) : sourceFrames;

  let duration: number;
  if (num === den) {
    duration = Math.min(sourceFrames, maxSourceFrames);
    delete clip.speed;
    if (clip.kind === 'video') delete clip.slowMotionSmoothing;
    clip.source.outFrame = clip.source.inFrame + duration;
  } else {
    const unit = den / gcd(num, den);
    duration = Math.max(unit, Math.round((sourceFrames * den) / num / unit) * unit);
    let source = (duration * num) / den;
    while (source > maxSourceFrames && duration > unit) {
      duration -= unit;
      source = (duration * num) / den;
    }
    if (!Number.isInteger(source) || source < 1) {
      throw new ProjectActionError('esa velocidad no se puede representar en frames enteros');
    }
    clip.durationFrames = duration;
    clip.source.outFrame = clip.source.inFrame + source;
    clip.speed = { num, den };
    if (clip.kind === 'video') {
      const smooth =
        num < den && (options?.smoothSlowMotion ?? clip.slowMotionSmoothing === true);
      if (smooth) clip.slowMotionSmoothing = true;
      else delete clip.slowMotionSmoothing;
    }
  }
  const delta = clip.durationFrames - oldDuration;
  const oldEnd = clip.startFrame + oldDuration;
  if (delta !== 0) {
    for (const other of next.timeline.clips) {
      if (other.id === clip.id || other.trackId !== clip.trackId) continue;
      if (other.startFrame >= oldEnd) {
        other.startFrame = Math.max(0, other.startFrame + delta);
      }
    }
  }
  touch(next);
  return next;
}

/**
 * Aplica una curva de velocidad continua a un clip de video.
 *
 * La ventana de origen no se toca: la curva decide cuánto dura la salida, y la
 * duración resultante es `sourceFrames / media(speed)`. Los clips siguientes de
 * la pista se desplazan como en cualquier cambio de velocidad.
 */
export function applySpeedCurvePoints(
  project: ProjectDocument,
  clipId: string,
  curve: SpeedCurve,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || clip.kind !== 'video') {
    throw new ProjectActionError('la curva de velocidad continua necesita un clip de video');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (clip.transform?.keyframes?.length || clip.audio?.gainKeyframes?.length) {
    throw new ProjectActionError(
      'quitá los keyframes de transformación o volumen antes de aplicar la curva',
    );
  }
  if (clip.motion) {
    throw new ProjectActionError('quitá el movimiento Ken Burns antes de aplicar la curva');
  }
  if (clip.reverse) {
    throw new ProjectActionError('quitá el reverse antes de aplicar la curva');
  }
  if (clip.stabilization) {
    throw new ProjectActionError('quitá la estabilización antes de aplicar la curva');
  }
  if (clip.transitionIn) {
    throw new ProjectActionError('quitá la transición de entrada antes de aplicar la curva');
  }
  const points = curve.points;
  if (points.length < 2 || points.length > 50) {
    throw new ProjectActionError('la curva necesita entre 2 y 50 puntos');
  }
  if (points[0]!.t !== 0 || points[points.length - 1]!.t !== 1) {
    throw new ProjectActionError('la curva debe empezar en 0 y terminar en 1');
  }
  let previous = -1;
  for (const point of points) {
    if (!Number.isFinite(point.t) || point.t <= previous || point.t < 0 || point.t > 1) {
      throw new ProjectActionError('los puntos de la curva deben estar ordenados entre 0 y 1');
    }
    if (!Number.isFinite(point.speed) || point.speed < MIN_RAMP_SPEED || point.speed > MAX_RAMP_SPEED) {
      throw new ProjectActionError('las velocidades de la curva deben estar entre 0.1x y 4x');
    }
    previous = point.t;
  }
  const sourceFrames = clip.source.outFrame - clip.source.inFrame;
  const oldDuration = clip.durationFrames;
  const duration = curveDurationFrames(sourceFrames, curve);
  clip.durationFrames = duration;
  clip.speedCurve = curve;
  delete clip.speed;
  delete clip.slowMotionSmoothing;
  const delta = duration - oldDuration;
  const oldEnd = clip.startFrame + oldDuration;
  if (delta !== 0) {
    for (const other of next.timeline.clips) {
      if (other.id === clip.id || other.trackId !== clip.trackId) continue;
      if (other.startFrame >= oldEnd) {
        other.startFrame = Math.max(0, other.startFrame + delta);
      }
    }
  }
  touch(next);
  return next;
}

/** Quita la curva y devuelve el clip a 1× sin mover la ventana de origen. */
export function removeSpeedCurve(project: ProjectDocument, clipId: string): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || clip.kind !== 'video') {
    throw new ProjectActionError('sólo los clips de video tienen curva de velocidad');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const sourceFrames = clip.source.outFrame - clip.source.inFrame;
  const oldDuration = clip.durationFrames;
  delete clip.speedCurve;
  delete clip.speed;
  clip.durationFrames = Math.max(1, sourceFrames);
  const delta = clip.durationFrames - oldDuration;
  const oldEnd = clip.startFrame + oldDuration;
  if (delta !== 0) {
    for (const other of next.timeline.clips) {
      if (other.id === clip.id || other.trackId !== clip.trackId) continue;
      if (other.startFrame >= oldEnd) {
        other.startFrame = Math.max(0, other.startFrame + delta);
      }
    }
  }
  touch(next);
  return next;
}

/** Activa o desactiva la interpolación de una cámara lenta ya aplicada.
 * El render sólo la usa en video por debajo de 1×; en 1× o más se descarta. */
export function setSlowMotionSmoothing(
  project: ProjectDocument,
  clipId: string,
  enabled: boolean,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || clip.kind !== 'video') {
    throw new ProjectActionError('sólo los clips de video pueden interpolar la cámara lenta');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const slow = (clip.speed?.num ?? 1) < (clip.speed?.den ?? 1);
  if (enabled && !slow) {
    throw new ProjectActionError('aplicá primero una velocidad menor a 1×');
  }
  if (enabled) clip.slowMotionSmoothing = true;
  else delete clip.slowMotionSmoothing;
  touch(next);
  return next;
}
