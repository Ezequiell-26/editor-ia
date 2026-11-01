/**
 * Host compartido de las herramientas del agente. Lo usan el chat de Olyvia y
 * el puente MCP en vivo para que ambos ejecuten exactamente las mismas
 * operaciones sobre el proyecto abierto, sin duplicar lógica.
 */
import type { RenderFinishedEvent, RenderProgressEvent } from '../../services/project-service';
import type { CanvasVideoResult } from '../video/encode-canvas';
import { addAsset } from '../../state/project-actions';
import type { ProjectStoreValue } from '../../state/project-store';
import { buildProjectMotionPlans } from '../motion/plan';
import type { AssistantToolHost } from './assistant-tools';
import { renderOutputFileName, segmentOutputFileName } from './render-output';
import { chunkOutputName, fileNameOf, planSceneChunks } from './scene-chunks';
import { previewPerfSnapshot } from '../perf/preview-perf';
import { renderQueueApi } from './render-queue-bridge';

export interface AssistantHostEvents {
  readonly progress: () => RenderProgressEvent | null;
  readonly finished: () => RenderFinishedEvent | null;
}

export interface AssistantHostContext {
  readonly store: ProjectStoreValue;
  readonly view: () => string;
  readonly navigate: (view: string) => void;
  readonly enterEditor?: () => void;
  readonly renderEvents?: AssistantHostEvents;
}

async function importBakedVideo(
  store: ProjectStoreValue,
  video: CanvasVideoResult,
  provider: string,
) {
  const project = store.state.project;
  if (!project) return null;
  const path = await store.service.stageDesignMedia(video.base64, 'mp4');
  const outcome = await store.service.importMediaPaths({
    paths: [path],
    fpsNum: project.video.frameRate.num,
    fpsDen: project.video.frameRate.den,
    confirmRights: true,
    provider,
  });
  const imported = outcome.assets[0];
  if (!imported) return null;
  const ok = store.mutate((current) => ({
    project: addAsset(current, imported),
  }));
  if (!ok) return null;
  return {
    assetId: imported.id,
    label: imported.label,
    bytes: Math.round((video.base64.length * 3) / 4),
    durationSeconds: video.durationSeconds,
  };
}

