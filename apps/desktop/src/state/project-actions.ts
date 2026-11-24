import type {
  Asset,
  BlendMode,
  Clip,
  ChromaKey,
  ClipEffects,
  ClipMotion,
  ClipTransition,
  ClipMask,
  ClipAnimation,
  ClipColorTag,
  Compound,
  CompoundInnerClip,
  MotionItem,
  ProjectDocument,
  Track,
} from '@editor-ia/project-schema';
import { friendlyAssetLabel } from './asset-labels';
import { markAssetReady } from './assets-actions';
import { AUDIO_PRESETS, type AudioPresetId } from './audio-presets';
import { evenDimension, retimeProject, validFpsRange } from './video-format';
import { ensureCaptionSetup } from './caption-actions';
import { applySplitKeyframes } from './keyframe-actions';
import { attachNarrationAsset } from './scene-actions';
import { syncNativeProfile } from './delivery-actions';
import {
  ProjectActionError,
  addTrack,
  canPlaceClip,
  clipEnd,
  cloneProject,
  findGap,
  fpsOf,
  gcd,
  intervalsForTrack,
  isWindowed,
  newId,
  secondsToFrames,
  speedOf,
  touch,
} from './project-actions-core';

export {
  ProjectActionError,
  addTrack,
  canPlaceClip,
  cloneProject,
  fpsOf,
  formatTimecode,
  framesToSeconds,
  isDropFrameFps,
  newId,
  secondsToFrames,
  touch,
  trackKindForClip,
} from './project-actions-core';
export * from './caption-actions';
export {
  applySpeedCurvePoints,
  applyTransformBezierToAllKeyframes,
  canPasteTransformKeyframes,
  captureTransformKeyframe,
  clearGainKeyframes,
  clearMaskKeyframes,
  clearTransformKeyframes,
  clipGainAtFrame,
  clipTransformAtFrame,
  clipsCoveringFrame,
  pasteTransformKeyframes,
  pasteTransformKeyframesAtPlayhead,
  removeGainKeyframe,
  removeMaskKeyframe,
  removeSpeedCurve,
  removeTransformKeyframe,
  setClipSpeed,
  setGainKeyframe,
  setMaskKeyframe,
  setSlowMotionSmoothing,
  setTransformKeyframe,
  snapshotTransformKeyframes,
} from './keyframe-actions';
export type {
  ClipTransformSample,
  TransformKeyframePatch,
} from './keyframe-actions';
export {
  applyFaceCenteredZoom,
  computeFaceCenteredOffsets,
  TALKING_HEAD_DEFAULT_FACE,
} from './face-zoom';
export type {
  ApplyFaceZoomOptions,
  ApplyFaceZoomResult,
  FaceCenteredOffsets,
  FaceFramingMode,
  FaceTarget,
  FaceZoomStyle,
} from './face-zoom';
export {
  autoPlaceSfx,
  ensureSfxAsset,
  SFX_CATALOG,
} from './sfx-placer';
export type {
  AutoPlaceSfxOptions,
  AutoPlaceSfxResult,
  BuiltinSfxId,
  PlacedSfxEvent,
  SfxPresetDefinition,
} from './sfx-placer';
export {
  applySemanticBroll,
  assetKeywords,
  extractKeywords,
  planSemanticBroll,
  scoreBrollMatch,
} from './broll-matcher';
export type {
  ApplySemanticBrollOptions,
  ApplySemanticBrollResult,
  KeywordMatchResult,
  PlannedBrollPlacement,
  PlanSemanticBrollOptions,
} from './broll-matcher';
export {
  applyMusicDucking,
  buildDuckingKeyframes,
  detectPunchlineMoments,
  modulateCutSeconds,
  pacingZoneAt,
  DEFAULT_PACING_ZONES,
} from './dynamic-pacing';
export type {
  ApplyMusicDuckingOptions,
  ApplyMusicDuckingResult,
  DuckingKeyframe,
  PacingZone,
  PunchlineMoment,
} from './dynamic-pacing';
export {
  addVoxCallout,
  addVoxCounter,
  addVoxHighlighter,
  autoPlaceVoxGraphics,
  detectVoxMoments,
} from './vox-motion';
export type {
  AddVoxCalloutOptions,
  AddVoxCounterOptions,
  AddVoxHighlighterOptions,
  AutoPlaceVoxOptions,
  AutoPlaceVoxResult,
  DetectedVoxMoment,
  VoxKind,
} from './vox-motion';
export { applyAutoZooms, planAutoZooms } from './auto-zoom';
export type {
  ApplyAutoZoomsResult,
  AutoZoomPlanItem,
  PlanAutoZoomsOptions,
} from './auto-zoom';
export {
  addScene,
  applyScenePlan,
  attachNarrationAsset,
  moveScene,
  removeScene,
  reorderScenes,
  updateScene,
} from './scene-actions';
export type { AppliedScenePlan } from './scene-actions';
export { rollClip, slideClip, slipClip, trimClip } from './trim-actions';
export {
  applyCompression,
  applyPixelFormat,
  applyProfileFit,
  COMPRESSION_PRESETS,
  compressionPresetOf,
  ensureDelivery,
  syncNativeProfile,
} from './delivery-actions';
export type {
  CompressionPreset,
  CompressionPresetId,
} from './delivery-actions';
export {
  applyBreathingLoop,
  applyClickPulse,
  applyFaceBlurOverlay,
  applyFaceCenter,
  applyMaskTrack,
} from './overlay-actions';
export type {
  BreathingLoopOptions,
  ClickPulseOptions,
  FaceBlurOverlayOptions,
  FaceBlurSample,
  FaceCenterSample,
} from './overlay-actions';
export {
  addAsset,
  markAssetReady,
  markAssetReadyFrom,
  removeAsset,
  relinkAsset,
  setAssetProxy,
  toggleAssetFavorite,
  updateAssetLabel,
  updateAssetMetadata,
} from './assets-actions';

/**
 * Pure project mutations.
 *
 * Every function returns a new document or `null` when the operation would
 * break the canonical format. The store validates the result before adopting
 * it, so an editor bug can never write a project the Rust boundary rejects.
 * Timeline timing stays in integer frames and every trim/split preserves the
 * `duration x speed = sourceWindow` identity.
 */

/**
 * Adds a source-less adjustment layer at the playhead. It lands on its own
 * track (created on demand) and grades the composite only inside its window;
 * the default length is three seconds because it is a grade range, not media.
 */
export function addAdjustmentLayer(
  project: ProjectDocument,
  atFrame: number,
  options: { durationFrames?: number; trackId?: string } = {},
): { project: ProjectDocument; clipId: string; trackId: string; startFrame: number } {
  const next = cloneProject(project);
  const fps = fpsOf(next);
  let track: Track | undefined;
  if (options.trackId) {
    track = next.timeline.tracks.find((item) => item.id === options.trackId);
    if (!track || track.kind !== 'adjustment') {
      throw new ProjectActionError('la pista elegida no es una pista de ajustes');
    }
    if (track.locked) {
      throw new ProjectActionError('la pista de ajustes está bloqueada');
    }
  } else {
    track = next.timeline.tracks.find(
      (item) => item.kind === 'adjustment' && !item.locked,
    );
    if (!track) {
      const created = addTrack(next, 'adjustment', 'Ajustes');
      next.timeline = created.project.timeline;
      track = next.timeline.tracks.find((item) => item.id === created.trackId);
      if (!track) {
        throw new ProjectActionError('no se pudo crear la pista de ajustes');
      }
    }
  }
  const durationFrames = Math.max(
    1,
    Math.round(options.durationFrames ?? Math.round(fps * 3)),
  );
  const startFrame = findGap(
    intervalsForTrack(next, track.id),
    Math.max(0, Math.round(atFrame)),
    durationFrames,
  );
  const clipId = newId();
  const clip: Clip = {
    id: clipId,
    trackId: track.id,
    kind: 'adjustment',
    label: 'Capa de ajuste',
    startFrame,
    durationFrames,
    source: { type: 'adjustment' },
    effects: {},
  };
  next.timeline.clips.push(clip);
  touch(next);
  return { project: next, clipId, trackId: track.id, startFrame };
}

/**
 * Adds a motion item and its graphic clip. The props are validated by the
 * template catalog before this action; the project schema only stores the
 * template reference and the opaque props, so the renderer can evolve without
 * migrating the project.
 */
export function addMotionGraphic(
  project: ProjectDocument,
  input: {
    readonly templateId: string;
    readonly templateVersion: string;
    readonly props: Readonly<Record<string, unknown>>;
    readonly durationFrames: number;
    readonly atFrame: number;
    readonly trackId?: string;
    readonly label?: string;
  },
): {
  project: ProjectDocument;
  motionId: string;
  clipId: string;
  trackId: string;
  startFrame: number;
} {
  const durationFrames = Math.max(1, Math.round(input.durationFrames));
  const next = cloneProject(project);
  let track = input.trackId
    ? next.timeline.tracks.find((item) => item.id === input.trackId)
    : next.timeline.tracks.find((item) => item.kind === 'graphic' && !item.locked);
  if (input.trackId) {
    if (!track || track.kind !== 'graphic') {
      throw new ProjectActionError('la pista elegida no es una pista gráfica');
    }
    if (track.locked) throw new ProjectActionError('la pista gráfica está bloqueada');
  } else if (!track) {
    const created = addTrack(next, 'graphic', 'G1');
    next.timeline = created.project.timeline;
    track = next.timeline.tracks.find((item) => item.id === created.trackId);
    if (!track) throw new ProjectActionError('no se pudo crear la pista gráfica');
  }
  const startFrame = findGap(
    intervalsForTrack(next, track.id),
    Math.max(0, Math.round(input.atFrame)),
    durationFrames,
  );
  const motionId = newId();
  const clipId = newId();
  const motion: MotionItem = {
    id: motionId,
    template: {
      id: input.templateId,
      version: input.templateVersion,
      source: 'bundled',
    },
    props: { ...input.props } as MotionItem['props'],
    targetTrackId: track.id,
  };
  next.motion.push(motion);
  next.timeline.clips.push({
    id: clipId,
    trackId: track.id,
    kind: 'graphic',
    label: input.label?.trim() || `Gráfico · ${input.templateId}`,
    startFrame,
    durationFrames,
    source: { type: 'graphic', motionId },
  });
  touch(next);
  return { project: next, motionId, clipId, trackId: track.id, startFrame };
}

export function updateMotionProps(
  project: ProjectDocument,
  motionId: string,
  props: Readonly<Record<string, unknown>>,
): ProjectDocument {
  const next = cloneProject(project);
  const motion = next.motion.find((item) => item.id === motionId);
  if (!motion) throw new ProjectActionError('el motion item no existe');
  motion.props = { ...props } as MotionItem['props'];
  touch(next);
  return next;
}

function compatibleTrackKinds(kind: Clip['kind']): Track['kind'][] {
  switch (kind) {
    case 'video':
      return ['video'];
    case 'image':
      return ['image'];
    case 'audio':
      return ['audio', 'narration'];
    case 'graphic':
      return ['graphic'];
    case 'freeze':
      return ['video'];
    case 'adjustment':
      return ['adjustment'];
    case 'compound':
      return ['video', 'image', 'graphic', 'adjustment'];
  }
}

