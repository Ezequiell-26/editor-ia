import type { DesktopService } from "../../services/contracts";
import type { NativeCall } from './shared';
import * as shared from './shared';
import type { AudioPeaks, AudioScopeData, CloneProgress, CloneVoiceResult, DialogueProgress, DialogueResult, DiarizeProviderInfo, DiarizeResult, DubProgress, DubResult, FileLoudness, LipSyncProgress, LipSyncResult, LoudnessAnalysisProgress, MixLoudnessReport, NarrationResult, TranscriptionResult, VoiceInfo, VoiceIsolationStatus } from "../../services/contracts";
import { listen } from "@tauri-apps/api/event";

export function createAudioService(call: NativeCall): Pick<DesktopService, 'enhanceDialogue' | 'onDialogueProgress' | 'synthesizeDub' | 'onDubProgress' | 'cloneVoice' | 'onCloneProgress' | 'lipSync' | 'onLipSyncProgress' | 'getDiarizeProvider' | 'saveDiarizeProvider' | 'diarizeAudio' | 'audioPeaksPath' | 'measureFileLoudness' | 'audioPeaks' | 'analyzeMixLoudness' | 'audioScopeAnalyze' | 'audioScopeAnalyzeAsset' | 'onLoudnessAnalysisProgress' | 'transcribeAsset' | 'voiceIsolationStatus' | 'voiceIsolateMedia' | 'voiceIsolationPrepare' | 'listVoices' | 'synthesizeNarration'> {
  return {
    async enhanceDialogue(request) {
      return (await call(shared.PROJECT_COMMANDS.enhanceDialogue, {
        request,
      })) as DialogueResult;
    },
    async onDialogueProgress(handler) {
      return listen<DialogueProgress>('dialogue-progress', (event) =>
        handler(event.payload),
      );
    },
    async synthesizeDub(request) {
      return (await call(shared.PROJECT_COMMANDS.synthesizeDub, {
        request,
      })) as DubResult;
    },
    async onDubProgress(handler) {
      return listen<DubProgress>('dub-progress', (event) => handler(event.payload));
    },
    async cloneVoice(request) {
      return (await call(shared.PROJECT_COMMANDS.cloneVoice, { request })) as CloneVoiceResult;
    },
    async onCloneProgress(handler) {
      return listen<CloneProgress>('clone-progress', (event) => handler(event.payload));
    },
    async lipSync(request) {
      return (await call(shared.PROJECT_COMMANDS.lipSync, { request })) as LipSyncResult;
    },
    async onLipSyncProgress(handler) {
      return listen<LipSyncProgress>('lipsync-progress', (event) => handler(event.payload));
    },
    async getDiarizeProvider() {
      return (await call(shared.PROJECT_COMMANDS.getDiarizeProvider, {})) as DiarizeProviderInfo;
    },
    async saveDiarizeProvider(input) {
      return (await call(shared.PROJECT_COMMANDS.saveDiarizeProvider, {
        kind: input.kind,
        baseUrl: input.baseUrl,
        language: input.language,
        apiKey: input.apiKey,
      })) as DiarizeProviderInfo;
    },
    async diarizeAudio(path, language) {
      return (await call(shared.PROJECT_COMMANDS.diarizeAudio, { path, language })) as DiarizeResult;
    },
    async audioPeaksPath(path, buckets) {
      return (await call(shared.PROJECT_COMMANDS.audioPeaksPath, {
        path,
        buckets: buckets ?? 600,
      })) as AudioPeaks;
    },
    async measureFileLoudness(path) {
      return (await call(shared.PROJECT_COMMANDS.measureFileLoudness, { path })) as FileLoudness;
    },
    async audioPeaks(assetId, buckets) {
      return (await call(shared.PROJECT_COMMANDS.audioPeaks, {
        assetId,
        buckets: buckets ?? 600,
      })) as AudioPeaks;
    },
    async analyzeMixLoudness(profileId) {
      return (await call(shared.PROJECT_COMMANDS.analyzeMixLoudness, {
        profileId: profileId ?? null,
      })) as MixLoudnessReport;
    },
    async audioScopeAnalyze(path, range) {
      return (await call(shared.PROJECT_COMMANDS.audioScopeAnalyze, {
        path,
        startSeconds: range?.startSeconds ?? null,
        durationSeconds: range?.durationSeconds ?? null,
      })) as AudioScopeData;
    },
    async audioScopeAnalyzeAsset(assetId, range) {
      return (await call(shared.PROJECT_COMMANDS.audioScopeAnalyzeAsset, {
        assetId,
        startSeconds: range?.startSeconds ?? null,
        durationSeconds: range?.durationSeconds ?? null,
      })) as AudioScopeData;
    },
    async onLoudnessAnalysisProgress(handler) {
      return listen<LoudnessAnalysisProgress>('loudness-analysis-progress', (event) =>
        handler(event.payload),
      );
    },
    async transcribeAsset(assetId, language, model) {
      return (await call(shared.PROJECT_COMMANDS.transcribeAsset, {
        assetId,
        language: language ?? null,
        model: model ?? null,
      })) as TranscriptionResult;
    },
    async voiceIsolationStatus() {
      return (await call(shared.PROJECT_COMMANDS.voiceIsolationStatus)) as VoiceIsolationStatus;
    },
    async voiceIsolateMedia(inputPath, model, quality) {
      const raw = (await call(shared.PROJECT_COMMANDS.voiceIsolateMedia, {
        inputPath,
        model: model ?? null,
        quality: quality ?? null,
      })) as {
        vocals_path: string;
        accompaniment_path: string | null;
        duration_seconds: number;
        sample_rate: number;
        channels: number;
        processing_time_ms: number;
        cached?: boolean;
      };
      return {
        vocalsPath: raw.vocals_path,
        accompanimentPath: raw.accompaniment_path,
        durationSeconds: raw.duration_seconds,
        sampleRate: raw.sample_rate,
        channels: raw.channels,
        processingTimeMs: raw.processing_time_ms,
        cached: raw.cached ?? false,
      };
    },
    async voiceIsolationPrepare(assetId, quality, force) {
      const raw = (await call(shared.PROJECT_COMMANDS.voiceIsolationPrepare, {
        assetId,
        quality: quality ?? null,
        force: force ?? null,
      })) as {
        vocals_path: string;
        accompaniment_path: string | null;
        duration_seconds: number;
        sample_rate: number;
        channels: number;
        processing_time_ms: number;
        cached?: boolean;
      };
      return {
        vocalsPath: raw.vocals_path,
        accompanimentPath: raw.accompaniment_path,
        durationSeconds: raw.duration_seconds,
        sampleRate: raw.sample_rate,
        channels: raw.channels,
        processingTimeMs: raw.processing_time_ms,
        cached: raw.cached ?? false,
      };
    },
    async listVoices() {
      const raw = await call(shared.PROJECT_COMMANDS.listVoices);
      return Array.isArray(raw) ? (raw as VoiceInfo[]) : [];
    },
    async synthesizeNarration(input) {
      return (await call(shared.PROJECT_COMMANDS.synthesizeNarration, {
        text: input.text,
        voice: input.voice ?? null,
        fpsNum: input.fpsNum,
        fpsDen: input.fpsDen,
        provider: input.provider ?? null,
      })) as NarrationResult;
    },
  };
}
