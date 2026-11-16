import { createEmptyProject, type ClipEffects, type ClipTransition, type ProjectDocument } from '@editor-ia/project-schema';
import { effectRegistry, createInstance } from '@editor-ia/effect-kit';
import type { ConversionTarget, DesktopService } from '../services/project-service';
import type { useProjectStore } from './project-store';
import { runAutoCleanup } from './auto-cleanup';
import { runAutoPilot } from './auto-pilot';
import { runSilenceCuts } from './silence-cuts';
import { applySpeechCuts, cuesForClip, planSpeechCutsFromCues } from './speech-cuts';
import {
  addCaptionCue,
  addClipFromAsset,
  addMotionGraphic,
  addTrack,
  applyTransitionToCuts,
  closeGaps,
  deleteCaptionCue,
  deleteClip,
  deleteTrack,
  fpsOf,
  moveClip,
  rippleDeleteClip,
  setClipSpeed,
  setTransformKeyframe,
  splitClip,
  updateAudioMix,
  updateCaptionCue,
  updateClip,
  updateMotionProps,
  updateTrack,
} from './project-actions';
import { applySpeakerSegments } from './speakers';
import { applyCriticFixes, critiqueTimeline } from './timeline-critic';
import { MCP_TOOLS } from './mcp-catalog';
import { validateMcpToolArguments } from './mcp-validation';
import { addMarker, deleteMarker } from './markers';
import { addAsset, removeAsset } from './project-actions';
import { applyReviewItems, buildReviewItems } from './review-queue';
import { createOrchestratorJob } from './orchestrator';
import { FACTORY_JOB_MANAGER } from './mcp-orchestrator-jobs';
import { autoCutByActivity, buildMulticamProject, envelopeFromPeaks } from './multicam';
import { updateCaptionStyle } from './project-actions';

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
      if (assets.length < 2) throw new Error('necesito al menos dos medios de video');
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
        const windowTitle = optionalText(args, 'windowTitle');
        const captureTargetRaw = optionalText(args, 'captureTarget');
        const captureTarget =
          captureTargetRaw === 'desktop' || captureTargetRaw === 'window' || captureTargetRaw === 'region'
            ? captureTargetRaw
            : undefined;
        const captureScreen = typeof args.captureScreen === 'boolean' ? args.captureScreen : undefined;
        const num = (key: string) => optionalNumber(args, key);
        const result = await context.store.service.screenRecordStart({
          outputDir,
          ...(fps !== undefined ? { fps } : {}),
          ...(webcamDevice ? { webcamDevice } : {}),
          ...(audioDevice ? { audioDevice } : {}),
          ...(streamUrl ? { streamUrl } : {}),
          ...(encoder ? { encoder } : {}),
          ...(windowTitle ? { windowTitle } : {}),
          ...(captureTarget ? { captureTarget } : {}),
          ...(num('regionX') !== undefined ? { regionX: num('regionX')! } : {}),
          ...(num('regionY') !== undefined ? { regionY: num('regionY')! } : {}),
          ...(num('regionWidth') !== undefined ? { regionWidth: num('regionWidth')! } : {}),
          ...(num('regionHeight') !== undefined ? { regionHeight: num('regionHeight')! } : {}),
          ...(captureScreen !== undefined ? { captureScreen } : {}),
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
      throw new Error('«action» debe ser start, stop, status o devices');
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
      throw new Error('«action» debe ser list, save, delete, start o preview');
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
                ...(kind === 'confetti' || kind === 'snow' || kind === 'sparks' || kind === 'bounce'
                  ? { kind }
                  : {}),
                ...(typeof p.count === 'number' ? { count: p.count } : {}),
                ...(typeof p.colorHex === 'string' ? { colorHex: p.colorHex } : {}),
                ...(typeof p.gravity === 'number' ? { gravity: p.gravity } : {}),
                ...(typeof p.bounce === 'number' ? { bounce: p.bounce } : {}),
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
        const project = createEmptyProject(name);
        project.video = {
          ...project.video,
          width,
          height,
          frameRate: { num: fps, den: 1 },
        };
        const stem =
          name
            .trim()
            .toLowerCase()
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
      const result =
        format === 'edl'
          ? await context.store.service.exportEdl(request)
          : format === 'otio'
            ? await context.store.service.exportOtio(request)
            : format === 'fcpxml'
              ? await context.store.service.exportFcpxml(request)
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

    default:
      throw new Error(`herramienta desconocida: ${tool}`);
  }
}
