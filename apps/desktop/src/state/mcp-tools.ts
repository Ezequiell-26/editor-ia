import type { ProjectDocument } from '@editor-ia/project-schema';
import type { DesktopService } from '../services/project-service';
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
import { addMarker, deleteMarker } from './markers';
import { addAsset, removeAsset } from './project-actions';
import { applyReviewItems, buildReviewItems } from './review-queue';
import { createOrchestratorJob, runOrchestratorJob } from './orchestrator';
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
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Args;
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
          mediaIds: [],
          voiceProvider: 'windows-sapi',
          photoMotion: 'auto',
          transitionFrames: 12,
          includeCaptions: true,
          renderVideo: args.render !== false,
          generateMedia: false,
          flowKind: 'image',
          flowModel: '',
          flowRatio: '',
          flowDuration: '',
          approveCredits: false,
          confirmRights: true,
        },
      });
      const done = await runOrchestratorJob(job, {
        service: context.store.service,
        baseProject: project,
        onUpdate: () => {},
      });
      return JSON.stringify({
        ok: done.status === 'done',
        status: done.status,
        projectPath: done.projectPath ?? null,
        videoPath: done.videoPath ?? null,
        error: done.error ?? null,
        warnings: done.result?.warnings ?? [],
      });
    }

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

    case '__catalog':
      return JSON.stringify(MCP_TOOLS);

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