export function addClipFromAsset(
  project: ProjectDocument,
  asset: Asset,
  options: {
    trackId?: string;
    atFrame?: number;
    durationFrames?: number;
    narration?: boolean;
    inFrame?: number;
    outFrame?: number;
  } = {},
): { project: ProjectDocument; clipId: string; trackId: string; startFrame: number } {
  if (asset.status !== 'ready') {
    throw new ProjectActionError('confirmá los derechos del material antes de montarlo');
  }
  const kind: Clip['kind'] | null =
    asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio' ? asset.kind : null;
  if (!kind) {
    throw new ProjectActionError('este tipo de material todavía no se puede montar');
  }
  const next = cloneProject(project);
  const fps = fpsOf(next);
  let track: Track | undefined;
  if (options.trackId) {
    track = next.timeline.tracks.find((item) => item.id === options.trackId);
    if (!track) {
      throw new ProjectActionError('la pista elegida no existe');
    }
    if (!compatibleTrackKinds(kind).includes(track.kind)) {
      throw new ProjectActionError('la pista elegida no acepta este tipo de clip');
    }
    if (track.locked) {
      throw new ProjectActionError('la pista elegida está bloqueada');
    }
  } else {
    const wanted = options.narration ? 'narration' : kind === 'audio' ? 'audio' : kind;
    track = next.timeline.tracks.find((item) => item.kind === wanted && !item.locked);
    if (!track) {
      const created = addTrack(next, wanted as Track['kind']);
      track = created.project.timeline.tracks.find((item) => item.id === created.trackId);
      if (!track) {
        throw new ProjectActionError('no se pudo crear la pista');
      }
      next.timeline = created.project.timeline;
    }
  }

  let durationFrames: number;
  let source: Clip['source'];
  if (isWindowedAsset(kind)) {
    const mediaDuration =
      'media' in asset && asset.media && 'durationFrames' in asset.media
        ? asset.media.durationFrames
        : undefined;
    if (!mediaDuration) {
      throw new ProjectActionError('el material no declara duración medida');
    }
    const requestedIn = Math.max(
      0,
      Math.min(mediaDuration - 1, Math.floor(options.inFrame ?? 0)),
    );
    const requestedOut = Math.max(
      requestedIn + 1,
      Math.min(mediaDuration, Math.floor(options.outFrame ?? mediaDuration)),
    );
    const windowFrames = requestedOut - requestedIn;
    durationFrames = options.durationFrames ?? windowFrames;
    durationFrames = Math.max(1, Math.min(durationFrames, windowFrames));
    source = {
      type: 'asset',
      assetId: asset.id,
      inFrame: requestedIn,
      outFrame: requestedIn + durationFrames,
    };
  } else {
    const defaultSeconds = 5;
    durationFrames = Math.max(1, options.durationFrames ?? Math.round(defaultSeconds * fps));
    source = { type: 'asset', assetId: asset.id };
  }

  const startFrame = findGap(
    intervalsForTrack(next, track.id),
    options.atFrame ?? 0,
    durationFrames,
  );
  const clipId = newId();
  const base = {
    id: clipId,
    trackId: track.id,
    label: friendlyAssetLabel(asset.label),
    startFrame,
    durationFrames,
  };
  const clip: Clip =
    kind === 'image'
      ? { ...base, kind: 'image', source: source as Extract<Clip, { kind: 'image' }>['source'] }
      : {
          ...base,
          kind,
          source: source as Extract<Clip, { kind: 'video' | 'audio' }>['source'],
        };
  next.timeline.clips.push(clip);
  touch(next);
  return { project: next, clipId, trackId: track.id, startFrame };
}

function isWindowedAsset(kind: Clip['kind']): boolean {
  return kind === 'video' || kind === 'audio';
}

export function moveClip(
  project: ProjectDocument,
  clipId: string,
  targetStart: number,
  targetTrackId?: string,
): ProjectDocument | null {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    return null;
  }
  const trackId = targetTrackId ?? clip.trackId;
  const track = next.timeline.tracks.find((item) => item.id === trackId);
  const sourceTrack = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (!track || track.locked || sourceTrack?.locked || !compatibleTrackKinds(clip.kind).includes(track.kind)) {
    return null;
  }
  const start = Math.max(0, Math.round(targetStart));
  if (!canPlaceClip(next, trackId, start, clip.durationFrames, clipId)) {
    return null;
  }
  clip.startFrame = start;
  clip.trackId = trackId;
  touch(next);
  return next;
}

/**
 * Movimiento magnético: mueve el clip y cierra los huecos de la pista destino.
 * Es el gesto de una timeline magnética cuando el imán está activo.
 */
/**
 * Movimiento con imán.
 *
 * Antes cerraba los huecos de la pista de destino, y eso arrastraba el clip
 * recién soltado junto a su vecino: se sentía como «vuelve al lugar de donde
 * estaba». Ahora respeta el frame donde lo soltás; compactar es una acción
 * aparte («cerrar huecos»).
 *
 * El imán real (a qué borde se pega) lo calcula la interfaz con `snapSpan`.
 */
export function magneticMoveClip(
  project: ProjectDocument,
  clipId: string,
  targetStart: number,
  targetTrackId?: string,
): ProjectDocument | null {
  return moveClip(project, clipId, targetStart, targetTrackId);
}

export function applySpeedRamp(
  project: ProjectDocument,
  clipId: string,
  options: { readonly from: number; readonly to: number },
): { project: ProjectDocument; clipIds: string[]; speeds: number[] } {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) {
    throw new ProjectActionError('la rampa de velocidad necesita un clip de video o audio');
  }
  const track = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (track?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (clip.transform?.keyframes?.length || clip.audio?.gainKeyframes?.length) {
    throw new ProjectActionError(
      'quitá los keyframes de transformación o volumen antes de aplicar la rampa',
    );
  }
  if ('motion' in clip && clip.motion) {
    throw new ProjectActionError(
      'quitá el movimiento Ken Burns antes de aplicar la rampa; después podés aplicarlo por tramo',
    );
  }
  if ('reverse' in clip && clip.reverse) {
    throw new ProjectActionError(
      'quitá el reverse antes de aplicar la rampa; después podés invertir cada tramo',
    );
  }
  const from = Number(options.from);
  const to = Number(options.to);
  if (from < 0.1 || from > 4 || to < 0.1 || to > 4) {
    throw new ProjectActionError('las velocidades de la rampa deben estar entre 0.1x y 4x');
  }
  if (Math.abs(from - to) < 0.001) {
    throw new ProjectActionError('elegí dos velocidades distintas para la rampa');
  }
  const windowFrames = clip.source.outFrame - clip.source.inFrame;
  const total = clip.durationFrames;
  if (windowFrames < 3 || total < 3) {
    throw new ProjectActionError('el clip es demasiado corto para una rampa de tres tramos');
  }
  const d1 = Math.max(1, Math.floor(total / 3));
  const d2 = Math.max(1, Math.floor((total - d1) / 2));
  const d3 = total - d1 - d2;
  if (d3 < 1) {
    throw new ProjectActionError('el clip es demasiado corto para una rampa de tres tramos');
  }
  const middleSpeed = (windowFrames - d1 * from - d3 * to) / d2;
  if (!Number.isFinite(middleSpeed) || middleSpeed < 0.1 || middleSpeed > 4) {
    throw new ProjectActionError(
      'la ventana del clip no alcanza para esas velocidades; acercá los extremos',
    );
  }
  const durations = [d1, d2, d3];
  const sourceFrames = [
    Math.max(1, Math.round(d1 * from)),
    Math.max(1, Math.round(d2 * middleSpeed)),
    0,
  ];
  sourceFrames[2] = windowFrames - sourceFrames[0]! - sourceFrames[1]!;
  if (sourceFrames[2]! < 1) {
    throw new ProjectActionError(
      'la ventana del clip no alcanza para esas velocidades; acercá los extremos',
    );
  }
  const speeds = sourceFrames.map((frames, index) => frames / durations[index]!);
  if (speeds.some((speed) => speed < 0.1 || speed > 4)) {
    throw new ProjectActionError(
      'la rampa produjo un tramo fuera de 0.1x–4x; acercá los extremos',
    );
  }

  const result = replaceWithSpeedSegments(
    next,
    clipId,
    durations,
    sourceFrames,
    (index) => `${clip.label ?? 'Clip'} · rampa ${index + 1}/3`,
  );
  return { project: next, clipIds: result.clipIds, speeds: result.speeds };
}

/**
 * Replaces a windowed clip with contiguous segments and keeps the scene
 * references valid. Shared by the three-step ramp and the smooth curve.
 */
function replaceWithSpeedSegments(
  next: ProjectDocument,
  clipId: string,
  durations: readonly number[],
  sourceFrames: readonly number[],
  labelFor: (index: number) => string,
): { clipIds: string[]; speeds: number[] } {
  const template = next.timeline.clips.find((item) => item.id === clipId) as Extract<
    Clip,
    { kind: 'video' | 'audio' }
  >;
  const baseIn = template.source.inFrame;
  const total = durations.length;
  const clipIds: string[] = [];
  const created: Clip[] = [];
  let cursorFrame = template.startFrame;
  let cursorSource = 0;
  for (let index = 0; index < total; index += 1) {
    const duration = durations[index]!;
    const window = sourceFrames[index]!;
    const copy = JSON.parse(JSON.stringify(template)) as Extract<
      Clip,
      { kind: 'video' | 'audio' }
    > & {
      transitionIn?: ClipTransition;
      transitionOut?: ClipTransition;
      effects?: ClipEffects;
    };
    copy.id = newId();
    copy.label = labelFor(index).slice(0, 200);
    copy.startFrame = cursorFrame;
    copy.durationFrames = duration;
    copy.source.inFrame = baseIn + cursorSource;
    copy.source.outFrame = baseIn + cursorSource + window;
    const divisor = gcd(window, duration);
    if (window === duration) delete copy.speed;
    else copy.speed = { num: window / divisor, den: duration / divisor };
    if (copy.kind === 'video' && (copy.speed?.num ?? 1) >= (copy.speed?.den ?? 1)) {
      delete copy.slowMotionSmoothing;
    }
    if (index > 0) delete copy.transitionIn;
    // La transición de salida pertenece al corte del final: sólo la última
    // porción la conserva.
    if (index < total - 1) delete copy.transitionOut;
    if (copy.effects) {
      if (index > 0) delete copy.effects.fadeInFrames;
      if (index < total - 1) delete copy.effects.fadeOutFrames;
      if (Object.keys(copy.effects).length === 0) delete copy.effects;
    }
    if (copy.audio) {
      if (index > 0) delete copy.audio.fadeInFrames;
      if (index < total - 1) delete copy.audio.fadeOutFrames;
      if (Object.keys(copy.audio).length === 0) delete copy.audio;
    }
    created.push(copy as Clip);
    clipIds.push(copy.id);
    cursorFrame += duration;
    cursorSource += window;
  }
  next.timeline.clips = [
    ...next.timeline.clips.filter((item) => item.id !== clipId),
    ...created,
  ];
  const replacement = new Set(clipIds);
  next.scenes = next.scenes.map((scene) => ({
    ...scene,
    clipIds: scene.clipIds.flatMap((id) => (id === clipId ? [...replacement] : [id])),
  }));
  touch(next);
  return {
    clipIds,
    speeds: sourceFrames.map((frames, index) => frames / durations[index]!),
  };
}

