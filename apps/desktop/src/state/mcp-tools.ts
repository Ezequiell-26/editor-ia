import { createEmptyProject, type ClipEffects, type ClipTransition, type ProjectDocument, type SpeedCurve, type ClipMask } from '@editor-ia/project-schema';
import {
  addInstance,
  createInstance,
  duplicateInstance,
  effectRegistry,
  moveInstance,
  newInstanceId,
  removeInstance,
  resetInstance,
  setInstanceEnabled,
  setInstanceParam,
  shiftInstance,
} from '@editor-ia/effect-kit';
import type { EffectManifest, EffectStack } from '@editor-ia/effect-kit';
import type { ConversionTarget, DesktopService } from '../services/project-service';
import type { useProjectStore } from './project-store';
import { runAutoCleanup } from './auto-cleanup';
import { COLOR_LOOKS } from './color-looks';
import { estimateOutputBytes } from './export-presets';
import { loadExportPresets, saveExportPreset, deleteExportPreset } from './export-presets';
import { loadGradePresets, saveGradePreset, deleteGradePreset, createBuiltinLooks, isValidGrade } from './grade-presets';
import { addSfxToTimeline } from './sfx-actions';
import { transcribeProjectClips } from './transcribe-project';
import { runAutoPilot } from './auto-pilot';
import { runSilenceCuts } from './silence-cuts';
import { applySpeechCuts, cuesForClip, planSpeechCutsFromCues } from './speech-cuts';
import { addAiMemory, forgetAiMemory, loadAiMemory } from './ai-memory';
import {
  addAdjustmentLayer,
  addCaptionCue,
  addClipFromAsset,
  addMotionGraphic,
  addScene,
  addTitleCue,
  addTrack,
  applyAudioPresetToAll,
  applySpeedCurvePoints,
  applySpeedRamp,
  applyTransitionToCuts,
  captionsFromScenes,
  closeGaps,
  createCompound,
  cutSideAtPlayhead,
  deleteCaptionCue,
  deleteClip,
  deleteTrack,
  detachAudio,
  duplicateClip,
  expandCompound,
  fpsOf,
  freezeFrameInPlace,
  moveClip,
  replaceClipWithDerivedAsset,
  rippleDeleteClip,
  reorderScenes,
  rollClip,
  setClipSpeed,
  clearMaskKeyframes,
  removeMaskKeyframe,
  removeScene,
  setClipStabilization,
  setMaskKeyframe,
  setProjectLook,
  setTransformKeyframe,
  slideClip,
  slipClip,
  splitClip,
  splitClipAtFrames,
  splitClipsAtMarkers,
  splitTrackAtFrames,
  trimTimelineStart,
  updateScene,
  updateAudioMix,
  updateCaptionCue,
  updateClip,
  updateMotionProps,
  updateTrack,
  applyCompression,
  applyPixelFormat,
  applyProfileFit,
  applyBreathingLoop,
  applyClickPulse,
  applyFaceBlurOverlay,
  applyFaceCenter,
  applyMaskTrack,
  applyTransformBezierToAllKeyframes,
  captureTransformKeyframe,
  clearGainKeyframes,
  clearTransformKeyframes,
  clipGainAtFrame,
  clipTransformAtFrame,
  pasteTransformKeyframesAtPlayhead,
  removeGainKeyframe,
  removeTransformKeyframe,
  setGainKeyframe,
  setSlowMotionSmoothing,
  snapshotTransformKeyframes,
} from './project-actions';
import { setTrackGainKeyframe, removeTrackGainKeyframe, clearTrackGainKeyframes, setTrackPanKeyframe, removeTrackPanKeyframe, clearTrackPanKeyframes } from './track-automation';
import { wrapCaptionText, planCaptionCues } from './caption-planner';
import { splitCaptionText, buildAutoEdit, prepareAutoEdit } from './auto-edit';
import { buildNarrationPlan } from './narration-plan';
import { BUILTIN_SMART_BINS, createSmartBin, filterBySmartBin, loadCustomSmartBins, removeCustomSmartBin, saveCustomSmartBins } from './smart-bins';
import type { SmartBinRule, SmartBinStore } from './smart-bins';
import { lumaMateCandidates, moveLumaMateToOwnTrack, placeFreezeMate } from './luma-mate';
import { applyDirectorPlan, buildDirectorPlan, directorQuality } from './director';
import { defaultDirectorProfile, directorProfile, emptyDirectorMemory, loadDirectorMemory, saveDirectorMemory } from './editor-memory';
import { adaptiveSummary, measureAdaptiveProfile } from './adaptive';
import { detectBeats, decodeAudioSamples, planBeatCuts } from './beat-sync';
import { suggestBeatSpeedCurve } from './speed-ramp-suggest';
import { MOTION_TEMPLATES } from './motion-plan';
import { deriveTraits, describeImage, planImageAssignments, scoreImage } from './visual-intelligence';
import { buildStoryboard } from './storyboard';
import { totalFrames } from './project-actions';
import { evaluateProjectQuality } from './quality';
import { BUILTIN_RULE_PACKS, auditProjectForPlatform } from './platform-rules';
import { TITLE_TEMPLATES } from './title-templates';
import { SPEED_RAMP_PRESETS, applySpeedRampPreset } from './speed-ramp-presets';
import { EFFECT_PRESETS as NAMED_EFFECT_PRESETS, applyEffectPreset } from './effect-presets';
import { AUDIO_PRESETS } from './audio-presets';
import { SAFE_AREA_PRESETS } from './safe-area-presets';
import { clipSourceFrameAtLocal, clipIsReversed } from './clip-source-time';
import { recordDirectorOutcome } from './editor-memory';
import {
  buildPreferencesBundle,
  importPreferencesFromText,
  preferencesFileName,
  serializePreferencesBundle,
} from './preferences-backup';
import { loadRenderQueue, saveRenderQueue, enqueueProfiles, clearSettled, summarizeQueue, movePending, retryEntry, removeEntry, renderQueueScope } from './render-queue';
import { ioRangeFromDocument, projectWithIoRange } from './io-range';
import { exportSubtitleCues } from './subtitle-export';
import { getCatalogFavorites, toggleCatalogFavorite } from './catalog-favorites';
import { FPS_PRESETS, FORMAT_PRESETS, retimeProject } from './video-format';
import { applyProjectTitleCard } from './auto-title';
import { buildProductionPlanFromProject } from './production-plan';
import { planVariants } from './batch-factory';
import { buildPublicationMetadata, auditPublication } from './publication';
import { builtinEffectTemplates } from './builtin-effect-templates';
import { loadEffectTemplates, stackFromTemplate } from './effect-templates';
import { collectSearchDocuments, createGlobalSearch, searchGlobal, destinationOfHit } from './global-search';
import { CAPTION_MOTION_PRESETS } from '@editor-ia/project-schema';
import { buildDeliveryPackage } from './delivery-package';
import { importSubtitleFile } from './subtitle-import';
import { buildFolderTimeline } from './folder-timeline';
import type { KeyValueStore } from './render-queue';
import type { CatalogFavoriteKind } from './catalog-favorites';
import type { FaceCenterSample, FaceBlurSample } from './overlay-actions';
import { maskFromFaceTrack } from './face-mask';
import { applySpeakerSegments } from './speakers';
import { applyCriticFixes, critiqueTimeline } from './timeline-critic';
import { executeGraph, graphFromJson, validateGraph, type NodeGraph } from './graph-model';
import { GRAPH_DOC_KEY, readStoredGraphs, upsertStoredGraph } from './graph-store';
import { buildTextEditProject } from './text-edit';
import { createLottieRasterizer, parseLottieDocument, planLottieExport } from './lottie';
import { aiSkill, composeSkillPrompt, listSkills } from './ai-skills';
import { deleteCustomSkill, loadCustomSkills, saveCustomSkill } from './custom-skills';
import { NAV_VIEWS, type ViewId } from '../app/navigation';
import { MCP_TOOLS } from './mcp-catalog';
import { validateMcpToolArguments } from './mcp-validation';
import { addMarker, clearMarkers, deleteMarker, markersFromCuts, markersFromScenes, updateMarker } from './markers';
import { addAsset, ensureDelivery, newId, removeAsset } from './project-actions';
import { markAssetReady } from './assets-actions';
import { applyReviewItems, buildReviewItems } from './review-queue';
import { createOrchestratorJob } from './orchestrator';
import { FACTORY_JOB_MANAGER } from './mcp-orchestrator-jobs';
import { autoCutByActivity, buildMulticamProject, envelopeFromPeaks } from './multicam';
import { updateCaptionStyle } from './project-actions';
import { autoEditApply, autoEditExport, autoEditMeasure, autoEditStatus, autoEditVariants } from './autoedit-mcp';

/**
 * Herramientas MCP con acceso a la app.
 *
 * Cada herramienta ejecuta la misma primitiva que usa la interfaz: no hay una
 * segunda implementación de la edición. El resultado viaja como JSON en texto
 * para que el cliente externo lo pueda leer sin ambigüedad.
 *
 * Regla: si una herramienta cambia el proyecto, el cambio pasa por
 * `store.update`, así queda en el historial y se puede deshacer con Ctrl+Z.
 */

export interface McpToolContext {
  readonly store: ReturnType<typeof useProjectStore>;
  readonly selectView?: ((view: string) => void) | undefined;
  readonly runCommand?: ((text: string) => Promise<string>) | undefined;
}

type Args = Record<string, unknown>;

// AUD-014: bitácora en sesión de las mutaciones fs_* del MCP. Los comandos
// nativos ya rechazan secretos/sistema; esto deja constancia de quién
// borró/movió/creó qué, visible desde `diagnostics`.
interface FsAuditEntry {
  readonly at: string;
  readonly op: 'write' | 'mkdir' | 'delete' | 'move';
  readonly path: string;
  readonly detail?: string;
}
const FS_AUDIT_LIMIT = 50;
const fsAuditLog: FsAuditEntry[] = [];

function recordFsAudit(op: FsAuditEntry['op'], path: string, detail?: string): void {
  fsAuditLog.push({ at: new Date().toISOString(), op, path, ...(detail ? { detail } : {}) });
  if (fsAuditLog.length > FS_AUDIT_LIMIT) fsAuditLog.splice(0, fsAuditLog.length - FS_AUDIT_LIMIT);
}

function projectOf(context: McpToolContext): ProjectDocument {
  const project = context.store.state.project;
  if (!project) throw new Error('no hay ningún proyecto abierto');
  return project;
}

function text(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`falta el parámetro «${key}» (texto)`);
  }
  return value.trim();
}

function optionalText(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function frame(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`falta el parámetro «${key}» (número de frame)`);
  }
  return Math.max(0, Math.round(value));
}

function optionalNumber(args: Args, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(args: Args, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}

function apply(context: McpToolContext, next: ProjectDocument): void {
  const ok = context.store.update(() => next);
  if (!ok) throw new Error('el cambio dejaría el proyecto en un estado inválido');
}

function outputDir(context: McpToolContext, args: Args): string {
  const explicit = optionalText(args, 'outputDir');
  if (explicit) return explicit;
  const root = context.store.state.opened?.root;
  if (!root) throw new Error('el proyecto no está guardado: indicá «outputDir»');
  return `${root.replace(/[\\/]+$/, '')}\\entregas`;
}

function clipsJson(project: ProjectDocument): unknown[] {
  return project.timeline.clips.map((clip) => ({
    id: clip.id,
    trackId: clip.trackId,
    kind: clip.kind,
    label: clip.label ?? null,
    startFrame: clip.startFrame,
    durationFrames: clip.durationFrames,
    endFrame: clip.startFrame + clip.durationFrames,
    assetId: clip.source.type === 'asset' ? clip.source.assetId : null,
    motion: 'motion' in clip && clip.motion ? clip.motion : null,
    gainDb: 'audio' in clip && clip.audio ? (clip.audio.gainDb ?? 0) : null,
    enabled: 'enabled' in clip ? (clip.enabled ?? true) : true,
  }));
}

// ── Helpers para las herramientas de edición avanzadas ─────────────────

function clipById(project: ProjectDocument, clipId: string) {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) throw new Error(`el clip «${clipId}» no está en la timeline`);
  return clip;
}

function clipIdsArg(args: Args, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`falta el parámetro «${key}» (lista de clips)`);
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function stringListArg(args: Args, key: string, max = 500): string[] {
  const value = args[key];
  if (!Array.isArray(value)) {
    throw new Error(`falta el parámetro «${key}» (lista de textos)`);
  }
  const list = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  if (list.length === 0) throw new Error(`«${key}» no tiene textos válidos`);
  if (list.length > max) throw new Error(`«${key}» supera el máximo de ${max} elementos`);
  return list;
}

function numberArg(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`falta el parámetro «${key}» (número)`);
  }
  return value;
}

function stringArg(args: Args, key: string): string {
  return text(args, key);
}

/** Claves del grado visual plano que un preset reemplaza (se preserva el resto). */
const GRADE_PATCH_KEYS = [
  'brightness', 'contrast', 'saturation', 'temperature', 'shadows', 'highlights',
  'fade', 'lift', 'gamma', 'gain', 'offset', 'hsl', 'colorMatch', 'vignette',
  'lensCorrection', 'relight', 'sharpen', 'denoise', 'blur', 'glow', 'motionBlur',
  'grayscale', 'sepia', 'hueRotateDeg', 'curvePreset',
] as const;

function visualEffectsOf(clip: ReturnType<typeof clipById>): ClipEffects {
  return ('effects' in clip ? clip.effects : undefined) ?? {};
}

// ── Helpers del stack de efectos del catálogo (pasada 157) ──

type StackOwner = 'stack' | 'audioStack';

function stackOf(current: ClipEffects, owner: StackOwner): EffectStack {
  const stack = current[owner];
  return Array.isArray(stack) ? ([...stack] as unknown as EffectStack) : [];
}

function stackOwnerOf(current: ClipEffects, instanceId: string): StackOwner | null {
  if (stackOf(current, 'stack').some((item) => item.id === instanceId)) return 'stack';
  if (stackOf(current, 'audioStack').some((item) => item.id === instanceId)) return 'audioStack';
  return null;
}

function instanceManifest(current: ClipEffects, instanceId: string): { owner: StackOwner; manifest: EffectManifest } {
  const owner = stackOwnerOf(current, instanceId);
  if (!owner) throw new Error(`la instancia «${instanceId}» no está en el stack del clip`);
  const instance = stackOf(current, owner).find((item) => item.id === instanceId);
  const manifest = instance ? effectRegistry.get(instance.effectId) : undefined;
  if (!manifest) throw new Error(`el efecto «${instance?.effectId ?? '?'}» ya no está en el catálogo`);
  return { owner, manifest };
}

function writeStack(
  project: ProjectDocument,
  clipId: string,
  owner: StackOwner,
  next: EffectStack,
): ProjectDocument {
  const clip = clipById(project, clipId);
  const current = visualEffectsOf(clip);
  return updateClip(project, clipId, {
    effects: { ...current, [owner]: next } as ClipEffects,
  });
}

function paramSpecJson(spec: EffectManifest['params'][number]): Record<string, unknown> {
  const base: Record<string, unknown> = { id: spec.id, label: spec.label, type: spec.type };
  if ('min' in spec) base.min = spec.min;
  if ('max' in spec) base.max = spec.max;
  if ('step' in spec && spec.step !== undefined) base.step = spec.step;
  if ('unit' in spec && spec.unit !== undefined) base.unit = spec.unit;
  if ('options' in spec) base.options = spec.options;
  if ('default' in spec) base.default = spec.default;
  if (spec.hint) base.hint = spec.hint;
  return base;
}

function manifestJson(manifest: EffectManifest): Record<string, unknown> {
  return {
    id: manifest.id,
    name: manifest.name,
    kind: manifest.kind,
    category: manifest.category,
    description: manifest.description,
    params: manifest.params.map(paramSpecJson),
  };
}

function mergeEffects(
  project: ProjectDocument,
  clipId: string,
  patch: Partial<ClipEffects>,
): ProjectDocument {
  const clip = clipById(project, clipId);
  const current = visualEffectsOf(clip);
  return updateClip(project, clipId, {
    effects: { ...current, ...patch } as ClipEffects,
  });
}

function mergeAudio(
  project: ProjectDocument,
  clipId: string,
  patch: Record<string, unknown>,
): ProjectDocument {
  const clip = clipById(project, clipId);
  const current = 'audio' in clip ? clip.audio : undefined;
  return updateClip(project, clipId, {
    audio: { ...(current ?? {}), ...patch } as never,
  });
}

const MCP_TRANSITION_MAP: Record<string, ClipTransition['type']> = {
  fade: 'fade-black',
  dissolve: 'dissolve',
  'wipe-left': 'wipe-left',
  'wipe-right': 'wipe-right',
  'slide-left': 'slide-left',
  'slide-right': 'slide-right',
  // El catálogo de transiciones no tiene "zoom" direccional: zoom-in/out se
  // aproximan con la transición zoom-suave (única de la familia disponible).
  'zoom-in': 'zoom-suave',
  'zoom-out': 'zoom-suave',
};

const TEXT_ANIMATION_MAP: Record<string, string> = {
  'none': 'none',
  'fade-in': 'fade',
  'fade-out': 'fade',
  'slide-up': 'slide-up',
  // slide-down no existe en las animaciones de motion: pop es la entrada
  // neutra más cercana (crece desde el centro sin dirección).
  'slide-down': 'pop',
  typewriter: 'write',
};

const EFFECT_PRESETS: Record<string, Partial<ClipEffects>> = {
  cinematic: { contrast: 1.12, saturation: 0.92, temperature: -0.04, shadows: -0.08, curvePreset: 'contrast-medium' },
  vintage: { curvePreset: 'vintage', saturation: 0.75, temperature: 0.12, contrast: 0.95 },
  vibrant: { saturation: 1.45, contrast: 1.12, brightness: 0.04 },
  warm: { temperature: 0.28, saturation: 1.05, shadows: 0.05 },
  cool: { temperature: -0.28, saturation: 0.95, brightness: 0.02 },
  bw: { grayscale: true, contrast: 1.15 },
  natural: {},
};

const CINEMATIC_PRESETS: Record<string, { lift?: ClipEffects['lift']; gamma?: ClipEffects['gamma']; gain?: ClipEffects['gain']; extra?: Partial<ClipEffects> }> = {
  'teal-orange': {
    lift: { r: -0.03, g: 0.0, b: 0.05 },
    gain: { r: 0.07, g: 0.01, b: -0.09 },
    extra: { contrast: 1.08, saturation: 0.95 },
  },
  'bleach-bypass': {
    gain: { r: 0.03, g: 0.02, b: -0.02 },
    extra: { saturation: 0.55, contrast: 1.35, curvePreset: 'contrast-strong' },
  },
  'film-noir': {
    lift: { r: -0.06, g: -0.05, b: -0.04 },
    gamma: { r: 0.02, g: 0.02, b: 0.02 },
    gain: { r: 0.04, g: 0.04, b: 0.04 },
    extra: { grayscale: true, contrast: 1.4, vignette: 0.35 },
  },
  'golden-hour': {
    lift: { r: 0.02, g: 0.0, b: -0.04 },
    gain: { r: 0.1, g: 0.03, b: -0.12 },
    extra: { temperature: 0.22, saturation: 1.1 },
  },
  'cold-blue': {
    lift: { r: -0.04, g: -0.01, b: 0.05 },
    gain: { r: -0.06, g: -0.02, b: 0.08 },
    extra: { temperature: -0.25, brightness: 0.02 },
  },
  'warm-sunset': {
    lift: { r: 0.03, g: 0.0, b: -0.05 },
    gain: { r: 0.09, g: 0.02, b: -0.1 },
    extra: { temperature: 0.3, saturation: 1.08, shadows: 0.06 },
  },
};

function scaleWheel(
  wheel: { r: number; g: number; b: number } | undefined,
  intensity: number,
): { r: number; g: number; b: number } | undefined {
  if (!wheel) return undefined;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v * intensity));
  return { r: clamp(wheel.r), g: clamp(wheel.g), b: clamp(wheel.b) };
}