export function createAssistantToolHost(context: AssistantHostContext): AssistantToolHost {
  const { store } = context;
  return {
    project: () => store.state.project,
    playheadFrame: () => store.state.playheadFrame,
    selection: () => store.state.selection,
    view: () => context.view(),
    navigate: (view) => {
      context.navigate(view);
    },
    setPlaying: (playing) => store.setPlaying(playing),
    undo: () => store.undo(),
    redo: () => store.redo(),
    save: async () => {
      await store.saveNow();
    },
    requestExport: () => {
      if (context.view() !== 'editor') context.navigate('editor');
      store.requestExport();
    },
    mutate: (update) => Boolean(store.mutate((current) => ({ project: update(current) }))),
    selectClip: (clipId) => store.setSelection({ kind: 'clip', id: clipId }),
    openProjectAt: async (path) => {
      const opened = await store.openProjectAt(path);
      if (opened) {
        if (context.enterEditor) context.enterEditor();
        else context.navigate('editor');
      }
      return opened;
    },
    importAssetPath: async (path) => {
      const project = store.state.project;
      if (!project) return null;
      const outcome = await store.service.importMediaPaths({
        paths: [path],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'olyvia-agent',
      });
      if (outcome.assets.length === 0) return null;
      const ok = store.mutate((current) => ({
        project: outcome.assets.reduce((next, asset) => addAsset(next, asset), current),
      }));
      if (!ok) return null;
      return outcome.assets.map((asset) => ({ id: asset.id, label: asset.label }));
    },
    fsRoots: () => store.service.fsRoots(),
    fsList: (path, limit, includeHidden) => store.service.fsList(path, limit, includeHidden),
    fsSearch: (root, query, maxDepth) => store.service.fsSearch(root, query, maxDepth),
    fsFindMedia: (kind, root, query, limit) =>
      store.service.fsFindMedia(kind, root, query, limit),
    fsReadText: (path) => store.service.fsReadText(path),
    importAssets: async (paths) => {
      const project = store.state.project;
      if (!project || paths.length === 0) return null;
      const outcome = await store.service.importMediaPaths({
        paths: [...paths],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'olyvia-agent',
      });
      return outcome.assets.length > 0 ? outcome.assets : null;
    },
    analyzeAsset: (assetId) => store.service.analyzeMedia(assetId),
    renderRigClip: async ({ clip, paletteId, seconds, target }) => {
      const { renderRigToVideo } = await import('../rig/bake');
      const video = await renderRigToVideo({
        clip,
        ...(paletteId ? { paletteId } : {}),
        width: 1280,
        height: 720,
        fps: 24,
        durationSeconds: seconds ?? 2,
        ...(target ? { target } : {}),
      });
      try {
        return await importBakedVideo(store, video, 'olyvia-rig');
      } finally {
        URL.revokeObjectURL(video.url);
      }
    },
    perfStats: () => previewPerfSnapshot(),
    synthesizeNarration: async (text, voice) => {
      const project = store.state.project;
      if (!project) return null;
      const result = await store.service.synthesizeNarration({
        text,
        ...(voice ? { voice } : {}),
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        provider: 'windows-sapi',
      });
      return result.asset;
    },
    renderThreeScene: async ({ preset, seconds, modelPath, animation, text, textDepth }) => {
      const { renderScene3DToVideo } = await import('../three/bake');
      const modelUrl = modelPath ? store.service.absoluteFileUrl(modelPath) : '';
      if (modelPath && !modelUrl) {
        throw new Error('el modelo 3D necesita una ruta local absoluta');
      }
      const video = await renderScene3DToVideo({
        preset: preset as Parameters<typeof renderScene3DToVideo>[0]['preset'],
        width: 1280,
        height: 720,
        fps: 24,
        durationSeconds: seconds ?? 4,
        ...(modelUrl ? { modelUrl } : {}),
        ...(animation ? { animation } : {}),
        ...(text ? { text } : {}),
        ...(textDepth && textDepth > 0 ? { textDepth } : {}),
      });
      try {
        const imported = await importBakedVideo(store, video, 'olyvia-three');
        if (!imported) return imported;
        return {
          ...imported,
          ...(video.animation ? { animation: video.animation } : {}),
          ...(video.animations.length > 0 ? { animations: video.animations } : {}),
        };
      } finally {
        URL.revokeObjectURL(video.url);
      }
    },
    renderSceneSegmentChunked: async ({ sceneId, includeCaptions }) => {
      const project = store.state.project;
      const opened = store.state.opened;
      if (!project || !opened) return null;
      const scene = project.scenes.find((item) => item.id === sceneId);
      if (!scene) return null;
      const clips = scene.clipIds
        .map((id) => project.timeline.clips.find((clip) => clip.id === id))
        .filter((clip): clip is NonNullable<typeof clip> => Boolean(clip));
      if (clips.length === 0) return null;
      const startFrame = Math.min(...clips.map((clip) => clip.startFrame));
      const endFrame = Math.max(...clips.map((clip) => clip.startFrame + clip.durationFrames));
      if (endFrame <= startFrame) return null;
      const profileId = project.renderProfiles[0]?.id;
      if (!profileId) return null;
      const outputPath = store.service.joinPath(
        opened.root,
        segmentOutputFileName(project.name, scene.id, project.revision),
      );
      const finalInfo = await store.service.fileInfo(outputPath);
      if (finalInfo.exists && finalInfo.bytes > 0) {
        return {
          sceneId: scene.id,
          skipped: true,
          outputPath,
          bytes: finalInfo.bytes,
          startFrame,
          endFrame,
        };
      }
      const fps = project.video.frameRate.num / project.video.frameRate.den;
      const chunkFrames = Math.max(60, Math.round((fps > 0 ? fps : 30) * 10));
      const hasTransitions = clips.some(
        (clip) =>
          ('transitionIn' in clip && Boolean(clip.transitionIn)) ||
          ('transitionOut' in clip && Boolean(clip.transitionOut)),
      );
      const hasGraphics = clips.some((clip) => clip.kind === 'graphic');
      const canChunk =
        !includeCaptions &&
        !hasTransitions &&
        !hasGraphics &&
        endFrame - startFrame > chunkFrames * 1.5;
      if (!canChunk) {
        const started = await store.service.startRenderTo(
          profileId,
          outputPath,
          includeCaptions,
          undefined,
          undefined,
          { startFrame, endFrame },
        );
        if (!started) return null;
        return {
          sceneId: scene.id,
          skipped: false,
          outputPath,
          bytes: 0,
          startFrame,
          endFrame,
          jobId: started.jobId,
          profileName: started.profileName,
        };
      }
      const finalName = fileNameOf(outputPath) || 'segmento.mp4';
      const chunkPaths: string[] = [];
      for (const chunk of planSceneChunks(startFrame, endFrame, chunkFrames)) {
        const chunkPath = store.service.joinPath(
          opened.root,
          chunkOutputName(finalName, chunk.index),
        );
        chunkPaths.push(chunkPath);
        const existing = await store.service.fileInfo(chunkPath);
        if (existing.exists && existing.bytes > 0) continue;
        const started = await store.service.startRenderTo(
          profileId,
          chunkPath,
          false,
          undefined,
          undefined,
          { startFrame: chunk.startFrame, endFrame: chunk.endFrame },
        );
        if (!started) return null;
        let idle = 0;
        let ready = false;
        for (let attempt = 0; attempt < 600; attempt += 1) {
          const active = await store.service.activeRender();
          if (!active) {
            const info = await store.service.fileInfo(chunkPath);
            if (info.exists && info.bytes > 0) {
              ready = true;
              break;
            }
            idle += 1;
            if (idle >= 3) break;
          } else {
            idle = 0;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
        if (!ready) return null;
      }
      const concatenated = await store.service.concatVideos(chunkPaths, outputPath);
      if (!concatenated) return null;
      return {
        sceneId: scene.id,
        skipped: false,
        outputPath,
        bytes: concatenated.bytes,
        startFrame,
        endFrame,
      };
    },
    renderSceneSegment: async ({ sceneId, includeCaptions }) => {
      const project = store.state.project;
      const opened = store.state.opened;
      if (!project || !opened) return null;
      const scene = project.scenes.find((item) => item.id === sceneId);
      if (!scene) return null;
      const clips = scene.clipIds
        .map((id) => project.timeline.clips.find((clip) => clip.id === id))
        .filter((clip): clip is NonNullable<typeof clip> => Boolean(clip));
      if (clips.length === 0) return null;
      const startFrame = Math.min(...clips.map((clip) => clip.startFrame));
      const endFrame = Math.max(...clips.map((clip) => clip.startFrame + clip.durationFrames));
      if (endFrame <= startFrame) return null;
      const profileId = project.renderProfiles[0]?.id;
      if (!profileId) return null;
      const outputPath = store.service.joinPath(
        opened.root,
        segmentOutputFileName(project.name, scene.id, project.revision),
      );
      const info = await store.service.fileInfo(outputPath);
      if (info.exists && info.bytes > 0) {
        return {
          sceneId: scene.id,
          skipped: true,
          outputPath,
          bytes: info.bytes,
          startFrame,
          endFrame,
        };
      }
      const hasGraphics = project.timeline.clips.some((clip) => clip.kind === 'graphic');
      const motionPlans = hasGraphics ? buildProjectMotionPlans(project).plans : undefined;
      const started = await store.service.startRenderTo(
        profileId,
        outputPath,
        includeCaptions,
        motionPlans,
        undefined,
        { startFrame, endFrame },
      );
      if (!started) return null;
      return {
        sceneId: scene.id,
        skipped: false,
        outputPath,
        bytes: 0,
        startFrame,
        endFrame,
        jobId: started.jobId,
        profileName: started.profileName,
      };
    },
    concatVideos: async (paths) => {
      const project = store.state.project;
      const opened = store.state.opened;
      if (!project || !opened || paths.length === 0) return null;
      const outputPath = store.service.joinPath(
        opened.root,
        renderOutputFileName(`${project.name} final`, null),
      );
      const result = await store.service.concatVideos(paths, outputPath);
      return result;
    },
    trackPoint: (request) => store.service.trackPoint(request),
    trackObject: (request) => store.service.trackObject(request),
    startRender: (profileId, includeCaptions) => {
      const project = store.state.project;
      const opened = store.state.opened;
      if (!project || !opened) return Promise.resolve(null);
      const resolvedProfile = profileId ?? project.renderProfiles[0]?.id ?? null;
      if (!resolvedProfile) return Promise.resolve(null);
      const output = store.service.joinPath(
        opened.root,
        renderOutputFileName(project.name, resolvedProfile, new Date()),
      );
      const hasGraphics = project.timeline.clips.some((clip) => clip.kind === 'graphic');
      const motionPlans = hasGraphics ? buildProjectMotionPlans(project).plans : undefined;
      return store.service.startRenderTo(
        resolvedProfile,
        output,
        includeCaptions,
        motionPlans,
      );
    },
    renderQueueAdd: async ({ sceneIds, includeCaptions, concat }) => {
      const api = renderQueueApi();
      if (!api) throw new Error('la cola de render todavía no está montada');
      return api.add({
        sceneIds,
        includeCaptions,
        ...(concat === true ? { concat: true } : {}),
      });
    },
    renderQueueStatus: () => {
      const api = renderQueueApi();
      if (!api) throw new Error('la cola de render todavía no está montada');
      return api.status();
    },
    renderQueueControl: (action, id) => {
      const api = renderQueueApi();
      if (!api) throw new Error('la cola de render todavía no está montada');
      return api.control(action, id);
    },
    cancelRender: (jobId) => store.service.cancelRender(jobId),
    activeRender: () => store.service.activeRender(),
    lastRenderEvent: () => {
      const progress = context.renderEvents?.progress() ?? null;
      const finished = context.renderEvents?.finished() ?? null;
      return {
        ...(progress ? { progress } : {}),
        ...(finished ? { finished } : {}),
      };
    },
  };
}