/**
 * Smooth speed curve in N contiguous segments. Like the three-step ramp it
 * keeps the clip's total duration and source window fixed and pins the first
 * and last segment to `from`/`to`; the intermediate segments are shifted by a
 * constant so the source window still adds up. The resulting speeds are
 * returned so the UI can show what was applied.
 */
export function applySpeedCurve(
  project: ProjectDocument,
  clipId: string,
  options: { readonly from: number; readonly to: number; readonly segments?: number },
): { project: ProjectDocument; clipIds: string[]; speeds: number[] } {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) {
    throw new ProjectActionError('la curva de velocidad necesita un clip de video o audio');
  }
  const track = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (track?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (clip.transform?.keyframes?.length || clip.audio?.gainKeyframes?.length) {
    throw new ProjectActionError(
      'quitá los keyframes de transformación o volumen antes de aplicar la curva',
    );
  }
  if ('motion' in clip && clip.motion) {
    throw new ProjectActionError(
      'quitá el movimiento Ken Burns antes de aplicar la curva; después podés aplicarlo por tramo',
    );
  }
  if ('reverse' in clip && clip.reverse) {
    throw new ProjectActionError('quitá el reverse antes de aplicar la curva');
  }
  const from = Number(options.from);
  const to = Number(options.to);
  if (from < 0.1 || from > 4 || to < 0.1 || to > 4) {
    throw new ProjectActionError('las velocidades de la curva deben estar entre 0.1x y 4x');
  }
  if (Math.abs(from - to) < 0.001) {
    throw new ProjectActionError('elegí dos velocidades distintas para la curva');
  }
  const segments = Math.round(options.segments ?? 8);
  if (segments < 3 || segments > 24) {
    throw new ProjectActionError('la curva necesita entre 3 y 24 tramos');
  }
  const windowFrames = clip.source.outFrame - clip.source.inFrame;
  const total = clip.durationFrames;
  if (windowFrames < segments || total < segments * 2) {
    throw new ProjectActionError('el clip es demasiado corto para esa cantidad de tramos');
  }
  const durations: number[] = [];
  let remaining = total;
  for (let index = 0; index < segments; index += 1) {
    const duration = index === segments - 1 ? remaining : Math.floor(total / segments);
    durations.push(duration);
    remaining -= duration;
  }
  if (durations.some((duration) => duration < 1)) {
    throw new ProjectActionError('el clip es demasiado corto para esa cantidad de tramos');
  }
  const ease = (value: number): number => value * value * (3 - 2 * value);
  const shape = durations.map((_, index) =>
    from + (to - from) * ease((index + 0.5) / segments),
  );
  const middle = durations.slice(1, -1).reduce((sum, duration) => sum + duration, 0);
  const fixedSource =
    durations[0]! * from + durations[segments - 1]! * to;
  let middleSource = 0;
  for (let index = 1; index < segments - 1; index += 1) {
    middleSource += durations[index]! * shape[index]!;
  }
  const shift = middle > 0 ? (windowFrames - fixedSource - middleSource) / middle : 0;
  const speeds = shape.map((value, index) =>
    index === 0 ? from : index === segments - 1 ? to : value + shift,
  );
  if (speeds.some((speed) => speed < 0.1 || speed > 4)) {
    throw new ProjectActionError(
      'la curva produjo un tramo fuera de 0.1x–4x; acercá los extremos',
    );
  }
  const sourceFrames = durations.map((duration, index) =>
    index === segments - 1
      ? 0
      : Math.max(1, Math.round(duration * speeds[index]!)),
  );
  sourceFrames[segments - 1] = windowFrames - sourceFrames.reduce((sum, value) => sum + value, 0);
  if (sourceFrames[segments - 1]! < 1) {
    throw new ProjectActionError('la ventana del clip no alcanza para esa curva');
  }
  const actual = sourceFrames.map((frames, index) => frames / durations[index]!);
  if (actual.some((speed) => speed < 0.1 || speed > 4)) {
    throw new ProjectActionError(
      'la curva produjo un tramo fuera de 0.1x–4x; acercá los extremos',
    );
  }
  const result = replaceWithSpeedSegments(next, clipId, durations, sourceFrames, (index) =>
    `${clip.label ?? 'Clip'} · curva ${index + 1}/${segments}`,
  );
  return { project: next, clipIds: result.clipIds, speeds: result.speeds };
}

/** Attach or clear the analyzed stabilization of a video clip. */
export function setClipStabilization(
  project: ProjectDocument,
  clipId: string,
  stabilization:
    | {
        smoothing: number;
        transformFile: string;
        inFrame: number;
        outFrame: number;
        previewProxy?: string;
      }
    | undefined,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (clip.kind !== 'video') {
    throw new ProjectActionError('solo los clips de video aceptan estabilización');
  }
  if (stabilization === undefined) {
    delete clip.stabilization;
  } else {
    clip.stabilization = {
      smoothing: Math.max(1, Math.min(60, Math.round(stabilization.smoothing))),
      transformFile: stabilization.transformFile,
      inFrame: stabilization.inFrame,
      outFrame: stabilization.outFrame,
      ...(stabilization.previewProxy !== undefined
        ? { previewProxy: stabilization.previewProxy }
        : {}),
    };
  }
  touch(next);
  return next;
}

export function splitClip(
  project: ProjectDocument,
  clipId: string,
  atFrame: number,
): { project: ProjectDocument; rightClipId: string } | null {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    return null;
  }
  if (clip.kind === 'compound') {
    throw new ProjectActionError(
      'un clip compuesto no se divide; deshacelo para editar los clips internos',
    );
  }
  const owner = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (owner?.locked) {
    return null;
  }
  let at = Math.round(atFrame);
  if (isWindowed(clip)) {
    const { num, den } = speedOf(clip);
    const step = den / gcd(num, den);
    at = Math.round((at - clip.startFrame) / step) * step + clip.startFrame;
  }
  if (at <= clip.startFrame || at >= clip.startFrame + clip.durationFrames) {
    return null;
  }
  const originalTransformKeyframes = clip.transform?.keyframes
    ? [...clip.transform.keyframes]
    : undefined;
  const originalGainKeyframes = clip.audio?.gainKeyframes
    ? [...clip.audio.gainKeyframes]
    : undefined;
  const leftDuration = at - clip.startFrame;
  const rightDuration = clip.durationFrames - leftDuration;
  const rightId = newId();
  let rightClip: Clip;
  if (isWindowed(clip)) {
    const { num, den } = speedOf(clip);
    const splitSource = clip.source.inFrame + (leftDuration * num) / den;
    if (!Number.isInteger(splitSource)) {
      return null;
    }
    rightClip = {
      ...JSON.parse(JSON.stringify(clip)),
      id: rightId,
      startFrame: at,
      durationFrames: rightDuration,
      source: { ...clip.source, inFrame: splitSource },
    } as Clip;
    clip.durationFrames = leftDuration;
    clip.source.outFrame = splitSource;
    next.timeline.clips.push(rightClip);
  } else {
    rightClip = {
      ...JSON.parse(JSON.stringify(clip)),
      id: rightId,
      startFrame: at,
      durationFrames: rightDuration,
    } as Clip;
    clip.durationFrames = leftDuration;
    next.timeline.clips.push(rightClip);
  }
  // El corte debe repartir las curvas/animaciones: el clip derecho no puede
  // reiniciar los keyframes en 0 ni el izquierdo conservar claves fuera de su
  // nueva duración.
  applySplitKeyframes(
    clip,
    rightClip,
    leftDuration,
    originalTransformKeyframes,
    originalGainKeyframes,
  );
  for (const scene of next.scenes) {
    const index = scene.clipIds.indexOf(clip.id);
    if (index >= 0) {
      scene.clipIds.splice(index + 1, 0, rightId);
    }
  }
  touch(next);
  return { project: next, rightClipId: rightId };
}

/** Split a clip at several absolute timeline frames, in order. */
/**
 * Freeze inside the original video track: split at the playhead, shift every
 * clip, caption and marker at/after it, and insert a ready image asset as a
 * `freeze` clip. The copied effects/static transform keep the still close to
 * the surrounding grade.
 */
export function freezeFrameInPlace(
  project: ProjectDocument,
  clipId: string,
  atFrame: number,
  assetId: string,
  durationFrames = 60,
): {
  project: ProjectDocument;
  freezeClipId: string;
  startFrame: number;
  durationFrames: number;
} {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || clip.kind !== 'video') {
    throw new ProjectActionError('el freeze en la pista necesita un clip de video');
  }
  const track = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (!track || track.locked) {
    throw new ProjectActionError('la pista del video está bloqueada');
  }
  const at = Math.round(atFrame);
  const clipEnd = clip.startFrame + clip.durationFrames;
  if (at < clip.startFrame || at >= clipEnd) {
    throw new ProjectActionError('poné el playhead dentro del clip de video');
  }
  const duration = Math.max(1, Math.round(durationFrames));
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset || asset.kind !== 'image') {
    throw new ProjectActionError('el freeze necesita una imagen importada');
  }
  if (asset.status !== 'ready') {
    throw new ProjectActionError('confirmá los derechos del frame antes de congelarlo');
  }
  const original = {
    effects: clip.effects ? JSON.parse(JSON.stringify(clip.effects)) : undefined,
    transform: clip.transform
      ? (() => {
          const { keyframes: _keyframes, ...rest } = clip.transform;
          return Object.keys(rest).length > 0
            ? JSON.parse(JSON.stringify(rest))
            : undefined;
        })()
      : undefined,
    blendMode: 'blendMode' in clip ? clip.blendMode : undefined,
    trackId: clip.trackId,
  };
  let working = next;
  if (at > clip.startFrame) {
    const split = splitClip(working, clipId, at);
    if (!split) {
      throw new ProjectActionError('no se pudo dividir el clip en el playhead');
    }
    working = split.project;
  }
  for (const item of working.timeline.clips) {
    if (item.startFrame >= at) item.startFrame += duration;
  }
  for (const cue of working.captions.cues) {
    if (cue.startFrame >= at) {
      cue.startFrame += duration;
      cue.endFrame += duration;
      for (const word of cue.words ?? []) {
        word.startFrame += duration;
        word.endFrame += duration;
      }
    }
  }
  for (const marker of working.markers) {
    if (marker.frame >= at) marker.frame += duration;
  }
  const freezeClipId = newId();
  const freeze: Clip = {
    id: freezeClipId,
    trackId: original.trackId,
    kind: 'freeze',
    label: 'Congelado',
    startFrame: at,
    durationFrames: duration,
    source: { type: 'asset', assetId },
    ...(original.effects ? { effects: original.effects } : {}),
    ...(original.transform ? { transform: original.transform } : {}),
    ...(original.blendMode ? { blendMode: original.blendMode } : {}),
  };
  working.timeline.clips.push(freeze);
  touch(working);
  return {
    project: working,
    freezeClipId,
    startFrame: at,
    durationFrames: duration,
  };
}

