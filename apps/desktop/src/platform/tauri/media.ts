import type { DesktopService } from "../../services/contracts";
import type { NativeCall } from './shared';
import * as shared from './shared';
import type { BackgroundProgress, BackgroundRemoval, BatchConversionItem, BestThumbnailFrame, CapabilityInfo, CompressProgress, ConversionResult, ConvertProgress, DenoiseProgress, DenoiseResult, EdlResult, ExtractedSubtitles, FcpxmlResult, LookLutResult, LosslessResult, MediaAnalysis, MediaProbe, ModelInfo, OtioResult, PreviewFrameResult, ProxyCleanupResult, ProxyProgressEvent, ProxyStatus, SceneDetection, ScopeFrameResult, SharpenProgress, SharpenResult, StabilizationAnalysis, ThumbnailExportResult, TimelineImportResult, ToolResult, UpscaleProgress, UpscaleResult, UpscaleVideoResult, VisualAudit, VisualCatalog } from "../../services/contracts";
import { listen } from "@tauri-apps/api/event";

export function createMediaService(call: NativeCall): Pick<DesktopService, 'analyzeImages' | 'analyzeMediaFrames' | 'importLut' | 'chooseImageFile' | 'chooseVideoFile' | 'chooseAudioFile' | 'probeMediaFile' | 'compressAnyFile' | 'onCompressProgress' | 'measureVmaf' | 'listModels' | 'downloadModel' | 'deleteModel' | 'listCapabilities' | 'listVisualCatalog' | 'auditVisuals' | 'removeBackground' | 'removeBackgroundAsset' | 'onBackgroundProgress' | 'writeAlphaFrames' | 'alphaFramesToAsset' | 'discardAlphaFrames' | 'upscaleImage' | 'upscaleVideo' | 'onUpscaleProgress' | 'denoiseMedia' | 'onDenoiseProgress' | 'sharpenMedia' | 'onSharpenProgress' | 'saveThumbnail' | 'pickThumbnailFrames' | 'renderPreviewFrame' | 'analyzeScopesFrame' | 'exportLookLut' | 'exportEdl' | 'exportOtio' | 'exportFcpxml' | 'importTimeline' | 'chooseSubtitleFile' | 'chooseTimelineFile' | 'extractFreezeFrame' | 'createVideoProxy' | 'proxyStatus' | 'ensureProxy' | 'cancelProxy' | 'applyProxyToAsset' | 'cleanupProxies' | 'onProxyProgress' | 'sampleAssetColor' | 'mediaThumbnail' | 'detectScenes' | 'analyzeStabilization' | 'analyzeMedia' | 'convertMedia' | 'convertMediaBatch' | 'compressMedia' | 'mergeVideos' | 'trimVideo' | 'watermarkVideo' | 'setMetadata' | 'extractSubtitles' | 'remux' | 'writeChapters' | 'extractAudio' | 'onConvertProgress'> {
  return {
    async analyzeImages(assetIds) {
      if (assetIds.length === 0) return [];
      const raw = await call(shared.PROJECT_COMMANDS.analyzeImages, {
        assetIds: [...assetIds],
      });
      return shared.mapImageContents(raw);
    },
    async analyzeMediaFrames(assetIds) {
      if (assetIds.length === 0) return [];
      const raw = await call(shared.PROJECT_COMMANDS.analyzeMediaFrames, {
        assetIds: [...assetIds],
      });
      return shared.mapImageContents(raw);
    },
    async importLut() {
      const raw = await call(shared.PROJECT_COMMANDS.importLut);
      if (!raw || typeof raw !== 'object') return null;
      const record = raw as { path?: unknown; name?: unknown };
      if (typeof record.path !== 'string' || !record.path) return null;
      return {
        path: record.path,
        name: typeof record.name === 'string' ? record.name : 'LUT',
      };
    },
    async chooseImageFile(title) {
      const raw = await call(shared.PROJECT_COMMANDS.chooseImageFile, {
        title: title ?? null,
      });
      return typeof raw === 'string' && raw ? raw : null;
    },
    async chooseVideoFile(title) {
      const raw = await call(shared.PROJECT_COMMANDS.chooseVideoFile, { title: title ?? null });
      return typeof raw === 'string' && raw ? raw : null;
    },
    async chooseAudioFile(title) {
      const raw = await call(shared.PROJECT_COMMANDS.chooseAudioFile, { title: title ?? null });
      return typeof raw === 'string' && raw ? raw : null;
    },
    async probeMediaFile(path) {
      return (await call(shared.PROJECT_COMMANDS.probeMediaFile, { path })) as MediaProbe;
    },
    async compressAnyFile(request) {
      return (await call(shared.PROJECT_COMMANDS.compressAnyFile, {
        request,
      })) as ConversionResult;
    },
    async onCompressProgress(handler) {
      return listen<CompressProgress>('compress-progress', (event) => handler(event.payload));
    },
    async measureVmaf(original, compressed) {
      const raw = await call(shared.PROJECT_COMMANDS.measureVmaf, { original, compressed });
      return typeof raw === 'number' ? raw : null;
    },
    async listModels() {
      return (await call(shared.PROJECT_COMMANDS.listModels)) as ModelInfo[];
    },
    async downloadModel(id) {
      return (await call(shared.PROJECT_COMMANDS.downloadModel, { id })) as ModelInfo;
    },
    async deleteModel(id) {
      return (await call(shared.PROJECT_COMMANDS.deleteModel, { id })) === true;
    },
    async listCapabilities() {
      return (await call(shared.PROJECT_COMMANDS.listCapabilities)) as CapabilityInfo[];
    },
    async listVisualCatalog() {
      return (await call(shared.PROJECT_COMMANDS.listVisualCatalog)) as VisualCatalog;
    },
    async auditVisuals(project) {
      return (await call(shared.PROJECT_COMMANDS.auditVisuals, { project })) as VisualAudit;
    },
    async removeBackground(inputPath) {
      return (await call(shared.PROJECT_COMMANDS.removeBackground, {
        inputPath,
      })) as BackgroundRemoval;
    },
    async removeBackgroundAsset(request) {
      const raw = await call(shared.PROJECT_COMMANDS.removeBackgroundAsset, {
        path: request.path,
        kind: request.kind,
        inFrame: request.inFrame,
        outFrame: request.outFrame,
        fpsNum: request.fpsNum,
        fpsDen: request.fpsDen,
      });
      const asset = shared.parseAssets([raw])[0];
      if (!asset) {
        throw new Error('el recorte no devolvió un asset válido');
      }
      return asset;
    },
    async onBackgroundProgress(handler) {
      return listen<BackgroundProgress>('background-progress', (event) =>
        handler(event.payload),
      );
    },
    async writeAlphaFrames(request) {
      await call(shared.PROJECT_COMMANDS.writeAlphaFrames, {
        token: request.token,
        startIndex: request.startIndex,
        frames: request.frames,
      });
    },
    async alphaFramesToAsset(request) {
      const raw = await call(shared.PROJECT_COMMANDS.alphaFramesToAsset, {
        token: request.token,
        label: request.label,
        width: request.width,
        height: request.height,
        frameCount: request.frameCount,
        fpsNum: request.fpsNum,
        fpsDen: request.fpsDen,
      });
      const asset = shared.parseAssets([raw])[0];
      if (!asset) {
        throw new Error('la secuencia no devolvió un asset válido');
      }
      return asset;
    },
    async discardAlphaFrames(token) {
      await call(shared.PROJECT_COMMANDS.discardAlphaFrames, { token });
    },
    async upscaleImage(inputPath) {
      return (await call(shared.PROJECT_COMMANDS.upscaleImage, {
        inputPath,
      })) as UpscaleResult;
    },
    async upscaleVideo(inputPath, outputPath, maxSeconds) {
      return (await call(shared.PROJECT_COMMANDS.upscaleVideo, {
        inputPath,
        outputPath: outputPath ?? null,
        maxSeconds: maxSeconds ?? null,
      })) as UpscaleVideoResult;
    },
    async onUpscaleProgress(handler) {
      return listen<UpscaleProgress>('upscale-progress', (event) =>
        handler(event.payload),
      );
    },
    async denoiseMedia(request) {
      return (await call(shared.PROJECT_COMMANDS.denoiseMedia, {
        request,
      })) as DenoiseResult;
    },
    async onDenoiseProgress(handler) {
      return listen<DenoiseProgress>('denoise-progress', (event) => handler(event.payload));
    },
    async sharpenMedia(request) {
      return (await call(shared.PROJECT_COMMANDS.sharpenMedia, {
        request,
      })) as SharpenResult;
    },
    async onSharpenProgress(handler) {
      return listen<SharpenProgress>('sharpen-progress', (event) => handler(event.payload));
    },
    async saveThumbnail(request) {
      return (await call(shared.PROJECT_COMMANDS.saveThumbnail, {
        request,
      })) as ThumbnailExportResult;
    },
    async pickThumbnailFrames(request) {
      return (await call(shared.PROJECT_COMMANDS.pickThumbnailFrames, {
        request,
      })) as BestThumbnailFrame[];
    },
    async renderPreviewFrame(request) {
      return (await call(shared.PROJECT_COMMANDS.renderPreviewFrame, {
        request,
      })) as PreviewFrameResult;
    },
    async analyzeScopesFrame(request) {
      return (await call(shared.PROJECT_COMMANDS.analyzeScopesFrame, {
        request,
      })) as ScopeFrameResult;
    },
    async exportLookLut(request) {
      return (await call(shared.PROJECT_COMMANDS.exportLookLut, {
        request,
      })) as LookLutResult;
    },
    async exportEdl(request) {
      return (await call(shared.PROJECT_COMMANDS.exportEdl, {
        request,
      })) as EdlResult;
    },
    async exportOtio(request) {
      return (await call(shared.PROJECT_COMMANDS.exportOtio, {
        request,
      })) as OtioResult;
    },
    async exportFcpxml(request) {
      return (await call(shared.PROJECT_COMMANDS.exportFcpxml, {
        request,
      })) as FcpxmlResult;
    },
    async importTimeline(request) {
      return (await call(shared.PROJECT_COMMANDS.importTimeline, {
        request,
      })) as TimelineImportResult;
    },
    async chooseSubtitleFile() {
      const raw = await call(shared.PROJECT_COMMANDS.chooseSubtitleFile);
      if (!raw || typeof raw !== 'object') return null;
      const record = raw as { name?: unknown; text?: unknown };
      if (typeof record.text !== 'string') return null;
      return {
        name: typeof record.name === 'string' ? record.name : 'subtitulos.srt',
        text: record.text,
      };
    },
    async chooseTimelineFile() {
      const raw = await call(shared.PROJECT_COMMANDS.chooseTimelineFile);
      return typeof raw === 'string' ? raw : null;
    },
    async extractFreezeFrame(input) {
      const raw = await call(shared.PROJECT_COMMANDS.extractFreezeFrame, {
        path: input.path,
        seconds: input.seconds,
        fpsNum: input.fpsNum,
        fpsDen: input.fpsDen,
      });
      const asset = shared.parseAssets([raw])[0];
      return asset ?? null;
    },
    async createVideoProxy(input) {
      const raw = await call(shared.PROJECT_COMMANDS.createVideoProxy, {
        path: input.path,
      });
      const record = (raw ?? {}) as Record<string, unknown>;
      return {
        path: typeof record.path === 'string' ? record.path : '',
        width: typeof record.width === 'number' ? record.width : 0,
        height: typeof record.height === 'number' ? record.height : 0,
        bytes: typeof record.bytes === 'number' ? record.bytes : 0,
      };
    },
    async proxyStatus(assetId) {
      return (await call(shared.PROJECT_COMMANDS.proxyStatus, { assetId })) as ProxyStatus;
    },
    async ensureProxy(assetId, quality) {
      return (await call(shared.PROJECT_COMMANDS.ensureProxy, {
        assetId,
        quality: quality ?? null,
      })) as ProxyStatus;
    },
    async cancelProxy(assetId) {
      return (await call(shared.PROJECT_COMMANDS.cancelProxy, { assetId })) as ProxyStatus;
    },
    async applyProxyToAsset(assetId) {
      const raw = await call(shared.PROJECT_COMMANDS.applyProxyToAsset, { assetId });
      if (!raw) return null;
      return shared.parseAssets([raw])[0] ?? null;
    },
    async cleanupProxies(assetId) {
      return (await call(shared.PROJECT_COMMANDS.cleanupProxies, {
        assetId: assetId ?? null,
      })) as ProxyCleanupResult;
    },
    async onProxyProgress(handler) {
      return listen<ProxyProgressEvent>('proxy-progress', (event) => handler(event.payload));
    },
    async sampleAssetColor(input) {
      const raw = await call(shared.PROJECT_COMMANDS.sampleAssetColor, {
        path: input.path,
        seconds: input.seconds,
      });
      const record = (raw ?? {}) as Record<string, unknown>;
      return {
        r: typeof record.r === 'number' ? record.r : 0,
        g: typeof record.g === 'number' ? record.g : 0,
        b: typeof record.b === 'number' ? record.b : 0,
      };
    },
    async mediaThumbnail(path, isImage) {
      const raw = await call(shared.PROJECT_COMMANDS.thumbnail, { path, isImage });
      if (typeof raw !== 'string') {
        throw new Error('la miniatura no llegó como imagen');
      }
      return raw;
    },
    async detectScenes(assetId, threshold) {
      return (await call(shared.PROJECT_COMMANDS.detectScenes, {
        assetId,
        threshold,
      })) as SceneDetection;
    },
    async analyzeStabilization(assetId, inFrame, outFrame, smoothing) {
      return (await call(shared.PROJECT_COMMANDS.analyzeStabilization, {
        assetId,
        inFrame,
        outFrame,
        smoothing,
      })) as StabilizationAnalysis;
    },
    async analyzeMedia(
      assetId,
      sceneThreshold,
      silenceDb,
      minSilenceSeconds,
      includeSamples,
    ) {
      return (await call(shared.PROJECT_COMMANDS.analyzeMedia, {
        assetId,
        sceneThreshold: sceneThreshold ?? null,
        silenceDb: silenceDb ?? null,
        minSilenceSeconds: minSilenceSeconds ?? null,
        includeSamples: includeSamples ?? null,
      })) as MediaAnalysis;
    },
    async convertMedia(request) {
      return (await call(shared.PROJECT_COMMANDS.convertMedia, {
        assetId: request.assetId,
        target: request.target,
        outputDir: request.outputDir,
        quality: request.quality ?? null,
        maxWidth: request.maxWidth ?? null,
        encoder: request.encoder ?? null,
        enhance: request.enhance ?? null,
      })) as ConversionResult;
    },
    async convertMediaBatch(assetIds, target, outputDir, quality, maxWidth, encoder, enhance) {
      return (await call(shared.PROJECT_COMMANDS.convertMediaBatch, {
        assetIds: [...assetIds],
        target,
        outputDir,
        quality: quality ?? null,
        maxWidth: maxWidth ?? null,
        encoder: encoder ?? null,
        enhance: enhance ?? null,
      })) as BatchConversionItem[];
    },
    async compressMedia(request) {
      return (await call(shared.PROJECT_COMMANDS.compressMedia, {
        assetId: request.assetId,
        outputDir: request.outputDir,
        target: request.target,
        mode: request.mode,
        quality: request.quality ?? null,
        targetMegabytes: request.targetMegabytes ?? null,
        maxWidth: request.maxWidth ?? null,
        audioKbps: request.audioKbps ?? null,
        encoder: request.encoder ?? null,
        enhance: request.enhance ?? null,
      })) as ConversionResult;
    },
    async mergeVideos(assetIds, outputDir) {
      return (await call(shared.PROJECT_COMMANDS.mergeVideos, {
        assetIds,
        outputDir,
      })) as ToolResult;
    },
    async trimVideo(assetId, startSeconds, endSeconds, outputDir) {
      return (await call(shared.PROJECT_COMMANDS.trimVideo, {
        assetId,
        startSeconds,
        endSeconds,
        outputDir,
      })) as ToolResult;
    },
    async watermarkVideo(assetId, text, position, outputDir) {
      return (await call(shared.PROJECT_COMMANDS.watermarkVideo, {
        assetId,
        text,
        position,
        outputDir,
      })) as ToolResult;
    },
    async setMetadata(assetId, title, artist, comment, outputDir) {
      return (await call(shared.PROJECT_COMMANDS.setMetadata, {
        assetId,
        title,
        artist,
        comment,
        outputDir,
      })) as ToolResult;
    },
    async extractSubtitles(path) {
      const raw = (await call(shared.PROJECT_COMMANDS.extractSubtitles, {
        path,
      })) as ExtractedSubtitles | null;
      return raw ?? null;
    },
    async remux(input) {
      return (await call(shared.PROJECT_COMMANDS.remux, { ...input })) as LosslessResult;
    },
    async writeChapters(input) {
      return (await call(shared.PROJECT_COMMANDS.writeChapters, { ...input })) as {
        path: string;
        bytes: number;
        chapters: number;
      };
    },
    async extractAudio(input) {
      return (await call(shared.PROJECT_COMMANDS.extractAudio, { ...input })) as {
        path: string;
        bytes: number;
        codec: string;
      };
    },
    async onConvertProgress(handler) {
      return listen<ConvertProgress>('convert-progress', (event) => handler(event.payload));
    },
  };
}
