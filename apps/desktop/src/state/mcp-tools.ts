import type { ProjectDocument } from '@editor-ia/project-schema';
import type { ConversionTarget, DesktopService } from '../services/project-service';
import type { useProjectStore } from './project-store';
import { runAutoCleanup } from './auto-cleanup';
import { runAutoPilot } from './auto-pilot';
import { runSilenceCuts } from './silence-cuts';
import { applySpeechCuts, cuesForClip, planSpeechCutsFromCues } from './speech-cuts';
import {
  addCaptionCue,
  addClipFromAsset,
  addTrack,
  deleteCaptionCue,
  deleteClip,
  deleteTrack,
  fpsOf,
  moveClip,
  setClipSpeed,
  splitClip,
  updateAudioMix,
  updateCaptionCue,
  updateClip,
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
import { autoCutByActivity, buildMulticamProject, envelopeFromPeaks } from '../features/multicam/multicam';
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
      const written = await context.store.service.writeTextFile(
        text(args, 'path'),
        text(args, 'content'),
      );
      return JSON.stringify({ ok: true, ...written });
    }

    case 'fs_mkdir': {
      const created = await context.store.service.makeDirectory(
        text(args, 'path'),
        optionalBoolean(args, 'recursive'),
      );
      return JSON.stringify({ ok: true, ...created });
    }

    case 'fs_delete': {
      const removed = await context.store.service.deletePath(
        text(args, 'path'),
        optionalBoolean(args, 'recursive'),
      );
      return JSON.stringify({ ok: true, ...removed });
    }

    case 'fs_move': {
      const moved = await context.store.service.movePath(
        text(args, 'from'),
        text(args, 'to'),
      );
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

    case 'package_project':
      return JSON.stringify({ ok: await context.store.packageProject() });

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
      });
    }

    case 'project_new': {
      const fps = Math.max(1, Math.round(optionalNumber(args, 'fps') ?? 30));
      const created = await context.store.createProject({
        name: text(args, 'name'),
        width: Math.max(2, Math.round(optionalNumber(args, 'width') ?? 1920)),
        height: Math.max(2, Math.round(optionalNumber(args, 'height') ?? 1080)),
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
      const root = context.store.state.opened?.root;
      if (!asset || !root) throw new Error('el proyecto no está guardado en disco');
      const path = `${root.replace(/[\\/]+$/, '')}\\${asset.source.path.replace(/^[\\/]+/, '')}`;
      const result = await context.store.service.diarizeAudio(path, optionalText(args, 'language'));
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
      const next = moveClip(project, clipId, startFrame, trackId);
      if (!next) throw new Error('el clip no existe');
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

    default:
      throw new Error(`herramienta desconocida: ${tool}`);
  }
}