/**
 * Moves the embedded audio of a video clip to its own audio clip. It reuses the
 * first free audio/narration track at that window and creates one otherwise;
 * the video keeps its picture and is muted so the sound never doubles.
 */
export function detachAudio(
  project: ProjectDocument,
  clipId: string,
): {
  project: ProjectDocument;
  clipId: string;
  trackId: string;
  createdTrack: boolean;
} {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (clip.kind !== 'video') {
    throw new ProjectActionError('sólo un clip de video puede separar su audio');
  }
  const owner = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (!owner || owner.locked) {
    throw new ProjectActionError('la pista del video está bloqueada');
  }
  const start = clip.startFrame;
  const end = start + clip.durationFrames;
  let target = next.timeline.tracks.find(
    (track) =>
      (track.kind === 'audio' || track.kind === 'narration') &&
      !track.locked &&
      !track.muted &&
      !next.timeline.clips.some(
        (item) =>
          item.trackId === track.id &&
          item.startFrame < end &&
          item.startFrame + item.durationFrames > start,
      ),
  );
  let createdTrack = false;
  if (!target) {
    const order = Math.max(-1, ...next.timeline.tracks.map((track) => track.order)) + 1;
    target = {
      id: newId(),
      kind: 'audio',
      label: 'Audio separado',
      order,
      muted: false,
      hidden: false,
      locked: false,
    };
    next.timeline.tracks.push(target);
    createdTrack = true;
  }
  const audio = clip.audio ? JSON.parse(JSON.stringify(clip.audio)) : {};
  delete audio.muted;
  const detached: Clip = {
    id: newId(),
    trackId: target.id,
    kind: 'audio',
    label: `${clip.label ?? 'Audio'} · audio`.slice(0, 200),
    startFrame: start,
    durationFrames: clip.durationFrames,
    source: JSON.parse(JSON.stringify(clip.source)),
    ...(clip.speed ? { speed: JSON.parse(JSON.stringify(clip.speed)) } : {}),
    ...(clip.reverse ? { reverse: true } : {}),
    ...(Object.keys(audio).length > 0 ? { audio } : {}),
    ...(clip.colorTag ? { colorTag: clip.colorTag } : {}),
    linkGroup: clip.linkGroup ?? newId(),
  };
  clip.linkGroup = detached.linkGroup;
  next.timeline.clips.push(detached);
  clip.audio = { ...(clip.audio ?? {}), muted: true };
  touch(next);
  return {
    project: next,
    clipId: detached.id,
    trackId: target.id,
    createdTrack,
  };
}

export interface ApplySplitEditOptions {
  readonly clipId: string;
  readonly type: 'j-cut' | 'l-cut';
  readonly frames?: number;
}

export interface ApplySplitEditResult {
  readonly project: ProjectDocument;
  readonly videoClipId: string;
  readonly audioClipId: string;
  readonly type: 'j-cut' | 'l-cut';
  readonly appliedFrames: number;
}

/**
 * Aplica un corte dividido (J-cut o L-cut) a un clip de la timeline:
 * - J-cut: el audio del clip se adelanta a su video (la voz entra antes de que se vea).
 * - L-cut: el audio del clip se prolonga después de que su video termine (la voz continúa sobre el siguiente plano).
 *
 * Si el clip de video aún tiene el audio embebido, se separa primero mediante `detachAudio`.
 * Si el desplazamiento produce colisión en la pista de audio, se reubica o crea una pista alterna.
 */
export function applySplitEdit(
  project: ProjectDocument,
  options: ApplySplitEditOptions,
): ApplySplitEditResult {
  let next = cloneProject(project);
  const inputClip = next.timeline.clips.find((c) => c.id === options.clipId);
  if (!inputClip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }

  let videoClip: Clip | undefined;
  let audioClip: Clip;

  if (inputClip.kind === 'video') {
    videoClip = inputClip;
    if (!videoClip.audio?.muted) {
      const detached = detachAudio(next, videoClip.id);
      next = detached.project;
      videoClip = next.timeline.clips.find((c) => c.id === inputClip.id)!;
      audioClip = next.timeline.clips.find((c) => c.id === detached.clipId)!;
    } else {
      const found = next.timeline.clips.find(
        (c) =>
          c.kind === 'audio' &&
          c.source.type === 'asset' &&
          inputClip.source.type === 'asset' &&
          c.source.assetId === inputClip.source.assetId &&
          Math.abs(c.startFrame - inputClip.startFrame) <= 30,
      );
      if (!found) {
        throw new ProjectActionError('no se encontró el clip de audio asociado al video');
      }
      audioClip = found;
    }
  } else if (inputClip.kind === 'audio') {
    audioClip = inputClip;
    // El video pareado es opcional: un clip de audio suelto (música,
    // narración) también admite J/L cut sobre sí mismo.
    videoClip = next.timeline.clips.find(
      (c) =>
        c.kind === 'video' &&
        c.source.type === 'asset' &&
        audioClip.source.type === 'asset' &&
        c.source.assetId === audioClip.source.assetId &&
        Math.abs(c.startFrame - audioClip.startFrame) <= 30,
    );
  } else {
    throw new ProjectActionError('sólo clips de video o audio pueden aplicar cortes divididos');
  }

  const audioSource = audioClip.source;
  const videoSource = videoClip?.source;
  if (
    audioSource.type !== 'asset' ||
    !('inFrame' in audioSource) ||
    !('outFrame' in audioSource) ||
    (videoSource !== undefined &&
      (videoSource.type !== 'asset' ||
        !('inFrame' in videoSource) ||
        !('outFrame' in videoSource)))
  ) {
    throw new ProjectActionError('el clip no proviene de un material asset ventaneado');
  }

  const requested = Math.max(1, Math.min(120, options.frames ?? 10));
  let appliedFrames = 0;

  if (options.type === 'j-cut') {
    const availableSource = audioSource.inFrame;
    const availableTimeline = audioClip.startFrame;
    const shift = Math.min(requested, availableSource, availableTimeline);
    if (shift <= 0) {
      throw new ProjectActionError('el clip no tiene fotogramas previos de audio para adelantar (inicio en 0)');
    }
    audioSource.inFrame -= shift;
    audioClip.startFrame -= shift;
    audioClip.durationFrames += shift;
    const fadeIn = Math.max(audioClip.audio?.fadeInFrames ?? 0, Math.min(shift, 4));
    audioClip.audio = { ...(audioClip.audio ?? {}), fadeInFrames: fadeIn };
    appliedFrames = shift;
  } else {
    const asset = next.assets.find((a) => a.id === audioSource.assetId);
    const mediaFrames =
      asset && 'media' in asset && asset.media && 'durationFrames' in asset.media
        ? asset.media.durationFrames
        : Number.POSITIVE_INFINITY;
    const availableTail = Math.max(0, mediaFrames - audioSource.outFrame);
    const extend = Math.min(requested, availableTail);
    if (extend <= 0) {
      throw new ProjectActionError('el clip no tiene fotogramas posteriores de audio en el material');
    }
    audioSource.outFrame += extend;
    audioClip.durationFrames += extend;
    const fadeOut = Math.max(audioClip.audio?.fadeOutFrames ?? 0, Math.min(extend, 6));
    audioClip.audio = { ...(audioClip.audio ?? {}), fadeOutFrames: fadeOut };
    appliedFrames = extend;
  }

  const collides = next.timeline.clips.some(
    (c) =>
      c.id !== audioClip.id &&
      c.trackId === audioClip.trackId &&
      c.startFrame < audioClip.startFrame + audioClip.durationFrames &&
      c.startFrame + c.durationFrames > audioClip.startFrame,
  );

  if (collides) {
    let target = next.timeline.tracks.find(
      (t) =>
        (t.kind === 'audio' || t.kind === 'narration') &&
        t.id !== audioClip.trackId &&
        !t.locked &&
        !t.muted &&
        !next.timeline.clips.some(
          (c) =>
            c.id !== audioClip.id &&
            c.trackId === t.id &&
            c.startFrame < audioClip.startFrame + audioClip.durationFrames &&
            c.startFrame + c.durationFrames > audioClip.startFrame,
        ),
    );
    if (!target) {
      const order = Math.max(-1, ...next.timeline.tracks.map((t) => t.order)) + 1;
      target = {
        id: newId(),
        kind: 'audio',
        label: 'Audio Split Edit',
        order,
        muted: false,
        hidden: false,
        locked: false,
      };
      next.timeline.tracks.push(target);
    }
    audioClip.trackId = target.id;
  }

  touch(next);
  return {
    project: next,
    videoClipId: videoClip?.id ?? audioClip.id,
    audioClipId: audioClip.id,
    type: options.type,
    appliedFrames,
  };
}

export interface ApplyMorphCutOptions {
  /** Clip ENTRANTE (video o audio): el corte está justo antes de su inicio. */
  readonly incomingClipId: string;
  /** Frames de extensión por lado (default 6 ≈ 200 ms a 30 fps). */
  readonly frames?: number;
}

export interface ApplyMorphCutResult {
  readonly project: ProjectDocument;
  readonly incomingClipId: string;
  readonly outgoingClipId: string;
  readonly jCutFrames: number;
  readonly lCutFrames: number;
  readonly audioClipIds: readonly string[];
}

/**
 * Morph Cut (paridad Premiere "Align"): en el corte entre dos clips
 * contiguos de la misma pista, el audio saliente se prolonga bajo el
 * video entrante (L-cut) Y el audio entrante arranca antes de su video
 * (J-cut). Como ambas extensiones se solapan alrededor del corte, las dos
 * voces se cruzan ~2×frames: el jump cut se disimula sin tocar el video.
 *
 * Cada lado se aplica de forma independiente: si un clip no tiene handle
 * de fuente, ese lado se salta y se reporta en 0 frames — no es un error
 * mientras al menos un lado haya podido extenderse.
 */