function autoEditOptions(args: Record<string, unknown>): {
  assignment: 'order' | 'match';
  includeCaptions: boolean;
  replaceTimeline: boolean;
  maxCaptionChars?: number;
  photoMotion?: 'auto' | 'none';
  transitionFrames?: number;
  includeVideos?: boolean;
  mediaByScene?: Record<string, string>;
} {
  const num = (key: string): number | undefined => optionalNumber(args as never, key);
  const bool = (key: string): boolean | undefined => optionalBoolean(args as never, key);
  const textv = (key: string): string | undefined => optionalText(args as never, key);
  const options: ReturnType<typeof autoEditOptions> = {
    assignment: (textv('assignment') ?? 'match') as 'order' | 'match',
    includeCaptions: bool('includeCaptions') ?? true,
    replaceTimeline: bool('replaceTimeline') ?? false,
  };
  const maxChars = num('maxCaptionChars'); if (maxChars !== undefined) options.maxCaptionChars = maxChars;
  const photoMotion = textv('photoMotion'); if (photoMotion === 'auto' || photoMotion === 'none') options.photoMotion = photoMotion;
  const transFrames = num('transitionFrames'); if (transFrames !== undefined) options.transitionFrames = transFrames;
  const incVideos = bool('includeVideos'); if (incVideos !== undefined) options.includeVideos = incVideos;
  const mediaByScene = args.mediaByScene as Record<string, string> | undefined;
  if (mediaByScene && typeof mediaByScene === 'object') options.mediaByScene = mediaByScene;
  return options;
}
export async function executeMcpTool(
  tool: string,
  rawArgs: unknown,
  context: McpToolContext,
): Promise<string> {
  if (tool === '__catalog') return JSON.stringify(MCP_TOOLS);
  const args = validateMcpToolArguments(tool, rawArgs);
  switch (tool) {
    case 'multicam_build': {
      const project = projectOf(context);
      const ids = Array.isArray(args.assetIds)
        ? args.assetIds.filter((item): item is string => typeof item === 'string')
        : [];
      const assets = ids
        .map((id) => project.assets.find((asset) => asset.id === id))
        .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
      const ignoredAssetIds = ids.filter(
        (id) => !project.assets.some((asset) => asset.id === id),
      );
      if (assets.length < 2) {
        throw new Error(
          ignoredAssetIds.length > 0
            ? `necesito al menos dos medios de video; ids que no existen: ${ignoredAssetIds.join(', ')}`
            : 'necesito al menos dos medios de video',
        );
      }
      const offsets = (args.offsets && typeof args.offsets === 'object' ? args.offsets : {}) as Record<string, unknown>;
      const cameras = assets.map((asset) => ({
        asset,
        offsetFrames: Math.max(
          0,
          Math.round(typeof offsets[asset.id] === 'number' ? (offsets[asset.id] as number) : 0),
        ),
      }));
      let cuts = [{ frame: 0, cameraIndex: 0 }];
      if (args.autoCut !== false) {
        const envelopes = await Promise.all(
          cameras.map(async (camera) => {
            try {
              return envelopeFromPeaks(await context.store.service.audioPeaks(camera.asset.id, 600));
            } catch {
              return null;
            }
          }),
        );
        cuts = autoCutByActivity(cameras, envelopes, fpsOf(project));
      }
      const built = buildMulticamProject(project, cameras, cuts);
      apply(context, built.project);
      return JSON.stringify({
        ok: true,
        trackId: built.trackId,
        clips: built.clipCount,
        cuts: cuts.length,
        durationFrames: built.durationFrames,
        ignoredAssetIds,
      });
    }

    case 'factory_run': {
      const project = projectOf(context);
      const brief = text(args, 'brief');
      const mediaIds = project.assets
        .filter(
          (asset) =>
            asset.status === 'ready' && (asset.kind === 'image' || asset.kind === 'video'),
        )
        .map((asset) => asset.id);
      if (mediaIds.length === 0) {
        throw new Error('factory_run necesita al menos una imagen o un video confirmado en el proyecto abierto');
      }
      const fps = project.video.frameRate;
      const job = createOrchestratorJob({
        name: brief.slice(0, 80) || 'Video automático',
        options: {
          brief,
          scenes: Math.max(1, Math.min(12, Math.round(optionalNumber(args, 'scenes') ?? 6))),
          language: optionalText(args, 'language') ?? 'es',
          width: Math.max(2, Math.round(optionalNumber(args, 'width') ?? project.video.width)),
          height: Math.max(2, Math.round(optionalNumber(args, 'height') ?? project.video.height)),
          fpsNum: fps.num,
          fpsDen: fps.den,
          outputDir: outputDir(context, args),
          mediaIds,
          voiceProvider: 'windows-sapi',
          photoMotion: 'auto',
          transitionFrames: 12,
          includeCaptions: true,
          renderVideo: args.render !== false,
          generateMedia: args.generateMedia === true,
          ...(optionalText(args, 'flowServerId')
            ? { flowServerId: optionalText(args, 'flowServerId')! }
            : {}),
          flowKind: args.flowKind === 'video' ? 'video' : 'image',
          flowModel: optionalText(args, 'flowModel') ?? 'Nano Banana 2',
          flowRatio: optionalText(args, 'flowRatio') ?? '16:9',
          flowDuration: optionalText(args, 'flowDuration') ?? '6s',
          approveCredits: args.approveCredits === true,
          confirmRights: true,
        },
      });
      const queued = FACTORY_JOB_MANAGER.start(job, {
        service: context.store.service,
        baseProject: project,
        onUpdate: () => {},
      });
      return JSON.stringify({
        ok: true,
        jobId: queued.id,
        status: queued.status,
        message: 'Trabajo aceptado. Consultá factory_job_status para ver el progreso y factory_job_cancel para solicitar cancelación.',
      });
    }

    case 'factory_job_status': {
      const jobId = text(args, 'jobId');
      const job = FACTORY_JOB_MANAGER.status(jobId);
      if (!job) throw new Error('no existe un trabajo de fábrica con ese ID');
      return JSON.stringify({
        id: job.id,
        name: job.name,
        source: job.source ?? null,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        cancelRequested: job.cancelRequested ?? false,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        projectPath: job.projectPath ?? null,
        videoPath: job.videoPath ?? null,
        videoBytes: job.videoBytes ?? null,
        profileId: job.profileId ?? null,
        error: job.error ?? null,
        result: job.result ?? null,
        cost: job.cost,
        log: job.log.slice(-20),
      });
    }

    case 'factory_job_list':
      return JSON.stringify(
        FACTORY_JOB_MANAGER.list(optionalNumber(args, 'limit') ?? 20).map((job) => ({
          id: job.id,
          name: job.name,
          source: job.source ?? null,
          status: job.status,
          stage: job.stage,
          progress: job.progress,
          cancelRequested: job.cancelRequested ?? false,
          updatedAt: job.updatedAt,
          projectPath: job.projectPath ?? null,
          videoPath: job.videoPath ?? null,
          error: job.error ?? null,
        })),
      );

    case 'factory_job_cancel':
      return JSON.stringify(FACTORY_JOB_MANAGER.cancel(text(args, 'jobId')));

    case 'caption_style_update': {
      const project = projectOf(context);
      const styleId = text(args, 'styleId');
      const patch: Parameters<typeof updateCaptionStyle>[2] = {};
      const name = optionalText(args, 'name');
      if (name !== undefined) patch.name = name;
      const font = optionalText(args, 'fontFamily');
      if (font !== undefined) patch.fontFamily = font;
      const size = optionalNumber(args, 'fontSizePx');
      if (size !== undefined) patch.fontSizePx = Math.max(8, Math.round(size));
      const color = optionalText(args, 'color');
      if (color !== undefined) patch.color = color;
      const outline = optionalText(args, 'outlineColor');
      if (outline !== undefined) patch.outlineColor = outline;
      const background = optionalText(args, 'backgroundColor');
      if (background !== undefined) patch.backgroundColor = background;
      apply(context, updateCaptionStyle(project, styleId, patch));
      return JSON.stringify({ ok: true, styleId });
    }

    case 'settings_set_tools': {
      const ffmpeg = optionalText(args, 'ffmpeg');
      const ffprobe = optionalText(args, 'ffprobe');
      if (!ffmpeg && !ffprobe) throw new Error('indicá «ffmpeg» o «ffprobe»');
      await context.store.service.setToolPaths({
        ...(ffmpeg ? { ffmpeg } : {}),
        ...(ffprobe ? { ffprobe } : {}),
      });
      return JSON.stringify({ ok: true });
    }

    case 'extract_audio': {
      const result = await context.store.service.extractAudio({
        input: text(args, 'input'),
        output: text(args, 'output'),
      });
      return JSON.stringify(result);
    }

    case 'audio_effects_list': {
      const effects = await context.store.service.audioEffectsList();
      return JSON.stringify({ effects });
    }

    case 'audio_effects_render': {
      const chain = Array.isArray(args.chain)
        ? (args.chain as Record<string, unknown>[]).map((step) => ({
            effect: String(step.effect ?? ''),
            params: Array.isArray(step.params)
              ? (step.params as Record<string, unknown>[]).map((p) => ({
                  param: String(p.param ?? ''),
                  value: Number(p.value) || 0,
                }))
              : [],
          }))
        : [];
      const speed = optionalNumber(args, 'speed');
      const output = await context.store.service.audioEffectsRender(
        text(args, 'path'),
        text(args, 'output'),
        chain,
        speed,
      );
      return JSON.stringify({ output });
    }

    case 'audio_loudness_analyze': {
      const result = await context.store.service.audioLoudnessAnalyze(text(args, 'path'));
      return JSON.stringify(result);
    }

    case 'audio_sync_offset': {
      const result = await context.store.service.audioSyncOffset(
        text(args, 'pathA'),
        text(args, 'pathB'),
      );
      return JSON.stringify(result);
    }

    case 'audio_time_stretch': {
      const output = await context.store.service.audioTimeStretch(
        text(args, 'path'),
        text(args, 'output'),
        numberArg(args, 'speed'),
      );
      return JSON.stringify({ output });
    }

    case 'audio_loudness_normalize': {
      const target = optionalNumber(args, 'targetLufs');
      const result = await context.store.service.audioLoudnessNormalize(
        text(args, 'path'),
        text(args, 'output'),
        target,
      );
      return JSON.stringify(result);
    }

    case 'audio_remix_analyze': {
      const result = await context.store.service.audioRemixAnalyze(
        text(args, 'path'),
      );
      return JSON.stringify(result);
    }

    case 'audio_remix_render': {
      const output = await context.store.service.audioRemixRender(
        text(args, 'path'),
        text(args, 'output'),
        numberArg(args, 'targetSeconds'),
        optionalNumber(args, 'segments'),
        optionalNumber(args, 'variations'),
      );
      return JSON.stringify({ output });
    }

    case 'audio_duck_plan': {
      const options: {
        sensitivity?: number; minOnSeconds?: number; bridgeSeconds?: number;
        clipStartSeconds?: number; clipEndSeconds?: number;
        baseDb?: number; reduceDb?: number; fadeSeconds?: number;
      } = {};
      for (const [key, field] of [
        ['sensitivity', 'sensitivity'], ['minOnSeconds', 'minOnSeconds'],
        ['bridgeSeconds', 'bridgeSeconds'], ['clipStartSeconds', 'clipStartSeconds'],
        ['clipEndSeconds', 'clipEndSeconds'], ['baseDb', 'baseDb'],
        ['reduceDb', 'reduceDb'], ['fadeSeconds', 'fadeSeconds'],
      ] as const) {
        const v = optionalNumber(args, key);
        if (v !== undefined) options[field] = v;
      }
      const result = await context.store.service.audioDuckPlan(text(args, 'path'), options);
      return JSON.stringify(result);
    }

    case 'audio_channels_convert': {
      const output = await context.store.service.audioChannelsConvert(
        text(args, 'path'),
        text(args, 'output'),
        text(args, 'toLayout'),
        optionalText(args, 'mixdown'),
        optionalText(args, 'fromLayout'),
      );
      return JSON.stringify({ output });
    }

    case 'lut_probe': {
      const result = await context.store.service.lutProbe(text(args, 'path'));
      return JSON.stringify(result);
    }

    case 'lut_export': {
      const effects: Record<string, number> = {};
      for (const key of ['brightness', 'contrast', 'saturation', 'temperature'] as const) {
        const value = optionalNumber(args, key);
        if (value !== undefined) effects[key] = value;
      }
      const title = optionalText(args, 'title');
      const result = await context.store.service.exportLookLut({
        outputDir: text(args, 'outputDir'),
        effects,
        ...(title ? { title } : {}),
      });
      return JSON.stringify(result);
    }

    case 'lut_import': {
      const result = await context.store.service.importLut(text(args, 'path'));
      return JSON.stringify(result ?? { ok: false, error: 'importación cancelada' });
    }

    case 'video_scopes_analyze': {
      const result = await context.store.service.analyzeScopesFrame({
        path: text(args, 'path'),
      });
      return JSON.stringify(result);
    }

    case 'render_frame': {
      const clipId = text(args, 'clipId');
      const project = projectOf(context);
      clipById(project, clipId);
      const result = await context.store.service.renderPreviewFrame({
        project: project as unknown,
        clipId,
        frame: frame(args, 'frame'),
        ...(optionalBoolean(args, 'native') !== undefined ? { native: optionalBoolean(args, 'native')! } : {}),
        ...(optionalBoolean(args, 'composite') !== undefined ? { composite: optionalBoolean(args, 'composite')! } : {}),
      });
      return JSON.stringify(result);
    }

    case 'media_thumbnail': {
      return JSON.stringify(
        await context.store.service.mediaThumbnail(
          text(args, 'path'),
          optionalBoolean(args, 'isImage') === true,
          optionalNumber(args, 'timeSeconds'),
        ),
      );
    }

    case 'scene_detect': {
      const threshold = optionalNumber(args, 'threshold');
      if (threshold === undefined) throw new Error('falta el parámetro «threshold» (0-1)');
      return JSON.stringify(
        await context.store.service.detectScenes(text(args, 'assetId'), threshold),
      );
    }

    case 'stabilization_analyze': {
      const smoothing = optionalNumber(args, 'smoothing');
      if (smoothing === undefined) throw new Error('falta el parámetro «smoothing»');
      return JSON.stringify(
        await context.store.service.analyzeStabilization(
          text(args, 'assetId'),
          frame(args, 'inFrame'),
          frame(args, 'outFrame'),
          smoothing,
        ),
      );
    }

    case 'sample_asset_color': {
      const seconds = optionalNumber(args, 'seconds');
      if (seconds === undefined) throw new Error('falta el parámetro «seconds»');
      return JSON.stringify(
        await context.store.service.sampleAssetColor({ path: text(args, 'path'), seconds }),
      );
    }

    case 'find_missing_assets': {
      return JSON.stringify(
        await context.store.service.findMissingAssets(optionalText(args, 'projectPath')),
      );
    }

    case 'find_duplicate_assets': {
      return JSON.stringify(
        await context.store.service.findDuplicateAssets(optionalText(args, 'projectPath')),
      );
    }

    case 'relink_assets_folder': {
      return JSON.stringify(
        await context.store.service.relinkAssetsFromFolder(
          optionalText(args, 'projectPath') ?? null,
          text(args, 'folder'),
        ),
      );
    }

    case 'sfx_library': {
      return JSON.stringify(await context.store.service.sfxLibrary());
    }

    case 'list_capabilities': {
      return JSON.stringify(await context.store.service.listCapabilities());
    }

    case 'export_capabilities': {
      return JSON.stringify(await context.store.service.exportCapabilities());
    }

    case 'extract_subtitles': {
      return JSON.stringify(await context.store.service.extractSubtitles(text(args, 'path')));
    }

    case 'mix_loudness_analyze': {
      return JSON.stringify(
        await context.store.service.analyzeMixLoudness(optionalText(args, 'profileId')),
      );
    }

    case 'audio_scope_analyze': {
      const range =
        optionalNumber(args, 'startSeconds') !== undefined &&
        optionalNumber(args, 'durationSeconds') !== undefined
          ? {
              startSeconds: optionalNumber(args, 'startSeconds')!,
              durationSeconds: optionalNumber(args, 'durationSeconds')!,
            }
          : null;
      const path = optionalText(args, 'path');
      const assetId = optionalText(args, 'assetId');
      if (!path && !assetId) throw new Error('indicá «path» o «assetId»');
      const data = path
        ? await context.store.service.audioScopeAnalyze(path, range)
        : await context.store.service.audioScopeAnalyzeAsset(assetId!, range);
      return JSON.stringify(data);
    }

    case 'file_loudness_measure': {
      return JSON.stringify(
        await context.store.service.measureFileLoudness(text(args, 'path')),
      );
    }

    case 'voice_list': {
      return JSON.stringify(await context.store.service.listVoices());
    }

    case 'narration_synthesize': {
      const rate = projectOf(context).video.frameRate;
      return JSON.stringify(
        await context.store.service.synthesizeNarration({
          text: text(args, 'text'),
          ...(optionalText(args, 'voice') ? { voice: optionalText(args, 'voice')! } : {}),
          ...(args.provider === 'windows-sapi' ? { provider: 'windows-sapi' as const } : {}),
          fpsNum: rate.num,
          fpsDen: rate.den,
        }),
      );
    }

    case 'dialogue_enhance': {
      const preset = optionalText(args, 'preset');
      return JSON.stringify(
        await context.store.service.enhanceDialogue({
          inputPath: text(args, 'inputPath'),
          ...(optionalText(args, 'outputDir') ? { outputDir: optionalText(args, 'outputDir') ?? null } : {}),
          ...(preset ? { preset: preset as 'dialogo' | 'voz' | 'podcast' | 'suave' } : {}),
        }),
      );
    }

    case 'dub_synthesize': {
      const cuesRaw = args.cues;
      if (!Array.isArray(cuesRaw) || cuesRaw.length === 0) {
        throw new Error('«cues» debe ser una lista no vacía');
      }
      const cues = cuesRaw.map((cue) => {
        const c = cue as Record<string, unknown>;
        const start = typeof c.startSeconds === 'number' ? c.startSeconds : undefined;
        const end = typeof c.endSeconds === 'number' ? c.endSeconds : undefined;
        const cueText = typeof c.text === 'string' ? c.text : '';
        if (start === undefined || end === undefined || !cueText) {
          throw new Error('cada cue necesita startSeconds, endSeconds y text');
        }
        return { startSeconds: start, endSeconds: end, text: cueText };
      });
      return JSON.stringify(
        await context.store.service.synthesizeDub({
          path: text(args, 'path'),
          outputDir: text(args, 'outputDir'),
          language: text(args, 'language'),
          cues,
          ...(optionalText(args, 'voice') ? { voice: optionalText(args, 'voice')! } : {}),
          ...(optionalNumber(args, 'endSeconds') !== undefined
            ? { endSeconds: optionalNumber(args, 'endSeconds')! }
            : {}),
          ...(optionalNumber(args, 'bedVolume') !== undefined
            ? { bedVolume: optionalNumber(args, 'bedVolume')! }
            : {}),
        }),
      );
    }

    case 'voice_clone': {
      return JSON.stringify(
        await context.store.service.cloneVoice({
          text: text(args, 'text'),
          referencePath: text(args, 'referencePath'),
          engineUrl: text(args, 'engineUrl'),
          language: text(args, 'language'),
          ...(args.engine === 'xtts' || args.engine === 'gpt-sovits' ? { engine: args.engine } : {}),
          ...(optionalText(args, 'promptText') ? { promptText: optionalText(args, 'promptText')! } : {}),
        }),
      );
    }

    case 'lip_sync': {
      return JSON.stringify(
        await context.store.service.lipSync({
          videoPath: text(args, 'videoPath'),
          audioPath: text(args, 'audioPath'),
          outputDir: text(args, 'outputDir'),
          engineUrl: text(args, 'engineUrl'),
          ...(optionalText(args, 'engine') ? { engine: optionalText(args, 'engine')! } : {}),
        }),
      );
    }

    case 'transcribe_asset': {
      return JSON.stringify(
        await context.store.service.transcribeAsset(
          text(args, 'assetId'),
          optionalText(args, 'language'),
          optionalText(args, 'model'),
        ),
      );
    }

    case 'background_remove_file': {
      return JSON.stringify(await context.store.service.removeBackground(text(args, 'inputPath')));
    }

    case 'background_remove_asset': {
      const rate = projectOf(context).video.frameRate;
      const kind = text(args, 'kind');
      if (kind !== 'image' && kind !== 'video') throw new Error('«kind» debe ser image o video');
      return JSON.stringify(
        await context.store.service.removeBackgroundAsset({
          path: text(args, 'path'),
          kind,
          inFrame: frame(args, 'inFrame'),
          outFrame: frame(args, 'outFrame'),
          fpsNum: rate.num,
          fpsDen: rate.den,
        }),
      );
    }

    case 'upscale_image': {
      return JSON.stringify(await context.store.service.upscaleImage(text(args, 'inputPath')));
    }

    case 'upscale_video': {
      return JSON.stringify(
        await context.store.service.upscaleVideo(
          text(args, 'inputPath'),
          optionalText(args, 'outputPath'),
          optionalNumber(args, 'maxSeconds'),
        ),
      );
    }

    case 'denoise_media': {
      const mode = text(args, 'mode');
      const preset = text(args, 'preset');
      if (mode !== 'video' && mode !== 'image') throw new Error('«mode» debe ser video o image');
      if (preset !== 'fast' && preset !== 'balanced' && preset !== 'quality') {
        throw new Error('«preset» debe ser fast, balanced o quality');
      }
      return JSON.stringify(
        await context.store.service.denoiseMedia({
          inputPath: text(args, 'inputPath'),
          mode,
          preset,
          ...(optionalText(args, 'outputDir') ? { outputDir: optionalText(args, 'outputDir') ?? null } : {}),
          ...(optionalNumber(args, 'strength') !== undefined
            ? { strength: optionalNumber(args, 'strength')! }
            : {}),
          ...(optionalBoolean(args, 'temporal') !== undefined
            ? { temporal: optionalBoolean(args, 'temporal')! }
            : {}),
          ...(optionalBoolean(args, 'preserveDetail') !== undefined
            ? { preserveDetail: optionalBoolean(args, 'preserveDetail')! }
            : {}),
        }),
      );
    }

    case 'sharpen_media': {
      const mode = text(args, 'mode');
      if (mode !== 'video' && mode !== 'image') throw new Error('«mode» debe ser video o image');
      const size = optionalNumber(args, 'unsharpSize');
      return JSON.stringify(
        await context.store.service.sharpenMedia({
          inputPath: text(args, 'inputPath'),
          mode,
          ...(optionalText(args, 'outputDir') ? { outputDir: optionalText(args, 'outputDir') ?? null } : {}),
          ...(optionalNumber(args, 'denoise') !== undefined
            ? { denoise: optionalNumber(args, 'denoise')! }
            : {}),
          ...(optionalBoolean(args, 'deblock') !== undefined
            ? { deblock: optionalBoolean(args, 'deblock')! }
            : {}),
          ...(optionalNumber(args, 'targetHeight') !== undefined
            ? { targetHeight: Math.round(optionalNumber(args, 'targetHeight')!) }
            : {}),
          ...(optionalBoolean(args, 'highPrecision') !== undefined
            ? { highPrecision: optionalBoolean(args, 'highPrecision')! }
            : {}),
          ...(optionalNumber(args, 'unsharpAmount') !== undefined
            ? { unsharpAmount: optionalNumber(args, 'unsharpAmount')! }
            : {}),
          ...(size !== undefined ? { unsharpSize: size as 3 | 5 | 7 | 9 } : {}),
          ...(optionalNumber(args, 'curve') !== undefined
            ? { curve: optionalNumber(args, 'curve')! }
            : {}),
          ...(optionalNumber(args, 'grain') !== undefined
            ? { grain: optionalNumber(args, 'grain')! }
            : {}),
          ...(optionalText(args, 'preset') ? { preset: optionalText(args, 'preset')! } : {}),
        }),
      );
    }

    case 'freeze_frame_extract': {
      const rate = projectOf(context).video.frameRate;
      return JSON.stringify(
        await context.store.service.extractFreezeFrame({
          path: text(args, 'path'),
          seconds: optionalNumber(args, 'seconds') ?? 0,
          fpsNum: rate.num,
          fpsDen: rate.den,
        }),
      );
    }

    case 'video_merge': {
      const ids = args.assetIds;
      if (!Array.isArray(ids) || ids.length < 2 || ids.some((v) => typeof v !== 'string' || !v)) {
        throw new Error('«assetIds» debe ser una lista de al menos 2 ids');
      }
      return JSON.stringify(
        await context.store.service.mergeVideos(ids as string[], text(args, 'outputDir')),
      );
    }

    case 'video_trim': {
      return JSON.stringify(
        await context.store.service.trimVideo(
          text(args, 'assetId'),
          optionalNumber(args, 'startSeconds') ?? 0,
          optionalNumber(args, 'endSeconds') ?? 0,
          text(args, 'outputDir'),
        ),
      );
    }

    case 'video_watermark': {
      return JSON.stringify(
        await context.store.service.watermarkVideo(
          text(args, 'assetId'),
          text(args, 'text'),
          text(args, 'position'),
          text(args, 'outputDir'),
        ),
      );
    }

    case 'video_metadata': {
      return JSON.stringify(
        await context.store.service.setMetadata(
          text(args, 'assetId'),
          optionalText(args, 'title') ?? '',
          optionalText(args, 'artist') ?? '',
          optionalText(args, 'comment') ?? '',
          text(args, 'outputDir'),
        ),
      );
    }

    case 'import_timeline': {
      const confirmRights = args.confirmRights === true;
      if (!confirmRights) throw new Error('confirmRights=true es obligatorio para importar');
      return JSON.stringify(
        await context.store.service.importTimeline({
          project: projectOf(context),
          path: text(args, 'path'),
          confirmRights: true,
        }),
      );
    }

    case 'verify_export': {
      return JSON.stringify(await context.store.service.verifyExport(text(args, 'path')));
    }

    case 'qc_media': {
      return JSON.stringify(
        await context.store.service.qcMediaFile(
          text(args, 'path'),
          optionalNumber(args, 'sceneThreshold'),
          optionalNumber(args, 'silenceDb'),
          optionalNumber(args, 'minSilence'),
        ),
      );
    }

    case 'thumbnail_pick': {
      return JSON.stringify(
        await context.store.service.pickThumbnailFrames({ path: text(args, 'path') }),
      );
    }

    case 'thumbnail_save': {
      const fileName = optionalText(args, 'fileName');
      const result = await context.store.service.saveThumbnail({
        dataUrl: text(args, 'dataUrl'),
        outputDir: text(args, 'outputDir'),
        ...(fileName ? { fileName } : {}),
      });
      return JSON.stringify(result);
    }

    case 'concat_worker': {
      const action = text(args, 'action');
      if (action === 'status') {
        return JSON.stringify(await context.store.service.concatWorkerStatus());
      }
      if (action === 'cancel') {
        return JSON.stringify({ ok: await context.store.service.concatWorkerCancelRender() });
      }
      if (action === 'request') {
        const paramsRaw = args.params;
        const params =
          typeof paramsRaw === 'object' && paramsRaw !== null && !Array.isArray(paramsRaw)
            ? (paramsRaw as Record<string, unknown>)
            : undefined;
        const timeoutMs = optionalNumber(args, 'timeoutMs');
        const result = await context.store.service.concatWorkerRequest(
          text(args, 'op'),
          params ?? null,
          timeoutMs !== undefined ? Math.round(timeoutMs) : undefined,
        );
        return JSON.stringify(result);
      }
      throw new Error('«action» debe ser status, request o cancel');
    }

    case 'render_diary': {
      const limit = optionalNumber(args, 'limit');
      return JSON.stringify(
        await context.store.service.renderDiary(limit === undefined ? undefined : Math.round(limit)),
      );
    }

    case 'project_versions_list': {
      return JSON.stringify(
        await context.store.service.listProjectVersions(optionalText(args, 'projectPath')),
      );
    }

    case 'project_version_restore': {
      const mode = args.mode;
      return JSON.stringify(
        await context.store.service.restoreProjectVersion(
          text(args, 'projectPath'),
          text(args, 'versionId'),
          mode === 'in-place' || mode === 'copy' ? mode : undefined,
        ),
      );
    }

    case 'visual_audit': {
      return JSON.stringify(await context.store.service.auditVisuals(projectOf(context)));
    }

    case 'media_probe_file': {
      return JSON.stringify(await context.store.service.probeMediaFile(text(args, 'path')));
    }

    case 'audio_peaks_path': {
      const buckets = optionalNumber(args, 'buckets');
      return JSON.stringify(
        await context.store.service.audioPeaksPath(
          text(args, 'path'),
          buckets === undefined ? undefined : Math.round(buckets),
        ),
      );
    }

    case 'proxy_status': {
      return JSON.stringify(await context.store.service.proxyStatus(text(args, 'assetId')));
    }

    case 'catalog_search': {
      const kind = optionalText(args, 'kind');
      const tags = args.tags;
      return JSON.stringify(
        await context.store.service.catalogSearch({
          ...(kind ? { kind: kind as 'video' | 'audio' | 'image' | 'animation' | 'graphic' } : {}),
          ...(optionalText(args, 'text') ? { text: optionalText(args, 'text')! } : {}),
          ...(Array.isArray(tags) && tags.every((t) => typeof t === 'string')
            ? { tags: tags as string[] }
            : {}),
          ...(optionalNumber(args, 'limit') !== undefined
            ? { limit: Math.round(optionalNumber(args, 'limit')!) }
            : {}),
        }),
      );
    }

    case 'catalog_get': {
      const entry = await context.store.service.catalogGet(text(args, 'id'));
      return JSON.stringify(entry);
    }

    case 'provider_test': {
      return JSON.stringify(await context.store.service.testProvider());
    }

    case 'render_queue': {
      return JSON.stringify(await context.store.service.renderQueueLoad());
    }

    case 'vmaf_measure': {
      return JSON.stringify(
        await context.store.service.measureVmaf(text(args, 'original'), text(args, 'compressed')),
      );
    }

    case 'proxy_apply': {
      return JSON.stringify(
        await context.store.service.applyProxyToAsset(text(args, 'assetId')),
      );
    }

    case 'relink_asset': {
      return JSON.stringify(
        await context.store.service.relinkAsset(text(args, 'assetId'), text(args, 'newPath')),
      );
    }

    case 'proxy_ensure': {
      const quality = args.quality;
      return JSON.stringify(
        await context.store.service.ensureProxy(
          text(args, 'assetId'),
          quality === '540p' || quality === '720p' ? quality : undefined,
        ),
      );
    }

    case 'proxy_cleanup': {
      return JSON.stringify(
        await context.store.service.cleanupProxies(optionalText(args, 'assetId')),
      );
    }

    case 'compress_file': {
      const target = text(args, 'target');
      const mode = text(args, 'mode');
      if (target !== 'mp4' && target !== 'mkv' && target !== 'hevc') {
        throw new Error('«target» debe ser mp4, mkv o hevc');
      }
      if (mode !== 'quality' && mode !== 'size') {
        throw new Error('«mode» debe ser quality o size');
      }
      return JSON.stringify(
        await context.store.service.compressAnyFile({
          inputPath: text(args, 'inputPath'),
          outputDir: text(args, 'outputDir'),
          target,
          mode,
          ...(optionalNumber(args, 'quality') !== undefined
            ? { quality: optionalNumber(args, 'quality')! }
            : {}),
          ...(optionalNumber(args, 'targetMegabytes') !== undefined
            ? { targetMegabytes: optionalNumber(args, 'targetMegabytes')! }
            : {}),
          ...(optionalNumber(args, 'maxWidth') !== undefined
            ? { maxWidth: Math.round(optionalNumber(args, 'maxWidth')!) }
            : {}),
          ...(optionalNumber(args, 'audioKbps') !== undefined
            ? { audioKbps: Math.round(optionalNumber(args, 'audioKbps')!) }
            : {}),
        }),
      );
    }

    case 'production_remove': {
      await context.store.service.productionRemove(text(args, 'runId'));
      return JSON.stringify({ ok: true });
    }

    case 'downloader_status': {
      return JSON.stringify(await context.store.service.downloaderStatus());
    }

    case 'downloader_bridge_info': {
      return JSON.stringify(await context.store.service.downloaderBridgeInfo());
    }

    case 'download_probe': {
      return JSON.stringify(
        await context.store.service.probeDownload(
          text(args, 'url'),
          optionalText(args, 'cookiesFile') ?? null,
          optionalText(args, 'cookiesFromBrowser') ?? null,
        ),
      );
    }

    case 'playlist_entries': {
      const limit = optionalNumber(args, 'limit');
      return JSON.stringify(
        await context.store.service.listPlaylistEntries(
          text(args, 'url'),
          limit === undefined ? null : Math.round(limit),
        ),
      );
    }

    case 'audio_tracks_url': {
      return JSON.stringify(await context.store.service.listAudioTracks(text(args, 'url')));
    }

    case 'sponsorblock_preview': {
      return JSON.stringify(
        await context.store.service.sponsorblockPreview(
          text(args, 'url'),
          optionalText(args, 'categories') ?? null,
        ),
      );
    }

    case 'source_checksum': {
      return JSON.stringify(await context.store.service.probeSourceChecksum(text(args, 'url')));
    }

    case 'rss_fetch': {
      const limit = optionalNumber(args, 'limit');
      return JSON.stringify(
        await context.store.service.fetchRssFeed(
          text(args, 'url'),
          limit === undefined ? null : Math.round(limit),
        ),
      );
    }

    case 'watch_folder_scan': {
      return JSON.stringify(await context.store.service.scanWatchFolder(text(args, 'path')));
    }

    case 'proxy_test': {
      return JSON.stringify(await context.store.service.testProxy(text(args, 'proxy')));
    }

    case 'vpn_list': {
      return JSON.stringify(await context.store.service.vpnList());
    }

    case 'watchdog_status': {
      return JSON.stringify(await context.store.service.watchdogStatus());
    }

    case 'platform_rules': {
      return JSON.stringify(await context.store.service.fetchPlatformRules());
    }

    case 'youtube_channel_analyze': {
      const maxVideos = optionalNumber(args, 'maxVideos');
      const detailCount = optionalNumber(args, 'detailCount');
      const commentVideos = optionalNumber(args, 'commentVideos');
      return JSON.stringify(
        await context.store.service.analyzeYoutubeChannel({
          channelUrl: text(args, 'channelUrl'),
          ...(maxVideos !== undefined ? { maxVideos: Math.round(maxVideos) } : {}),
          ...(detailCount !== undefined ? { detailCount: Math.round(detailCount) } : {}),
          ...(optionalBoolean(args, 'includeComments') !== undefined
            ? { includeComments: optionalBoolean(args, 'includeComments')! }
            : {}),
          ...(commentVideos !== undefined ? { commentVideos: Math.round(commentVideos) } : {}),
        }),
      );
    }

    case 'creator_hook': {
      return JSON.stringify(
        await context.store.service.creatorInjectHook({
          inputPath: text(args, 'inputPath'),
          outputPath: text(args, 'outputPath'),
          hookText: text(args, 'hookText'),
          ...(optionalNumber(args, 'zoomPercent') !== undefined
            ? { zoomPercent: optionalNumber(args, 'zoomPercent')! }
            : {}),
          ...(optionalNumber(args, 'soundGainDb') !== undefined
            ? { soundGainDb: optionalNumber(args, 'soundGainDb')! }
            : {}),
        }),
      );
    }

    case 'creator_export_multi_aspect': {
      const aspects = args.aspects;
      return JSON.stringify(
        await context.store.service.creatorExportMultiAspect({
          inputPath: text(args, 'inputPath'),
          outputDir: text(args, 'outputDir'),
          ...(Array.isArray(aspects) && aspects.every((a) => typeof a === 'string')
            ? { aspects: aspects as ('vertical' | 'horizontal' | 'square')[] }
            : {}),
        }),
      );
    }

    case 'creator_inject_cta': {
      return JSON.stringify(
        await context.store.service.creatorInjectCta({
          inputPath: text(args, 'inputPath'),
          outputPath: text(args, 'outputPath'),
          ctaText: text(args, 'ctaText'),
          url: text(args, 'url'),
          ...(optionalNumber(args, 'ctaSeconds') !== undefined
            ? { ctaSeconds: optionalNumber(args, 'ctaSeconds')! }
            : {}),
          ...(optionalBoolean(args, 'addQr') !== undefined
            ? { addQr: optionalBoolean(args, 'addQr')! }
            : {}),
        }),
      );
    }

    case 'creator_interleave_broll': {
      return JSON.stringify(
        await context.store.service.creatorInterleaveBroll({
          inputPath: text(args, 'inputPath'),
          brollDir: text(args, 'brollDir'),
          outputPath: text(args, 'outputPath'),
          ...(optionalNumber(args, 'intervalSeconds') !== undefined
            ? { intervalSeconds: optionalNumber(args, 'intervalSeconds')! }
            : {}),
          ...(optionalNumber(args, 'clipSeconds') !== undefined
            ? { clipSeconds: optionalNumber(args, 'clipSeconds')! }
            : {}),
          ...(optionalNumber(args, 'maxInsertions') !== undefined
            ? { maxInsertions: Math.round(optionalNumber(args, 'maxInsertions')!) }
            : {}),
        }),
      );
    }

    case 'creator_split_chapters': {
      return JSON.stringify(
        await context.store.service.creatorSplitChapters({
          inputPath: text(args, 'inputPath'),
          outputDir: text(args, 'outputDir'),
        }),
      );
    }

    case 'creator_burn_subtitles': {
      return JSON.stringify(
        await context.store.service.creatorBurnSubtitles({
          inputPath: text(args, 'inputPath'),
          outputPath: text(args, 'outputPath'),
          subtitleText: text(args, 'subtitleText'),
        }),
      );
    }

    case 'download_pause': {
      return JSON.stringify(
        await context.store.service.pauseDownload(optionalText(args, 'runId') ?? null),
      );
    }

    case 'download_resume': {
      return JSON.stringify(
        await context.store.service.resumeDownload(optionalText(args, 'runId') ?? null),
      );
    }

    case 'download_cancel': {
      return JSON.stringify(
        await context.store.service.cancelDownload(optionalText(args, 'runId') ?? null),
      );
    }

    case 'download_media': {
      const compression = text(args, 'compression');
      const codec = text(args, 'codec');
      const kind = text(args, 'kind');
      if (!['none', 'high', 'balanced', 'compact'].includes(compression)) {
        throw new Error('«compression» inválido');
      }
      if (!['h265', 'h264', 'av1'].includes(codec)) throw new Error('«codec» inválido');
      if (!['video', 'image', 'audio', 'gallery'].includes(kind)) {
        throw new Error('«kind» inválido');
      }
      const format = optionalText(args, 'format');
      const hdrMode = optionalText(args, 'hdrMode');
      const quality = optionalText(args, 'quality');
      const cinematicFocus = optionalText(args, 'cinematicFocus');
      const delogoCorner = optionalText(args, 'delogoCorner');
      const upscaleTarget = optionalText(args, 'upscaleTarget');
      const num = (k: string) => {
        const v = optionalNumber(args, k);
        return v === undefined ? undefined : v;
      };
      const boolArg = (k: string) => optionalBoolean(args, k);
      const txt = (k: string) => optionalText(args, k);
      return JSON.stringify(
        await context.store.service.downloadMedia({
          url: text(args, 'url'),
          kind: kind as 'video' | 'image' | 'audio' | 'gallery',
          compression: compression as 'none' | 'high' | 'balanced' | 'compact',
          codec: codec as 'h265' | 'h264' | 'av1',
          ...(txt('runId') ? { runId: txt('runId')! } : {}),
          ...(num('maxHeight') !== undefined ? { maxHeight: Math.round(num('maxHeight')!) } : {}),
          ...(quality === 'best' || quality === 'worst' || quality === 'height' ? { quality } : {}),
          ...(hdrMode === 'tonemap' || hdrMode === 'preserve' ? { hdrMode } : {}),
          ...(num('targetSizeMb') !== undefined ? { targetSizeMb: num('targetSizeMb')! } : {}),
          ...(boolArg('keepOriginal') !== undefined ? { keepOriginal: boolArg('keepOriginal')! } : {}),
          ...(boolArg('playlist') !== undefined ? { playlist: boolArg('playlist')! } : {}),
          ...(txt('cookiesFile') ? { cookiesFile: txt('cookiesFile')! } : {}),
          ...(txt('cookiesFromBrowser') ? { cookiesFromBrowser: txt('cookiesFromBrowser')! } : {}),
          ...(format === 'mp4' || format === 'mkv' || format === 'webm' || format === 'mp3' || format === 'm4a' ? { format } : {}),
          ...(boolArg('saveToDownloads') !== undefined ? { saveToDownloads: boolArg('saveToDownloads')! } : {}),
          ...(txt('destinationRoot') ? { destinationRoot: txt('destinationRoot')! } : {}),
          ...(boolArg('cinematic') !== undefined ? { cinematic: boolArg('cinematic')! } : {}),
          ...(cinematicFocus === 'center' || cinematicFocus === 'left' || cinematicFocus === 'right' || cinematicFocus === 'top' || cinematicFocus === 'bottom' ? { cinematicFocus } : {}),
          ...(txt('replacementAudio') ? { replacementAudio: txt('replacementAudio')! } : {}),
          ...(boolArg('autoPipeline') !== undefined ? { autoPipeline: boolArg('autoPipeline')! } : {}),
          ...(boolArg('audioSpeedNoise') !== undefined ? { audioSpeedNoise: boolArg('audioSpeedNoise')! } : {}),
          ...(boolArg('voicePipeline') !== undefined ? { voicePipeline: boolArg('voicePipeline')! } : {}),
          ...(txt('voiceScript') ? { voiceScript: txt('voiceScript')! } : {}),
          ...(boolArg('watermark') !== undefined ? { watermark: boolArg('watermark')! } : {}),
          ...(boolArg('delogo') !== undefined ? { delogo: boolArg('delogo')! } : {}),
          ...(delogoCorner === 'top-right' || delogoCorner === 'top-left' || delogoCorner === 'bottom-right' || delogoCorner === 'bottom-left' ? { delogoCorner } : {}),
          ...(boolArg('upscale') !== undefined ? { upscale: boolArg('upscale')! } : {}),
          ...(upscaleTarget === 'auto' || upscaleTarget === '1080' || upscaleTarget === '2160' ? { upscaleTarget } : {}),
          ...(boolArg('autoRoute') !== undefined ? { autoRoute: boolArg('autoRoute')! } : {}),
          ...(txt('sourceTitle') ? { sourceTitle: txt('sourceTitle')! } : {}),
          ...(num('sourceDuration') !== undefined ? { sourceDuration: num('sourceDuration')! } : {}),
          ...(txt('proxy') ? { proxy: txt('proxy')! } : {}),
        }),
      );
    }

    case 'cleanup_download': {
      await context.store.service.cleanupDownload(text(args, 'runId'));
      return JSON.stringify({ ok: true });
    }

    case 'install_downloader': {
      return JSON.stringify(await context.store.service.installDownloader());
    }

    case 'update_downloader': {
      return JSON.stringify(await context.store.service.updateDownloader());
    }

    case 'vpn_connect': {
      return JSON.stringify(await context.store.service.vpnConnect(text(args, 'name')));
    }

    case 'vpn_disconnect': {
      return JSON.stringify(await context.store.service.vpnDisconnect(text(args, 'name')));
    }

    case 'watchdog_install': {
      return JSON.stringify(await context.store.service.installWatchdog());
    }

    case 'watchdog_remove': {
      return JSON.stringify(await context.store.service.removeWatchdog());
    }

    case 'production_plan_from_brief': {
      const keyPoints = args.keyPoints;
      return JSON.stringify(
        await context.store.service.productionPlanFromBrief({
          objective: text(args, 'objective'),
          ...(optionalText(args, 'audience') ? { audience: optionalText(args, 'audience')! } : {}),
          ...(optionalText(args, 'tone') ? { tone: optionalText(args, 'tone')! } : {}),
          ...(Array.isArray(keyPoints) && keyPoints.every((k) => typeof k === 'string')
            ? { keyPoints: keyPoints as string[] }
            : {}),
          ...(optionalNumber(args, 'sceneCount') !== undefined
            ? { sceneCount: Math.round(optionalNumber(args, 'sceneCount')!) }
            : {}),
          ...(optionalNumber(args, 'durationSeconds') !== undefined
            ? { durationSeconds: optionalNumber(args, 'durationSeconds')! }
            : {}),
          ...(optionalText(args, 'platform') ? { platform: optionalText(args, 'platform')! } : {}),
          ...(optionalText(args, 'aspectRatio') ? { aspectRatio: optionalText(args, 'aspectRatio')! } : {}),
          ...(optionalText(args, 'voice') ? { voice: optionalText(args, 'voice')! } : {}),
          ...(optionalBoolean(args, 'music') !== undefined
            ? { music: optionalBoolean(args, 'music')! }
            : {}),
          ...(optionalBoolean(args, 'titleCard') !== undefined
            ? { titleCard: optionalBoolean(args, 'titleCard')! }
            : {}),
          ...(optionalText(args, 'brollQuery') ? { brollQuery: optionalText(args, 'brollQuery')! } : {}),
          ...(optionalNumber(args, 'maxCostCents') !== undefined
            ? { maxCostCents: optionalNumber(args, 'maxCostCents')! }
            : {}),
        }),
      );
    }

    case 'production_plan_from_text': {
      return JSON.stringify(
        await context.store.service.productionPlanFromText(text(args, 'text'), {
          approvedCost: args.approvedCost === true,
        }),
      );
    }

    case 'production_create': {
      const plan = args.plan;
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        throw new Error('«plan» debe ser un objeto ProductionPlan');
      }
      const runId = optionalText(args, 'runId');
      const maxCost = optionalNumber(args, 'maxCostCents');
      return JSON.stringify(
        await context.store.service.productionCreate(
          plan as import('@editor-ia/project-schema').ProductionPlan,
          {
            ...(runId ? { runId } : {}),
            ...(maxCost !== undefined ? { maxCostCents: maxCost } : {}),
          },
        ),
      );
    }

    case 'production_status': {
      return JSON.stringify(await context.store.service.productionStatus(text(args, 'runId')));
    }

    case 'production_list': {
      return JSON.stringify(await context.store.service.productionList());
    }

    case 'production_start': {
      return JSON.stringify(await context.store.service.productionStart(text(args, 'runId')));
    }

    case 'production_advance': {
      return JSON.stringify(await context.store.service.productionAdvance(text(args, 'runId')));
    }

    case 'production_pause': {
      return JSON.stringify(await context.store.service.productionPause(text(args, 'runId')));
    }

    case 'production_resume': {
      return JSON.stringify(await context.store.service.productionResume(text(args, 'runId')));
    }

    case 'production_cancel': {
      return JSON.stringify(await context.store.service.productionCancel(text(args, 'runId')));
    }

    case 'subtitles_save_localized': {
      const format = text(args, 'format');
      if (format !== 'srt' && format !== 'vtt') throw new Error('«format» debe ser srt o vtt');
      return JSON.stringify(
        await context.store.service.saveLocalizedSubtitle({
          content: text(args, 'content'),
          outputDir: text(args, 'outputDir'),
          baseName: text(args, 'baseName'),
          language: text(args, 'language'),
          format,
        }),
      );
    }

    case 'export_short': {
      return JSON.stringify(
        await context.store.service.exportShort({
          path: text(args, 'path'),
          outputDir: text(args, 'outputDir'),
          startSeconds: optionalNumber(args, 'startSeconds') ?? 0,
          endSeconds: optionalNumber(args, 'endSeconds') ?? 0,
          ...(optionalText(args, 'label') ? { label: optionalText(args, 'label')! } : {}),
          ...(optionalBoolean(args, 'smartReframe') !== undefined
            ? { smartReframe: optionalBoolean(args, 'smartReframe')! }
            : {}),
        }),
      );
    }

    case 'analyze_face_track': {
      return JSON.stringify(
        await context.store.service.analyzeFaceTrack({
          path: text(args, 'path'),
          startSeconds: optionalNumber(args, 'startSeconds') ?? 0,
          endSeconds: optionalNumber(args, 'endSeconds') ?? 0,
        }),
      );
    }

    case 'track_object': {
      const rect = args.rect as Record<string, unknown> | undefined;
      const rx = rect && typeof rect.x === 'number' ? rect.x : undefined;
      const ry = rect && typeof rect.y === 'number' ? rect.y : undefined;
      const rw = rect && typeof rect.w === 'number' ? rect.w : undefined;
      const rh = rect && typeof rect.h === 'number' ? rect.h : undefined;
      if (rx === undefined || ry === undefined || rw === undefined || rh === undefined) {
        throw new Error('«rect» necesita x, y, w, h numéricos');
      }
      return JSON.stringify(
        await context.store.service.trackObject({
          path: text(args, 'path'),
          rect: { x: rx, y: ry, w: rw, h: rh },
          startSeconds: optionalNumber(args, 'startSeconds') ?? 0,
          endSeconds: optionalNumber(args, 'endSeconds') ?? 0,
        }),
      );
    }

    case 'analyze_images': {
      const ids = args.assetIds;
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('«assetIds» vacío');
      return JSON.stringify(
        await context.store.service.analyzeImages(ids as string[]),
      );
    }

    case 'analyze_media_frames': {
      const ids = args.assetIds;
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('«assetIds» vacío');
      return JSON.stringify(
        await context.store.service.analyzeMediaFrames(ids as string[]),
      );
    }

    case 'convert_media_batch': {
      const ids = args.assetIds;
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('«assetIds» vacío');
      return JSON.stringify(
        await context.store.service.convertMediaBatch(
          ids as string[],
          text(args, 'target') as import('../services/contracts/media').ConversionTarget,
          text(args, 'outputDir'),
          optionalNumber(args, 'quality'),
          optionalNumber(args, 'maxWidth') !== undefined
            ? Math.round(optionalNumber(args, 'maxWidth')!)
            : undefined,
          optionalText(args, 'encoder') as import('../services/contracts/providers').EncoderPreference | undefined,
        ),
      );
    }

    case 'models_list': {
      return JSON.stringify(await context.store.service.listModels());
    }

    case 'model_download': {
      return JSON.stringify(await context.store.service.downloadModel(text(args, 'id')));
    }

    case 'model_delete': {
      return JSON.stringify(await context.store.service.deleteModel(text(args, 'id')));
    }

    case 'check_asset_files': {
      const paths = args.paths;
      if (!Array.isArray(paths) || paths.length === 0) throw new Error('«paths» vacío');
      return JSON.stringify(await context.store.service.checkAssetFiles(paths as string[]));
    }

    case 'plugins_list': {
      return JSON.stringify(await context.store.service.listPlugins());
    }

    case 'plugin_install': {
      return JSON.stringify(await context.store.service.installPlugin(text(args, 'path')));
    }

    case 'plugin_remove': {
      await context.store.service.removePlugin(text(args, 'id'));
      return JSON.stringify({ ok: true });
    }

    case 'plugin_set_enabled': {
      const enabled = args.enabled;
      if (typeof enabled !== 'boolean') throw new Error('«enabled» debe ser boolean');
      return JSON.stringify(
        await context.store.service.setPluginEnabled(text(args, 'id'), enabled),
      );
    }

    case 'extension_status': {
      return JSON.stringify(await context.store.service.extensionStatus());
    }

    case 'system_info': {
      return JSON.stringify(await context.store.service.systemInfo());
    }

    case 'notify_user': {
      await context.store.service.notifyUser(text(args, 'title'), optionalText(args, 'body') ?? '');
      return JSON.stringify({ ok: true });
    }

    case 'mcp_servers_list': {
      return JSON.stringify(await context.store.service.listMcpServers());
    }

    case 'mcp_server_probe': {
      return JSON.stringify(await context.store.service.probeMcpServer(text(args, 'id')));
    }

    case 'mcp_server_delete': {
      await context.store.service.deleteMcpServer(text(args, 'id'));
      return JSON.stringify({ ok: true });
    }

    case 'mcp_session_status': {
      return JSON.stringify(await context.store.service.mcpSessionStatus());
    }

    case 'mcp_audit_tail': {
      const limit = optionalNumber(args, 'limit');
      return JSON.stringify(
        await context.store.service.mcpAuditTail(limit === undefined ? undefined : Math.round(limit)),
      );
    }

    case 'mcp_external_call': {
      let parsedArgs: unknown = {};
      const raw = optionalText(args, 'argsJson');
      if (raw) {
        try {
          parsedArgs = JSON.parse(raw);
        } catch {
          throw new Error('«argsJson» no es JSON válido');
        }
      }
      return JSON.stringify(
        await context.store.service.callMcpTool(
          text(args, 'id'),
          text(args, 'tool'),
          parsedArgs,
        ),
      );
    }

    case 'flow_proxies_get': {
      return JSON.stringify(await context.store.service.getFlowProxies());
    }

    case 'flow_proxy_set': {
      return JSON.stringify(
        await context.store.service.setFlowProxy(
          text(args, 'accountId'),
          optionalText(args, 'proxy') ?? null,
        ),
      );
    }

    case 'audio_peaks': {
      const buckets = optionalNumber(args, 'buckets');
      return JSON.stringify(
        await context.store.service.audioPeaks(
          text(args, 'assetId'),
          buckets === undefined ? undefined : Math.round(buckets),
        ),
      );
    }

    case 'visual_catalog': {
      return JSON.stringify(await context.store.service.listVisualCatalog());
    }

    case 'quality_gate_review': {
      return JSON.stringify(await context.store.service.qualityGateReview());
    }

    case 'convert_file': {
      const target = text(args, 'target');
      if (!['gif', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'].includes(target)) {
        throw new Error('«target» inválido');
      }
      return JSON.stringify(
        await context.store.service.convertFile({
          inputPath: text(args, 'inputPath'),
          target: target as 'gif' | 'mp3' | 'wav' | 'm4a' | 'aac' | 'ogg' | 'opus' | 'flac',
          outputDir: text(args, 'outputDir'),
          ...(optionalNumber(args, 'quality') !== undefined
            ? { quality: optionalNumber(args, 'quality')! }
            : {}),
          ...(optionalNumber(args, 'maxWidth') !== undefined
            ? { maxWidth: Math.round(optionalNumber(args, 'maxWidth')!) }
            : {}),
          ...(optionalNumber(args, 'fps') !== undefined
            ? { fps: optionalNumber(args, 'fps')! }
            : {}),
        }),
      );
    }

    case 'compress_asset': {
      const target = text(args, 'target');
      const mode = text(args, 'mode');
      if (target !== 'mp4' && target !== 'mkv' && target !== 'hevc') {
        throw new Error('«target» debe ser mp4, mkv o hevc');
      }
      if (mode !== 'quality' && mode !== 'size') throw new Error('«mode» debe ser quality o size');
      return JSON.stringify(
        await context.store.service.compressMedia({
          assetId: text(args, 'assetId'),
          outputDir: text(args, 'outputDir'),
          target,
          mode,
          ...(optionalNumber(args, 'quality') !== undefined
            ? { quality: optionalNumber(args, 'quality')! }
            : {}),
          ...(optionalNumber(args, 'targetMegabytes') !== undefined
            ? { targetMegabytes: optionalNumber(args, 'targetMegabytes')! }
            : {}),
          ...(optionalNumber(args, 'maxWidth') !== undefined
            ? { maxWidth: Math.round(optionalNumber(args, 'maxWidth')!) }
            : {}),
          ...(optionalNumber(args, 'audioKbps') !== undefined
            ? { audioKbps: Math.round(optionalNumber(args, 'audioKbps')!) }
            : {}),
        }),
      );
    }

    case 'proxy_cancel': {
      return JSON.stringify(await context.store.service.cancelProxy(text(args, 'assetId')));
    }

    case 'mcp_server_status': {
      return JSON.stringify(await context.store.service.mcpServerStatus());
    }

    case 'mcp_detect_clients': {
      return JSON.stringify(await context.store.service.mcpDetectClients());
    }

    case 'mcp_autoconnect': {
      return JSON.stringify(await context.store.service.mcpAutoconnect(text(args, 'client')));
    }

    case 'studio_capabilities': {
      return JSON.stringify(await context.store.service.studioCapabilities());
    }
    case 'tts_voices': {
      return JSON.stringify(await context.store.service.ttsVoices());
    }
    case 'tts_synthesize': {
      const voiceId = optionalText(args, 'voiceId');
      const pace = optionalNumber(args, 'pace');
      const semitones = optionalNumber(args, 'semitones');
      return JSON.stringify(await context.store.service.ttsSynthesize(
        text(args, 'text'),
        text(args, 'output'),
        voiceId ?? undefined,
        pace ?? undefined,
        semitones ?? undefined,
      ));
    }
    case 'text_fonts_list': {
      return JSON.stringify(await context.store.service.textFontsList());
    }
    case 'text_render_preview': {
      const alignRaw = optionalText(args, 'align');
      const fontSize = optionalNumber(args, 'fontSize');
      const family = optionalText(args, 'family');
      const style = optionalText(args, 'style');
      const wrapWidth = optionalNumber(args, 'wrapWidth');
      const leading = optionalNumber(args, 'leading');
      const canvasWidth = optionalNumber(args, 'canvasWidth');
      const canvasHeight = optionalNumber(args, 'canvasHeight');
      const color = optionalText(args, 'color');
      const request = {
        text: text(args, 'text'),
        output: text(args, 'output'),
        ...(fontSize != null ? { fontSize } : {}),
        ...(family ? { family } : {}),
        ...(style ? { style } : {}),
        ...(alignRaw === 'left' || alignRaw === 'center' || alignRaw === 'right' ? { align: alignRaw as 'left' | 'center' | 'right' } : {}),
        ...(wrapWidth != null ? { wrapWidth } : {}),
        ...(leading != null ? { leading } : {}),
        ...(canvasWidth != null ? { canvasWidth } : {}),
        ...(canvasHeight != null ? { canvasHeight } : {}),
        ...(color ? { color } : {}),
      };
      return JSON.stringify(await context.store.service.textRenderPreview(request));
    }
    case 'subtitles_inspect_file': {
      return JSON.stringify(await context.store.service.subtitlesInspectFile(text(args, 'path')));
    }
    case 'subtitles_convert_file': {
      const output = await context.store.service.subtitlesConvertFile(
        text(args, 'input'),
        text(args, 'output'),
      );
      return JSON.stringify({ output });
    }
    case 'tools_batch': {
      const rawSteps = args.steps;
      if (!Array.isArray(rawSteps) || rawSteps.length === 0 || rawSteps.length > 50) {
        throw new Error('«steps» debe ser una lista de 1 a 50 pasos');
      }
      const stopOnError = optionalBoolean(args, 'stop_on_error') ?? true;
      const results: { name: string; ok: boolean; result?: string; error?: string }[] = [];
      const MAX_STEP_RESULT = 8_000;
      const clipResult = (value: string) =>
        value.length <= MAX_STEP_RESULT
          ? value
          : `${value.slice(0, MAX_STEP_RESULT)}…[truncado ${value.length - MAX_STEP_RESULT} chars]`;
      for (const step of rawSteps) {
        const name =
          step && typeof step === 'object' && typeof (step as { name?: unknown }).name === 'string'
            ? (step as { name: string }).name
            : '';
        if (!name) {
          results.push({ name: '', ok: false, error: 'paso sin «name»' });
          if (stopOnError) break;
          continue;
        }
        if (name === 'tools_batch') {
          results.push({ name, ok: false, error: 'tools_batch no admite pasos anidados' });
          if (stopOnError) break;
          continue;
        }
        const stepArgs =
          step && typeof step === 'object' && 'arguments' in step
            ? ((step as { arguments?: unknown }).arguments ?? {})
            : {};
        try {
          const result = await executeMcpTool(name, stepArgs, context);
          results.push({ name, ok: true, result: clipResult(result) });
        } catch (error) {
          results.push({
            name,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
          if (stopOnError) break;
        }
      }
      const completed = results.filter((item) => item.ok).length;
      const failed = results.length - completed;
      return JSON.stringify({
        total: rawSteps.length,
        ran: results.length,
        completed,
        failed,
        stoppedEarly: results.length < rawSteps.length,
        results,
      });
    }

    case 'media_probe_color': {
      const result = await context.store.service.mediaProbeColor(text(args, 'path'));
      return JSON.stringify(result);
    }

    case 'memory_add': {
      const notes = addAiMemory(text(args, 'text'));
      return JSON.stringify({ saved: true, total: notes.length });
    }

    case 'memory_list': {
      const notes = loadAiMemory();
      return JSON.stringify({ notes });
    }

    case 'memory_forget': {
      const id = text(args, 'id');
      const notes = forgetAiMemory(id);
      return JSON.stringify({ removed: true, total: notes.length });
    }

    case 'write_chapters': {
      const chapters = Array.isArray(args.chapters)
        ? (args.chapters as Record<string, unknown>[]).map((item) => ({
            startSeconds: Number(item.startSeconds) || 0,
            endSeconds: Number(item.endSeconds) || 0,
            title: typeof item.title === 'string' ? item.title : 'Capítulo',
          }))
        : [];
      const result = await context.store.service.writeChapters({
        input: text(args, 'input'),
        output: text(args, 'output'),
        ...(optionalText(args, 'title') ? { title: optionalText(args, 'title')! } : {}),
        chapters,
      });
      return JSON.stringify(result);
    }

    case 'remux': {
      const result = await context.store.service.remux({
        input: text(args, 'input'),
        output: text(args, 'output'),
      });
      return JSON.stringify(result);
    }

    case 'export_lossless': {
      const result = await context.store.service.exportLossless({
        input: text(args, 'input'),
        output: text(args, 'output'),
        startSeconds: optionalNumber(args, 'startSeconds') ?? 0,
        endSeconds: optionalNumber(args, 'endSeconds') ?? 0,
        exact: optionalBoolean(args, 'exact') ?? false,
      });
      return JSON.stringify(result);
    }

    case 'asset_import': {
      const project = projectOf(context);
      const paths = Array.isArray(args.paths)
        ? args.paths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      if (paths.length === 0) throw new Error('faltan rutas en «paths»');
      const rate = project.video.frameRate;
      const outcome = await context.store.service.importMediaPaths({
        paths,
        fpsNum: rate.num,
        fpsDen: rate.den,
        confirmRights: true,
      });
      if (outcome.assets.length === 0) {
        throw new Error(outcome.warnings[0] ?? 'no se pudo importar el material');
      }
      let next = project;
      for (const asset of outcome.assets) next = addAsset(next, asset);
      apply(context, next);
      return JSON.stringify({
        ok: true,
        assets: outcome.assets.map((asset) => ({
          id: asset.id,
          label: asset.label,
          kind: asset.kind,
        })),
        warnings: outcome.warnings,
      });
    }

    case 'asset_remove': {
      const project = projectOf(context);
      const assetId = text(args, 'assetId');
      apply(context, removeAsset(project, assetId));
      return JSON.stringify({ ok: true, assetId });
    }

    case 'media_folder_list': {
      const folder = text(args, 'folder');
      const root = optionalText(args, 'root');
      const listing = await context.store.service.listMediaFolder({
        folder,
        ...(root ? { root } : {}),
      });
      return JSON.stringify({
        ok: true,
        directory: listing.directory,
        count: listing.files.length,
        files: listing.files.map((file) => ({
          path: file.path,
          name: file.name,
          kind: file.kind,
          bytes: file.bytes,
        })),
      });
    }

    case 'media_search': {
      const kind = optionalText(args, 'kind');
      const root = optionalText(args, 'root');
      if (kind && kind !== 'image' && kind !== 'audio' && kind !== 'video') {
        throw new Error('«kind» debe ser image, audio o video');
      }
      const result = await context.store.service.searchMediaFolder({
        folder: text(args, 'folder'),
        query: text(args, 'query'),
        ...(kind === 'image' || kind === 'audio' || kind === 'video' ? { kind } : {}),
        ...(root ? { root } : {}),
      });
      return JSON.stringify({
        ok: true,
        directory: result.directory,
        query: result.query,
        count: result.files.length,
        truncated: result.truncated,
        files: result.files.map((file) => ({
          path: file.path,
          name: file.name,
          kind: file.kind,
          bytes: file.bytes,
        })),
      });
    }

    case 'fs_list': {
      const listing = await context.store.service.listDirectory(text(args, 'path'));
      return JSON.stringify({
        ok: true,
        directory: listing.directory,
        count: listing.entries.length,
        truncated: listing.truncated,
        entries: listing.entries.map((entry) => ({
          name: entry.name,
          path: entry.path,
          kind: entry.kind,
          bytes: entry.bytes,
        })),
      });
    }

    case 'fs_read': {
      const file = await context.store.service.readTextFile(text(args, 'path'));
      return JSON.stringify({
        ok: true,
        path: file.path,
        bytes: file.bytes,
        truncated: file.truncated,
        content: file.content,
      });
    }

    case 'fs_write': {
      const target = text(args, 'path');
      const written = await context.store.service.writeTextFile(
        target,
        text(args, 'content'),
      );
      recordFsAudit('write', target, `${written.bytes} bytes`);
      return JSON.stringify({ ok: true, ...written });
    }

    case 'fs_mkdir': {
      const target = text(args, 'path');
      const created = await context.store.service.makeDirectory(
        target,
        optionalBoolean(args, 'recursive'),
      );
      recordFsAudit('mkdir', target);
      return JSON.stringify({ ok: true, ...created });
    }

    case 'fs_delete': {
      const target = text(args, 'path');
      // AUD-014: el borrado es destructivo e irreversible — exige
      // confirm=true explícito además de las protecciones nativas.
      if (optionalBoolean(args, 'confirm') !== true) {
        throw new Error(
          'fs_delete requiere confirm=true: verificá la ruta y pasá confirm explícito para borrar',
        );
      }
      const recursive = optionalBoolean(args, 'recursive');
      const removed = await context.store.service.deletePath(target, recursive);
      recordFsAudit('delete', target, recursive === true ? 'recursive' : 'file');
      return JSON.stringify({ ok: true, ...removed });
    }

    case 'fs_move': {
      const from = text(args, 'from');
      const to = text(args, 'to');
      const moved = await context.store.service.movePath(from, to);
      recordFsAudit('move', from, `-> ${to}`);
      return JSON.stringify({ ok: true, ...moved });
    }

    case 'voice_isolation_status': {
      const status = await context.store.service.voiceIsolationStatus();
      return JSON.stringify({ ok: true, ...status });
    }

    case 'voice_isolate': {
      const outcome = await context.store.service.voiceIsolateMedia(
        text(args, 'path'),
        optionalText(args, 'model'),
        optionalText(args, 'quality'),
      );
      return JSON.stringify({ ok: true, ...outcome });
    }

    case 'voice_isolation_prepare': {
      const outcome = await context.store.service.voiceIsolationPrepare(
        text(args, 'assetId'),
        optionalText(args, 'quality'),
        optionalBoolean(args, 'force'),
      );
      return JSON.stringify({ ok: true, ...outcome });
    }

    case 'flow_browser_status': {
      const status = await context.store.service.flowBrowserStatus();
      return JSON.stringify({ ok: true, ...status });
    }

    case 'flow_browser_launch': {
      const status = await context.store.service.flowBrowserLaunch(
        optionalText(args, 'url'),
      );
      return JSON.stringify({ ok: true, ...status });
    }

    case 'flow_browser_stop': {
      const stopped = await context.store.service.flowBrowserStop();
      return JSON.stringify({ ok: true, stopped });
    }

    case 'flow_embed_status': {
      const status = await context.store.service.flowEmbedStatus();
      return JSON.stringify({ ok: true, ...status });
    }

    case 'web_sessions_status': {
      const status = await context.store.service.webSessionsStatus();
      return JSON.stringify({ ok: true, ...status });
    }

    case 'flow_embed_open': {
      const status = await context.store.service.webSessionOpen(
        optionalText(args, 'url') ?? 'https://flow.google.com',
        optionalText(args, 'slot'),
      );
      return JSON.stringify({ ok: true, ...status });
    }

    case 'flow_embed_close': {
      const closed = await context.store.service.webSessionClose(
        optionalText(args, 'slot'),
      );
      return JSON.stringify({ ok: true, closed });
    }

    case 'flow_embed_nav': {
      const direction = text(args, 'direction');
      if (direction !== 'back' && direction !== 'forward' && direction !== 'reload') {
        throw new Error('direction debe ser back, forward o reload');
      }
      const navigated = await context.store.service.webSessionNav(
        direction,
        optionalText(args, 'slot'),
      );
      return JSON.stringify({ ok: true, navigated });
    }

    case 'flow_embed_eval': {
      const result = await context.store.service.webSessionEval(
        text(args, 'js'),
        optionalText(args, 'slot'),
      );
      return JSON.stringify({ ok: true, result });
    }

    case 'flow_generate_image': {
      const result = await context.store.service.flowGenerateImage({
        prompt: text(args, 'prompt'),
        outputDir: text(args, 'outputDir'),
        ...(optionalText(args, 'slot') ? { slot: optionalText(args, 'slot')! } : {}),
        ...(optionalText(args, 'url') ? { url: optionalText(args, 'url')! } : {}),
        ...(optionalNumber(args, 'timeoutSecs') !== undefined
          ? { timeoutSecs: optionalNumber(args, 'timeoutSecs')! }
          : {}),
        ...(typeof args.reuseProject === 'boolean' ? { reuseProject: args.reuseProject } : {}),
      });
      return JSON.stringify(result);
    }

    case 'flow_generate_assets': {
      const prompts = Array.isArray(args.prompts)
        ? args.prompts
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .slice(0, 10)
        : [];
      if (prompts.length === 0) throw new Error('faltan prompts en «prompts»');
      const dir = outputDir(context, args);
      const timeoutSecs = optionalNumber(args, 'timeoutSecs');
      const importToProject = args.importToProject !== false;
      const results: { prompt: string; ok: boolean; files: number; error?: string }[] = [];
      const paths: string[] = [];
      for (const prompt of prompts) {
        try {
          const generated = await context.store.service.flowGenerateImage({
            prompt,
            outputDir: dir,
            ...(timeoutSecs !== undefined ? { timeoutSecs } : {}),
          });
          results.push({
            prompt,
            ok: generated.ok,
            files: generated.files.length,
            ...(generated.error ? { error: generated.error } : {}),
          });
          for (const file of generated.files) paths.push(file.path);
        } catch (error) {
          results.push({
            prompt,
            ok: false,
            files: 0,
            error: error instanceof Error ? error.message : 'falló la generación',
          });
        }
      }
      let assets: { id: string; label: string; kind: string }[] = [];
      if (importToProject && paths.length > 0) {
        const project = projectOf(context);
        const rate = project.video.frameRate;
        const outcome = await context.store.service.importMediaPaths({
          paths,
          fpsNum: rate.num,
          fpsDen: rate.den,
          confirmRights: true,
          provider: 'google-flow-image',
        });
        let next = project;
        for (const asset of outcome.assets) next = addAsset(next, asset);
        apply(context, next);
        assets = outcome.assets.map((asset) => ({
          id: asset.id,
          label: asset.label,
          kind: asset.kind,
        }));
      }
      return JSON.stringify({
        ok: results.some((item) => item.ok),
        outputDir: dir,
        results,
        files: paths,
        assets,
      });
    }

    case 'screen_record': {
      const action = text(args, 'action');
      const parseChroma = () => {
        const raw = args.webcamChroma;
        if (typeof raw !== 'object' || raw === null) return undefined;
        const c = raw as Record<string, unknown>;
        if (
          typeof c.color !== 'string' ||
          typeof c.similarity !== 'number' ||
          typeof c.blend !== 'number'
        ) {
          return undefined;
        }
        return { color: c.color, similarity: c.similarity, blend: c.blend };
      };
      const parseCursor = () => {
        const raw = args.cursorOverlay;
        if (typeof raw !== 'object' || raw === null) return undefined;
        const c = raw as Record<string, unknown>;
        const styles = ['flecha', 'punto', 'cruz', 'cheia', '3d'] as const;
        const colors = ['blanco', 'negro', 'amarillo', 'verde'] as const;
        const scales = [0.5, 1, 2] as const;
        if (
          typeof c.style !== 'string' ||
          !styles.includes(c.style as (typeof styles)[number]) ||
          typeof c.color !== 'string' ||
          !colors.includes(c.color as (typeof colors)[number]) ||
          typeof c.scale !== 'number' ||
          !scales.includes(c.scale as (typeof scales)[number]) ||
          typeof c.ripple !== 'boolean'
        ) {
          return undefined;
        }
        return {
          style: c.style as (typeof styles)[number],
          color: c.color as (typeof colors)[number],
          scale: c.scale as (typeof scales)[number],
          ripple: c.ripple,
        };
      };
      const captureArgs = () => {
        const windowTitle = optionalText(args, 'windowTitle');
        const captureTargetRaw = optionalText(args, 'captureTarget');
        const captureTarget: 'desktop' | 'window' | 'region' | undefined =
          captureTargetRaw === 'desktop' || captureTargetRaw === 'window' || captureTargetRaw === 'region'
            ? captureTargetRaw
            : undefined;
        const captureScreen = typeof args.captureScreen === 'boolean' ? args.captureScreen : undefined;
        const num = (key: string) => optionalNumber(args, key);
        return {
          ...(windowTitle ? { windowTitle } : {}),
          ...(captureTarget ? { captureTarget } : {}),
          ...(num('regionX') !== undefined ? { regionX: num('regionX')! } : {}),
          ...(num('regionY') !== undefined ? { regionY: num('regionY')! } : {}),
          ...(num('regionWidth') !== undefined ? { regionWidth: num('regionWidth')! } : {}),
          ...(num('regionHeight') !== undefined ? { regionHeight: num('regionHeight')! } : {}),
          ...(captureScreen !== undefined ? { captureScreen } : {}),
        };
      };
      if (action === 'start') {
        const outputDir = text(args, 'outputDir');
        const fps = optionalNumber(args, 'fps');
        const webcamDevice = optionalText(args, 'webcamDevice');
        const audioDevice = optionalText(args, 'audioDevice');
        const streamUrl = optionalText(args, 'streamUrl');
        const encoderRaw = optionalText(args, 'encoder');
        const encoder =
          encoderRaw === 'x264' || encoderRaw === 'nvenc' || encoderRaw === 'qsv' || encoderRaw === 'amf' || encoderRaw === 'mf'
            ? encoderRaw
            : undefined;
        const webcamChroma = parseChroma();
        const cursorOverlay = parseCursor();
        const result = await context.store.service.screenRecordStart({
          outputDir,
          ...(fps !== undefined ? { fps } : {}),
          ...(webcamDevice ? { webcamDevice } : {}),
          ...(webcamChroma ? { webcamChroma } : {}),
          ...(cursorOverlay ? { cursorOverlay } : {}),
          ...(audioDevice ? { audioDevice } : {}),
          ...(streamUrl ? { streamUrl } : {}),
          ...(encoder ? { encoder } : {}),
          ...captureArgs(),
        });
        return JSON.stringify(result);
      }
      if (action === 'stop') {
        return JSON.stringify(await context.store.service.screenRecordStop());
      }
      if (action === 'status') {
        return JSON.stringify(await context.store.service.screenRecordStatus());
      }
      if (action === 'devices') {
        return JSON.stringify(await context.store.service.screenRecordDevices());
      }
      if (action === 'snapshot') {
        const fps = optionalNumber(args, 'fps');
        const webcamDevice = optionalText(args, 'webcamDevice');
        const webcamChroma = parseChroma();
        const result = await context.store.service.screenRecordSnapshot({
          ...(fps !== undefined ? { fps } : {}),
          ...(webcamDevice ? { webcamDevice } : {}),
          ...(webcamChroma ? { webcamChroma } : {}),
          ...captureArgs(),
        });
        return JSON.stringify(result);
      }
      throw new Error('«action» debe ser start, stop, status, devices o snapshot');
    }

    case 'obs_scenes': {
      const action = text(args, 'action');
      if (action === 'list') {
        return JSON.stringify(await context.store.service.obsSceneList());
      }
      if (action === 'delete') {
        return JSON.stringify({ deleted: await context.store.service.obsSceneDelete(text(args, 'id')) });
      }
      if (action === 'start') {
        return JSON.stringify(
          await context.store.service.obsSceneStart(text(args, 'id'), text(args, 'outputDir')),
        );
      }
      if (action === 'preview') {
        return JSON.stringify(await context.store.service.obsScenePreview(text(args, 'id')));
      }
      if (action === 'transition') {
        const num = (key: string) => optionalNumber(args, key);
        const int = (key: string) => optionalNumber(args, key);
        const transitionKind = optionalText(args, 'kind');
        return JSON.stringify(
          await context.store.service.obsTransitionRecord({
            fromId: text(args, 'id'),
            toId: text(args, 'toId'),
            outputDir: text(args, 'outputDir'),
            ...(transitionKind ? { kind: transitionKind } : {}),
            ...(num('leadSecs') !== undefined ? { leadSecs: num('leadSecs')! } : {}),
            ...(num('durationSecs') !== undefined ? { durationSecs: num('durationSecs')! } : {}),
            ...(num('tailSecs') !== undefined ? { tailSecs: num('tailSecs')! } : {}),
            ...(int('width') !== undefined ? { width: int('width')! } : {}),
            ...(int('height') !== undefined ? { height: int('height')! } : {}),
            ...(int('fps') !== undefined ? { fps: int('fps')! } : {}),
            ...(optionalText(args, 'audioDevice') ? { audioDevice: optionalText(args, 'audioDevice')! } : {}),
          }),
        );
      }
      if (action === 'switch_start') {
        const num = (key: string) => optionalNumber(args, key);
        const int = (key: string) => optionalNumber(args, key);
        const switchKind = optionalText(args, 'kind');
        return JSON.stringify(
          await context.store.service.obsSwitchStart({
            sceneId: text(args, 'id'),
            outputDir: text(args, 'outputDir'),
            ...(switchKind ? { kind: switchKind } : {}),
            ...(num('transitionSecs') !== undefined ? { transitionSecs: num('transitionSecs')! } : {}),
            ...(int('width') !== undefined ? { width: int('width')! } : {}),
            ...(int('height') !== undefined ? { height: int('height')! } : {}),
            ...(int('fps') !== undefined ? { fps: int('fps')! } : {}),
            ...(optionalText(args, 'audioDevice') ? { audioDevice: optionalText(args, 'audioDevice')! } : {}),
            ...(optionalText(args, 'streamUrl') ? { streamUrl: optionalText(args, 'streamUrl')! } : {}),
            ...(optionalText(args, 'encoder') ? { encoder: optionalText(args, 'encoder')! } : {}),
          }),
        );
      }
      if (action === 'switch_scene') {
        return JSON.stringify(await context.store.service.obsSwitchScene(text(args, 'id')));
      }
      if (action === 'switch_stop') {
        return JSON.stringify(await context.store.service.obsSwitchStop());
      }
      if (action === 'switch_status') {
        return JSON.stringify(await context.store.service.obsSwitchStatus());
      }
      if (action === 'switch_preview') {
        return JSON.stringify(await context.store.service.obsSwitchPreview());
      }
      if (action === 'save') {
        const num = (key: string) => optionalNumber(args, key);
        const captureTargetRaw = optionalText(args, 'captureTarget');
        const captureTarget =
          captureTargetRaw === 'desktop' || captureTargetRaw === 'window' || captureTargetRaw === 'region'
            ? captureTargetRaw
            : undefined;
        const encoderRaw = optionalText(args, 'encoder');
        const encoder =
          encoderRaw === 'x264' || encoderRaw === 'nvenc' || encoderRaw === 'qsv' || encoderRaw === 'amf' || encoderRaw === 'mf'
            ? encoderRaw
            : undefined;
        const scene: import('../services/project-service').ObsSceneInput = {
          name: text(args, 'name'),
          ...(optionalText(args, 'id') ? { id: optionalText(args, 'id')! } : {}),
          ...(num('fps') !== undefined ? { fps: num('fps')! } : {}),
          ...(captureTarget ? { captureTarget } : {}),
          ...(optionalText(args, 'windowTitle') ? { windowTitle: optionalText(args, 'windowTitle')! } : {}),
          ...(num('regionX') !== undefined ? { regionX: num('regionX')! } : {}),
          ...(num('regionY') !== undefined ? { regionY: num('regionY')! } : {}),
          ...(num('regionWidth') !== undefined ? { regionWidth: num('regionWidth')! } : {}),
          ...(num('regionHeight') !== undefined ? { regionHeight: num('regionHeight')! } : {}),
          ...(optionalText(args, 'webcamDevice') ? { webcamDevice: optionalText(args, 'webcamDevice')! } : {}),
          ...(optionalText(args, 'audioDevice') ? { audioDevice: optionalText(args, 'audioDevice')! } : {}),
          ...(optionalText(args, 'streamUrl') ? { streamUrl: optionalText(args, 'streamUrl')! } : {}),
          ...(encoder ? { encoder } : {}),
          ...(typeof args.captureScreen === 'boolean' ? { captureScreen: args.captureScreen } : {}),
        };
        return JSON.stringify(await context.store.service.obsSceneSave(scene));
      }
      throw new Error('«action» debe ser list, save, delete, start, preview, transition, switch_start, switch_scene, switch_stop o switch_status');
    }

    case 'browser_instances': {
      const action = text(args, 'action');
      const profileId = optionalText(args, 'profileId');
      if (action === 'list') {
        return JSON.stringify(await context.store.service.browserInstanceList());
      }
      if (action === 'close') {
        return JSON.stringify({ closed: await context.store.service.browserInstanceClose(text(args, 'profileId')) });
      }
      if (action === 'launch') {
        const proxyUrl = optionalText(args, 'proxyUrl');
        const url = optionalText(args, 'url');
        return JSON.stringify(
          await context.store.service.browserInstanceLaunch({
            profileId: text(args, 'profileId'),
            ...(proxyUrl ? { proxyUrl } : {}),
            ...(url ? { url } : {}),
          }),
        );
      }
      if (action === 'navigate') {
        return JSON.stringify({
          navigated: await context.store.service.browserInstanceNavigate(
            text(args, 'profileId'),
            text(args, 'url'),
          ),
        });
      }
      if (action === 'eval') {
        return JSON.stringify(
          await context.store.service.browserInstanceEval(
            text(args, 'profileId'),
            text(args, 'expression'),
          ),
        );
      }
      void profileId;
      throw new Error('«action» debe ser launch, close, list, navigate o eval');
    }

    case 'subtitles_pipeline': {
      const inputPath = text(args, 'inputPath');
      const outputPath = optionalText(args, 'outputPath');
      const targetLanguage = optionalText(args, 'targetLanguage');
      const sourceLanguage = optionalText(args, 'sourceLanguage');
      const model = optionalText(args, 'model');
      const burn = typeof args.burn === 'boolean' ? args.burn : undefined;
      return JSON.stringify(
        await context.store.service.subtitlesPipeline({
          inputPath,
          ...(outputPath ? { outputPath } : {}),
          ...(targetLanguage ? { targetLanguage } : {}),
          ...(sourceLanguage ? { sourceLanguage } : {}),
          ...(model === 'tiny' || model === 'base' || model === 'small' || model === 'medium'
            ? { model }
            : {}),
          ...(burn !== undefined ? { burn } : {}),
        }),
      );
    }

    case 'subtitles_translate': {
      const rawTexts = args.texts;
      if (!Array.isArray(rawTexts)) {
        throw new Error('«texts» debe ser un array de strings');
      }
      const texts = rawTexts.filter((t): t is string => typeof t === 'string');
      const sourceLanguage = text(args, 'sourceLanguage');
      const targetLanguage = text(args, 'targetLanguage');
      const glossary = optionalText(args, 'glossary');
      const approvedCost = typeof args.approvedCost === 'boolean' ? args.approvedCost : undefined;
      return JSON.stringify(
        await context.store.service.translateSubtitles({
          texts,
          sourceLanguage,
          targetLanguage,
          ...(glossary ? { glossary } : {}),
          ...(approvedCost !== undefined ? { approvedCost } : {}),
        }),
      );
    }

    case 'stickman_render': {
      const outputPath = text(args, 'outputPath');
      const action = optionalText(args, 'action');
      const durationSeconds = optionalNumber(args, 'durationSeconds');
      const fps = optionalNumber(args, 'fps');
      const width = optionalNumber(args, 'width');
      const height = optionalNumber(args, 'height');
      const boneHex = optionalText(args, 'boneHex');
      const bgHex = optionalText(args, 'bgHex');
      const rawParticles = args.particles;
      const particles =
        typeof rawParticles === 'object' && rawParticles !== null
          ? (() => {
              const p = rawParticles as Record<string, unknown>;
              const kind = p.kind;
              return {
                ...(kind === 'confetti' || kind === 'snow' || kind === 'sparks' || kind === 'bounce' || kind === 'tumble'
                  ? { kind }
                  : {}),
                ...(typeof p.count === 'number' ? { count: p.count } : {}),
                ...(typeof p.colorHex === 'string' ? { colorHex: p.colorHex } : {}),
                ...(typeof p.gravity === 'number' ? { gravity: p.gravity } : {}),
                ...(typeof p.bounce === 'number' ? { bounce: p.bounce } : {}),
                ...(typeof p.spin === 'number' ? { spin: p.spin } : {}),
              };
            })()
          : undefined;
      const rawKf = args.keyframes;
      const POSE_FIELDS = [
        'spine', 'head', 'upper_arm_l', 'fore_arm_l', 'upper_arm_r', 'fore_arm_r',
        'thigh_l', 'shin_l', 'thigh_r', 'shin_r', 'pelvis_dy',
      ] as const;
      const keyframes = Array.isArray(rawKf)
        ? rawKf
            .filter((k): k is Record<string, unknown> => typeof k === 'object' && k !== null)
            .map((k): import('../services/project-service').StickmanKeyframeInput => {
              const out: { frame: number } & Record<string, number> = {
                frame: typeof k.frame === 'number' ? k.frame : 0,
              };
              for (const f of POSE_FIELDS) {
                const v = k[f];
                if (typeof v === 'number') out[f] = v;
              }
              return out;
            })
        : undefined;
      const result = await context.store.service.stickmanRender({
        outputPath,
        ...(action === 'idle' || action === 'walk' || action === 'run' || action === 'wave' ||
        action === 'jump' || action === 'custom'
          ? { action }
          : {}),
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        ...(fps !== undefined ? { fps } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(boneHex ? { boneHex } : {}),
        ...(bgHex ? { bgHex } : {}),
        ...(keyframes && keyframes.length > 0 ? { keyframes } : {}),
      });
      return JSON.stringify(result);
    }

    case 'markers_list':
      return JSON.stringify(
        projectOf(context).markers.map((marker) => ({
          id: marker.id,
          frame: marker.frame,
          endFrame: marker.endFrame ?? null,
          label: marker.label,
          color: marker.color ?? null,
        })),
      );

    case 'marker_add': {
      const project = projectOf(context);
      const endFrame = optionalNumber(args, 'endFrame');
      const added = addMarker(project, frame(args, 'frame'), {
        ...(optionalText(args, 'label') ? { label: optionalText(args, 'label')! } : {}),
        ...(endFrame !== undefined ? { endFrame } : {}),
      });
      apply(context, added.project);
      return JSON.stringify({ ok: true, markerId: added.markerId });
    }

    case 'marker_delete': {
      const project = projectOf(context);
      const markerId = text(args, 'markerId');
      apply(context, deleteMarker(project, markerId));
      return JSON.stringify({ ok: true, markerId });
    }

    case 'settings_get': {
      const [ai, diarize] = await Promise.all([
        context.store.service.getProvider().catch(() => null),
        context.store.service.getDiarizeProvider().catch(() => null),
      ]);
      return JSON.stringify({ ai, diarize });
    }

    case 'settings_set': {
      const ai = args.ai as Args | undefined;
      const diarize = args.diarize as Args | undefined;
      if (!ai && !diarize) throw new Error('indicá «ai» o «diarize»');
      const saved: Record<string, unknown> = {};
      if (ai) {
        saved.ai = await context.store.service.saveProvider({
          kind: typeof ai.kind === 'string' ? ai.kind : 'openai-compatible',
          baseUrl: typeof ai.baseUrl === 'string' ? ai.baseUrl : '',
          model: typeof ai.model === 'string' ? ai.model : '',
          ...(typeof ai.apiKey === 'string' ? { apiKey: ai.apiKey } : {}),
        });
      }
      if (diarize) {
        saved.diarize = await context.store.service.saveDiarizeProvider({
          kind: typeof diarize.kind === 'string' ? diarize.kind : 'none',
          baseUrl: typeof diarize.baseUrl === 'string' ? diarize.baseUrl : '',
          language: typeof diarize.language === 'string' ? diarize.language : 'es',
          ...(typeof diarize.apiKey === 'string' ? { apiKey: diarize.apiKey } : {}),
        });
      }
      return JSON.stringify({ ok: true, saved });
    }

    case 'package_project': {
      const outputPath = optionalText(args, 'path') ?? optionalText(args, 'outputPath');
      const packaged = await context.store.packageProject(outputPath);
      return JSON.stringify({ ok: packaged, ...(outputPath ? { path: outputPath } : {}) });
    }

    case 'review_build': {
      const project = projectOf(context);
      const items = await buildReviewItems(project, (assetId) =>
        context.store.service.audioPeaks(assetId),
      );
      return JSON.stringify(items);
    }

    case 'review_apply': {
      const project = projectOf(context);
      const items = await buildReviewItems(project, (assetId) =>
        context.store.service.audioPeaks(assetId),
      );
      const accepted = Array.isArray(args.accepted)
        ? new Set(args.accepted.filter((item): item is string => typeof item === 'string'))
        : new Set(items.map((item) => item.id));
      apply(context, applyReviewItems(project, items, accepted));
      return JSON.stringify({ ok: true, applied: accepted.size });
    }

    case 'diagnostics': {
      const project = context.store.state.project;
      let provider: Record<string, unknown> | null = null;
      try {
        const info = (await context.store.service.getProvider()) as unknown as Record<string, unknown>;
        provider = {
          kind: typeof info.kind === 'string' ? info.kind : null,
          model: typeof info.model === 'string' ? info.model : null,
          baseUrl: typeof info.baseUrl === 'string' ? info.baseUrl : null,
          hasKey: info.hasKey === true,
        };
      } catch {
        provider = null;
      }
      let plugins = 0;
      try {
        plugins = (await context.store.service.listPlugins()).length;
      } catch {
        plugins = 0;
      }
      return JSON.stringify({
        app: 'olyvia',
        tools: MCP_TOOLS.length,
        project: project
          ? {
              name: project.name,
              clips: project.timeline.clips.length,
              tracks: project.timeline.tracks.length,
              captions: project.captions.cues.length,
              fps: fpsOf(project),
            }
          : null,
        provider,
        plugins,
        bridge: 'mcp-call',
        // AUD-014: últimas mutaciones fs_* de la sesión (auditoría).
        fsAudit: fsAuditLog.slice(-20),
      });
    }

    case 'project_new': {
      const name = text(args, 'name');
      const fps = Math.max(1, Math.round(optionalNumber(args, 'fps') ?? 30));
      const width = Math.max(2, Math.round(optionalNumber(args, 'width') ?? 1920));
      const height = Math.max(2, Math.round(optionalNumber(args, 'height') ?? 1080));
      const directory = optionalText(args, 'directory');
      if (directory) {
        // Vía no interactiva: el diálogo nativo de guardado no se puede
        // contestar desde el MCP, así que se escribe el archivo directo.
        const created = createEmptyProject(name);
        created.video = {
          ...created.video,
          width,
          height,
          frameRate: { num: fps, den: 1 },
        };
        // A diferencia de createEmptyProject (renderProfiles vacío), el
        // backend y la UI siempre entregan perfiles: sin ellos un flujo
        // autónomo no puede exportar. ensureDelivery corre después de fijar
        // el canvas para que el perfil nativo siga width×height.
        const project = ensureDelivery(created);
        const stem =
          name
            .trim()
            .toLowerCase()
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9-_ ]/g, '')
            .trim()
            .replace(/\s+/g, '-') || 'proyecto';
        const written = await context.store.service.writeProjectFile({
          directory,
          // write_project_file agrega «.editoria.json» solo: pasar el stem.
          fileName: stem,
          project,
        });
        const opened = await context.store.openProjectAt(written.path);
        return JSON.stringify({ ok: opened, path: written.path });
      }
      const created = await context.store.createProject({
        name,
        width,
        height,
        fpsNum: fps,
        fpsDen: 1,
      });
      return JSON.stringify({ ok: created });
    }

    case 'project_open': {
      const opened = await context.store.openProjectAt(text(args, 'path'));
      return JSON.stringify({ ok: opened });
    }

    case 'project_save':
      return JSON.stringify({ ok: await context.store.saveNow() });

    case 'project_save_as':
      return JSON.stringify({ ok: await context.store.saveAs() });

    case 'project_close':
      context.store.closeProject();
      return JSON.stringify({ ok: true });

    case 'undo':
      context.store.undo();
      return JSON.stringify({ ok: true });

    case 'redo':
      context.store.redo();
      return JSON.stringify({ ok: true });

    case 'track_add': {
      const project = projectOf(context);
      const kind = text(args, 'kind');
      const allowed = ['video', 'audio', 'narration', 'graphic', 'image', 'adjustment'];
      if (!allowed.includes(kind)) {
        throw new Error(`tipo de pista inválido: ${kind}`);
      }
      const added = addTrack(project, kind as Parameters<typeof addTrack>[1], optionalText(args, 'label'));
      apply(context, added.project);
      return JSON.stringify({ ok: true, trackId: added.trackId });
    }

    case 'track_delete': {
      const project = projectOf(context);
      const trackId = text(args, 'trackId');
      apply(context, deleteTrack(project, trackId));
      return JSON.stringify({ ok: true, trackId });
    }

    case 'clip_add': {
      const project = projectOf(context);
      const assetId = text(args, 'assetId');
      const asset = project.assets.find((item) => item.id === assetId);
      if (!asset) throw new Error('el asset no existe en el proyecto');
      const media = 'media' in asset ? asset.media : undefined;
      const duration =
        optionalNumber(args, 'durationFrames') ??
        (media && 'durationFrames' in media ? media.durationFrames : 90);
      const targetTrack = optionalText(args, 'trackId');
      const added = addClipFromAsset(project, asset, {
        atFrame: Math.max(0, Math.round(optionalNumber(args, 'atFrame') ?? 0)),
        durationFrames: Math.max(1, Math.round(duration)),
        ...(targetTrack ? { trackId: targetTrack } : {}),
      });
      apply(context, added.project);
      return JSON.stringify({ ok: true, clipId: added.clipId });
    }

    case 'clip_effects': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      let next = project;
      const speed = optionalNumber(args, 'speed');
      if (speed !== undefined && speed > 0) next = setClipSpeed(next, clipId, speed);
      const reverse = optionalBoolean(args, 'reverse');
      if (reverse !== undefined) next = updateClip(next, clipId, { reverse });
      apply(context, next);
      return JSON.stringify({ ok: true, clipId });
    }

    case 'audio_mix': {
      const project = projectOf(context);
      const patch: Parameters<typeof updateAudioMix>[1] = {};
      const gain = optionalNumber(args, 'masterGainDb');
      if (gain !== undefined) patch.masterGainDb = gain;
      const limiter = optionalBoolean(args, 'masterLimiter');
      if (limiter !== undefined) patch.masterLimiter = limiter;
      const lufs = optionalNumber(args, 'targetLufs');
      if (lufs !== undefined) {
        patch.loudnessTarget = {
          platform: project.video.height > project.video.width ? 'shorts' : 'youtube',
          integratedLufs: Math.max(-33, Math.min(-9, lufs)),
          truePeakDb: -1,
          toleranceDb: 1,
        };
      }
      apply(context, updateAudioMix(project, patch));
      return JSON.stringify({ ok: true });
    }

    case 'critic_run': {
      const report = critiqueTimeline(projectOf(context));
      return JSON.stringify({ score: report.score, findings: report.findings, fixable: report.fixable });
    }

    case 'critic_fix': {
      const project = projectOf(context);
      const report = critiqueTimeline(project);
      const rules = Array.isArray(args.rules)
        ? new Set(args.rules.filter((item): item is string => typeof item === 'string'))
        : null;
      const accepted = new Set(
        report.findings
          .filter((finding) => finding.fix && (!rules || rules.has(finding.rule)))
          .map((finding) => finding.id),
      );
      apply(context, applyCriticFixes(project, report.findings, accepted));
      return JSON.stringify({ ok: true, applied: accepted.size });
    }

    case 'diarize': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const clip = project.timeline.clips.find((item) => item.id === clipId);
      if (!clip || clip.source.type !== 'asset') throw new Error('el clip no tiene archivo');
      const assetId = clip.source.assetId;
      const asset = project.assets.find((item) => item.id === assetId);
      if (!asset) throw new Error('el proyecto no está guardado en disco');
      const result = await context.store.service.diarizeAudio(assetId, optionalText(args, 'language'));
      const applied = applySpeakerSegments(project, clipId, result.segments, {
        prefix: optionalBoolean(args, 'prefix') ?? false,
      });
      apply(context, applied.project);
      return JSON.stringify({ ok: true, labelled: applied.labelled, segments: result.segments.length });
    }

    case 'export_interchange': {
      const project = projectOf(context);
      const format = text(args, 'format');
      const directory = text(args, 'directory');
      const request = { project, outputDir: directory };
      const ext = format === 'fcp7xml' ? 'xml' : format;
      const output =
        directory.replace(/[\\/]+$/, '') +
        '\\' +
        String((project as { name?: string }).name ?? 'timeline').replace(/[<>:"/\\|?*]/g, '_') +
        '.' + ext;
      const result =
        format === 'edl'
          ? await context.store.service.exportEdl(request)
          : format === 'otio'
            ? await context.store.service.exportOtio(request)
            : format === 'fcpxml'
              ? await context.store.service.exportFcpxml(request)
              : format === 'fcp7xml' || format === 'aaf' || format === 'omf'
                ? await context.store.service.exportTimelineInterchange({
                    project,
                    output,
                    format,
                  })
                : null;
      if (!result) throw new Error(`formato desconocido: ${format}`);
      return JSON.stringify({ ok: true, format, result });
    }

    case 'playhead': {
      context.store.setPlayhead(frame(args, 'frame'));
      return JSON.stringify({ ok: true });
    }

    case 'app_status':
      return JSON.stringify({
        app: 'olyvia',
        project: context.store.state.project?.name ?? null,
        open: context.store.state.project !== null,
      });

    case 'project_summary': {
      const project = projectOf(context);
      const fps = fpsOf(project);
      const end = project.timeline.clips.reduce(
        (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
        0,
      );
      return JSON.stringify({
        name: project.name,
        width: project.video.width,
        height: project.video.height,
        fps,
        durationFrames: end,
        durationSeconds: Number((end / fps).toFixed(2)),
        tracks: project.timeline.tracks.length,
        clips: project.timeline.clips.length,
        captions: project.captions.cues.length,
        assets: project.assets.length,
        path: context.store.state.opened?.path ?? null,
      });
    }

    case 'project_snapshot': {
      const project = projectOf(context);
      const fps = fpsOf(project);
      const durationFrames = project.timeline.clips.reduce(
        (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
        0,
      );
      const allSections = ['tracks', 'clips', 'captions', 'assets', 'markers', 'profiles'] as const;
      const requested = Array.isArray(args.include)
        ? new Set(
            args.include.filter(
              (item): item is (typeof allSections)[number] =>
                typeof item === 'string' && allSections.includes(item as (typeof allSections)[number]),
            ),
          )
        : new Set<string>(allSections);
      const limit = Math.max(1, Math.min(500, Math.round(optionalNumber(args, 'limit') ?? 200)));
      const page = <T,>(items: T[]) => ({
        items: items.slice(0, limit),
        total: items.length,
        truncated: items.length > limit,
      });
      const sections: Record<string, unknown> = {};

      if (requested.has('tracks')) {
        // Un solo recorrido de clips evita volver a filtrar toda la timeline por cada pista.
        const clipCountsByTrack = new Map<string, number>();
        for (const clip of project.timeline.clips) {
          clipCountsByTrack.set(
            clip.trackId,
            (clipCountsByTrack.get(clip.trackId) ?? 0) + 1,
          );
        }
        sections.tracks = page(
          project.timeline.tracks.map((track) => ({
            id: track.id,
            kind: track.kind,
            label: track.label,
            locked: track.locked,
            muted: track.muted,
            hidden: track.hidden ?? false,
            clips: clipCountsByTrack.get(track.id) ?? 0,
          })),
        );
      }
      if (requested.has('clips')) sections.clips = page(clipsJson(project));
      if (requested.has('captions')) {
        sections.captions = page(
          project.captions.cues.map((cue) => ({
            id: cue.id,
            startFrame: cue.startFrame,
            endFrame: cue.endFrame,
            text: cue.text,
            speaker: cue.speaker ?? null,
          })),
        );
      }
      if (requested.has('assets')) {
        sections.assets = page(
          project.assets.map((asset) => {
            const media = 'media' in asset ? asset.media : undefined;
            return {
              id: asset.id,
              label: asset.label,
              kind: asset.kind,
              path: asset.source.path,
              status: asset.status,
              durationFrames:
                media && 'durationFrames' in media ? media.durationFrames : null,
              width: media && 'width' in media ? media.width : null,
              height: media && 'height' in media ? media.height : null,
            };
          }),
        );
      }
      if (requested.has('markers')) {
        sections.markers = page(
          project.markers.map((marker) => ({
            id: marker.id,
            frame: marker.frame,
            endFrame: marker.endFrame ?? null,
            label: marker.label,
            color: marker.color ?? null,
          })),
        );
      }
      if (requested.has('profiles')) {
        sections.profiles = page(
          project.renderProfiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
            aspectRatio: profile.aspectRatio,
            width: profile.resolution.width,
            height: profile.resolution.height,
            bitrate: profile.bitrate,
          })),
        );
      }

      return JSON.stringify({
        schemaVersion: 1,
        project: {
          name: project.name,
          width: project.video.width,
          height: project.video.height,
          fps,
          durationFrames,
          durationSeconds: Number((durationFrames / fps).toFixed(2)),
          path: context.store.state.opened?.path ?? null,
        },
        counts: {
          tracks: project.timeline.tracks.length,
          clips: project.timeline.clips.length,
          captions: project.captions.cues.length,
          assets: project.assets.length,
          markers: project.markers.length,
          profiles: project.renderProfiles.length,
        },
        limitPerSection: limit,
        sections,
      });
    }

    case 'timeline_clips':
      return JSON.stringify(clipsJson(projectOf(context)));

    case 'captions_list':
      return JSON.stringify(
        projectOf(context).captions.cues.map((cue) => ({
          id: cue.id,
          startFrame: cue.startFrame,
          endFrame: cue.endFrame,
          text: cue.text,
          speaker: cue.speaker ?? null,
        })),
      );

    case 'assets_list':
      return JSON.stringify(
        projectOf(context).assets.map((asset) => {
          const media = 'media' in asset ? asset.media : undefined;
          return {
            id: asset.id,
            label: asset.label,
            kind: asset.kind,
            path: asset.source.path,
            status: asset.status,
            durationFrames:
              media && 'durationFrames' in media ? media.durationFrames : null,
            width: media && 'width' in media ? media.width : null,
            height: media && 'height' in media ? media.height : null,
          };
        }),
      );

    case 'media_analyze': {
      const ids = Array.isArray(args.assetIds)
        ? args.assetIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).slice(0, 20)
        : [];
      if (ids.length === 0) throw new Error('faltan ids de assets en «assetIds»');
      return JSON.stringify(await context.store.service.analyzeMediaFrames(ids));
    }

    case 'fs_check': {
      const paths = Array.isArray(args.paths)
        ? args.paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, 50)
        : [];
      if (paths.length === 0) throw new Error('faltan rutas en «paths»');
      return JSON.stringify(await context.store.service.checkAssetFiles(paths));
    }

    case 'media_convert': {
      const ids = Array.isArray(args.assetIds)
        ? args.assetIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).slice(0, 20)
        : [];
      if (ids.length === 0) throw new Error('faltan ids de assets en «assetIds»');
      const target = text(args, 'target') as ConversionTarget;
      const outputDir = text(args, 'outputDir');
      const quality = optionalNumber(args, 'quality');
      const maxWidth = optionalNumber(args, 'maxWidth');
      if (ids.length === 1) {
        const result = await context.store.service.convertMedia({
          assetId: ids[0] as string,
          target,
          outputDir,
          ...(quality !== undefined ? { quality } : {}),
          ...(maxWidth !== undefined ? { maxWidth } : {}),
        });
        return JSON.stringify(result);
      }
      const items = await context.store.service.convertMediaBatch(
        ids,
        target,
        outputDir,
        quality,
        maxWidth,
      );
      return JSON.stringify(items);
    }

    case 'tracks_list': {
      const project = projectOf(context);
      return JSON.stringify(
        project.timeline.tracks.map((track) => ({
          id: track.id,
          kind: track.kind,
          label: track.label,
          locked: track.locked,
          muted: track.muted,
          clips: project.timeline.clips.filter((clip) => clip.trackId === track.id).length,
        })),
      );
    }

    case 'export_profiles':
      return JSON.stringify(
        projectOf(context).renderProfiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          aspectRatio: profile.aspectRatio,
          width: profile.resolution.width,
          height: profile.resolution.height,
          bitrate: profile.bitrate,
        })),
      );

    case 'clip_update': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const patch: Parameters<typeof updateClip>[2] = {};
      const label = optionalText(args, 'label');
      if (label !== undefined) patch.label = label;
      const enabled = optionalBoolean(args, 'enabled');
      if (enabled !== undefined) patch.enabled = enabled;
      const motion = args.motion;
      if (motion === null) patch.motion = undefined;
      else if (motion === 'zoom-in' || motion === 'zoom-out' || motion === 'pan-left' || motion === 'pan-right') {
        patch.motion = { type: motion, intensity: optionalNumber(args, 'motionIntensity') ?? 0.08 };
      }
      const gainDb = optionalNumber(args, 'gainDb');
      if (gainDb !== undefined) {
        const clip = project.timeline.clips.find((item) => item.id === clipId);
        const audio = clip && 'audio' in clip ? (clip.audio ?? {}) : {};
        patch.audio = { ...audio, gainDb: Math.max(-60, Math.min(12, gainDb)) };
      }
      apply(context, updateClip(project, clipId, patch));
      return JSON.stringify({ ok: true, clipId });
    }

    case 'clip_move': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const startFrame = frame(args, 'startFrame');
      const trackId = optionalText(args, 'trackId');
      if (!project.timeline.clips.some((clip) => clip.id === clipId)) {
        throw new Error('el clip no existe');
      }
      const next = moveClip(project, clipId, startFrame, trackId);
      if (!next) {
        throw new Error(
          'no se pudo mover el clip: solapamiento con otro clip, pista bloqueada o tipo incompatible con la pista destino',
        );
      }
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, startFrame });
    }

    case 'clip_delete': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      apply(context, deleteClip(project, clipId));
      return JSON.stringify({ ok: true, clipId });
    }

    case 'clip_split': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const atFrame = frame(args, 'atFrame');
      const result = splitClip(project, clipId, atFrame);
      if (!result) throw new Error('el clip no existe o no se puede dividir en ese frame');
      apply(context, result.project);
      return JSON.stringify({ ok: true, clipId, rightClipId: result.rightClipId });
    }

    case 'clip_slip': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const deltaFrames = optionalNumber(args, 'deltaFrames');
      if (deltaFrames === undefined) throw new Error('falta el parámetro «deltaFrames» (número)');
      const next = slipClip(project, clipId, Math.round(deltaFrames));
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, deltaFrames: Math.round(deltaFrames) });
    }

    case 'clip_slide': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const deltaFrames = optionalNumber(args, 'deltaFrames');
      if (deltaFrames === undefined) throw new Error('falta el parámetro «deltaFrames» (número)');
      const next = slideClip(project, clipId, Math.round(deltaFrames));
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, deltaFrames: Math.round(deltaFrames) });
    }

    case 'clip_roll': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const edge = text(args, 'edge');
      if (edge !== 'in' && edge !== 'out') throw new Error("edge debe ser 'in' u 'out'");
      const deltaFrames = optionalNumber(args, 'deltaFrames');
      if (deltaFrames === undefined) throw new Error('falta el parámetro «deltaFrames» (número)');
      const next = rollClip(project, clipId, edge, Math.round(deltaFrames));
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, edge, deltaFrames: Math.round(deltaFrames) });
    }

    case 'clip_speed_ramp': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const from = optionalNumber(args, 'from');
      const to = optionalNumber(args, 'to');
      if (from === undefined || to === undefined) throw new Error('faltan «from» y/o «to»');
      const result = applySpeedRamp(project, clipId, { from, to });
      apply(context, result.project);
      return JSON.stringify({ ok: true, clipIds: result.clipIds, speeds: result.speeds });
    }

    case 'clip_speed_curve': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const points = args.points;
      if (!Array.isArray(points) || points.length < 2) {
        throw new Error('«points» debe ser un array de al menos 2 puntos {t, speed}');
      }
      const targetFps = optionalNumber(args, 'targetFps');
      const curve: SpeedCurve = {
        points: points as SpeedCurve['points'],
        ...(args.opticalFlow === true ? { opticalFlow: true } : {}),
        ...(targetFps === 24 || targetFps === 30 || targetFps === 60 || targetFps === 120
          ? { targetFps: targetFps as 24 | 30 | 60 | 120 }
          : {}),
      };
      const next = applySpeedCurvePoints(project, clipId, curve);
      apply(context, next);
      return JSON.stringify({ ok: true, clipId });
    }

    case 'clip_stabilize': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const transformFile = optionalText(args, 'transformFile');
      let next: ProjectDocument;
      if (!transformFile) {
        next = setClipStabilization(project, clipId, undefined);
      } else {
        const smoothing = optionalNumber(args, 'smoothing') ?? 10;
        const inFrame = optionalNumber(args, 'inFrame') ?? 0;
        const outFrame = optionalNumber(args, 'outFrame') ?? Number.MAX_SAFE_INTEGER;
        next = setClipStabilization(project, clipId, {
          smoothing,
          transformFile,
          inFrame: Math.round(inFrame),
          outFrame: Math.round(outFrame),
          ...(optionalText(args, 'previewProxy')
            ? { previewProxy: optionalText(args, 'previewProxy')! }
            : {}),
        });
      }
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, enabled: transformFile !== undefined });
    }

    case 'clip_freeze': {
      const project = projectOf(context);
      const result = freezeFrameInPlace(
        project,
        text(args, 'clipId'),
        frame(args, 'atFrame'),
        text(args, 'assetId'),
        Math.max(1, Math.round(optionalNumber(args, 'durationFrames') ?? 60)),
      );
      apply(context, result.project);
      return JSON.stringify({
        ok: true,
        freezeClipId: result.freezeClipId,
        startFrame: result.startFrame,
        durationFrames: result.durationFrames,
      });
    }

    case 'clip_detach_audio': {
      const project = projectOf(context);
      const result = detachAudio(project, text(args, 'clipId'));
      apply(context, result.project);
      return JSON.stringify({ ok: true, clipId: result.clipId, trackId: result.trackId });
    }

    case 'clip_duplicate': {
      const project = projectOf(context);
      const result = duplicateClip(project, text(args, 'clipId'));
      if (!result) throw new Error('el clip no existe');
      apply(context, result.project);
      return JSON.stringify({ ok: true, clipId: result.clipId });
    }

    case 'clip_compound': {
      const project = projectOf(context);
      const result = createCompound(project, text(args, 'clipId'));
      apply(context, result.project);
      return JSON.stringify({ ok: true, compoundClipId: result.compoundClipId, grouped: result.grouped });
    }

    case 'compound_expand': {
      const project = projectOf(context);
      const next = expandCompound(project, text(args, 'clipId'));
      apply(context, next);
      return JSON.stringify({ ok: true });
    }

    case 'adjustment_add': {
      const project = projectOf(context);
      const result = addAdjustmentLayer(project, frame(args, 'atFrame'), {
        ...(optionalNumber(args, 'durationFrames') !== undefined
          ? { durationFrames: Math.max(1, Math.round(optionalNumber(args, 'durationFrames')!)) }
          : {}),
        ...(optionalText(args, 'trackId') ? { trackId: optionalText(args, 'trackId')! } : {}),
      });
      apply(context, result.project);
      return JSON.stringify({ ok: true, clipId: result.clipId, trackId: result.trackId });
    }

    case 'clip_replace': {
      const project = projectOf(context);
      const next = replaceClipWithDerivedAsset(
        project,
        text(args, 'clipId'),
        text(args, 'assetId'),
        optionalNumber(args, 'sourceOffset') !== undefined
          ? { sourceOffset: Math.round(optionalNumber(args, 'sourceOffset')!) }
          : undefined,
      );
      apply(context, next);
      return JSON.stringify({ ok: true });
    }

    case 'clip_split_multi': {
      const project = projectOf(context);
      const frames = args.frames;
      if (!Array.isArray(frames) || frames.length === 0) {
        throw new Error('«frames» debe ser un array no vacío de frames de corte');
      }
      const result = splitClipAtFrames(
        project,
        text(args, 'clipId'),
        frames.map((item) => Math.round(Number(item))),
      );
      if (!result) throw new Error('el clip no existe o no se puede dividir');
      apply(context, result.project);
      return JSON.stringify({ ok: true, clipIds: result.clipIds });
    }

    case 'track_split': {
      const project = projectOf(context);
      const frames = args.frames;
      if (!Array.isArray(frames) || frames.length === 0) {
        throw new Error('«frames» debe ser un array no vacío de frames de corte');
      }
      const next = splitTrackAtFrames(
        project,
        text(args, 'trackId'),
        frames.map((item) => Math.round(Number(item))),
      );
      if (!next) throw new Error('la pista no existe, está bloqueada o no hay cortes válidos');
      apply(context, next);
      return JSON.stringify({ ok: true });
    }

    case 'split_at_markers': {
      const project = projectOf(context);
      const trackIds = Array.isArray(args.trackIds)
        ? args.trackIds.filter((item): item is string => typeof item === 'string')
        : undefined;
      const result = splitClipsAtMarkers(project, trackIds ? { trackIds } : {});
      apply(context, result.project);
      return JSON.stringify({ ok: true, cuts: result.cuts, clips: result.clips, skippedTracks: result.skippedTracks });
    }

    case 'cut_at_frame': {
      const project = projectOf(context);
      const side = text(args, 'side');
      if (side !== 'left' && side !== 'right') throw new Error("side debe ser 'left' u 'right'");
      const result = cutSideAtPlayhead(
        project,
        frame(args, 'atFrame'),
        side,
        optionalText(args, 'clipId'),
      );
      if (!result) throw new Error('no hay clips para cortar en ese frame');
      apply(context, result.project);
      return JSON.stringify({ ok: true, keptClipIds: result.keptClipIds, removedClipIds: result.removedClipIds });
    }

    case 'captions_from_scenes': {
      const project = projectOf(context);
      apply(context, captionsFromScenes(project));
      return JSON.stringify({ ok: true });
    }

    case 'audio_preset_apply_all': {
      const project = projectOf(context);
      const preset = text(args, 'preset');
      if (preset !== 'voice' && preset !== 'music') throw new Error("preset debe ser 'voice' o 'music'");
      const result = applyAudioPresetToAll(project, preset);
      apply(context, result.project);
      return JSON.stringify({ ok: true, applied: result.applied, skipped: result.skipped });
    }

    case 'transition_apply_cuts': {
      const project = projectOf(context);
      const result = applyTransitionToCuts(project, {
        ...(optionalText(args, 'type') ? { type: optionalText(args, 'type') as ClipTransition['type'] } : {}),
        ...(optionalNumber(args, 'frames') !== undefined ? { frames: Math.round(optionalNumber(args, 'frames')!) } : {}),
        ...(optionalText(args, 'color') ? { color: optionalText(args, 'color') } : {}),
        ...(Array.isArray(args.trackIds)
          ? { trackIds: args.trackIds.filter((item): item is string => typeof item === 'string') }
          : {}),
      });
      apply(context, result.project);
      return JSON.stringify({ ok: true, applied: result.applied, skipped: result.skipped });
    }

    case 'timeline_trim_start': {
      const project = projectOf(context);
      const frames = optionalNumber(args, 'frames');
      if (frames === undefined) throw new Error('falta el parámetro «frames»');
      const result = trimTimelineStart(project, Math.round(frames));
      apply(context, result.project);
      return JSON.stringify({ ok: true, trimmed: result.trimmed });
    }

    case 'clip_mask_set': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const mask = args.mask;
      const next = updateClip(project, clipId, {
        mask: mask === null ? undefined : (mask as ClipMask),
      });
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, hasMask: mask !== null });
    }

    case 'mask_keyframe_add': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const atFrame = frame(args, 'frame');
      const easing = optionalText(args, 'easing');
      const next = setMaskKeyframe(project, clipId, atFrame, {
        ...(optionalNumber(args, 'x') !== undefined ? { x: optionalNumber(args, 'x')! } : {}),
        ...(optionalNumber(args, 'y') !== undefined ? { y: optionalNumber(args, 'y')! } : {}),
        ...(optionalNumber(args, 'width') !== undefined ? { width: optionalNumber(args, 'width')! } : {}),
        ...(optionalNumber(args, 'height') !== undefined ? { height: optionalNumber(args, 'height')! } : {}),
        ...(optionalNumber(args, 'rotationDeg') !== undefined ? { rotationDeg: optionalNumber(args, 'rotationDeg')! } : {}),
        ...(optionalNumber(args, 'feather') !== undefined ? { feather: optionalNumber(args, 'feather')! } : {}),
        ...(easing ? { easing: easing as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' } : {}),
      });
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, frame: atFrame });
    }

    case 'mask_keyframe_remove': {
      const project = projectOf(context);
      apply(context, removeMaskKeyframe(project, text(args, 'clipId'), frame(args, 'frame')));
      return JSON.stringify({ ok: true });
    }

    case 'clip_mask_from_face': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const samples = (args.samples as Record<string, unknown>[]).map((s) => ({
        time: Number(s.time),
        centerX: Number(s.centerX),
        centerY: Number(s.centerY),
        size: Number(s.size ?? 0.2),
      }));
      const mask = maskFromFaceTrack({ samples }, fpsOf(project));
      if (!mask) {
        throw new Error('no se pudo derivar una máscara del track facial (samples vacías o inválidas)');
      }
      const feather = optionalNumber(args, 'feather');
      const invert = optionalBoolean(args, 'invert');
      const finalMask: ClipMask = {
        ...mask,
        ...(feather !== undefined ? { feather } : {}),
        ...(invert !== undefined ? { invert } : {}),
      };
      apply(context, updateClip(project, clipId, { mask: finalMask }));
      return JSON.stringify({ ok: true, clipId, keyframes: finalMask.keyframes?.length ?? 0 });
    }

    case 'mask_keyframes_clear': {
      const project = projectOf(context);
      apply(context, clearMaskKeyframes(project, text(args, 'clipId')));
      return JSON.stringify({ ok: true });
    }

    case 'project_look_set': {
      const project = projectOf(context);
      const look = args.look;
      const next = setProjectLook(
        project,
        look === null ? null : (look as ClipEffects),
      );
      apply(context, next);
      return JSON.stringify({ ok: true, hasLook: look !== null });
    }

    case 'marker_update': {
      const project = projectOf(context);
      const markerId = text(args, 'markerId');
      const color = optionalText(args, 'color');
      const role = optionalText(args, 'role');
      const next = updateMarker(project, markerId, {
        ...(optionalNumber(args, 'frame') !== undefined ? { frame: Math.round(optionalNumber(args, 'frame')!) } : {}),
        ...(args.endFrame === null || optionalNumber(args, 'endFrame') !== undefined
          ? { endFrame: args.endFrame === null ? undefined : Math.round(optionalNumber(args, 'endFrame')!) }
          : {}),
        ...(optionalText(args, 'label') !== undefined ? { label: optionalText(args, 'label')! } : {}),
        ...(color ? { color: color as 'mint' | 'amber' | 'rose' | 'blue' | 'violet' | 'slate' } : {}),
        ...(optionalText(args, 'note') !== undefined ? { note: optionalText(args, 'note')! } : {}),
        ...(role === 'cover' ? { role: 'cover' as const } : {}),
      });
      apply(context, next);
      return JSON.stringify({ ok: true, markerId });
    }

    case 'markers_clear': {
      apply(context, clearMarkers(projectOf(context)));
      return JSON.stringify({ ok: true });
    }

    case 'markers_from_scenes': {
      const fromScenes = markersFromScenes(projectOf(context));
      apply(context, fromScenes.project);
      return JSON.stringify({ ok: true, added: fromScenes.added, skipped: fromScenes.skipped });
    }

    case 'markers_from_cuts': {
      const project = projectOf(context);
      const frames = args.frames;
      if (!Array.isArray(frames) || frames.length === 0) {
        throw new Error('«frames» debe ser un array no vacío de frames de corte');
      }
      const result = markersFromCuts(project, frames.map((item) => Math.round(Number(item))));
      apply(context, result.project);
      return JSON.stringify({ ok: true, added: result.added, skipped: result.skipped });
    }

    case 'caption_title_add': {
      const project = projectOf(context);
      const result = addTitleCue(project, {
        text: text(args, 'text'),
        ...(optionalNumber(args, 'startFrame') !== undefined ? { startFrame: Math.round(optionalNumber(args, 'startFrame')!) } : {}),
        ...(optionalNumber(args, 'durationFrames') !== undefined ? { durationFrames: Math.max(1, Math.round(optionalNumber(args, 'durationFrames')!)) } : {}),
        ...(optionalText(args, 'styleId') ? { styleId: optionalText(args, 'styleId')! } : {}),
      });
      apply(context, result.project);
      return JSON.stringify({ ok: true, cueId: result.cueId, trackId: result.trackId });
    }

    case 'scene_add': {
      const project = projectOf(context);
      const intent = text(args, 'intent');
      if (!['hook', 'context', 'explainer', 'demo', 'proof', 'cta', 'outro'].includes(intent)) {
        throw new Error("intent inválido");
      }
      const result = addScene(project, {
        title: text(args, 'title'),
        intent: intent as 'hook' | 'context' | 'explainer' | 'demo' | 'proof' | 'cta' | 'outro',
        narration: text(args, 'narration'),
        ...(optionalText(args, 'notes') ? { notes: optionalText(args, 'notes')! } : {}),
      });
      apply(context, result.project);
      return JSON.stringify({ ok: true, sceneId: result.sceneId });
    }

    case 'scene_update': {
      const project = projectOf(context);
      const sceneId = text(args, 'sceneId');
      const intent = optionalText(args, 'intent');
      const status = optionalText(args, 'status');
      const next = updateScene(project, sceneId, {
        ...(optionalText(args, 'title') !== undefined ? { title: optionalText(args, 'title')! } : {}),
        ...(intent ? { intent: intent as 'hook' | 'context' | 'explainer' | 'demo' | 'proof' | 'cta' | 'outro' } : {}),
        ...(status ? { status: status as 'draft' | 'reviewed' | 'approved' } : {}),
        ...(optionalText(args, 'notes') !== undefined ? { notes: optionalText(args, 'notes')! } : {}),
        ...(optionalText(args, 'narration') !== undefined ? { narration: optionalText(args, 'narration')! } : {}),
      });
      apply(context, next);
      return JSON.stringify({ ok: true, sceneId });
    }

    case 'scene_remove': {
      apply(context, removeScene(projectOf(context), text(args, 'sceneId')));
      return JSON.stringify({ ok: true });
    }

    case 'scene_reorder': {
      const project = projectOf(context);
      const sceneIds = args.sceneIds;
      if (!Array.isArray(sceneIds) || sceneIds.length === 0) {
        throw new Error('«sceneIds» debe ser un array no vacío de ids de escena');
      }
      apply(context, reorderScenes(project, sceneIds.filter((item): item is string => typeof item === 'string')));
      return JSON.stringify({ ok: true });
    }

    case 'overlay_face_center': {
      const samples = (args.samples as Record<string, unknown>[]).map((s) => ({
        time: Number(s.time),
        centerX: Number(s.centerX),
        centerY: Number(s.centerY),
      })) as FaceCenterSample[];
      const smoothing = optionalNumber(args, 'smoothing');
      apply(context, applyFaceCenter(projectOf(context), text(args, 'clipId'), samples,
        smoothing !== undefined ? { smoothing } : undefined));
      return JSON.stringify({ ok: true });
    }

    case 'overlay_face_blur': {
      const samples = (args.samples as Record<string, unknown>[]).map((s) => ({
        time: Number(s.time),
        centerX: Number(s.centerX),
        centerY: Number(s.centerY),
        size: Number(s.size),
        ...(typeof s.rotationDeg === 'number' ? { rotationDeg: Number(s.rotationDeg) } : {}),
      })) as FaceBlurSample[];
      const options: Record<string, unknown> = {};
      for (const key of ['blur', 'margin', 'feather', 'smoothing', 'pixelSize'] as const) {
        const v = optionalNumber(args, key);
        if (v !== undefined) options[key] = v;
      }
      const kind = optionalText(args, 'kind');
      if (kind === 'blur' || kind === 'pixelate') options.kind = kind;
      const result = applyFaceBlurOverlay(projectOf(context), text(args, 'clipId'), samples, options as never);
      apply(context, result.project);
      return JSON.stringify({ ok: true, clipId: result.clipId, trackId: result.trackId });
    }

    case 'overlay_mask_track': {
      const samples = (args.samples as Record<string, unknown>[]).map((s) => ({
        time: Number(s.time),
        centerX: Number(s.centerX),
        centerY: Number(s.centerY),
        size: Number(s.size),
        ...(typeof s.rotationDeg === 'number' ? { rotationDeg: Number(s.rotationDeg) } : {}),
      })) as FaceBlurSample[];
      const options: Record<string, unknown> = {};
      for (const key of ['margin', 'feather', 'smoothing'] as const) {
        const v = optionalNumber(args, key);
        if (v !== undefined) options[key] = v;
      }
      const invert = optionalBoolean(args, 'invert');
      if (invert !== undefined) options.invert = invert;
      apply(context, applyMaskTrack(projectOf(context), text(args, 'clipId'), samples, options as never));
      return JSON.stringify({ ok: true });
    }

    case 'overlay_breathing': {
      const options: Record<string, unknown> = {};
      const amplitude = optionalNumber(args, 'amplitude');
      const period = optionalNumber(args, 'periodSeconds');
      if (amplitude !== undefined) options.amplitude = amplitude;
      if (period !== undefined) options.periodSeconds = period;
      apply(context, applyBreathingLoop(projectOf(context), text(args, 'clipId'), options));
      return JSON.stringify({ ok: true });
    }

    case 'overlay_click_pulse': {
      const atOffset = optionalNumber(args, 'atOffset');
      apply(context, applyClickPulse(projectOf(context), text(args, 'clipId'),
        atOffset !== undefined ? { atOffset } : undefined));
      return JSON.stringify({ ok: true });
    }

    case 'delivery_compression': {
      const codec = optionalText(args, 'videoCodec');
      apply(context, applyCompression(projectOf(context), text(args, 'preset') as never,
        codec === 'h264' || codec === 'h265' || codec === 'vp9' || codec === 'av1' || codec === 'prores' ? codec : undefined));
      return JSON.stringify({ ok: true });
    }

    case 'delivery_profile_fit': {
      apply(context, applyProfileFit(projectOf(context), text(args, 'fit') as never));
      return JSON.stringify({ ok: true });
    }

    case 'delivery_pixel_format': {
      apply(context, applyPixelFormat(projectOf(context), text(args, 'pixelFormat') as never));
      return JSON.stringify({ ok: true });
    }
    case 'keyframe_remove': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const clip = clipById(project, clipId);
      const absolute = frame(args, 'frame');
      const local = absolute - clip.startFrame;
      apply(context, removeTransformKeyframe(project, clipId, local));
      return JSON.stringify({ ok: true, clipId, frame: absolute, localFrame: local });
    }

    case 'keyframe_clear': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const freeze = optionalNumber(args, 'freezeAtFrame');
      apply(context, clearTransformKeyframes(project, clipId, freeze ?? 0));
      return JSON.stringify({ ok: true });
    }

    case 'keyframe_paste_at_frame': {
      const project = projectOf(context);
      const absolute = frame(args, 'frame');
      const easing = optionalText(args, 'easing') as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' | undefined;
      const bezierArg = args.bezier as Record<string, unknown> | null | undefined;
      const patch: Record<string, unknown> = {};
      for (const key of ['offsetX', 'offsetY', 'scale', 'rotationDeg', 'opacity'] as const) {
        const v = optionalNumber(args, key);
        if (v !== undefined) patch[key] = v;
      }
      if (easing) patch.easing = easing;
      if (bezierArg === null) patch.bezier = null;
      else if (bezierArg && typeof bezierArg === 'object') {
        patch.bezier = {
          cp1X: Number(bezierArg.cp1X), cp1Y: Number(bezierArg.cp1Y),
          cp2X: Number(bezierArg.cp2X), cp2Y: Number(bezierArg.cp2Y),
        };
      }
      const result = pasteTransformKeyframesAtPlayhead(project, absolute, patch as never);
      apply(context, result.project);
      return JSON.stringify({ ok: true, applied: result.applied, frame: absolute });
    }

    case 'keyframe_bezier_apply': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const bezier = {
        cp1X: numberArg(args, 'cp1X'), cp1Y: numberArg(args, 'cp1Y'),
        cp2X: numberArg(args, 'cp2X'), cp2Y: numberArg(args, 'cp2Y'),
      };
      apply(context, applyTransformBezierToAllKeyframes(project, clipId, bezier));
      return JSON.stringify({ ok: true });
    }

    case 'keyframe_snapshot': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const clip = clipById(project, clipId);
      const absolute = frame(args, 'frame');
      const local = absolute - clip.startFrame;
      const patch = snapshotTransformKeyframes(clip, local);
      return JSON.stringify({ ok: true, patch });
    }

    case 'keyframe_capture': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const clip = clipById(project, clipId);
      const absolute = frame(args, 'frame');
      const local = absolute - clip.startFrame;
      const patch = captureTransformKeyframe(clip, local);
      return JSON.stringify({ ok: true, patch });
    }

    case 'keyframe_transform_at': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const clip = clipById(project, clipId);
      const absolute = frame(args, 'frame');
      const local = absolute - clip.startFrame;
      const sampled = clipTransformAtFrame(clip, local);
      return JSON.stringify({ ok: true, transform: sampled });
    }

    case 'gain_keyframe_add': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const clip = clipById(project, clipId);
      const absolute = frame(args, 'frame');
      const local = absolute - clip.startFrame;
      const easing = optionalText(args, 'easing') as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' | undefined;
      apply(context, setGainKeyframe(project, clipId, local, numberArg(args, 'gainDb'), easing ?? 'linear'));
      return JSON.stringify({ ok: true, clipId, localFrame: local });
    }

    case 'gain_keyframe_remove': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const clip = clipById(project, clipId);
      const absolute = frame(args, 'frame');
      const local = absolute - clip.startFrame;
      apply(context, removeGainKeyframe(project, clipId, local));
      return JSON.stringify({ ok: true, clipId, localFrame: local });
    }

    case 'gain_keyframes_clear': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const freeze = optionalNumber(args, 'freezeAtFrame');
      apply(context, clearGainKeyframes(project, clipId, freeze ?? 0));
      return JSON.stringify({ ok: true });
    }

    case 'clip_gain_at': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const clip = clipById(project, clipId);
      const absolute = frame(args, 'frame');
      const local = absolute - clip.startFrame;
      const gainDb = clipGainAtFrame(clip, local);
      return JSON.stringify({ ok: true, gainDb });
    }

    case 'clip_slowmo_smoothing': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      apply(context, setSlowMotionSmoothing(project, clipId, optionalBoolean(args, 'enabled') ?? true));
      return JSON.stringify({ ok: true });
    }

    case 'track_gain_keyframe_add': {
      const project = projectOf(context);
      const trackId = stringArg(args, 'trackId');
      const absolute = optionalNumber(args, 'frame');
      const freeze = optionalNumber(args, 'freezeAtFrame');
      const easing = optionalText(args, 'easing') as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' | undefined;
      apply(context, setTrackGainKeyframe(project, trackId, absolute ?? 0, numberArg(args, 'gainDb'), easing ?? 'linear'));
      return JSON.stringify({ ok: true });
    }

    case 'track_gain_keyframe_remove': {
      const project = projectOf(context);
      const trackId = stringArg(args, 'trackId');
      const absolute = optionalNumber(args, 'frame');
      const freeze = optionalNumber(args, 'freezeAtFrame');
      apply(context, removeTrackGainKeyframe(project, trackId, absolute ?? 0));
      return JSON.stringify({ ok: true });
    }

    case 'track_gain_keyframes_clear': {
      const project = projectOf(context);
      const trackId = stringArg(args, 'trackId');
      const absolute = optionalNumber(args, 'frame');
      const freeze = optionalNumber(args, 'freezeAtFrame');
      apply(context, clearTrackGainKeyframes(project, trackId, freeze ?? 0));
      return JSON.stringify({ ok: true });
    }

    case 'track_pan_keyframe_add': {
      const project = projectOf(context);
      const trackId = stringArg(args, 'trackId');
      const absolute = optionalNumber(args, 'frame');
      const freeze = optionalNumber(args, 'freezeAtFrame');
      const easing = optionalText(args, 'easing') as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' | undefined;
      apply(context, setTrackPanKeyframe(project, trackId, absolute ?? 0, numberArg(args, 'value'), easing ?? 'linear'));
      return JSON.stringify({ ok: true });
    }

    case 'track_pan_keyframe_remove': {
      const project = projectOf(context);
      const trackId = stringArg(args, 'trackId');
      const absolute = optionalNumber(args, 'frame');
      const freeze = optionalNumber(args, 'freezeAtFrame');
      apply(context, removeTrackPanKeyframe(project, trackId, absolute ?? 0));
      return JSON.stringify({ ok: true });
    }

    case 'track_pan_keyframes_clear': {
      const project = projectOf(context);
      const trackId = stringArg(args, 'trackId');
      const absolute = optionalNumber(args, 'frame');
      const freeze = optionalNumber(args, 'freezeAtFrame');
      apply(context, clearTrackPanKeyframes(project, trackId, freeze ?? 0));
      return JSON.stringify({ ok: true });
    }
    case 'caption_add': {
      const project = projectOf(context);
      const added = addCaptionCue(project, {
        text: text(args, 'text'),
        startFrame: frame(args, 'startFrame'),
        durationFrames: Math.max(1, frame(args, 'durationFrames')),
      });
      apply(context, added.project);
      return JSON.stringify({ ok: true, cueId: added.cueId });
    }

    case 'caption_update': {
      const project = projectOf(context);
      const cueId = text(args, 'cueId');
      const patch: Parameters<typeof updateCaptionCue>[2] = {};
      const value = optionalText(args, 'text');
      if (value !== undefined) patch.text = value;
      const start = optionalNumber(args, 'startFrame');
      if (start !== undefined) patch.startFrame = Math.max(0, Math.round(start));
      const end = optionalNumber(args, 'endFrame');
      if (end !== undefined) patch.endFrame = Math.max(1, Math.round(end));
      apply(context, updateCaptionCue(project, cueId, patch));
      return JSON.stringify({ ok: true, cueId });
    }

    case 'caption_delete': {
      const project = projectOf(context);
      const cueId = text(args, 'cueId');
      apply(context, deleteCaptionCue(project, cueId));
      return JSON.stringify({ ok: true, cueId });
    }

    case 'track_update': {
      const project = projectOf(context);
      const trackId = text(args, 'trackId');
      const patch: Parameters<typeof updateTrack>[2] = {};
      const label = optionalText(args, 'label');
      if (label !== undefined) patch.label = label;
      const locked = optionalBoolean(args, 'locked');
      if (locked !== undefined) patch.locked = locked;
      const muted = optionalBoolean(args, 'muted');
      if (muted !== undefined) patch.muted = muted;
      const hidden = optionalBoolean(args, 'hidden');
      if (hidden !== undefined) patch.hidden = hidden;
      apply(context, updateTrack(project, trackId, patch));
      return JSON.stringify({ ok: true, trackId });
    }

    case 'run_automation': {
      const project = projectOf(context);
      const kind = text(args, 'kind');
      const service = context.store.service;
      const peaks = (assetId: string) => service.audioPeaks(assetId);
      if (kind === 'cut_silences') {
        const result = await runSilenceCuts(project, peaks);
        apply(context, result.project);
        return JSON.stringify({
          ok: true,
          cuts: result.cuts,
          removedSeconds: result.removedSeconds,
        });
      }
      if (kind === 'cut_pauses') {
        const fps = fpsOf(project);
        let next = project;
        let cuts = 0;
        const candidates = project.timeline.clips
          .filter((clip) => (clip.kind === 'video' || clip.kind === 'audio') && clip.source.type === 'asset')
          .sort((a, b) => a.startFrame - b.startFrame);
        for (const clip of candidates) {
          const live = next.timeline.clips.find((item) => item.id === clip.id);
          if (!live) continue;
          const plan = planSpeechCutsFromCues(cuesForClip(next, live.id), live, fps);
          if (!plan || plan.excessive) continue;
          const after = applySpeechCuts(next, live.id, plan);
          if (after !== next) {
            cuts += plan.pauses;
            next = after;
          }
        }
        apply(context, next);
        return JSON.stringify({ ok: true, cuts });
      }
      if (kind === 'auto_cleanup') {
        const report = await runAutoCleanup(project, peaks);
        apply(context, report.project);
        return JSON.stringify({
          ok: true,
          silenceCuts: report.silenceCuts,
          pauseCuts: report.pauseCuts,
          denoised: report.denoised,
          zoomed: report.zoomed,
          removedSeconds: report.removedSeconds,
        });
      }
      if (kind === 'auto_pilot' || kind === 'export') {
        const report = await runAutoPilot({
          project,
          service,
          options: {
            outputDir: outputDir(context, args),
            ...(optionalText(args, 'profileId') ? { profileId: optionalText(args, 'profileId') } : {}),
          },
        });
        apply(context, report.project);
        return JSON.stringify({
          ok: true,
          videoPath: report.videoPath,
          projectPath: report.projectPath,
          verified: report.verified,
          warnings: report.warnings,
          vmaf: report.quality.vmaf,
          correctionDb: report.loudness.correctionDb,
        });
      }
      throw new Error(`automatización desconocida: ${kind}`);
    }

    case 'export_render': {
      const project = projectOf(context);
      const report = await runAutoPilot({
        project,
        service: context.store.service,
        options: {
          outputDir: outputDir(context, args),
          ...(optionalText(args, 'profileId') ? { profileId: optionalText(args, 'profileId') } : {}),
          ...(optionalBoolean(args, 'qualityCheck') ? { qualityCheck: true } : {}),
        },
      });
      apply(context, report.project);
      return JSON.stringify({
        ok: true,
        videoPath: report.videoPath,
        verified: report.verified,
        warnings: report.warnings,
      });
    }

    case 'navigate': {
      const view = text(args, 'view');
      if (!context.selectView) throw new Error('la navegación no está disponible');
      context.selectView(view);
      return JSON.stringify({ ok: true, view });
    }

    case 'run_command': {
      const command = text(args, 'command');
      if (!context.runCommand) throw new Error('el operador no está disponible');
      return await context.runCommand(command);
    }

    // ── Efectos visuales ──────────────────────────────────────────────
    case 'clip_effects_apply': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const patch: Partial<ClipEffects> = {};
      for (const key of ['brightness', 'contrast', 'saturation', 'temperature', 'shadows', 'highlights', 'fade'] as const) {
        const value = optionalNumber(args, key);
        if (value !== undefined) (patch as Record<string, number>)[key] = value;
      }
      const next = mergeEffects(project, clipId, patch);
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, applied: patch });
    }

    case 'clip_effects_clear': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const clip = clipById(project, clipId);
      const current = visualEffectsOf(clip);
      // Se limpian los efectos visuales; se preserva audioStack (no es visual)
      // y el visualizador de espectro (es una superposición, no un grado).
      const kept: ClipEffects = {};
      if (current.audioStack) kept.audioStack = current.audioStack;
      if (current.spectrum) kept.spectrum = current.spectrum;
      const next = updateClip(project, clipId, {
        effects: Object.keys(kept).length > 0 ? kept : {},
      });
      apply(context, next);
      return JSON.stringify({ ok: true, clipId });
    }

    case 'clip_effects_preset': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const preset = stringArg(args, 'preset');
      const values = EFFECT_PRESETS[preset];
      if (!values) throw new Error(`preset desconocido: ${preset}`);
      const clip = clipById(project, clipId);
      const current = visualEffectsOf(clip);
      const base: ClipEffects = { ...current };
      for (const key of GRADE_PATCH_KEYS) delete (base as Record<string, unknown>)[key];
      const next = updateClip(project, clipId, {
        effects: { ...base, ...values } as ClipEffects,
      });
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, preset });
    }

    // ── Transiciones ──────────────────────────────────────────────────
    case 'transition_add': {
      const project = projectOf(context);
      const fromClipId = stringArg(args, 'fromClipId');
      const toClipId = stringArg(args, 'toClipId');
      const type = stringArg(args, 'type');
      const mapped = MCP_TRANSITION_MAP[type];
      if (!mapped) throw new Error(`tipo de transición desconocido: ${type}`);
      const from = clipById(project, fromClipId);
      const to = clipById(project, toClipId);
      if (from.trackId !== to.trackId) {
        throw new Error('los dos clips deben estar en la misma pista');
      }
      if (from.startFrame + from.durationFrames !== to.startFrame) {
        throw new Error('los clips no son contiguos: la transición va entre cortes');
      }
      const frames = Math.min(
        Math.max(1, Math.round(optionalNumber(args, 'durationFrames') ?? 15)),
        to.durationFrames,
      );
      const next = updateClip(project, toClipId, {
        transitionIn: { type: mapped, frames },
      });
      apply(context, next);
      return JSON.stringify({ ok: true, clipId: toClipId, type: mapped, frames });
    }

    case 'transition_remove': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const next = updateClip(project, clipId, { transitionIn: {}, transitionOut: {} });
      apply(context, next);
      return JSON.stringify({ ok: true, clipId });
    }

    case 'transitions_list': {
      const project = projectOf(context);
      const list = project.timeline.clips
        .filter((clip) => 'transitionIn' in clip && clip.transitionIn || 'transitionOut' in clip && clip.transitionOut)
        .map((clip) => ({
          clipId: clip.id,
          transitionIn: 'transitionIn' in clip ? clip.transitionIn ?? null : null,
          transitionOut: 'transitionOut' in clip ? clip.transitionOut ?? null : null,
        }));
      return JSON.stringify({ ok: true, transitions: list, count: list.length });
    }

    // ── Texto y lower thirds ──────────────────────────────────────────
    case 'text_layer_add': {
      const project = projectOf(context);
      const animation = optionalText(args, 'animation') ?? 'fade-in';
      const mappedAnimation = TEXT_ANIMATION_MAP[animation] ?? 'fade';
      const result = addMotionGraphic(project, {
        templateId: 'free-text',
        templateVersion: '1.0.0',
        props: {
          text: stringArg(args, 'text'),
          x: optionalNumber(args, 'positionX') ?? 0.1,
          y: optionalNumber(args, 'positionY') ?? 0.44,
          width: 0.8,
          size: Math.round(optionalNumber(args, 'fontSize') ?? 72),
          color: optionalText(args, 'color') ?? '#ffffff',
          weight: '700',
          align: 'center',
          animation: mappedAnimation,
        },
        durationFrames: Math.max(1, Math.round(numberArg(args, 'durationFrames'))),
        atFrame: frame(args, 'startFrame'),
        label: 'Capa de texto',
      });
      const warnings = optionalText(args, 'fontFamily')
        ? ['fontFamily no está soportado por la plantilla free-text: usa la fuente del sistema']
        : [];
      apply(context, result.project);
      return JSON.stringify({
        ok: true,
        clipId: result.clipId,
        motionId: result.motionId,
        trackId: result.trackId,
        startFrame: result.startFrame,
        animation: mappedAnimation,
        warnings,
      });
    }

    case 'text_layer_update': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const clip = clipById(project, clipId);
      if (clip.kind !== 'graphic' || clip.source.type !== 'graphic') {
        throw new Error('el clip no es una capa de texto gráfica');
      }
      const motion = project.motion.find((item) => item.id === clip.source.motionId);
      if (!motion) throw new Error('el motion item de la capa no existe');
      const props: Record<string, unknown> = { ...motion.props };
      if (args.text !== undefined) props.text = stringArg(args, 'text');
      if (args.fontSize !== undefined) props.size = Math.round(numberArg(args, 'fontSize'));
      if (args.color !== undefined) props.color = stringArg(args, 'color');
      if (args.positionX !== undefined) props.x = numberArg(args, 'positionX');
      if (args.positionY !== undefined) props.y = numberArg(args, 'positionY');
      const warnings = optionalText(args, 'fontFamily')
        ? ['fontFamily no está soportado por la plantilla free-text']
        : [];
      const next = updateMotionProps(project, motion.id, props);
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, motionId: motion.id, warnings });
    }

    case 'lower_third_add': {
      const project = projectOf(context);
      const title = stringArg(args, 'title');
      const subtitle = optionalText(args, 'subtitle') ?? '';
      const style = optionalText(args, 'style') ?? 'minimal';
      const position = optionalText(args, 'position') ?? 'lower-left';
      const side = position.endsWith('right') ? 'right' : 'left';
      const warnings = position.includes('center') || position.startsWith('upper')
        ? ['la posición vertical/centrada no está soportada: la placa queda abajo, alineada a ' + side]
        : [];
      const useMinimal = style === 'minimal';
      const result = addMotionGraphic(project, {
        templateId: useMinimal ? 'lower-third-minimal' : 'lower-third',
        templateVersion: '1.0.0',
        props: useMinimal
          ? { title, subtitle, accent: '#7dd3c0', side, animation: 'slide-left' }
          : { name: title, role: subtitle, accent: '#7dd3c0', side, animation: 'slide-left' },
        durationFrames: Math.max(30, Math.round(numberArg(args, 'durationFrames'))),
        atFrame: frame(args, 'startFrame'),
        label: `Lower third · ${title}`,
      });
      apply(context, result.project);
      return JSON.stringify({
        ok: true,
        clipId: result.clipId,
        motionId: result.motionId,
        trackId: result.trackId,
        startFrame: result.startFrame,
        style: useMinimal ? 'lower-third-minimal' : 'lower-third',
        warnings,
      });
    }

    // ── Operaciones en lote ───────────────────────────────────────────
    case 'batch_clips_select': {
      const project = projectOf(context);
      const kind = optionalText(args, 'kind');
      const trackId = optionalText(args, 'trackId');
      const tag = optionalText(args, 'tag');
      const matches = project.timeline.clips.filter((clip) => {
        if (kind && clip.kind !== kind) return false;
        if (trackId && clip.trackId !== trackId) return false;
        if (tag && !('colorTag' in clip && clip.colorTag === tag)) return false;
        return true;
      });
      return JSON.stringify({
        ok: true,
        clipIds: matches.map((clip) => clip.id),
        count: matches.length,
      });
    }

    case 'batch_effects_apply': {
      let project = projectOf(context);
      const ids = clipIdsArg(args, 'clipIds');
      const effect = stringArg(args, 'effect') as 'brightness' | 'contrast' | 'saturation' | 'temperature';
      const value = numberArg(args, 'value');
      // Rangos espejo de ClipEffectsSchema: sin esto un valor fuera de rango
      // llega hasta store.update y falla con un error genérico poco útil.
      const ranges: Record<string, [number, number]> = {
        brightness: [-1, 1], contrast: [0, 3], saturation: [0, 3], temperature: [-1, 1],
      };
      const range = ranges[effect];
      if (range && (value < range[0] || value > range[1])) {
        throw new Error(`«${effect}» admite valores entre ${range[0]} y ${range[1]} (recibido ${value})`);
      }
      const applied: string[] = [];
      const failed: { clipId: string; error: string }[] = [];
      for (const clipId of ids) {
        try {
          project = mergeEffects(project, clipId, { [effect]: value });
          applied.push(clipId);
        } catch (error) {
          failed.push({ clipId, error: error instanceof Error ? error.message : String(error) });
        }
      }
      apply(context, project);
      return JSON.stringify({ ok: failed.length === 0, applied: applied.length, failed });
    }

    case 'batch_audio_normalize': {
      let project = projectOf(context);
      const ids = clipIdsArg(args, 'clipIds');
      const manifest = effectRegistry.get('audio.leveler');
      if (!manifest) throw new Error('el efecto audio.leveler no está en el registro');
      const applied: string[] = [];
      const failed: { clipId: string; error: string }[] = [];
      for (const clipId of ids) {
        try {
          const clip = clipById(project, clipId);
          const current = visualEffectsOf(clip);
          const stack = [...(current.audioStack ?? [])];
          const idx = stack.findIndex((item) => item.effectId === 'audio.leveler');
          const instance = createInstance(manifest) as unknown as NonNullable<ClipEffects['audioStack']>[number];
          if (idx >= 0) stack[idx] = instance;
          else stack.push(instance);
          project = updateClip(project, clipId, {
            effects: { ...current, audioStack: stack } as ClipEffects,
          });
          applied.push(clipId);
        } catch (error) {
          failed.push({ clipId, error: error instanceof Error ? error.message : String(error) });
        }
      }
      apply(context, project);
      return JSON.stringify({
        ok: failed.length === 0,
        applied: applied.length,
        failed,
        note: 'se aplicó el nivelador (dynaudnorm); targetLufs es orientativo, el render normaliza por ventanas',
      });
    }

    case 'batch_transitions_add': {
      const project = projectOf(context);
      const trackId = stringArg(args, 'trackId');
      const type = stringArg(args, 'type');
      const mapped = MCP_TRANSITION_MAP[type];
      if (!mapped) throw new Error(`tipo de transición desconocido: ${type}`);
      const frames = Math.min(60, Math.max(5, Math.round(optionalNumber(args, 'durationFrames') ?? 15)));
      const result = applyTransitionToCuts(project, {
        type: mapped,
        frames,
        trackIds: [trackId],
      });
      if (result.applied === 0 && result.project === project) {
        throw new Error('no se aplicó ninguna transición (revisá que la pista tenga clips contiguos de video/imagen)');
      }
      apply(context, result.project);
      return JSON.stringify({ ok: true, applied: result.applied, skipped: result.skipped });
    }

    case 'batch_speed_change': {
      let project = projectOf(context);
      const ids = clipIdsArg(args, 'clipIds');
      const speed = numberArg(args, 'speed');
      const applied: string[] = [];
      const failed: { clipId: string; error: string }[] = [];
      for (const clipId of ids) {
        try {
          project = setClipSpeed(project, clipId, speed);
          applied.push(clipId);
        } catch (error) {
          failed.push({ clipId, error: error instanceof Error ? error.message : String(error) });
        }
      }
      apply(context, project);
      return JSON.stringify({ ok: failed.length === 0, applied: applied.length, failed });
    }

    // ── Keyframes y animación ─────────────────────────────────────────
    case 'keyframe_add': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const clip = clipById(project, clipId);
      const absolute = frame(args, 'frame');
      const local = absolute - clip.startFrame;
      if (local < 0 || local >= clip.durationFrames) {
        throw new Error(
          `el frame ${absolute} cae fuera del clip (ocupa ${clip.startFrame}–${clip.startFrame + clip.durationFrames}); ` +
          'la clave se define en frames absolutos de timeline',
        );
      }
      const property = stringArg(args, 'property');
      const easing = optionalText(args, 'easing') as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' | undefined;
      const value = numberArg(args, 'value');
      const patch =
        property === 'offsetX' ? { offsetX: value, ...(easing ? { easing } : {}) }
        : property === 'offsetY' ? { offsetY: value, ...(easing ? { easing } : {}) }
        : property === 'scale' ? { scale: value, ...(easing ? { easing } : {}) }
        : property === 'rotationDeg' ? { rotationDeg: value, ...(easing ? { easing } : {}) }
        : property === 'opacity' ? { opacity: value, ...(easing ? { easing } : {}) }
        : null;
      if (!patch) throw new Error(`propiedad de keyframe desconocida: ${property}`);
      const next = setTransformKeyframe(project, clipId, local, patch);
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, frame: absolute, localFrame: local, property });
    }

    case 'animation_preset_apply': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const clip = clipById(project, clipId);
      const preset = stringArg(args, 'preset');
      const intensity = Math.min(1, Math.max(0.1, optionalNumber(args, 'intensity') ?? 0.5));
      const motionTypes = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'] as const;
      let next: ProjectDocument;
      if ((motionTypes as readonly string[]).includes(preset) && (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze')) {
        next = updateClip(project, clipId, {
          motion: { type: preset as (typeof motionTypes)[number], intensity: intensity * 0.5 },
        });
      } else if (preset === 'fade-in-out') {
        const d = Math.min(30, Math.max(1, Math.round(clip.durationFrames * 0.15)));
        next = updateClip(project, clipId, {
          animationIn: { type: 'fade', durationFrames: d },
          animationOut: { type: 'fade', durationFrames: d },
        });
      } else if (preset === 'rotate') {
        const d = Math.min(30, Math.max(1, Math.round(clip.durationFrames * 0.2)));
        next = updateClip(project, clipId, {
          animationIn: { type: 'spin', durationFrames: d },
          animationOut: { type: 'spin', durationFrames: d },
        });
      } else {
        throw new Error(`preset de animación desconocido: ${preset}`);
      }
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, preset });
    }

    // ── Audio avanzado ────────────────────────────────────────────────
    case 'audio_effect_eq': {
      let project = projectOf(context);
      const rawIds = args.clipIds;
      const ids = Array.isArray(rawIds) && rawIds.length > 0
        ? rawIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : [stringArg(args, 'clipId')];
      const patch: Record<string, number> = {};
      const low = optionalNumber(args, 'lowDb');
      const mid = optionalNumber(args, 'midDb');
      const high = optionalNumber(args, 'highDb');
      if (low !== undefined) patch.eqLowDb = low;
      if (mid !== undefined) patch.eqMidDb = mid;
      if (high !== undefined) patch.eqHighDb = high;
      if (Object.keys(patch).length === 0) throw new Error('indicá al menos una banda (lowDb/midDb/highDb)');
      const applied: string[] = [];
      const failed: { clipId: string; error: string }[] = [];
      for (const clipId of ids) {
        try {
          project = mergeAudio(project, clipId, patch);
          applied.push(clipId);
        } catch (error) {
          failed.push({ clipId, error: error instanceof Error ? error.message : String(error) });
        }
      }
      apply(context, project);
      return JSON.stringify({ ok: failed.length === 0, applied: applied.length, failed });
    }

    case 'audio_effect_voice': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const effect = stringArg(args, 'effect');
      const allowed = ['deep', 'chipmunk', 'robot', 'echo', 'cave', 'radio'];
      if (!allowed.includes(effect)) throw new Error(`efecto de voz desconocido: ${effect}`);
      const next = mergeAudio(project, clipId, { voiceEffect: effect });
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, voiceEffect: effect });
    }

    case 'audio_ducking': {
      const project = projectOf(context);
      const musicTrackId = stringArg(args, 'musicTrackId');
      const voiceTrackId = stringArg(args, 'voiceTrackId');
      const reductionDb = optionalNumber(args, 'reductionDb') ?? -12;
      const fadeMs = optionalNumber(args, 'fadeMs');
      const next = JSON.parse(JSON.stringify(project)) as ProjectDocument;
      next.audio.ducking = {
        enabled: true,
        amountDb: Math.max(-60, Math.min(0, reductionDb)),
        sourceTrackIds: [voiceTrackId],
        targetTrackIds: [musicTrackId],
      };
      apply(context, next);
      return JSON.stringify({
        ok: true,
        ducking: next.audio.ducking,
        warnings: fadeMs !== undefined
          ? ['fadeMs no existe en el esquema de ducking: el render aplica su rampa fija']
          : [],
      });
    }

    // ── Color grading ─────────────────────────────────────────────────
    case 'color_wheels_adjust': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const patch: Partial<ClipEffects> = {};
      for (const wheel of ['lift', 'gamma', 'gain', 'offset'] as const) {
        const raw = args[wheel];
        if (raw && typeof raw === 'object') {
          const w = raw as Record<string, unknown>;
          const rgb = {
            r: typeof w.r === 'number' ? w.r : 0,
            g: typeof w.g === 'number' ? w.g : 0,
            b: typeof w.b === 'number' ? w.b : 0,
          };
          (patch as Record<string, unknown>)[wheel] = rgb;
        }
      }
      if (Object.keys(patch).length === 0) throw new Error('indicá al menos una rueda (lift/gamma/gain/offset)');
      const next = mergeEffects(project, clipId, patch);
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, applied: patch });
    }

    case 'color_preset_cinematic': {
      const project = projectOf(context);
      const clipId = stringArg(args, 'clipId');
      const preset = stringArg(args, 'preset');
      const spec = CINEMATIC_PRESETS[preset];
      if (!spec) throw new Error(`preset cinematográfico desconocido: ${preset}`);
      const intensity = Math.min(1, Math.max(0, optionalNumber(args, 'intensity') ?? 1));
      const clip = clipById(project, clipId);
      const current = visualEffectsOf(clip);
      const base: ClipEffects = { ...current };
      for (const key of GRADE_PATCH_KEYS) delete (base as Record<string, unknown>)[key];
      const patch: Partial<ClipEffects> = { ...(spec.extra ?? {}) };
      const lift = scaleWheel(spec.lift, intensity);
      const gamma = scaleWheel(spec.gamma, intensity);
      const gain = scaleWheel(spec.gain, intensity);
      if (lift) patch.lift = lift;
      if (gamma) patch.gamma = gamma;
      if (gain) patch.gain = gain;
      // Los extras numéricos se escalan por intensidad respecto a su neutro.
      for (const key of ['contrast', 'saturation', 'temperature', 'brightness', 'vignette'] as const) {
        const v = patch[key];
        if (typeof v === 'number') {
          const neutral = key === 'saturation' || key === 'contrast' ? 1 : 0;
          (patch as Record<string, number>)[key] = neutral + (v - neutral) * intensity;
        }
      }
      const next = updateClip(project, clipId, { effects: { ...base, ...patch } as ClipEffects });
      apply(context, next);
      return JSON.stringify({ ok: true, clipId, preset, intensity });
    }

    // ── Timeline avanzada ─────────────────────────────────────────────
    case 'timeline_ripple_delete': {
      let project = projectOf(context);
      const ids = clipIdsArg(args, 'clipIds');
      const deleted: string[] = [];
      const failed: { clipId: string; error: string }[] = [];
      for (const clipId of ids) {
        try {
          project = rippleDeleteClip(project, clipId);
          deleted.push(clipId);
        } catch (error) {
          failed.push({ clipId, error: error instanceof Error ? error.message : String(error) });
        }
      }
      apply(context, project);
      return JSON.stringify({ ok: failed.length === 0, deleted: deleted.length, failed });
    }

    case 'timeline_gaps_remove': {
      const project = projectOf(context);
      const trackId = stringArg(args, 'trackId');
      const result = closeGaps(project, trackId);
      apply(context, result.project);
      return JSON.stringify({ ok: true, moved: result.moved, removedFrames: result.removedFrames });
    }

    case 'caption_text_split': {
      const chunks = splitCaptionText(text(args, 'text'), optionalNumber(args, 'maxChars'));
      return JSON.stringify({ ok: true, chunks });
    }

    case 'caption_wrap': {
      const wrapped = wrapCaptionText(
        text(args, 'text'),
        optionalNumber(args, 'maxCharsPerLine'),
        optionalNumber(args, 'maxLines'),
      );
      return JSON.stringify({ ok: true, wrapped });
    }

    case 'caption_plan_cues': {
      const segments = (args.segments as Record<string, unknown>[]).map((s) => ({
        start: Number(s.start), end: Number(s.end), text: String(s.text),
        ...(Array.isArray(s.words) ? { words: s.words as never } : {}),
      }));
      const plan = planCaptionCues(segments, {
        ...(optionalNumber(args, 'maxCharsPerLine') !== undefined ? { maxCharsPerLine: optionalNumber(args, 'maxCharsPerLine') } : {}),
        ...(optionalNumber(args, 'maxLines') !== undefined ? { maxLines: optionalNumber(args, 'maxLines') } : {}),
        ...(optionalNumber(args, 'maxDurationSeconds') !== undefined ? { maxDurationSeconds: optionalNumber(args, 'maxDurationSeconds') } : {}),
        ...(optionalNumber(args, 'minDurationSeconds') !== undefined ? { minDurationSeconds: optionalNumber(args, 'minDurationSeconds') } : {}),
        ...(optionalNumber(args, 'maxCps') !== undefined ? { maxCps: optionalNumber(args, 'maxCps') } : {}),
      });
      return JSON.stringify({ ok: true, plan });
    }

    case 'narration_plan_build': {
      const segments = (args.segments as Record<string, unknown>[]).map((s) => ({
        start: Number(s.start), end: Number(s.end), text: String(s.text),
        words: (Array.isArray(s.words) ? s.words : []) as never,
      }));
      const npPause = optionalNumber(args, 'pauseSeconds');
      const npMax = optionalNumber(args, 'maxSentenceSeconds');
      const npMin = optionalNumber(args, 'minSentenceSeconds');
      const npLead = optionalNumber(args, 'leadSeconds');
      const npTail = optionalNumber(args, 'tailSeconds');
      const plan = buildNarrationPlan(segments, {
        ...(npPause !== undefined ? { pauseSeconds: npPause } : {}),
        ...(npMax !== undefined ? { maxSentenceSeconds: npMax } : {}),
        ...(npMin !== undefined ? { minSentenceSeconds: npMin } : {}),
        ...(npLead !== undefined ? { leadSeconds: npLead } : {}),
        ...(npTail !== undefined ? { tailSeconds: npTail } : {}),
      });
      return JSON.stringify({ ok: true, plan });
    }

    case 'smart_bin_list': {
      const store = typeof localStorage === 'undefined' ? null : (localStorage as unknown as SmartBinStore);
      const custom = store ? loadCustomSmartBins(store) : [];
      return JSON.stringify({ ok: true, builtins: BUILTIN_SMART_BINS, custom });
    }

    case 'assets_smart_bin_filter': {
      const project = projectOf(context);
      const kind = optionalText(args, 'kind') ?? 'all';
      const status = optionalText(args, 'status') ?? 'any';
      const rule: SmartBinRule = {
        id: 'adhoc',
        name: 'adhoc',
        kind: kind as SmartBinRule['kind'],
        status: status as SmartBinRule['status'],
        favoritesOnly: optionalBoolean(args, 'favoritesOnly') ?? false,
        tag: optionalText(args, 'tag') ?? '',
        bin: optionalText(args, 'bin') ?? '',
        query: optionalText(args, 'query') ?? '',
      };
      const matches = filterBySmartBin(project.assets, rule)
        .slice(0, 500)
        .map((a) => ({ id: a.id, label: a.label, kind: a.kind, status: a.status }));
      return JSON.stringify({ ok: true, count: matches.length, assets: matches });
    }

    case 'smart_bin_create': {
      const store = typeof localStorage === 'undefined' ? null : (localStorage as unknown as SmartBinStore);
      if (!store) throw new Error('localStorage no disponible');
      const input: Record<string, unknown> = { name: text(args, 'name') };
      for (const key of ['kind', 'status', 'tag', 'bin', 'query'] as const) {
        const v = optionalText(args, key); if (v !== undefined) input[key] = v;
      }
      const fav = optionalBoolean(args, 'favoritesOnly'); if (fav !== undefined) input.favoritesOnly = fav;
      const bin = createSmartBin(input as never);
      const bins = [...loadCustomSmartBins(store), bin];
      saveCustomSmartBins(store, bins);
      return JSON.stringify({ ok: true, bin });
    }

    case 'smart_bin_remove': {
      const store = typeof localStorage === 'undefined' ? null : (localStorage as unknown as SmartBinStore);
      if (!store) throw new Error('localStorage no disponible');
      const bins = removeCustomSmartBin(loadCustomSmartBins(store), text(args, 'id'));
      saveCustomSmartBins(store, bins);
      return JSON.stringify({ ok: true });
    }

    case 'luma_mate_candidates': {
      const project = projectOf(context);
      const clip = clipById(project, text(args, 'clipId'));
      const candidates = lumaMateCandidates(project.timeline.clips, project.timeline.tracks, clip, fpsOf(project));
      return JSON.stringify({ ok: true, candidates });
    }

    case 'luma_mate_move_track': {
      const project = projectOf(context);
      const next = moveLumaMateToOwnTrack(project, text(args, 'mateClipId'));
      if (!next) return JSON.stringify({ ok: false, error: 'mate clip no encontrado' });
      apply(context, next);
      return JSON.stringify({ ok: true });
    }

    case 'luma_mate_place_freeze': {
      const project = projectOf(context);
      const mateLabel = optionalText(args, 'label');
      const result = placeFreezeMate(project, text(args, 'frameAssetId'), {
        startFrame: frame(args, 'startFrame'),
        durationFrames: frame(args, 'durationFrames'),
        ...(mateLabel !== undefined ? { label: mateLabel } : {}),
      });
      apply(context, result.project);
      return JSON.stringify({ ok: true, mateClipId: result.mateClipId, trackId: result.trackId });
    }

    case 'adaptive_profile': {
      const project = projectOf(context);
      const profile = measureAdaptiveProfile(project);
      return JSON.stringify({ ok: true, profile, summary: adaptiveSummary(profile) });
    }

    case 'auto_edit_build': {
      const project = projectOf(context);
      const result = buildAutoEdit(project, autoEditOptions(args));
      apply(context, result.project);
      return JSON.stringify({ ok: true, plan: result.plan });
    }

    case 'auto_edit_prepare': {
      const project = projectOf(context);
      const narrations = (args.narrations as Record<string, unknown>[]).map((n) => {
        const asset = project.assets.find((a) => a.id === String(n.assetId));
        if (!asset) throw new Error(`asset de narración no encontrado: ${String(n.assetId)}`);
        return { sceneId: String(n.sceneId), asset };
      });
      const result = prepareAutoEdit(project, narrations, autoEditOptions(args), optionalBoolean(args, 'confirmVoiceRights') ?? false);
      apply(context, result.project);
      return JSON.stringify({ ok: true, plan: result.plan });
    }

    case 'autoedit_measure':
      return await autoEditMeasure(context, args);

    case 'autoedit_variants':
      return autoEditVariants(context, args);

    case 'autoedit_apply':
      return autoEditApply(context, args);

    case 'autoedit_export':
      return await autoEditExport(context, args);

    case 'autoedit_status':
      return autoEditStatus(context);

    case 'director_apply': {
      const project = projectOf(context);
      const assetId = text(args, 'assetId');
      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) throw new Error(`asset no encontrado: ${assetId}`);
      if (asset.kind !== 'video') throw new Error('director_apply necesita un asset de video');
      const platform = text(args, 'platform') as 'youtube' | 'shorts' | 'tiktok' | 'reels' | 'podcast' | 'broadcast';
      const dopt = (key: string) => optionalBoolean(args, key) ?? true;
      const options = {
        removeSilences: dopt('removeSilences'), removeRetakes: dopt('removeRetakes'),
        removeFillers: dopt('removeFillers'), removeBadFrames: dopt('removeBadFrames'),
        splitScenes: dopt('splitScenes'), enhanceAudio: dopt('enhanceAudio'),
        normalizeLoudness: dopt('normalizeLoudness'), autoCaptions: dopt('autoCaptions'),
        autoColor: dopt('autoColor'),
      };
      const analysis = await context.store.service.analyzeMedia(assetId);
      let transcript = null;
      try { transcript = await context.store.service.transcribeAsset(assetId); } catch { /* sin modelo de transcripción */ }
      const memory = await loadDirectorMemory(context.store.service);
      const profile = directorProfile(memory, platform) ?? defaultDirectorProfile(platform);
      const plan = buildDirectorPlan(project, asset as never, analysis, transcript, profile, platform, options);
      const applied = applyDirectorPlan(project, asset as never, plan);
      apply(context, applied.project);
      return JSON.stringify({
        ok: true,
        clipIds: applied.clipIds,
        captionCount: applied.captionCount,
        cuts: plan.cuts.length,
        removed: plan.removed.length,
        quality: directorQuality(plan),
      });
    }

    case 'timeline_align_clips': {
      let project = projectOf(context);
      const ids = clipIdsArg(args, 'clipIds');
      const alignTo = stringArg(args, 'alignTo') as 'start' | 'end' | 'center';
      if (!['start', 'end', 'center'].includes(alignTo)) {
        throw new Error(`alignTo desconocido: ${alignTo}`);
      }
      const reference = optionalNumber(args, 'referenceFrame') ?? (() => {
        const frames = ids.map((id) => clipById(project, id).startFrame);
        return Math.min(...frames);
      })();
      const aligned: string[] = [];
      const failed: { clipId: string; error: string }[] = [];
      for (const clipId of ids) {
        try {
          const clip = clipById(project, clipId);
          const target =
            alignTo === 'start'
              ? reference
              : alignTo === 'end'
                ? reference - clip.durationFrames
                : reference - Math.floor(clip.durationFrames / 2);
          const next = moveClip(project, clipId, Math.max(0, target));
          if (!next) throw new Error('no se pudo mover (solapamiento o pista bloqueada)');
          project = next;
          aligned.push(clipId);
        } catch (error) {
          failed.push({ clipId, error: error instanceof Error ? error.message : String(error) });
        }
      }
      apply(context, project);
      return JSON.stringify({ ok: failed.length === 0, aligned: aligned.length, referenceFrame: reference, failed });
    }

    case 'beat_detect': {
      const project = projectOf(context);
      const asset = project.assets.find((a) => a.id === text(args, 'assetId'));
      if (!asset) throw new Error('asset no encontrado');
      if (asset.source.type !== 'local') throw new Error('beat_detect necesita un asset local');
      const root = context.store.state.opened?.root ?? '';
      const url = context.store.service.mediaUrl(root, asset.source.path);
      const decoded = await decodeAudioSamples(url);
      if (!decoded) throw new Error('no se pudo decodificar el audio del asset');
      const analysis = detectBeats(decoded.samples, decoded.sampleRate);
      return JSON.stringify({
        ok: true,
        bpm: analysis.bpm,
        confidence: analysis.confidence,
        beatsSeconds: analysis.beatsSeconds.slice(0, 5000),
        beatCount: analysis.beatsSeconds.length,
      });
    }

    case 'beat_cut_track': {
      const project = projectOf(context);
      const clip = clipById(project, text(args, 'clipId'));
      const source = clip.source.type === 'asset' && 'inFrame' in clip.source ? clip.source : null;
      if (!source) throw new Error('beat_cut_track necesita un clip con fuente asset ventaneada');
      const asset = project.assets.find((a) => a.id === source.assetId);
      if (!asset || asset.source.type !== 'local') throw new Error('el asset del clip no es local');
      const root = context.store.state.opened?.root ?? '';
      const url = context.store.service.mediaUrl(root, asset.source.path);
      const decoded = await decodeAudioSamples(url);
      if (!decoded) throw new Error('no se pudo decodificar el audio');
      const analysis = detectBeats(decoded.samples, decoded.sampleRate);
      if (analysis.beatsSeconds.length === 0 || analysis.confidence < 0.4) {
        throw new Error('pulso poco claro: no se corta en beat para no inventar una grilla');
      }
      const speed = 'speed' in clip && clip.speed ? clip.speed.num / Math.max(1, clip.speed.den) : 1;
      const frames = planBeatCuts({
        beatsSeconds: analysis.beatsSeconds,
        fps: fpsOf(project),
        audioInFrame: source.inFrame,
        audioOutFrame: source.outFrame,
        audioStartFrame: clip.startFrame,
        speed,
        stride: Math.max(1, Math.round(optionalNumber(args, 'stride') ?? 1)),
        targetStartFrame: 0,
        targetEndFrame: totalFrames(project),
        ...(optionalNumber(args, 'minGapFrames') !== undefined ? { minGapFrames: Math.round(optionalNumber(args, 'minGapFrames')!) } : {}),
      });
      if (frames.length === 0) throw new Error('los pulsos no caen dentro del rango objetivo');
      const trackId = optionalText(args, 'trackId');
      const target = trackId
        ? project.timeline.tracks.find((tr) => tr.id === trackId)
        : [...project.timeline.tracks].filter((tr) => tr.kind === 'video' && !tr.locked).sort((a, b) => b.order - a.order)[0];
      if (!target) throw new Error('no hay pista de video destino');
      const next = splitTrackAtFrames(project, target.id, frames);
      if (!next) throw new Error('no se pudo cortar la pista');
      apply(context, next);
      return JSON.stringify({ ok: true, cuts: frames.length, trackId: target.id, bpm: analysis.bpm });
    }

    case 'beat_ramp_suggest': {
      const project = projectOf(context);
      const clip = clipById(project, text(args, 'clipId'));
      if (clip.kind !== 'video') throw new Error('beat_ramp_suggest necesita un clip de video');
      const source = clip.source.type === 'asset' && 'inFrame' in clip.source ? clip.source : null;
      if (!source) throw new Error('el clip no tiene ventana de origen');
      const asset = project.assets.find((a) => a.id === source.assetId);
      if (!asset || asset.source.type !== 'local') throw new Error('el asset del clip no es local');
      const root = context.store.state.opened?.root ?? '';
      const url = context.store.service.mediaUrl(root, asset.source.path);
      const decoded = await decodeAudioSamples(url);
      if (!decoded) throw new Error('no se pudo decodificar el audio');
      const analysis = detectBeats(decoded.samples, decoded.sampleRate);
      if (analysis.beatsSeconds.length === 0) return JSON.stringify({ ok: true, suggestion: null, reason: 'sin pulsos' });
      const suggestion = suggestBeatSpeedCurve(analysis.beatsSeconds, source.inFrame, source.outFrame, fpsOf(project), {
        ...(optionalNumber(args, 'slowSpeed') !== undefined ? { slowSpeed: optionalNumber(args, 'slowSpeed')! } : {}),
        ...(optionalNumber(args, 'dipSeconds') !== undefined ? { dipSeconds: optionalNumber(args, 'dipSeconds')! } : {}),
        ...(optionalNumber(args, 'minGapSeconds') !== undefined ? { minGapSeconds: optionalNumber(args, 'minGapSeconds')! } : {}),
        ...(optionalNumber(args, 'samples') !== undefined ? { samples: Math.round(optionalNumber(args, 'samples')!) } : {}),
      });
      return JSON.stringify({ ok: true, suggestion, bpm: analysis.bpm, confidence: analysis.confidence });
    }

    case 'motion_templates_list': {
      const templates = MOTION_TEMPLATES.slice(0, 500).map((tpl) => ({
        id: tpl.id,
        version: tpl.version,
        label: tpl.label,
        description: tpl.description,
        category: tpl.category,
        fields: tpl.fields.map((f) => ({ id: f.id, label: f.label, kind: f.kind, ...(f.options ? { options: f.options } : {}) })),
      }));
      return JSON.stringify({ ok: true, count: MOTION_TEMPLATES.length, templates });
    }

    case 'motion_graphic_add': {
      const project = projectOf(context);
      const templateId = text(args, 'templateId');
      const template = MOTION_TEMPLATES.find((tpl) => tpl.id === templateId);
      if (!template) throw new Error(`motion template desconocido: ${templateId} (ver motion_templates_list)`);
      const props = (args.props && typeof args.props === 'object' ? args.props : {}) as Record<string, unknown>;
      const trackIdArg = optionalText(args, 'trackId');
      const result = addMotionGraphic(project, {
        templateId: template.id,
        templateVersion: template.version,
        props,
        durationFrames: frame(args, 'durationFrames'),
        atFrame: frame(args, 'atFrame'),
        ...(trackIdArg !== undefined ? { trackId: trackIdArg } : {}),
        ...(optionalText(args, 'label') !== undefined ? { label: optionalText(args, 'label')! } : {}),
      });
      apply(context, result.project);
      return JSON.stringify({ ok: true, clipId: result.clipId, templateId: template.id });
    }

    case 'storyboard_build': {
      const project = projectOf(context);
      const ids = args.imageAssetIds as string[];
      const images = ids.map((id) => {
        const asset = project.assets.find((a) => a.id === id);
        if (!asset) throw new Error(`imagen no encontrada: ${id}`);
        if (asset.kind !== 'image') throw new Error(`el asset no es imagen: ${id}`);
        return asset;
      });
      const audioId = optionalText(args, 'audioAssetId');
      let audio = null;
      if (audioId) {
        const a = project.assets.find((x) => x.id === audioId);
        if (!a) throw new Error(`audio no encontrado: ${audioId}`);
        if (a.kind !== 'audio') throw new Error(`el asset no es audio: ${audioId}`);
        audio = a;
      }
      const photoMotion = optionalText(args, 'photoMotion');
      const result = buildStoryboard(project, {
        images,
        audio,
        ...(optionalNumber(args, 'defaultImageSeconds') !== undefined ? { defaultImageSeconds: optionalNumber(args, 'defaultImageSeconds')! } : {}),
        ...(photoMotion === 'auto' || photoMotion === 'none' ? { photoMotion } : {}),
        ...(optionalNumber(args, 'transitionFrames') !== undefined ? { transitionFrames: Math.round(optionalNumber(args, 'transitionFrames')!) } : {}),
      });
      apply(context, result.project);
      return JSON.stringify({
        ok: true,
        imageClipIds: result.imageClipIds,
        audioClipId: result.audioClipId,
        imageTrackId: result.imageTrackId,
        audioTrackId: result.audioTrackId,
      });
    }

    case 'image_traits': {
      const contents = await context.store.service.analyzeMediaFrames([text(args, 'assetId')]);
      const content = contents[0];
      if (!content) throw new Error('no se pudo analizar el asset');
      const traits = deriveTraits(content);
      const description = describeImage(content);
      const sentence = optionalText(args, 'sentence');
      const score = sentence !== undefined ? scoreImage(sentence, traits) : null;
      return JSON.stringify({ ok: true, traits, description, score });
    }

    case 'visual_plan_assignments': {
      const sentences = (args.sentences as string[]).map(String);
      const imageAssetIds = (args.imageAssetIds as string[]).map(String);
      const contents = await context.store.service.analyzeMediaFrames(imageAssetIds);
      const options: Record<string, unknown> = {};
      const openWithWide = optionalBoolean(args, 'openWithWide');
      const reusePenalty = optionalNumber(args, 'reusePenalty');
      const duplicateThreshold = optionalNumber(args, 'duplicateThreshold');
      if (openWithWide !== undefined) options.openWithWide = openWithWide;
      if (reusePenalty !== undefined) options.reusePenalty = reusePenalty;
      if (duplicateThreshold !== undefined) options.duplicateThreshold = duplicateThreshold;
      const assignments = planImageAssignments(sentences, contents, options as never);
      return JSON.stringify({ ok: true, assignments });
    }
    case 'project_quality_evaluate': {
      const findings = evaluateProjectQuality(projectOf(context));
      return JSON.stringify({ ok: true, findings });
    }

    case 'platform_rules_list': {
      const packs = BUILTIN_RULE_PACKS.map((p) => ({
        id: p.id, label: p.label, version: p.version, orientation: p.orientation,
        minHeight: p.minHeight,
        ...(p.minDurationSeconds !== undefined ? { minDurationSeconds: p.minDurationSeconds } : {}),
        ...(p.maxDurationSeconds !== undefined ? { maxDurationSeconds: p.maxDurationSeconds } : {}),
        ...(p.maxFileSizeMb !== undefined ? { maxFileSizeMb: p.maxFileSizeMb } : {}),
        requiresAiDisclosure: p.requiresAiDisclosure,
        requiresMusicLicense: p.requiresMusicLicense,
        monetization: p.monetization.length,
        strikeRisks: p.strikeRisks.length,
      }));
      return JSON.stringify({ ok: true, packs });
    }

    case 'platform_rules_audit': {
      const pack = BUILTIN_RULE_PACKS.find((p) => p.id === text(args, 'packId'));
      if (!pack) throw new Error('pack de reglas desconocido');
      const findings = auditProjectForPlatform(projectOf(context), pack);
      return JSON.stringify({ ok: true, packId: pack.id, findings });
    }

    case 'title_templates_list': {
      return JSON.stringify({ ok: true, templates: TITLE_TEMPLATES });
    }

    case 'speed_ramp_presets': {
      return JSON.stringify({ ok: true, presets: SPEED_RAMP_PRESETS });
    }

    case 'effect_presets_list': {
      return JSON.stringify({ ok: true, presets: NAMED_EFFECT_PRESETS });
    }

    case 'audio_presets_list': {
      return JSON.stringify({ ok: true, presets: AUDIO_PRESETS });
    }

    case 'safe_area_presets': {
      return JSON.stringify({ ok: true, presets: SAFE_AREA_PRESETS });
    }

    case 'clip_source_info': {
      const project = projectOf(context);
      const clip = clipById(project, text(args, 'clipId'));
      const local = optionalNumber(args, 'localFrame') ?? 0;
      const sourceFrame = clipSourceFrameAtLocal(clip, Math.round(local));
      return JSON.stringify({
        ok: true,
        clipId: clip.id,
        localFrame: Math.round(local),
        sourceFrame,
        reversed: clipIsReversed(clip),
        speed: 'speed' in clip && clip.speed ? clip.speed.num / Math.max(1, clip.speed.den) : 1,
        hasSpeedCurve: !!('speedCurve' in clip && clip.speedCurve),
      });
    }

    case 'director_memory_get': {
      const memory = await loadDirectorMemory(context.store.service);
      return JSON.stringify({ ok: true, memory });
    }

    case 'render_queue_status': {
      const store = typeof localStorage === 'undefined' ? null : (localStorage as unknown as KeyValueStore);
      const queue = store ? loadRenderQueue(store) : [];
      return JSON.stringify({ ok: true, summary: summarizeQueue(queue), queue: queue.slice(0, 200) });
    }

    case 'project_io_range_get': {
      return JSON.stringify({ ok: true, range: ioRangeFromDocument(projectOf(context)) });
    }

    case 'subtitles_export_content': {
      const project = projectOf(context);
      const format = text(args, 'format') as 'srt' | 'vtt' | 'ass';
      const cues = project.captions.cues.map((cue) => ({
        startFrame: cue.startFrame,
        endFrame: cue.endFrame,
        text: cue.text,
      }));
      const file = exportSubtitleCues(cues, fpsOf(project), format);
      return JSON.stringify({ ok: true, format: file.format, extension: file.extension, mimeType: file.mimeType, content: file.content });
    }

    case 'catalog_favorites_list': {
      return JSON.stringify({ ok: true, favorites: [...getCatalogFavorites()] });
    }

    case 'video_format_presets': {
      return JSON.stringify({ ok: true, fpsPresets: FPS_PRESETS, formatPresets: FORMAT_PRESETS });
    }

    case 'project_io_range_set': {
      const project = projectOf(context);
      const inFrame = optionalNumber(args, 'inFrame');
      const outFrame = optionalNumber(args, 'outFrame');
      let range = null;
      if (inFrame !== undefined && outFrame !== undefined) {
        if (outFrame <= inFrame) throw new Error('outFrame debe ser mayor que inFrame');
        range = { inFrame: Math.round(inFrame), outFrame: Math.round(outFrame) };
      }
      apply(context, projectWithIoRange(project, range));
      return JSON.stringify({ ok: true, range });
    }

    case 'project_title_card_apply': {
      const project = projectOf(context);
      const next = applyProjectTitleCard(project);
      if (!next) return JSON.stringify({ ok: false, error: 'no hay título ni captions para la tarjeta' });
      apply(context, next);
      return JSON.stringify({ ok: true });
    }

    case 'speed_ramp_preset_apply': {
      const project = projectOf(context);
      const preset = SPEED_RAMP_PRESETS.find((p) => p.id === text(args, 'presetId'));
      if (!preset) throw new Error('preset de rampa desconocido');
      const result = applySpeedRampPreset(project, text(args, 'clipId'), preset);
      apply(context, result.project);
      return JSON.stringify({ ok: true, clipIds: result.clipIds, velocidades: result.velocidades });
    }

    case 'effect_preset_apply': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const clip = clipById(project, clipId);
      const preset = NAMED_EFFECT_PRESETS.find((p) => p.id === text(args, 'presetId'));
      if (!preset) throw new Error('preset de efectos desconocido');
      const current = visualEffectsOf(clip);
      const next = applyEffectPreset(current, preset);
      apply(context, updateClip(project, clipId, { effects: next }));
      return JSON.stringify({ ok: true, presetId: preset.id });
    }

    case 'project_retime': {
      const project = projectOf(context);
      const num = Math.round(numberArg(args, 'num'));
      const den = Math.round(numberArg(args, 'den'));
      if (num < 1 || den < 1 || num > 240000 || den > 1001) throw new Error('frame rate fuera de rango');
      apply(context, retimeProject(project, num, den));
      return JSON.stringify({ ok: true, num, den });
    }

    case 'catalog_favorite_toggle': {
      const kind = text(args, 'kind') as CatalogFavoriteKind;
      const id = text(args, 'id');
      const next = toggleCatalogFavorite(kind, id);
      return JSON.stringify({ ok: true, favorites: [...next] });
    }

    case 'render_queue_enqueue': {
      const store = typeof localStorage === 'undefined' ? null : (localStorage as unknown as KeyValueStore);
      if (!store) throw new Error('localStorage no disponible');
      const project = projectOf(context);
      const ids = (args.profileIds as string[]).map(String);
      const profiles = project.renderProfiles.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, name: p.name }));
      if (profiles.length === 0) throw new Error('ningún profileId coincide con los perfiles del proyecto');
      const queue = loadRenderQueue(store);
      const next = enqueueProfiles(queue, profiles, optionalBoolean(args, 'includeCaptions') ?? false, { id: project.id, name: project.name });
      saveRenderQueue(store, next);
      return JSON.stringify({ ok: true, enqueued: profiles.length, summary: summarizeQueue(next) });
    }

    case 'render_queue_move': {
      const store = typeof localStorage === 'undefined' ? null : (localStorage as unknown as KeyValueStore);
      if (!store) throw new Error('localStorage no disponible');
      const project = projectOf(context);
      const id = text(args, 'id');
      const direction = text(args, 'direction');
      if (direction !== 'up' && direction !== 'down') throw new Error('direction debe ser up o down');
      const queue = loadRenderQueue(store);
      const next = movePending(queue, id, direction, renderQueueScope(project));
      if (next === queue) throw new Error('la entrada no es una pendiente movible de este proyecto');
      saveRenderQueue(store, next);
      return JSON.stringify({ ok: true, id, direction, summary: summarizeQueue(next) });
    }

    case 'render_queue_retry': {
      const store = typeof localStorage === 'undefined' ? null : (localStorage as unknown as KeyValueStore);
      if (!store) throw new Error('localStorage no disponible');
      const id = text(args, 'id');
      const queue = loadRenderQueue(store);
      const entry = queue.find((item) => item.id === id);
      if (!entry) throw new Error('la entrada no existe en la cola');
      if (entry.status === 'pending' || entry.status === 'running') {
        throw new Error(`la entrada está ${entry.status}; retry aplica a error/done/cancelled`);
      }
      const next = retryEntry(queue, id);
      saveRenderQueue(store, next);
      return JSON.stringify({ ok: true, id, summary: summarizeQueue(next) });
    }

    case 'render_queue_remove': {
      const store = typeof localStorage === 'undefined' ? null : (localStorage as unknown as KeyValueStore);
      if (!store) throw new Error('localStorage no disponible');
      const id = text(args, 'id');
      const queue = loadRenderQueue(store);
      const entry = queue.find((item) => item.id === id);
      if (!entry) throw new Error('la entrada no existe en la cola');
      if (entry.status === 'running') throw new Error('no se puede quitar una entrada en curso');
      const next = removeEntry(queue, id);
      saveRenderQueue(store, next);
      return JSON.stringify({ ok: true, id, summary: summarizeQueue(next) });
    }

    case 'render_queue_clear_settled': {
      const store = typeof localStorage === 'undefined' ? null : (localStorage as unknown as KeyValueStore);
      if (!store) throw new Error('localStorage no disponible');
      const next = clearSettled(loadRenderQueue(store));
      saveRenderQueue(store, next);
      return JSON.stringify({ ok: true, summary: summarizeQueue(next) });
    }

    case 'director_outcome_record': {
      const project = projectOf(context);
      const projectPath = context.store.state.opened?.path ?? '';
      if (!projectPath) return JSON.stringify({ ok: false, error: 'sin proyecto abierto en disco' });
      const exported = optionalBoolean(args, 'exported') ?? false;
      const memory = await recordDirectorOutcome(context.store.service, projectPath, project, exported);
      return JSON.stringify({ ok: true, recorded: memory !== null });
    }
    case 'production_plan_from_project': {
      const project = projectOf(context);
      const plan = buildProductionPlanFromProject(project, text(args, 'objective'));
      return JSON.stringify({ ok: true, plan });
    }

    case 'factory_variants_plan': {
      const project = projectOf(context);
      const fps = project.video.frameRate;
      const brief = {
        topic: text(args, 'topic'),
        variants: Math.max(1, Math.min(20, Math.round(numberArg(args, 'variants')))),
        scenes: Math.max(1, Math.min(12, Math.round(optionalNumber(args, 'scenes') ?? 6))),
        language: optionalText(args, 'language') ?? 'es',
        width: Math.max(16, Math.round(optionalNumber(args, 'width') ?? project.video.width)),
        height: Math.max(16, Math.round(optionalNumber(args, 'height') ?? project.video.height)),
        fpsNum: Math.max(1, Math.round(optionalNumber(args, 'fpsNum') ?? fps.num)),
        fpsDen: Math.max(1, Math.round(optionalNumber(args, 'fpsDen') ?? fps.den)),
      };
      return JSON.stringify({ ok: true, variants: planVariants(brief) });
    }

    case 'publication_metadata': {
      return JSON.stringify({ ok: true, metadata: buildPublicationMetadata(projectOf(context)) });
    }

    case 'publication_audit': {
      return JSON.stringify({ ok: true, audit: auditPublication(projectOf(context)) });
    }

    case 'effect_templates_list': {
      const kind = optionalText(args, 'kind');
      const kinds: ('video' | 'audio')[] = kind === 'video' || kind === 'audio' ? [kind] : ['video', 'audio'];
      const builtins = kinds.flatMap((k) => builtinEffectTemplates(k));
      const custom = loadEffectTemplates().filter((tpl) => !kind || tpl.kind === kind);
      return JSON.stringify({
        ok: true,
        builtins: builtins.map((tpl) => ({ id: tpl.id, name: tpl.name, kind: tpl.kind, stackSize: tpl.stack.length })),
        custom: custom.map((tpl) => ({ id: tpl.id, name: tpl.name, kind: tpl.kind, stackSize: tpl.stack.length, createdAt: tpl.createdAt })),
      });
    }

    case 'project_search': {
      const project = projectOf(context);
      const documents = collectSearchDocuments(project);
      const index = await createGlobalSearch(documents);
      const limit = Math.max(1, Math.min(50, Math.round(optionalNumber(args, 'limit') ?? 8)));
      const hits = await searchGlobal(index, documents, text(args, 'query'), limit);
      return JSON.stringify({
        ok: true,
        hits: hits.map((hit) => ({ ...hit, destination: destinationOfHit(hit) })),
      });
    }

    case 'caption_motion_presets': {
      return JSON.stringify({ ok: true, presets: CAPTION_MOTION_PRESETS });
    }

    case 'delivery_package_build': {
      const project = projectOf(context);
      const bundle = await buildDeliveryPackage(project);
      const dir = outputDir(context, args);
      const target = await context.store.service.joinPath(dir, bundle.fileName);
      const saved = await context.store.service.saveDeliveryPackage(bundle.bytes, bundle.fileName, target);
      if (!saved) return JSON.stringify({ ok: false, error: 'guardado cancelado' });
      return JSON.stringify({ ok: true, path: saved, fileName: bundle.fileName, bytes: bundle.bytes.length, entries: bundle.entries });
    }

    case 'subtitle_import': {
      const project = projectOf(context);
      const name = optionalText(args, 'name');
      const styleId = optionalText(args, 'styleId');
      const result = importSubtitleFile(
        project,
        { text: text(args, 'text'), ...(name ? { name } : {}) },
        styleId ? { styleId } : undefined,
      );
      apply(context, result.project);
      return JSON.stringify({ ok: true, added: result.added, skipped: result.skipped, trackId: result.trackId, warnings: result.warnings });
    }

    case 'folder_timeline_build': {
      const project = projectOf(context);
      const media = {
        images: project.assets.filter((a) => a.kind === 'image'),
        videos: project.assets.filter((a) => a.kind === 'video'),
        audio: project.assets.filter((a) => a.kind === 'audio'),
      };
      const imageFrames = optionalNumber(args, 'imageFrames');
      const fadeFrames = optionalNumber(args, 'fadeFrames');
      const result = buildFolderTimeline(project, media, {
        ...(imageFrames !== undefined ? { imageFrames: Math.round(imageFrames) } : {}),
        ...(fadeFrames !== undefined ? { fadeFrames: Math.round(fadeFrames) } : {}),
      });
      apply(context, result.project);
      return JSON.stringify({
        ok: true,
        firstClipId: result.firstClipId,
        imageCount: result.imageCount,
        videoCount: result.videoCount,
        audioCount: result.audioCount,
        startFrame: result.startFrame,
        endFrame: result.endFrame,
        warnings: result.warnings,
      });
    }

    case 'auto_cleanup_run': {
      const project = projectOf(context);
      const silenceThreshold = optionalNumber(args, 'silenceThresholdDb');
      const silenceMin = optionalNumber(args, 'silenceMinSeconds');
      const silencePad = optionalNumber(args, 'silencePaddingSeconds');
      const pauseMin = optionalNumber(args, 'pauseMinSeconds');
      const pausePad = optionalNumber(args, 'pausePaddingSeconds');
      const denoise = optionalText(args, 'denoise');
      const report = await runAutoCleanup(project, (assetId) => context.store.service.audioPeaks(assetId), {
        ...(optionalBoolean(args, 'closeGaps') !== undefined ? { closeGaps: optionalBoolean(args, 'closeGaps') } : {}),
        ...(optionalBoolean(args, 'cutSilences') !== undefined ? { cutSilences: optionalBoolean(args, 'cutSilences') } : {}),
        ...(silenceThreshold !== undefined || silenceMin !== undefined || silencePad !== undefined
          ? { silence: {
              ...(silenceThreshold !== undefined ? { thresholdDb: silenceThreshold } : {}),
              ...(silenceMin !== undefined ? { minSilenceSeconds: silenceMin } : {}),
              ...(silencePad !== undefined ? { paddingSeconds: silencePad } : {}),
            } }
          : {}),
        ...(optionalBoolean(args, 'cutPauses') !== undefined ? { cutPauses: optionalBoolean(args, 'cutPauses') } : {}),
        ...(pauseMin !== undefined || pausePad !== undefined
          ? { pause: {
              ...(pauseMin !== undefined ? { minPauseSeconds: pauseMin } : {}),
              ...(pausePad !== undefined ? { paddingSeconds: pausePad } : {}),
            } }
          : {}),
        ...(denoise === 'off' || denoise === 'light' || denoise === 'medium' || denoise === 'strong' ? { denoise } : {}),
        ...(optionalBoolean(args, 'levelAudio') !== undefined ? { levelAudio: optionalBoolean(args, 'levelAudio') } : {}),
        ...(optionalNumber(args, 'targetLufs') !== undefined ? { targetLufs: optionalNumber(args, 'targetLufs') } : {}),
        ...(optionalBoolean(args, 'zoomCuts') !== undefined ? { zoomCuts: optionalBoolean(args, 'zoomCuts') } : {}),
        ...(optionalNumber(args, 'zoomIntensity') !== undefined ? { zoomIntensity: optionalNumber(args, 'zoomIntensity') } : {}),
      });
      apply(context, report.project);
      return JSON.stringify({
        ok: true,
        gapsClosed: report.gapsClosed,
        silenceCuts: report.silenceCuts,
        pauseCuts: report.pauseCuts,
        denoised: report.denoised,
        zoomed: report.zoomed,
        leveled: report.leveled,
        removedSeconds: report.removedSeconds,
      });
    }

    case 'effect_template_apply': {
      const project = projectOf(context);
      const wanted = text(args, 'name').trim().toLowerCase();
      const kindFilter = optionalText(args, 'kind');
      const target = optionalText(args, 'target');
      const pool = [
        ...builtinEffectTemplates('video'),
        ...builtinEffectTemplates('audio'),
        ...loadEffectTemplates(),
      ].filter((tpl) => (!kindFilter || tpl.kind === kindFilter) && tpl.name.trim().toLowerCase() === wanted);
      const template = pool[0];
      if (!template) throw new Error(`plantilla de efectos no encontrada: ${text(args, 'name')}`);
      const { stack, skipped } = stackFromTemplate(template);
      if (stack.length === 0) throw new Error('la plantilla no tiene efectos compatibles con el catálogo');
      const clip = clipById(project, text(args, 'clipId'));
      const current = visualEffectsOf(clip);
      const useAudio = (target ?? template.kind) === 'audio';
      const next = useAudio
        ? { ...current, audioStack: [...stack] as ClipEffects['audioStack'] }
        : { ...current, stack: [...stack] as ClipEffects['stack'] };
      apply(context, updateClip(project, clip.id, { effects: next }));
      return JSON.stringify({ ok: true, template: template.name, kind: template.kind, applied: stack.length, skipped });
    }
    case 'color_looks_list': {
      return JSON.stringify({ ok: true, looks: COLOR_LOOKS });
    }

    case 'export_presets_list': {
      return JSON.stringify({ ok: true, presets: loadExportPresets() });
    }

    case 'export_size_estimate': {
      const project = projectOf(context);
      const fps = project.video.frameRate;
      const fpsValue = optionalNumber(args, 'fps') ?? fps.num / Math.max(1, fps.den);
      const durationSeconds = optionalNumber(args, 'durationSeconds')
        ?? (totalFrames(project) / Math.max(0.001, fpsValue));
      const bytes = estimateOutputBytes(
        {
          width: Math.round(optionalNumber(args, 'width') ?? project.video.width),
          height: Math.round(optionalNumber(args, 'height') ?? project.video.height),
          fps: fpsValue,
          audioBitsPerSecond: Math.round(optionalNumber(args, 'audioBitsPerSecond') ?? 128000),
        },
        durationSeconds,
        optionalNumber(args, 'videoBitsPerPixel'),
      );
      return JSON.stringify({ ok: true, bytes, megabytes: Number((bytes / 1048576).toFixed(2)), durationSeconds: Number(durationSeconds.toFixed(3)) });
    }

    case 'grade_presets_list': {
      return JSON.stringify({
        ok: true,
        presets: loadGradePresets().map((preset) => ({ id: preset.id, name: preset.name, createdAt: preset.createdAt, hasGrade: preset.grade !== null, hasLayer: preset.layer !== null })),
        builtinLooks: createBuiltinLooks().map((look) => ({ id: look.id, label: look.label })),
      });
    }

    case 'sfx_add': {
      const wantedId = optionalText(args, 'sfxId');
      const wantedFile = optionalText(args, 'file');
      const items = await context.store.service.sfxLibrary();
      const item = items.find((entry) =>
        (wantedId && entry.id === wantedId) || (wantedFile && entry.file === wantedFile),
      );
      if (!item) throw new Error('efecto de sonido no encontrado en la biblioteca');
      const atFrame = Math.max(0, Math.round(optionalNumber(args, 'atFrame') ?? 0));
      await addSfxToTimeline(context.store as never, item, atFrame);
      return JSON.stringify({ ok: true, sfxId: item.id, label: item.label, atFrame });
    }

    case 'color_look_apply': {
      const project = projectOf(context);
      const look = COLOR_LOOKS.find((entry) => entry.id === text(args, 'lookId'));
      if (!look) throw new Error('look de color desconocido');
      const clipId = optionalText(args, 'clipId');
      if (clipId) {
        const clip = clipById(project, clipId);
        const current = visualEffectsOf(clip);
        apply(context, updateClip(project, clipId, { effects: { ...current, ...look.effects } }));
      } else {
        const current = (project.look ?? {}) as ClipEffects;
        apply(context, setProjectLook(project, { ...current, ...look.effects }));
      }
      return JSON.stringify({ ok: true, lookId: look.id, scope: clipId ? 'clip' : 'project' });
    }

    case 'export_preset_save': {
      const compression = text(args, 'compression');
      if (!['equilibrado', 'rapido', 'compacto', 'maximo', 'custom'].includes(compression)) {
        throw new Error('compresión inválida');
      }
      const presets = saveExportPreset({
        name: text(args, 'name'),
        profileId: text(args, 'profileId'),
        compression: compression as 'equilibrado' | 'rapido' | 'compacto' | 'maximo' | 'custom',
        useGpu: optionalBoolean(args, 'useGpu') ?? false,
      });
      return JSON.stringify({ ok: true, presets: presets.map((preset) => ({ id: preset.id, name: preset.name })) });
    }

    case 'export_preset_delete': {
      const presets = deleteExportPreset(text(args, 'id'));
      return JSON.stringify({ ok: true, presets: presets.map((preset) => ({ id: preset.id, name: preset.name })) });
    }

    case 'grade_preset_save': {
      const grade = args.grade;
      if (!isValidGrade(grade)) throw new Error('grade inválido: se espera un grafo ColorGrade completo');
      const presets = saveGradePreset(text(args, 'name'), { grade });
      return JSON.stringify({ ok: true, presets: presets.map((preset) => ({ id: preset.id, name: preset.name })) });
    }

    case 'grade_preset_delete': {
      const presets = deleteGradePreset(text(args, 'id'));
      return JSON.stringify({ ok: true, presets: presets.map((preset) => ({ id: preset.id, name: preset.name })) });
    }

    case 'grade_preset_apply': {
      const project = projectOf(context);
      const wanted = text(args, 'preset');
      const preset = loadGradePresets().find(
        (entry) => entry.id === wanted || entry.name.toLowerCase() === wanted.toLowerCase(),
      );
      if (!preset) throw new Error('plantilla de gradación no encontrada');
      if (!preset.grade) throw new Error('la plantilla no tiene un grafo ColorGrade completo');
      const clip = clipById(project, text(args, 'clipId'));
      const current = visualEffectsOf(clip);
      apply(context, updateClip(project, clip.id, { effects: { ...current, colorGrade: preset.grade } }));
      return JSON.stringify({ ok: true, preset: preset.name });
    }

    case 'transcribe_project': {
      const language = optionalText(args, 'language');
      const model = optionalText(args, 'model');
      const summary = await transcribeProjectClips(context.store as never, {
        ...(language ? { language } : {}),
        ...(model ? { model } : {}),
      });
      return JSON.stringify({ ok: true, ...summary });
    }
    case 'file_url_absolute': {
      return JSON.stringify({ ok: true, url: context.store.service.absoluteFileUrl(text(args, 'path')) });
    }

    case 'audio_import_bytes': {
      const fpsNum = optionalNumber(args, 'fpsNum');
      const fpsDen = optionalNumber(args, 'fpsDen');
      const project = projectOf(context);
      const rate = project.video.frameRate;
      const outcome = await context.store.service.importMediaBytes({
        fileName: text(args, 'fileName'),
        dataBase64: text(args, 'dataBase64'),
        fpsNum: Math.max(1, Math.round(fpsNum ?? rate.num)),
        fpsDen: Math.max(1, Math.round(fpsDen ?? rate.den)),
      });
      return JSON.stringify({ ok: true, assets: outcome.assets, warnings: outcome.warnings });
    }

    case 'media_copy_into': {
      const paths = (args.paths as unknown[]).map(String);
      const copied = await context.store.service.copyMediaInto({
        paths,
        directory: text(args, 'directory'),
      });
      return JSON.stringify({ ok: true, copied });
    }

    case 'alpha_frames_write': {
      const frames = (args.frames as unknown[]).map(String);
      await context.store.service.writeAlphaFrames({
        token: text(args, 'token'),
        startIndex: Math.max(0, Math.round(numberArg(args, 'startIndex'))),
        frames,
      });
      return JSON.stringify({ ok: true, written: frames.length });
    }

    case 'alpha_frames_to_asset': {
      const asset = await context.store.service.alphaFramesToAsset({
        token: text(args, 'token'),
        label: text(args, 'label'),
        width: Math.round(numberArg(args, 'width')),
        height: Math.round(numberArg(args, 'height')),
        frameCount: Math.round(numberArg(args, 'frameCount')),
        fpsNum: Math.round(numberArg(args, 'fpsNum')),
        fpsDen: Math.round(numberArg(args, 'fpsDen')),
      });
      const project = projectOf(context);
      const next = markAssetReady(addAsset(project, asset), asset.id, 'allowed');
      apply(context, next);
      return JSON.stringify({ ok: true, assetId: asset.id, label: asset.label });
    }

    case 'alpha_frames_discard': {
      await context.store.service.discardAlphaFrames(text(args, 'token'));
      return JSON.stringify({ ok: true });
    }
    // ── Pasada 155: generación AI, ciclo de render, proveedores ──
    case 'script_generate': {
      return JSON.stringify(
        await context.store.service.generateScript({
          brief: text(args, 'brief'),
          sceneCount: Math.round(numberArg(args, 'sceneCount')),
          language: text(args, 'language'),
          approvedCost: args.approvedCost === true,
        }),
      );
    }

    case 'effect_recipe_generate': {
      const approvedCost = optionalBoolean(args, 'approvedCost');
      return JSON.stringify(
        await context.store.service.generateVideoEffect({
          prompt: text(args, 'prompt'),
          ...(approvedCost !== undefined ? { approvedCost } : {}),
        }),
      );
    }

    case 'motion_suggest': {
      return JSON.stringify(
        await context.store.service.generateMotion({
          brief: text(args, 'brief'),
          templateId: text(args, 'templateId'),
          approvedCost: args.approvedCost === true,
        }),
      );
    }

    case 'whiteboard_status':
      return JSON.stringify(await context.store.service.whiteboardStatus());

    case 'whiteboard_generate': {
      const audioPath = optionalText(args, 'audioPath');
      const durationSeconds = optionalNumber(args, 'durationSeconds');
      const quality = optionalText(args, 'quality');
      return JSON.stringify(
        await context.store.service.whiteboardGenerate({
          imagePath: text(args, 'imagePath'),
          ...(audioPath ? { audioPath } : {}),
          ...(durationSeconds !== undefined ? { durationSeconds } : {}),
          ...(quality === 'low' || quality === 'medium' || quality === 'high' ? { quality } : {}),
        }),
      );
    }

    case 'system_fonts_list':
      return JSON.stringify(await context.store.service.listSystemFonts());

    case 'hardware_encoders':
      return JSON.stringify(await context.store.service.hardwareEncoders());

    case 'download_disk_space': {
      const dir = optionalText(args, 'path');
      return JSON.stringify({
        ok: true,
        freeBytes: await context.store.service.downloadDiskSpace(dir ?? null),
      });
    }

    case 'render_active':
      return JSON.stringify({ ok: true, jobId: await context.store.service.activeRender() });

    case 'render_cancel':
      await context.store.service.cancelRender(text(args, 'jobId'));
      return JSON.stringify({ ok: true });

    case 'render_start': {
      const startFrame = optionalNumber(args, 'startFrame');
      const endFrame = optionalNumber(args, 'endFrame');
      const hasRange = startFrame !== undefined || endFrame !== undefined;
      if (hasRange && (startFrame === undefined || endFrame === undefined || endFrame <= startFrame)) {
        throw new Error('rango inválido: startFrame y endFrame (end exclusivo) son ambos obligatorios y end > start');
      }
      const motionPlans = args.motionPlans;
      const motionPlansObj =
        motionPlans && typeof motionPlans === 'object' && !Array.isArray(motionPlans)
          ? (motionPlans as Record<string, unknown>)
          : undefined;
      return JSON.stringify(
        await context.store.service.startRenderTo(
          text(args, 'profileId'),
          text(args, 'outputPath'),
          args.includeCaptions === true,
          motionPlansObj,
          optionalText(args, 'hardwareEncoder') ?? null,
          hasRange
            ? { startFrame: Math.round(startFrame ?? 0), endFrame: Math.round(endFrame ?? 0) }
            : undefined,
        ),
      );
    }

    case 'render_variant': {
      const motionPlans = args.motionPlans;
      return JSON.stringify(
        await context.store.service.renderProjectVariant({
          projectPath: text(args, 'projectPath'),
          profileId: text(args, 'profileId'),
          outputPath: text(args, 'outputPath'),
          includeCaptions: args.includeCaptions === true,
          ...(motionPlans && typeof motionPlans === 'object' && !Array.isArray(motionPlans)
            ? { motionPlans: motionPlans as Record<string, unknown> }
            : {}),
        }),
      );
    }

    case 'render_cache_prune':
      return JSON.stringify({ ok: true, pruned: await context.store.service.pruneRenderCache() });

    case 'render_queue_clear_finished':
      return JSON.stringify(await context.store.service.renderQueueClearFinished());

    case 'project_variant_write': {
      const projectArg = args.project;
      if (!projectArg || typeof projectArg !== 'object' || Array.isArray(projectArg)) {
        throw new Error('falta el parámetro «project» (objeto ProjectDocument)');
      }
      return JSON.stringify(
        await context.store.service.writeProjectVariant({
          directory: text(args, 'directory'),
          fileName: text(args, 'fileName'),
          project: projectArg,
        }),
      );
    }

    case 'media_plan_match': {
      const imageDescriptions = Array.isArray(args.imageDescriptions)
        ? args.imageDescriptions.filter((item): item is string => typeof item === 'string')
        : undefined;
      const approvedCost = optionalBoolean(args, 'approvedCost');
      return JSON.stringify(
        await context.store.service.matchMediaPlan({
          sentences: stringListArg(args, 'sentences', 200),
          images: stringListArg(args, 'images', 200),
          ...(imageDescriptions && imageDescriptions.length > 0 ? { imageDescriptions } : {}),
          ...(approvedCost !== undefined ? { approvedCost } : {}),
        }),
      );
    }

    case 'audio_provider_get':
      return JSON.stringify(await context.store.service.getAudioProvider());

    case 'audio_provider_save': {
      const apiKey = optionalText(args, 'apiKey');
      return JSON.stringify(
        await context.store.service.saveAudioProvider({
          kind: text(args, 'kind'),
          voiceId: text(args, 'voiceId'),
          modelId: text(args, 'modelId'),
          externalUrl: text(args, 'externalUrl'),
          approved: args.approved === true,
          ...(apiKey ? { apiKey } : {}),
        }),
      );
    }

    case 'audio_provider_clear_key':
      return JSON.stringify(await context.store.service.clearAudioProviderKey());

    case 'whisper_model_status':
      return JSON.stringify(await context.store.service.whisperModelStatus());

    case 'whisper_model_download':
      return JSON.stringify(await context.store.service.whisperModelDownload(text(args, 'modelId')));

    case 'whisper_model_download_cancel':
      await context.store.service.whisperModelDownloadCancel();
      return JSON.stringify({ ok: true });

    case 'mcp_server_save': {
      const envRaw = Array.isArray(args.env) ? args.env : [];
      const env = envRaw.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const rec = item as Record<string, unknown>;
        if (typeof rec.key !== 'string' || rec.key.trim().length === 0) return [];
        const key = rec.key.trim();
        return typeof rec.value === 'string'
          ? [{ key, value: rec.value }]
          : [{ key }];
      });
      const commandArgs = Array.isArray(args.args)
        ? args.args.filter((item): item is string => typeof item === 'string')
        : [];
      const id = optionalText(args, 'id');
      const workingDir = optionalText(args, 'workingDir');
      return JSON.stringify(
        await context.store.service.saveMcpServer({
          ...(id ? { id } : {}),
          name: text(args, 'name'),
          command: text(args, 'command'),
          args: commandArgs,
          env,
          ...(workingDir ? { workingDir } : {}),
          enabled: args.enabled === true,
        }),
      );
    }

    case 'mcp_session_close':
      return JSON.stringify({ ok: true, closed: await context.store.service.closeMcpSession(text(args, 'id')) });

    case 'web_session_nav': {
      const direction = text(args, 'direction');
      if (direction !== 'back' && direction !== 'forward' && direction !== 'reload') {
        throw new Error('direction debe ser back, forward o reload');
      }
      return JSON.stringify({
        ok: true,
        navigated: await context.store.service.webSessionNav(direction, optionalText(args, 'slot')),
      });
    }

    case 'web_session_eval':
      return JSON.stringify({
        ok: true,
        result: await context.store.service.webSessionEval(text(args, 'js'), optionalText(args, 'slot')),
      });

    case 'vpn_wireguard':
      return JSON.stringify(await context.store.service.vpnWireguard());

    case 'vpn_wireguard_open':
      await context.store.service.vpnWireguardOpen();
      return JSON.stringify({ ok: true });

    case 'extension_prepare':
      return JSON.stringify(await context.store.service.prepareExtension());

    case 'publication_manifest_save': {
      const manifest = args.manifest;
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('falta el parámetro «manifest» (objeto)');
      }
      return JSON.stringify({ ok: true, path: await context.store.service.savePublicationManifest(manifest) });
    }

    case 'recent_project_thumbnail':
      return JSON.stringify({ ok: true, thumbnail: await context.store.service.recentProjectThumbnail(text(args, 'path')) });

    case 'tool_choose': {
      const toolName = text(args, 'tool');
      if (toolName !== 'ffmpeg' && toolName !== 'ffprobe') {
        throw new Error('tool debe ser ffmpeg o ffprobe');
      }
      return JSON.stringify(await context.store.service.chooseTool(toolName));
    }

    case 'open_external_url':
      await context.store.service.openExternalUrl(text(args, 'url'));
      return JSON.stringify({ ok: true });

    case 'reveal_output':
      await context.store.service.revealOutput(text(args, 'path'));
      return JSON.stringify({ ok: true });

    // ── Pasada 156: recuperación, memoria del director y preferencias ──
    case 'recovery_status': {
      const offer = context.store.state.recoveryOffer;
      return JSON.stringify({
        ok: true,
        offer: offer
          ? {
              path: offer.path,
              savedAt: offer.savedAt,
              fileName: offer.path.split(/[\\/]/).pop() ?? offer.path,
            }
          : null,
      });
    }

    case 'recovery_restore': {
      const restored = await context.store.acceptRecovery();
      return JSON.stringify({ ok: restored });
    }

    case 'recovery_dismiss': {
      context.store.dismissRecovery();
      return JSON.stringify({ ok: true });
    }

    case 'director_memory_reset': {
      await saveDirectorMemory(context.store.service, emptyDirectorMemory());
      return JSON.stringify({ ok: true });
    }

    case 'preferences_export': {
      return JSON.stringify({
        ok: true,
        json: serializePreferencesBundle(buildPreferencesBundle()),
        fileName: preferencesFileName(),
      });
    }

    case 'preferences_import': {
      const result = importPreferencesFromText(text(args, 'json'));
      return JSON.stringify(
        result.ok ? { ok: true, summary: result.summary } : { ok: false, error: result.error },
      );
    }

    // ── Pasada 157: catálogo de efectos y stack por clip ──
    case 'effect_catalog_search': {
      const query = optionalText(args, 'query') ?? '';
      const kindRaw = optionalText(args, 'kind');
      const kind = kindRaw === 'video' || kindRaw === 'transition' || kindRaw === 'audio' ? kindRaw : undefined;
      const category = optionalText(args, 'category');
      const limit = Math.max(1, Math.min(200, Math.round(optionalNumber(args, 'limit') ?? 50)));
      let manifests = effectRegistry.search(query, kind);
      if (category) manifests = manifests.filter((m) => m.category === category);
      return JSON.stringify({
        ok: true,
        total: manifests.length,
        effects: manifests.slice(0, limit).map(manifestJson),
      });
    }

    case 'effect_stack_list': {
      const project = projectOf(context);
      const clip = clipById(project, text(args, 'clipId'));
      const current = visualEffectsOf(clip);
      const map = (stack: EffectStack) =>
        stack.map((item) => ({
          id: item.id,
          effectId: item.effectId,
          enabled: item.enabled,
          params: item.params,
        }));
      return JSON.stringify({
        ok: true,
        stack: map(stackOf(current, 'stack')),
        audioStack: map(stackOf(current, 'audioStack')),
      });
    }

    case 'effect_stack_add': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const manifest = effectRegistry.get(text(args, 'effectId'));
      if (!manifest) throw new Error(`efecto no encontrado en el catálogo: ${text(args, 'effectId')}`);
      if (manifest.kind === 'transition') {
        throw new Error(`«${manifest.id}» es una transición: usar transition_add`);
      }
      const targetRaw = optionalText(args, 'target');
      const owner: StackOwner =
        targetRaw === 'audio' || targetRaw === 'video'
          ? targetRaw === 'audio' ? 'audioStack' : 'stack'
          : manifest.kind === 'audio' ? 'audioStack' : 'stack';
      const paramsRaw = args.params;
      const params =
        paramsRaw && typeof paramsRaw === 'object' && !Array.isArray(paramsRaw)
          ? (paramsRaw as Record<string, unknown>)
          : undefined;
      const clip = clipById(project, clipId);
      const current = visualEffectsOf(clip);
      const stack = stackOf(current, owner);
      const instance = createInstance(manifest, params ? { params } : undefined) as unknown as EffectStack[number];
      const next = addInstance(stack, instance);
      if (next === stack || next.length === stack.length) {
        throw new Error('el stack llegó al máximo de 32 efectos');
      }
      apply(context, writeStack(project, clipId, owner, next));
      return JSON.stringify({ ok: true, instanceId: instance.id, effectId: manifest.id, owner });
    }

    case 'effect_stack_remove': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const instanceId = text(args, 'instanceId');
      const clip = clipById(project, clipId);
      const current = visualEffectsOf(clip);
      const { owner } = instanceManifest(current, instanceId);
      apply(context, writeStack(project, clipId, owner, removeInstance(stackOf(current, owner), instanceId)));
      return JSON.stringify({ ok: true, removed: instanceId, owner });
    }

    case 'effect_stack_set_enabled': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const instanceId = text(args, 'instanceId');
      const clip = clipById(project, clipId);
      const current = visualEffectsOf(clip);
      const { owner } = instanceManifest(current, instanceId);
      apply(context, writeStack(project, clipId, owner, setInstanceEnabled(stackOf(current, owner), instanceId, args.enabled === true)));
      return JSON.stringify({ ok: true, instanceId, enabled: args.enabled === true });
    }

    case 'effect_stack_set_param': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const instanceId = text(args, 'instanceId');
      const param = text(args, 'param');
      const clip = clipById(project, clipId);
      const current = visualEffectsOf(clip);
      const { owner, manifest } = instanceManifest(current, instanceId);
      if (!manifest.params.some((spec) => spec.id === param)) {
        throw new Error(`el efecto «${manifest.id}» no tiene el parámetro «${param}»`);
      }
      apply(context, writeStack(project, clipId, owner, setInstanceParam(stackOf(current, owner), manifest, instanceId, param, args.value)));
      return JSON.stringify({ ok: true, instanceId, param });
    }

    case 'effect_stack_reset': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const instanceId = text(args, 'instanceId');
      const clip = clipById(project, clipId);
      const current = visualEffectsOf(clip);
      const { owner, manifest } = instanceManifest(current, instanceId);
      apply(context, writeStack(project, clipId, owner, resetInstance(stackOf(current, owner), manifest, instanceId)));
      return JSON.stringify({ ok: true, instanceId });
    }

    case 'effect_stack_move': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const instanceId = text(args, 'instanceId');
      const clip = clipById(project, clipId);
      const current = visualEffectsOf(clip);
      const { owner } = instanceManifest(current, instanceId);
      const direction = optionalText(args, 'direction');
      const toIndex = optionalNumber(args, 'toIndex');
      const stack = stackOf(current, owner);
      const next =
        toIndex !== undefined
          ? moveInstance(stack, instanceId, Math.round(toIndex))
          : direction === 'up' || direction === 'down'
            ? shiftInstance(stack, instanceId, direction === 'up' ? -1 : 1)
            : stack;
      if (next === stack) throw new Error('no se pudo reordenar la instancia (índice inválido o ya está en el extremo)');
      apply(context, writeStack(project, clipId, owner, next));
      return JSON.stringify({ ok: true, instanceId, owner });
    }

    case 'effect_catalog_get': {
      const effectId = text(args, 'effectId');
      const manifest = effectRegistry.get(effectId);
      if (!manifest) throw new Error(`efecto «${effectId}» no encontrado en el catálogo`);
      return JSON.stringify({ ok: true, effect: manifestJson(manifest) });
    }

    case 'effect_stack_duplicate': {
      const project = projectOf(context);
      const clipId = text(args, 'clipId');
      const instanceId = text(args, 'instanceId');
      const clip = clipById(project, clipId);
      const current = visualEffectsOf(clip);
      const { owner } = instanceManifest(current, instanceId);
      const stack = stackOf(current, owner);
      const instance = stack.find((item) => item.id === instanceId);
      if (!instance) throw new Error(`la instancia «${instanceId}» no está en el stack del clip`);
      const next = duplicateInstance(stack, instanceId, newInstanceId(instance.effectId));
      if (next === stack) throw new Error('no se pudo duplicar la instancia');
      apply(context, writeStack(project, clipId, owner, next));
      const index = stack.findIndex((item) => item.id === instanceId);
      return JSON.stringify({ ok: true, instanceId: next[index + 1]?.id ?? null, owner });
    }

    // ── Pasada 158: grafos de nodos, edición por texto y Lottie ──
    case 'node_graph_list': {
      const project = projectOf(context);
      const graphs = readStoredGraphs(project).map((item) => ({
        name: item.name,
        updatedAt: item.updatedAt,
        nodes: item.graph.nodes.length,
        edges: item.graph.edges.length,
      }));
      return JSON.stringify({ ok: true, graphs });
    }

    case 'node_graph_get': {
      const project = projectOf(context);
      const name = text(args, 'name');
      const stored = readStoredGraphs(project).find((item) => item.name === name);
      if (!stored) throw new Error(`no hay un grafo guardado llamado «${name}»`);
      return JSON.stringify({ ok: true, name: stored.name, updatedAt: stored.updatedAt, graph: stored.graph });
    }

    case 'node_graph_validate': {
      const project = projectOf(context);
      const name = optionalText(args, 'name');
      const inline = args.graph;
      let graph: NodeGraph;
      if (name) {
        const stored = readStoredGraphs(project).find((item) => item.name === name);
        if (!stored) throw new Error(`no hay un grafo guardado llamado «${name}»`);
        graph = stored.graph;
      } else if (inline && typeof inline === 'object') {
        graph = graphFromJson(JSON.stringify(inline));
      } else {
        throw new Error('pasá «name» (grafo guardado) o «graph» (JSON inline)');
      }
      const problems = validateGraph(graph);
      return JSON.stringify({ ok: problems.length === 0, problems, nodes: graph.nodes.length, edges: graph.edges.length });
    }

    case 'node_graph_save': {
      const project = projectOf(context);
      const name = text(args, 'name');
      const graph = graphFromJson(JSON.stringify(args.graph));
      const named: NodeGraph = { ...graph, name };
      const problems = validateGraph(named);
      if (problems.length > 0) {
        throw new Error(`grafo inválido: ${problems.join(' · ')}`);
      }
      apply(
        context,
        upsertStoredGraph(project, {
          name,
          updatedAt: new Date().toISOString(),
          graph: named,
        }),
      );
      return JSON.stringify({ ok: true, name, nodes: named.nodes.length, edges: named.edges.length });
    }

    case 'node_graph_remove': {
      const project = projectOf(context);
      const name = text(args, 'name');
      const stored = readStoredGraphs(project);
      const rest = stored.filter((item) => item.name !== name);
      if (rest.length === stored.length) throw new Error(`no hay un grafo guardado llamado «${name}»`);
      const clone: Record<string, unknown> = { ...project };
      if (rest.length === 0) delete clone[GRAPH_DOC_KEY];
      else clone[GRAPH_DOC_KEY] = rest;
      apply(context, clone as ProjectDocument);
      return JSON.stringify({ ok: true, name });
    }

    case 'node_graph_execute': {
      const project = projectOf(context);
      const name = text(args, 'name');
      const stored = readStoredGraphs(project).find((item) => item.name === name);
      if (!stored) throw new Error(`no hay un grafo guardado llamado «${name}»`);
      const result = executeGraph(stored.graph, project);
      apply(context, result.project);
      const clipCount = result.results.reduce((sum, item) => sum + item.clipIds.length, 0);
      return JSON.stringify({
        ok: true,
        name,
        nodes: result.results.length,
        clipCount,
        renderRequested: result.renderRequested,
        results: result.results,
      });
    }

    case 'text_edit_build': {
      const project = projectOf(context);
      const assetId = text(args, 'assetId');
      const asset = project.assets.find((item) => item.id === assetId);
      if (!asset) throw new Error(`no hay un asset «${assetId}» en el proyecto`);
      const rawSegments = args.segments;
      if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
        throw new Error('«segments» debe ser un array no vacío de {start,end,text}');
      }
      const segments = rawSegments.map((item) => {
        const record = item as Record<string, unknown>;
        return {
          start: Number(record.start),
          end: Number(record.end),
          text: String(record.text ?? ''),
          words: [],
        };
      });
      const exclude = Array.isArray(args.exclude)
        ? args.exclude.map((item) => Math.max(0, Math.round(Number(item))))
        : [];
      const at = optionalNumber(args, 'atFrame');
      const built = buildTextEditProject(project, asset, segments, exclude, {
        ...(at !== undefined ? { atFrame: at } : {}),
        ...(optionalText(args, 'label') ? { label: optionalText(args, 'label')! } : {}),
      });
      apply(context, built.project);
      return JSON.stringify({
        ok: true,
        trackId: built.trackId,
        clipCount: built.clipCount,
        durationFrames: built.durationFrames,
      });
    }

    case 'lottie_import': {
      if (args.confirmRights !== true) {
        throw new Error('lottie_import requiere confirmRights=true: declarás tener derechos para usar la animación');
      }
      const project = projectOf(context);
      const inline = optionalText(args, 'json');
      const path = optionalText(args, 'path');
      if ((inline ? 1 : 0) + (path ? 1 : 0) !== 1) {
        throw new Error('pasá exactamente uno de «json» (contenido) o «path» (archivo .json)');
      }
      let rawText = inline;
      if (path) {
        const file = await context.store.service.readTextFile(path);
        if (file.truncated) {
          throw new Error('el Lottie supera el límite de lectura de archivos (512 KB): pasá el JSON completo en «json»');
        }
        rawText = file.content;
      }
      const doc = parseLottieDocument(JSON.parse(rawText ?? '{}'));
      const fpsArg = optionalNumber(args, 'fps');
      const framesArg = optionalNumber(args, 'maxFrames');
      const plan = planLottieExport(doc, {
        ...(fpsArg !== undefined ? { fps: fpsArg } : {}),
        ...(framesArg !== undefined ? { maxFrames: framesArg } : {}),
      });
      const token = `lottie-${newId()}`;
      let rasterizer: Awaited<ReturnType<typeof createLottieRasterizer>> | null = null;
      let wroteFrames = false;
      try {
        rasterizer = await createLottieRasterizer(doc, plan);
        const BATCH = 8;
        for (let start = 0; start < plan.frameCount; start += BATCH) {
          const end = Math.min(plan.frameCount, start + BATCH);
          const frames: string[] = [];
          for (let index = start; index < end; index += 1) {
            frames.push(await rasterizer.renderFrame(index));
          }
          await context.store.service.writeAlphaFrames({ token, startIndex: start, frames });
          wroteFrames = true;
        }
        const asset = await context.store.service.alphaFramesToAsset({
          token,
          label: optionalText(args, 'label') ?? 'Lottie',
          width: plan.width,
          height: plan.height,
          frameCount: plan.frameCount,
          fpsNum: plan.fpsNum,
          fpsDen: plan.fpsDen,
        });
        const next = markAssetReady(addAsset(project, asset), asset.id, 'allowed');
        apply(context, next);
        return JSON.stringify({
          ok: true,
          assetId: asset.id,
          label: asset.label,
          width: plan.width,
          height: plan.height,
          frameCount: plan.frameCount,
          fpsNum: plan.fpsNum,
          fpsDen: plan.fpsDen,
          durationSeconds: plan.durationSeconds,
          trimmed: plan.trimmed,
          layerCount: doc.layerCount,
        });
      } catch (error) {
        if (wroteFrames) {
          try {
            await context.store.service.discardAlphaFrames(token);
          } catch {
            // El token temporal queda huérfano; el backend lo limpia por TTL.
          }
        }
        throw error;
      } finally {
        rasterizer?.dispose();
      }
    }

    // ── Pasada 159: skills del AI Hub ──
    case 'ai_skills_list': {
      const category = optionalText(args, 'category');
      const customOnly = args.customOnly === true;
      const skills = listSkills().filter((skill) => {
        if (customOnly && !('custom' in skill && skill.custom)) return false;
        if (category && skill.category !== category) return false;
        return true;
      });
      return JSON.stringify({
        ok: true,
        skills: skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          summary: skill.summary,
          category: skill.category,
          target: skill.target,
          output: skill.output,
          custom: 'custom' in skill && skill.custom === true,
        })),
      });
    }

    case 'ai_skill_compose': {
      const skillId = text(args, 'skillId');
      const skill = aiSkill(skillId);
      if (!skill) throw new Error(`no hay una skill «${skillId}» (probá ai_skills_list)`);
      const composed = composeSkillPrompt(skill, text(args, 'brief'));
      return JSON.stringify({
        ok: true,
        skillId: skill.id,
        prompt: composed.prompt,
        characters: composed.characters,
        estimatedTokens: composed.estimatedTokens,
        tooLong: composed.tooLong,
      });
    }

    case 'custom_skill_save': {
      const name = text(args, 'name');
      const summary = text(args, 'summary');
      const category = text(args, 'category');
      if (!['guion', 'crecimiento', 'produccion', 'localizacion', 'motion'].includes(category)) {
        throw new Error('«category» inválida');
      }
      const target = text(args, 'target');
      const output = text(args, 'output');
      const prompt = text(args, 'prompt');
      if (!NAV_VIEWS.some((view) => view.id === target)) {
        throw new Error(`«target» debe ser una vista válida (${NAV_VIEWS.map((v) => v.id).join(', ')})`);
      }
      const slug =
        name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'skill';
      const id = optionalText(args, 'id') ?? slug;
      const skill = {
        id,
        name: name.slice(0, 200),
        summary: summary.slice(0, 4000),
        category: category as 'guion' | 'crecimiento' | 'produccion' | 'localizacion' | 'motion',
        target: target as ViewId,
        output: output.slice(0, 200),
        prompt: prompt.slice(0, 4000),
        custom: true as const,
        createdAt: new Date().toISOString(),
      };
      const skills = saveCustomSkill(skill);
      return JSON.stringify({ ok: true, id, total: skills.length });
    }

    case 'custom_skill_delete': {
      const id = text(args, 'id');
      const existed = loadCustomSkills().some((skill) => skill.id === id);
      if (!existed) throw new Error(`no hay una skill personalizada «${id}»`);
      const skills = deleteCustomSkill(id);
      return JSON.stringify({ ok: true, id, total: skills.length });
    }

    case 'mcp_tool_schema': {
      const name = text(args, 'name');
      const tool = MCP_TOOLS.find((entry) => entry.name === name);
      if (!tool) throw new Error(`no hay una herramienta «${name}» en el catálogo`);
      return JSON.stringify({
        ok: true,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations ?? null,
      });
    }

    default:
      throw new Error(`herramienta desconocida: ${tool}`);
  }
}