export function applyMorphCut(
  project: ProjectDocument,
  options: ApplyMorphCutOptions,
): ApplyMorphCutResult {
  const incoming = project.timeline.clips.find((c) => c.id === options.incomingClipId);
  if (!incoming) {
    throw new ProjectActionError('el clip entrante no está en la timeline');
  }
  // Video o audio: el mecanismo es el mismo (L del saliente + J del entrante).
  if (incoming.kind !== 'video' && incoming.kind !== 'audio') {
    throw new ProjectActionError('el morph cut necesita un clip de video o audio entrante');
  }
  const track = project.timeline.tracks.find((t) => t.id === incoming.trackId);
  if (!track || track.locked) {
    throw new ProjectActionError('la pista del clip entrante está bloqueada');
  }
  const outgoing = project.timeline.clips
    .filter(
      (c) =>
        c.trackId === incoming.trackId &&
        c.id !== incoming.id &&
        c.kind === incoming.kind &&
        c.startFrame + c.durationFrames === incoming.startFrame,
    )
    .sort((a, b) => b.startFrame - a.startFrame)[0];
  if (!outgoing) {
    throw new ProjectActionError(
      'no hay un clip contiguo del mismo tipo antes del entrante en la misma pista',
    );
  }
  const outTrack = project.timeline.tracks.find((t) => t.id === outgoing.trackId);
  if (!outTrack || outTrack.locked) {
    throw new ProjectActionError('la pista del clip saliente está bloqueada');
  }

  const frames = Math.max(1, Math.min(60, options.frames ?? 6));
  let next = project;
  let lCutFrames = 0;
  let jCutFrames = 0;
  const audioClipIds: string[] = [];

  try {
    const result = applySplitEdit(next, { clipId: outgoing.id, type: 'l-cut', frames });
    next = result.project;
    lCutFrames = result.appliedFrames;
    audioClipIds.push(result.audioClipId);
  } catch {
    // Sin cola de material: el lado saliente queda sin extender.
  }
  try {
    const result = applySplitEdit(next, { clipId: incoming.id, type: 'j-cut', frames });
    next = result.project;
    jCutFrames = result.appliedFrames;
    audioClipIds.push(result.audioClipId);
  } catch {
    // Sin cabeza de material: el lado entrante queda sin extender.
  }

  if (lCutFrames === 0 && jCutFrames === 0) {
    throw new ProjectActionError(
      'ningún lado pudo extenderse: faltan fotogramas de audio en el material fuente',
    );
  }
  return {
    project: next,
    incomingClipId: incoming.id,
    outgoingClipId: outgoing.id,
    jCutFrames,
    lCutFrames,
    audioClipIds,
  };
}

/**
 * Closes the empty spaces between clips of one track. The first clip keeps its
 * start so overlay tracks do not jump to zero; locked tracks are rejected.
 */
export function applyAudioPresetToAll(
  project: ProjectDocument,
  preset: AudioPresetId,
): { project: ProjectDocument; applied: number; skipped: number } {
  const settings = AUDIO_PRESETS.find((item) => item.id === preset)?.settings;
  if (!settings) return { project, applied: 0, skipped: 0 };
  let next = project;
  let applied = 0;
  let skipped = 0;
  for (const clip of project.timeline.clips) {
    if (clip.kind !== 'audio') continue;
    const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
    if (!track || track.locked) {
      skipped += 1;
      continue;
    }
    const audio = { ...(clip.audio ?? {}), ...settings };
    next = updateClip(next, clip.id, { audio });
    applied += 1;
  }
  return { project: next, applied, skipped };
}

export function applyTransitionToCuts(
  project: ProjectDocument,
  options: {
    type?: ClipTransition['type'];
    frames?: number;
    color?: string | undefined;
    trackIds?: readonly string[];
    /// `luma-wipe` exige `mateClipId` por corte (el schema lo valida): el
    /// resolvedor elige el mate de cada clip — p. ej. el primer candidato
    /// válido—; los cortes sin mate se saltan y se cuentan en `skipped`.
    mateClipIdFor?: ((clip: Clip, frames: number) => string | undefined) | undefined;
  } = {},
): { project: ProjectDocument; applied: number; skipped: number } {
  const type = options.type ?? 'dissolve';
  const frames = Math.max(1, Math.round(options.frames ?? 12));
  const color =
    options.color && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(options.color)
      ? options.color.toLowerCase()
      : undefined;
  const next = cloneProject(project);
  let applied = 0;
  let skipped = 0;
  for (const track of next.timeline.tracks) {
    if (track.locked) continue;
    if (options.trackIds && !options.trackIds.includes(track.id)) continue;
    const clips = next.timeline.clips
      .filter((clip) => clip.trackId === track.id)
      .sort((a, b) => a.startFrame - b.startFrame);
    for (let index = 1; index < clips.length; index += 1) {
      const previous = clips[index - 1]!;
      const clip = clips[index]!;
      if (previous.startFrame + previous.durationFrames !== clip.startFrame) continue;
      if (
        clip.kind !== 'video' &&
        clip.kind !== 'image' &&
        clip.kind !== 'freeze'
      ) {
        continue;
      }
      if (
        previous.kind !== 'video' &&
        previous.kind !== 'image' &&
        previous.kind !== 'freeze'
      ) {
        continue;
      }
      // dip-color exige color válido (el schema lo requiere); sin él el
      // documento quedaría inválido, así que el corte se salta.
      if (type === 'dip-color' && color === undefined) continue;
      // luma-wipe exige `mateClipId` por corte; la aplicación masiva no
      // puede elegir un mate por sí sola, así que lo resuelve
      // `options.mateClipIdFor` y sin mate válido el corte se salta.
      if (type === 'luma-wipe') {
        const mateClipId = options.mateClipIdFor?.(clip, frames);
        if (!mateClipId) {
          skipped += 1;
          continue;
        }
        const target = clip as Clip & { transitionIn?: ClipTransition };
        target.transitionIn = {
          type,
          frames: Math.min(frames, clip.durationFrames),
          mateClipId,
        };
        applied += 1;
        continue;
      }
      const target = clip as Clip & { transitionIn?: ClipTransition };
      target.transitionIn = {
        type,
        frames: Math.min(frames, clip.durationFrames),
        ...(type === 'dip-color' && color ? { color } : {}),
      };
      applied += 1;
    }
  }
  if (applied === 0) return { project, applied: 0, skipped };
  touch(next);
  return { project: next, applied, skipped };
}

export function closeGaps(
  project: ProjectDocument,
  trackId: string,
): { project: ProjectDocument; moved: number; removedFrames: number } {
  const next = cloneProject(project);
  const track = next.timeline.tracks.find((item) => item.id === trackId);
  if (!track) {
    throw new ProjectActionError('la pista no está en el proyecto');
  }
  if (track.locked) {
    throw new ProjectActionError('la pista está bloqueada');
  }
  const clips = next.timeline.clips
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
  if (clips.length < 2) {
    return { project, moved: 0, removedFrames: 0 };
  }
  let cursor = clips[0]!.startFrame;
  let moved = 0;
  let removedFrames = 0;
  for (const clip of clips) {
    if (clip.startFrame !== cursor) {
      removedFrames += Math.max(0, clip.startFrame - cursor);
      clip.startFrame = cursor;
      moved += 1;
    }
    cursor += clip.durationFrames;
  }
  if (moved > 0) touch(next);
  return { project: moved > 0 ? next : project, moved, removedFrames };
}

/**
 * Splits every unlocked clip that crosses a marker frame. It turns chapter
 * markers into editable segments without rippling or changing durations.
 */
export function splitClipsAtMarkers(
  project: ProjectDocument,
  options: { trackIds?: readonly string[] } = {},
): { project: ProjectDocument; cuts: number; clips: number; skippedTracks: number } {
  const frames = [
    ...new Set(
      project.markers
        .map((marker) => marker.frame)
        .filter((frame) => frame > 0),
    ),
  ].sort((a, b) => a - b);
  if (frames.length === 0) {
    return { project, cuts: 0, clips: 0, skippedTracks: 0 };
  }
  let next = project;
  let cuts = 0;
  let clips = 0;
  const skipped = new Set<string>();
  const originals = [...project.timeline.clips];
  for (const clip of originals) {
    const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
    if (!track) continue;
    if (options.trackIds && !options.trackIds.includes(track.id)) continue;
    const inside = frames.filter(
      (frame) =>
        frame > clip.startFrame && frame < clip.startFrame + clip.durationFrames,
    );
    if (inside.length === 0) continue;
    if (track.locked) {
      skipped.add(track.id);
      continue;
    }
    const result = splitClipAtFrames(next, clip.id, inside);
    if (!result) continue;
    next = result.project;
    cuts += Math.max(0, result.clipIds.length - 1);
    clips += 1;
  }
  return {
    project: next,
    cuts,
    clips,
    skippedTracks: skipped.size,
  };
}

export function splitClipAtFrames(
  project: ProjectDocument,
  clipId: string,
  cutFrames: readonly number[],
): { project: ProjectDocument; clipIds: string[] } | null {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip || clip.kind === 'compound') return null;
  const start = clip.startFrame;
  const end = clip.startFrame + clip.durationFrames;
  const cuts = [...new Set(cutFrames.map((frame) => Math.round(frame)))]
    .filter((frame) => frame > start && frame < end)
    .sort((a, b) => a - b);
  let next = project;
  let currentId = clipId;
  const clipIds = [clipId];
  for (const cut of cuts) {
    const result = splitClip(next, currentId, cut);
    if (!result) continue;
    next = result.project;
    currentId = result.rightClipId;
    clipIds.push(currentId);
  }
  return { project: next, clipIds };
}

/**
 * Split every clip of a track at the given absolute frames. Used by beat sync:
 * the same cut list is applied to whichever clips overlap those frames.
 */
export function splitTrackAtFrames(
  project: ProjectDocument,
  trackId: string,
  frames: readonly number[],
): ProjectDocument | null {
  const track = project.timeline.tracks.find((item) => item.id === trackId);
  if (!track || track.locked) return null;
  const unique = [...new Set(frames.map((frame) => Math.round(frame)))].sort((a, b) => a - b);
  if (unique.length === 0) return null;
  const clips = project.timeline.clips
    .filter((clip) => clip.trackId === trackId)
    .map((clip) => ({
      id: clip.id,
      start: clip.startFrame,
      end: clip.startFrame + clip.durationFrames,
    }));
  let next = project;
  let changed = false;
  for (const clip of clips) {
    const inside = unique.filter((frame) => frame > clip.start && frame < clip.end);
    if (inside.length === 0) continue;
    const result = splitClipAtFrames(next, clip.id, inside);
    if (result) {
      next = result.project;
      changed = true;
    }
  }
  return changed ? next : null;
}

/** Copy a clip after itself on the same track, preserving every effect. */
export function duplicateClip(
  project: ProjectDocument,
  clipId: string,
): { project: ProjectDocument; clipId: string } | null {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    return null;
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    return null;
  }
  const startFrame = findGap(
    intervalsForTrack(next, clip.trackId),
    clip.startFrame + clip.durationFrames,
    clip.durationFrames,
  );
  const id = newId();
  const copy = {
    ...JSON.parse(JSON.stringify(clip)),
    id,
    startFrame,
  } as Clip;
  // El copión nunca hereda el vínculo del original: si no, pasaría a
  // arrastrarse/borrarse junto a un grupo que no le corresponde.
  // `duplicateClipGroup` los re-vincula entre sí cuando corresponde.
  delete copy.linkGroup;
  if (copy.kind === 'compound') {
    const cloned = cloneCompoundForClip(next, copy.source.compoundId);
    next.compounds = [...(next.compounds ?? []), cloned.compound];
    copy.source = { type: 'compound', compoundId: cloned.compoundId };
  }
  next.timeline.clips.push(copy);
  for (const scene of next.scenes) {
    const index = scene.clipIds.indexOf(clip.id);
    if (index >= 0) {
      scene.clipIds.splice(index + 1, 0, id);
    }
  }
  touch(next);
  return { project: next, clipId: id };
}

/**
 * Duplica un clip o, si pertenece a un `linkGroup`, todo el grupo como una
 * sola unidad — paridad del Ctrl+D / Alt+arrastre de Premiere sobre una
 * selección vinculada. Los copiones reciben un `linkGroup` NUEVO compartido
 * entre ellos: nunca heredan el del original. Si alguna pista del grupo está
 * bloqueada no se duplica nada (pre-chequeo atómico).
 */
export function duplicateClipGroup(
  project: ProjectDocument,
  clipId: string,
): { project: ProjectDocument; clipIds: string[] } | null {
  const anchor = project.timeline.clips.find((item) => item.id === clipId);
  if (!anchor) return null;
  const memberIds = anchor.linkGroup
    ? project.timeline.clips
        .filter((item) => item.linkGroup === anchor.linkGroup)
        .map((item) => item.id)
    : [clipId];
  for (const memberId of memberIds) {
    const member = project.timeline.clips.find((item) => item.id === memberId);
    const track = project.timeline.tracks.find((item) => item.id === member?.trackId);
    if (!member || track?.locked) return null;
  }
  let next = project;
  const copyIds: string[] = [];
  for (const memberId of memberIds) {
    const result = duplicateClip(next, memberId);
    if (!result) return null;
    next = result.project;
    copyIds.push(result.clipId);
  }
  if (anchor.linkGroup) {
    const group = newId();
    next = cloneProject(next);
    for (const id of copyIds) {
      const copy = next.timeline.clips.find((item) => item.id === id);
      if (copy) copy.linkGroup = group;
    }
    touch(next);
  }
  return { project: next, clipIds: copyIds };
}

export function deleteClip(project: ProjectDocument, clipId: string): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    return next;
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const linkGroup = clip.linkGroup;
  next.timeline.clips = next.timeline.clips.filter((item) => item.id !== clipId);
  // Si el clip era miembro de un linkGroup, el grupo no puede quedar con
  // un solo superviviente: el vínculo se disuelve (mismo criterio que
  // unlinkClips — sin badges fantasma).
  if (linkGroup !== undefined) {
    const survivors = next.timeline.clips.filter((item) => item.linkGroup === linkGroup);
    if (survivors.length < 2) {
      for (const survivor of survivors) delete survivor.linkGroup;
    }
  }
  if (clip.kind === 'compound') {
    const stillUsed = next.timeline.clips.some(
      (item) =>
        item.source.type === 'compound' &&
        item.source.compoundId === clip.source.compoundId,
    );
    if (!stillUsed) {
      next.compounds = (next.compounds ?? []).filter(
        (item) => item.id !== clip.source.compoundId,
      );
    }
  }
  for (const scene of next.scenes) {
    scene.clipIds = scene.clipIds.filter((id) => id !== clipId);
  }
  touch(next);
  return next;
}

/**
 * Corte lateral en la aguja (Q/W de AlaukCut, `cortarLadoDaAgulha`): divide
 * el/los clips en el frame y elimina la mitad pedida.
 * - `side: 'left'` → borra lo que está ANTES de la aguja (queda la derecha).
 * - `side: 'right'` → borra lo que está DESPUÉS de la aguja (queda la
 *   izquierda).
 * Con `onlyClipId` opera sólo sobre ese clip (equivalente a la selección de
 * AlaukCut); sin él, sobre todos los clips que contienen la aguja en su
 * interior en pistas desbloqueadas. Los clips compuestos y los cortes en el
 * borde exacto se saltan, igual que `partirNaAgulha` devolviendo falsy.
 * Devuelve `null` si ningún clip se pudo cortar.
 */
export function cutSideAtPlayhead(
  project: ProjectDocument,
  atFrame: number,
  side: 'left' | 'right',
  onlyClipId?: string | readonly string[],
): {
  project: ProjectDocument;
  keptClipIds: string[];
  removedClipIds: string[];
} | null {
  const only =
    onlyClipId === undefined
      ? null
      : new Set(
          typeof onlyClipId === 'string' ? [onlyClipId] : [...onlyClipId],
        );
  const targets = only
    ? project.timeline.clips.filter((clip) => only.has(clip.id))
    : project.timeline.clips.filter(
        (clip) =>
          clip.kind !== 'compound' &&
          clip.startFrame < atFrame &&
          atFrame < clip.startFrame + clip.durationFrames,
      );
  let current = project;
  const keptClipIds: string[] = [];
  const removedClipIds: string[] = [];
  for (const target of targets) {
    if (target.kind === 'compound') continue;
    const split = splitClip(current, target.id, atFrame);
    if (!split) continue;
    current = split.project;
    const dropId = side === 'left' ? target.id : split.rightClipId;
    const keepId = side === 'left' ? split.rightClipId : target.id;
    current = deleteClip(current, dropId);
    keptClipIds.push(keepId);
    removedClipIds.push(dropId);
  }
  if (!keptClipIds.length) return null;
  return { project: current, keptClipIds, removedClipIds };
}

/**
 * Pastes a serialized clip at the requested frame. The target track is the
 * original one when it still exists, and the paste moves to the next free gap
 * on that track so it never overlaps.
 */
export function pasteClip(
  project: ProjectDocument,
  clip: Clip,
  input: { startFrame: number; trackId?: string },
): { project: ProjectDocument; clipId: string; startFrame: number; trackId: string } {
  const next = cloneProject(project);
  const target =
    (input.trackId
      ? next.timeline.tracks.find((track) => track.id === input.trackId)
      : undefined) ??
    next.timeline.tracks.find((track) => track.id === clip.trackId) ??
    next.timeline.tracks.find((track) => {
      if (clip.kind === 'video' || clip.kind === 'freeze') {
        return track.kind === 'video';
      }
      if (clip.kind === 'image') return track.kind === 'image';
      if (clip.kind === 'audio') return track.kind === 'audio' || track.kind === 'narration';
      if (clip.kind === 'graphic') return track.kind === 'graphic';
      if (clip.kind === 'compound') {
        return (
          track.kind === 'video' ||
          track.kind === 'image' ||
          track.kind === 'graphic' ||
          track.kind === 'adjustment'
        );
      }
      return track.kind === 'adjustment';
    });
  if (!target) {
    throw new ProjectActionError('no hay una pista compatible para pegar el clip');
  }
  if (target.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const startFrame = findGap(
    intervalsForTrack(next, target.id),
    Math.max(0, Math.round(input.startFrame)),
    clip.durationFrames,
  );
  const id = newId();
  const copy = {
    ...JSON.parse(JSON.stringify(clip)),
    id,
    trackId: target.id,
    startFrame,
  } as Clip;
  // El portapapeles puede traer un linkGroup viejo: el pegado nunca se une
  // al grupo del clip original (mismo criterio que duplicateClip).
  delete copy.linkGroup;
  if (copy.kind === 'compound') {
    const cloned = cloneCompoundForClip(next, copy.source.compoundId);
    next.compounds = [...(next.compounds ?? []), cloned.compound];
    copy.source = { type: 'compound', compoundId: cloned.compoundId };
  }
  next.timeline.clips.push(copy);
  for (const scene of next.scenes) {
    const index = scene.clipIds.indexOf(clip.id);
    if (index >= 0) {
      scene.clipIds.splice(index + 1, 0, id);
    }
  }
  touch(next);
  return { project: next, clipId: id, startFrame, trackId: target.id };
}

/**
 * Recorta el inicio de la timeline: mueve todo a la izquierda y elimina el
 * aire inicial. Es una operación global —clips, subtítulos y marcadores— porque
 * recortar sólo una pista desincroniza el resto.
 */
export function trimTimelineStart(
  project: ProjectDocument,
  frames: number,
): { project: ProjectDocument; trimmed: number } {
  const amount = Math.max(0, Math.round(frames));
  if (amount === 0) return { project, trimmed: 0 };
  const next = cloneProject(project);
  let trimmed = 0;
  for (const clip of next.timeline.clips) {
    const before = clip.startFrame;
    clip.startFrame = Math.max(0, clip.startFrame - amount);
    if (clip.startFrame !== before) trimmed += 1;
  }
  next.captions.cues = next.captions.cues
    .map((cue) => ({
      ...cue,
      startFrame: Math.max(0, cue.startFrame - amount),
      endFrame: Math.max(0, cue.endFrame - amount),
    }))
    .filter((cue) => cue.endFrame > cue.startFrame);
  for (const marker of next.markers) {
    marker.frame = Math.max(0, marker.frame - amount);
  }
  touch(next);
  return { project: next, trimmed };
}

/**
 * Removes a clip and closes the gap it leaves on its own track. Other tracks
 * keep their timing.
 */
export function rippleDeleteClip(
  project: ProjectDocument,
  clipId: string,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return next;
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const end = clip.startFrame + clip.durationFrames;
  const duration = clip.durationFrames;
  const linkGroup = clip.linkGroup;
  next.timeline.clips = next.timeline.clips.filter((item) => item.id !== clipId);
  // Mismo criterio que deleteClip: el linkGroup no puede quedar con un
  // solo superviviente (sin badges fantasma).
  if (linkGroup !== undefined) {
    const survivors = next.timeline.clips.filter((item) => item.linkGroup === linkGroup);
    if (survivors.length < 2) {
      for (const survivor of survivors) delete survivor.linkGroup;
    }
  }
  for (const item of next.timeline.clips) {
    if (item.trackId === clip.trackId && item.startFrame >= end) {
      item.startFrame = Math.max(0, item.startFrame - duration);
    }
  }
  for (const scene of next.scenes) {
    scene.clipIds = scene.clipIds.filter((id) => id !== clipId);
  }
  touch(next);
  return next;
}

export function updateClip(
  project: ProjectDocument,
  clipId: string,
  patch: Partial<{
    label: string;
    transform: Clip extends { transform?: infer T } ? T : never;
    audio: Clip extends { audio?: infer T } ? T : never;
    effects: ClipEffects;
    motion: ClipMotion | undefined;
    chromaKey: ChromaKey | undefined;
    transitionIn: ClipTransition | Record<string, never>;
    transitionOut: ClipTransition | Record<string, never>;
    reverse: boolean;
    mask: ClipMask | undefined;
    blendMode: BlendMode | undefined;
    animationIn: ClipAnimation | undefined;
    animationOut: ClipAnimation | undefined;
    colorTag: ClipColorTag | undefined;
    monitorFrame: Clip extends { monitorFrame?: infer T } ? T : never;
    waveformStyle: 'capcut' | 'davinci' | undefined;
    enabled: boolean;
  }>,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) {
      throw new ProjectActionError('el clip necesita un nombre');
    }
    clip.label = label;
  }
  if ('colorTag' in patch) {
    const target = clip as Clip & { colorTag?: ClipColorTag };
    if (patch.colorTag === undefined) delete target.colorTag;
    else target.colorTag = patch.colorTag;
  }
  if ('monitorFrame' in patch) {
    if (patch.monitorFrame === undefined) delete clip.monitorFrame;
    else clip.monitorFrame = patch.monitorFrame;
  }
  if ('waveformStyle' in patch) {
    if (patch.waveformStyle === undefined) delete clip.waveformStyle;
    else clip.waveformStyle = patch.waveformStyle;
  }
  if (patch.enabled !== undefined) {
    if (patch.enabled) delete clip.enabled;
    else clip.enabled = false;
  }
  if (patch.transform !== undefined) {
    if (Object.keys(patch.transform).length === 0) {
      delete clip.transform;
    } else {
      clip.transform = patch.transform as NonNullable<Clip['transform']>;
    }
  }
  if (patch.audio !== undefined) {
    if (Object.keys(patch.audio).length === 0) {
      delete clip.audio;
    } else {
      clip.audio = patch.audio as NonNullable<Clip['audio']>;
    }
  }
  if (patch.effects !== undefined) {
    // Los clips de audio no tienen imagen, pero sí `effects.audioStack`
    // (AudioClipEffectsSchema): se acepta un patch que sólo toque esa pila.
    const audioStackOnly =
      clip.kind === 'audio' &&
      Object.keys(patch.effects).every((key) => key === 'audioStack');
    if (
      !audioStackOnly &&
      clip.kind !== 'video' &&
      clip.kind !== 'image' &&
      clip.kind !== 'freeze' &&
      clip.kind !== 'adjustment'
    ) {
      throw new ProjectActionError('este tipo de clip no acepta efectos visuales');
    }
    if (Object.keys(patch.effects).length === 0) {
      delete clip.effects;
    } else {
      clip.effects = patch.effects;
    }
  }
  if ('motion' in patch) {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta movimiento');
    }
    if (patch.motion === undefined) {
      delete clip.motion;
    } else {
      clip.motion = patch.motion;
    }
  }
  if ('chromaKey' in patch) {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta chroma key');
    }
    if (patch.chromaKey === undefined) {
      delete clip.chromaKey;
    } else {
      clip.chromaKey = patch.chromaKey;
    }
  }
  if ('transitionIn' in patch && patch.transitionIn !== undefined) {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta transiciones visuales');
    }
    const target = clip as Clip & { transitionIn?: ClipTransition };
    if (Object.keys(patch.transitionIn).length === 0) {
      delete target.transitionIn;
    } else {
      target.transitionIn = patch.transitionIn as ClipTransition;
    }
  }
  if ('transitionOut' in patch && patch.transitionOut !== undefined) {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta transiciones visuales');
    }
    const target = clip as Clip & { transitionOut?: ClipTransition };
    if (Object.keys(patch.transitionOut).length === 0) {
      delete target.transitionOut;
    } else {
      target.transitionOut = patch.transitionOut as ClipTransition;
    }
  }
  if (patch.reverse !== undefined) {
    if (clip.kind !== 'video' && clip.kind !== 'audio') {
      throw new ProjectActionError('este tipo de clip no se puede reproducir al revés');
    }
    const target = clip as Clip & { reverse?: boolean };
    if (patch.reverse) target.reverse = true;
    else delete target.reverse;
  }
  if ('mask' in patch) {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta máscara');
    }
    const target = clip as Clip & { mask?: ClipMask };
    if (patch.mask === undefined || Object.keys(patch.mask).length === 0) {
      delete target.mask;
    } else {
      target.mask = patch.mask;
    }
  }
  if ('blendMode' in patch) {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta modo de mezcla');
    }
    const target = clip as Clip & { blendMode?: BlendMode };
    if (patch.blendMode === undefined) delete target.blendMode;
    else target.blendMode = patch.blendMode;
  }
  for (const side of ['animationIn', 'animationOut'] as const) {
    if (!(side in patch)) continue;
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta animaciones');
    }
    const target = clip as Clip & { animationIn?: ClipAnimation; animationOut?: ClipAnimation };
    const animation = patch[side];
    if (animation === undefined) {
      delete target[side];
      continue;
    }
    if (animation.durationFrames > clip.durationFrames) {
      throw new ProjectActionError('la animación no puede durar más que el clip');
    }
    target[side] = animation;
  }
  touch(next);
  return next;
}

/** Cambia el material del clip por uno derivado sin tocar su lugar en la
 * timeline. En video exige un asset con al menos la misma ventana de origen:
 * así `durationFrames x speed = sourceFrames` sigue siendo exacto. */
export function replaceClipWithDerivedAsset(
  project: ProjectDocument,
  clipId: string,
  assetId: string,
  options?: { readonly sourceOffset?: number },
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) throw new ProjectActionError('el clip no está en la timeline');
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset) throw new ProjectActionError('el material derivado no está en el proyecto');
  const offset = options?.sourceOffset ?? 0;

  if (clip.kind === 'video') {
    if (asset.kind !== 'video') {
      throw new ProjectActionError('un clip de video necesita un asset de video');
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ProjectActionError('el desplazamiento del recorte no es válido');
    }
    const sourceFrames = clip.source.outFrame - clip.source.inFrame;
    const available = asset.media?.durationFrames ?? 0;
    if (available < offset + sourceFrames) {
      throw new ProjectActionError(
        'el material derivado no cubre la ventana del clip; volvé a procesarlo completo',
      );
    }
    clip.source = {
      type: 'asset',
      assetId,
      inFrame: offset,
      outFrame: offset + sourceFrames,
    };
    // El .trf se analizó sobre el archivo original; el recorte tiene otra
    // escala y otro inicio. Se invalida para no aplicar desplazamientos falsos.
    delete clip.stabilization;
  } else if (clip.kind === 'image' || clip.kind === 'freeze') {
    if (asset.kind !== 'image') {
      throw new ProjectActionError('una imagen necesita un asset de imagen');
    }
    if (offset !== 0) {
      throw new ProjectActionError('una imagen no usa desplazamiento de origen');
    }
    clip.source = { type: 'asset', assetId };
  } else {
    throw new ProjectActionError('este tipo de clip no acepta un cambio de material');
  }
  touch(next);
  return next;
}

/** Agrupa el clip seleccionado y todos los que se solapan en su rango, en
 * cualquier pista, en un clip compuesto. El render los aplana de vuelta a sus
 * pistas originales; no se admiten compuestos anidados. */
export function createCompound(
  project: ProjectDocument,
  selectedClipId: string,
): { project: ProjectDocument; compoundClipId: string; grouped: number } {
  const next = cloneProject(project);
  const selected = next.timeline.clips.find((item) => item.id === selectedClipId);
  if (!selected) throw new ProjectActionError('el clip no está en la timeline');
  if (selected.kind === 'compound') {
    throw new ProjectActionError('un clip compuesto no se puede agrupar dentro de otro');
  }
  if (
    selected.kind === 'audio' ||
    selected.kind === 'adjustment' ||
    selected.kind === 'graphic'
  ) {
    throw new ProjectActionError(
      'elegí un clip visual (video, imagen o congelado) como ancla del compuesto',
    );
  }
  const track = next.timeline.tracks.find((item) => item.id === selected.trackId);
  if (!track) throw new ProjectActionError('la pista del clip no existe');
  if (track.locked) throw new ProjectActionError('la pista del clip está bloqueada');

  const rangeStart = selected.startFrame;
  const rangeEnd = selected.startFrame + selected.durationFrames;
  const grouped = next.timeline.clips.filter(
    (clip) =>
      clip.startFrame < rangeEnd && clip.startFrame + clip.durationFrames > rangeStart,
  );
  if (grouped.some((clip) => clip.kind === 'compound')) {
    throw new ProjectActionError(
      'el rango ya incluye un clip compuesto; deshacelo antes de agrupar',
    );
  }
  if (
    grouped.some(
      (clip) =>
        next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked === true,
    )
  ) {
    throw new ProjectActionError('hay una pista bloqueada dentro del rango');
  }
  const groupStart = Math.min(...grouped.map((clip) => clip.startFrame));
  const groupEnd = Math.max(
    ...grouped.map((clip) => clip.startFrame + clip.durationFrames),
  );
  const durationFrames = groupEnd - groupStart;
  const compoundId = newId();
  const compoundClipId = newId();
  const label = `Compuesto ${(next.compounds?.length ?? 0) + 1}`;
  const inner = grouped.map((clip) => {
    const copy = JSON.parse(JSON.stringify(clip)) as CompoundInnerClip;
    copy.startFrame -= groupStart;
    return copy;
  });
  const compound: Compound = {
    id: compoundId,
    label,
    durationFrames,
    clips: inner,
  };
  next.compounds = [...(next.compounds ?? []), compound];
  const groupedIds = new Set(grouped.map((clip) => clip.id));
  next.timeline.clips = next.timeline.clips.filter((clip) => !groupedIds.has(clip.id));
  next.timeline.clips.push({
    id: compoundClipId,
    trackId: selected.trackId,
    kind: 'compound',
    label,
    startFrame: groupStart,
    durationFrames,
    source: { type: 'compound', compoundId },
  } as Clip);
  for (const scene of next.scenes) {
    const replaced = scene.clipIds.map((id) =>
      groupedIds.has(id) ? compoundClipId : id,
    );
    scene.clipIds = [...new Set(replaced)];
  }
  touch(next);
  return { project: next, compoundClipId, grouped: grouped.length };
}

/** Deshace un compuesto: devuelve sus clips a las pistas originales en la
 * posición actual del clip compuesto y elimina la definición. */
export function expandCompound(
  project: ProjectDocument,
  compoundClipId: string,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === compoundClipId);
  if (!clip || clip.kind !== 'compound') {
    throw new ProjectActionError('el clip no es un compuesto');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const compound = (next.compounds ?? []).find(
    (item) => item.id === clip.source.compoundId,
  );
  if (!compound) throw new ProjectActionError('la definición del compuesto no existe');
  const instances = next.timeline.clips.filter(
    (item) =>
      item.source.type === 'compound' &&
      item.source.compoundId === compound.id,
  );
  if (instances.length > 1) {
    throw new ProjectActionError(
      'el compuesto está usado por más de un clip; deshacé los otros antes',
    );
  }
  const offset = clip.startFrame;
  const inner = compound.clips.map((item) => {
    const copy = JSON.parse(JSON.stringify(item)) as Clip;
    copy.startFrame += offset;
    return copy;
  });
  next.timeline.clips = next.timeline.clips.filter((item) => item.id !== clip.id);
  next.timeline.clips.push(...inner);
  next.compounds = (next.compounds ?? []).filter((item) => item.id !== compound.id);
  const innerIds = inner.map((item) => item.id);
  for (const scene of next.scenes) {
    const replaced = scene.clipIds.flatMap((id) =>
      id === clip.id ? innerIds : [id],
    );
    scene.clipIds = [...new Set(replaced)];
  }
  touch(next);
  return next;
}

function cloneCompoundForClip(
  project: ProjectDocument,
  compoundId: string,
): { compound: Compound; compoundId: string } {
  const source = (project.compounds ?? []).find((item) => item.id === compoundId);
  if (!source) throw new ProjectActionError('la definición del compuesto no existe');
  const id = newId();
  const clips = source.clips.map((clip) => ({
    ...(JSON.parse(JSON.stringify(clip)) as CompoundInnerClip),
    id: newId(),
  }));
  return {
    compound: { ...source, id, label: `${source.label} copia`, clips },
    compoundId: id,
  };
}

export function updateTrack(
  project: ProjectDocument,
  trackId: string,
  patch: Partial<
    Pick<
      Track,
      | 'label'
      | 'muted'
      | 'hidden'
      | 'locked'
      | 'gainDb'
      | 'pan'
      | 'eqLowDb'
      | 'eqMidDb'
      | 'eqHighDb'
      | 'solo'
    >
  >,
): ProjectDocument {
  const next = cloneProject(project);
  const track = next.timeline.tracks.find((item) => item.id === trackId);
  if (!track) {
    throw new ProjectActionError('la pista no existe');
  }
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) {
      throw new ProjectActionError('la pista necesita un nombre');
    }
    track.label = label;
  }
  if (patch.muted !== undefined) track.muted = patch.muted;
  if (patch.hidden !== undefined) track.hidden = patch.hidden;
  if (patch.locked !== undefined) track.locked = patch.locked;
  if (patch.gainDb !== undefined) {
    if (!Number.isFinite(patch.gainDb) || patch.gainDb < -60 || patch.gainDb > 12) {
      throw new ProjectActionError('la ganancia de pista debe estar entre -60 y 12 dB');
    }
    track.gainDb = patch.gainDb;
  }
  if (patch.pan !== undefined) {
    if (!Number.isFinite(patch.pan) || patch.pan < -1 || patch.pan > 1) {
      throw new ProjectActionError('el paneo de pista debe estar entre -1 y 1');
    }
    track.pan = patch.pan;
  }
  for (const key of ['eqLowDb', 'eqMidDb', 'eqHighDb'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < -12 || value > 12) {
      throw new ProjectActionError('el EQ de pista debe estar entre -12 y 12 dB');
    }
    track[key] = value;
  }
  if (patch.solo !== undefined) track.solo = patch.solo;
  touch(next);
  return next;
}

export function moveTrack(
  project: ProjectDocument,
  trackId: string,
  direction: 'up' | 'down',
): ProjectDocument {
  const next = cloneProject(project);
  const sorted = [...next.timeline.tracks].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((item) => item.id === trackId);
  if (index < 0) {
    throw new ProjectActionError('la pista no existe');
  }
  const target = direction === 'up' ? index + 1 : index - 1;
  if (target < 0 || target >= sorted.length) {
    return project;
  }
  const track = sorted[index]!;
  const neighbour = sorted[target]!;
  const order = track.order;
  track.order = neighbour.order;
  neighbour.order = order;
  touch(next);
  return next;
}

export function deleteTrack(project: ProjectDocument, trackId: string): ProjectDocument {
  const next = cloneProject(project);
  if (next.timeline.clips.some((clip) => clip.trackId === trackId)) {
    throw new ProjectActionError('la pista tiene clips; vaciala antes de borrarla');
  }
  if (next.captions.cues.some((cue) => cue.trackId === trackId)) {
    throw new ProjectActionError('la pista tiene subtítulos; quitalos antes de borrarla');
  }
  if (next.motion.some((item) => item.targetTrackId === trackId)) {
    throw new ProjectActionError('la pista tiene gráficos asociados');
  }
  if (next.timeline.tracks.find((item) => item.id === trackId)?.locked) {
    throw new ProjectActionError('la pista está bloqueada');
  }
  next.timeline.tracks = next.timeline.tracks.filter((track) => track.id !== trackId);
  touch(next);
  return next;
}

export function captionsFromScenes(project: ProjectDocument): ProjectDocument {
  let next = ensureCaptionSetup(project).project;
  const setup = ensureCaptionSetup(next);
  next = cloneProject(setup.project);
  const fps = fpsOf(next);
  let cursor = Math.max(0, ...next.captions.cues.map((cue) => cue.endFrame));
  const scenes = [...next.scenes].sort((a, b) => a.order - b.order);
  for (const scene of scenes) {
    const text = scene.narration.text?.trim();
    if (!text) continue;
    const duration = Math.max(
      secondsToFrames(1.5, fps),
      scene.narration.estimatedDurationFrames ?? secondsToFrames(Math.max(2, text.length / 15), fps),
    );
    const start = findGap(
      next.captions.cues
        .filter((cue) => cue.trackId === setup.trackId)
        .map((cue) => ({ start: cue.startFrame, end: cue.endFrame })),
      cursor,
      duration,
    );
    next.captions.cues.push({
      id: newId(),
      trackId: setup.trackId,
      styleId: setup.styleId,
      text: text.slice(0, 500),
      language: next.language,
      startFrame: start,
      endFrame: start + duration,
    });
    cursor = start + duration;
  }
  touch(next);
  return next;
}


/** Add a locally generated narration asset and, when the user confirmed the
 * voice rights, mount it on a narration track. The asset passed to
 * addClipFromAsset is the project copy after markAssetReady: mounting the raw
 * `unverified` candidate would be rejected by the same gate the render uses. */
export function addGeneratedNarration(
  project: ProjectDocument,
  asset: Asset,
  sceneId: string,
  options: { confirmRights: boolean; atFrame: number; label?: string },
): { project: ProjectDocument; clipId: string | null } {
  let next = cloneProject(project);
  const existing = next.assets.find((item) => item.id === asset.id);
  if (!existing) {
    next.assets.push(asset);
  }
  const stored = next.assets.find((item) => item.id === asset.id);
  if (!stored) {
    throw new ProjectActionError('la narraci�n generada no se pudo agregar al proyecto');
  }
  if (options.label && options.label.trim()) {
    stored.label = options.label.trim().slice(0, 200);
  }
  if (options.confirmRights) {
    next = markAssetReady(next, asset.id, 'allowed');
  }
  next = attachNarrationAsset(next, sceneId, asset.id);
  let clipId: string | null = null;
  if (options.confirmRights) {
    const ready = next.assets.find((item) => item.id === asset.id);
    if (!ready) {
      throw new ProjectActionError('la narraci�n qued� sin derechos verificados');
    }
    const added = addClipFromAsset(next, ready, {
      atFrame: options.atFrame,
      narration: true,
    });
    next = added.project;
    clipId = added.clipId;
  }
  touch(next);
  return { project: next, clipId };
}

export function updateProjectLook(
  project: ProjectDocument,
  patch: Partial<ClipEffects> | null,
): ProjectDocument {
  const next = cloneProject(project);
  if (patch === null) {
    delete next.look;
  } else {
    const look: ClipEffects = { ...(next.look ?? {}) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete look[key as keyof ClipEffects];
      else (look as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(look).length === 0) delete next.look;
    else next.look = look;
  }
  touch(next);
  return next;
}

/**
 * Replaces the creative look used by presets, pero conserva el LUT cargado:
 * elegir un look no debe borrar `lutFile`/`lutIntensity`, que son una capa
 * separada del grade. Si el preset trae su propio LUT, ese gana.
 */
export function setProjectLook(
  project: ProjectDocument,
  look: ClipEffects | null,
): ProjectDocument {
  const next = cloneProject(project);
  const previous = next.look ?? {};
  const incoming: ClipEffects = look ? { ...look } : {};
  const merged: ClipEffects = {
    ...incoming,
    ...(incoming.lutFile === undefined && previous.lutFile !== undefined
      ? { lutFile: previous.lutFile }
      : {}),
    ...(incoming.lutIntensity === undefined && previous.lutIntensity !== undefined
      ? { lutIntensity: previous.lutIntensity }
      : {}),
  };
  if (Object.keys(merged).length === 0) delete next.look;
  else next.look = merged;
  touch(next);
  return next;
}

export function updateProjectSettings(
  project: ProjectDocument,
  patch: { name?: string; width?: number; height?: number; fpsNum?: number; fpsDen?: number; backgroundColor?: string; language?: string },
): ProjectDocument {
  let next = cloneProject(project);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ProjectActionError('el proyecto necesita un nombre');
    next.name = name.slice(0, 120);
  }
  if (patch.width !== undefined) next.video.width = evenDimension(patch.width, next.video.width);
  if (patch.height !== undefined) next.video.height = evenDimension(patch.height, next.video.height);
  if (patch.backgroundColor !== undefined) next.video.backgroundColor = patch.backgroundColor;
  if (patch.language !== undefined) next.language = patch.language;
  if (patch.width !== undefined || patch.height !== undefined) {
    // Canvas changes are non-destructive; the renderer fits every clip to the
    // new frame. The native delivery profile follows the project size.
    syncNativeProfile(next);
  }
  const nextNum = patch.fpsNum !== undefined ? Math.max(1, Math.round(patch.fpsNum)) : next.video.frameRate.num;
  const nextDen = patch.fpsDen !== undefined ? Math.max(1, Math.round(patch.fpsDen)) : next.video.frameRate.den;
  if (!validFpsRange(nextNum, nextDen)) {
    throw new ProjectActionError('La tasa de frames debe quedar entre 1 y 240 fps.');
  }
  const fpsChanged =
    nextNum !== next.video.frameRate.num || nextDen !== next.video.frameRate.den;
  if (fpsChanged) {
    try {
      next = retimeProject(next, nextNum, nextDen);
    } catch (error) {
      throw new ProjectActionError(
        error instanceof Error ? error.message : 'no se pudo cambiar la tasa de frames',
      );
    }
  } else {
    touch(next);
  }
  return next;
}

export function updateAudioMix(
  project: ProjectDocument,
  patch: {
    masterGainDb?: number;
    masterLimiter?: boolean;
    loudnessTarget?: ProjectDocument['audio']['loudnessTarget'];
  },
): ProjectDocument {
  const next = cloneProject(project);
  if (patch.masterGainDb !== undefined) {
    next.audio.master.gainDb = Math.max(-60, Math.min(12, patch.masterGainDb));
  }
  if (patch.masterLimiter !== undefined) {
    next.audio.master.limiter = patch.masterLimiter;
  }
  if ('loudnessTarget' in patch) {
    if (patch.loudnessTarget === undefined) {
      delete next.audio.loudnessTarget;
    } else {
      next.audio.loudnessTarget = patch.loudnessTarget;
    }
  }
  touch(next);
  return next;
}

export function totalFrames(project: ProjectDocument): number {
  // Un solo recorrido sin arrays temporales ni spread: se llama en cada
  // edición y en la invalidación del store, y con timelines largas el
  // `Math.max(...map)` anterior creaba dos arrays y podía agotar la pila de
  // argumentos. Medición con 2.500 clips: 10,5× más rápido que el spread.
  let last = 0;
  for (const clip of project.timeline.clips) {
    const end = clip.startFrame + clip.durationFrames;
    if (end > last) last = end;
  }
  for (const cue of project.captions.cues) {
    if (cue.endFrame > last) last = cue.endFrame;
  }
  return last;
}
