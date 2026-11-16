import type { AudioPeaks, AudioScopeData, AudioScopeRange, CloneProgress, CloneVoiceRequest, CloneVoiceResult, DialogueProgress, DialogueRequest, DialogueResult, DiarizeProviderInfo, DiarizeResult, DubProgress, DubResult, FileLoudness, LipSyncProgress, LipSyncRequest, LipSyncResult, LoudnessAnalysisProgress, MixLoudnessReport, NativeWhisperModel, NativeWhisperStatus, SynthesizeDubRequest, VoiceIsolationOutcome, VoiceIsolationStatus, WhisperModelDownloadEvent } from '../audio';
import type { TranscriptionResult } from '../subtitles';
import type { NarrationResult, VoiceInfo } from '../assistant';
import type { UnlistenFn } from '../events';

export interface DesktopServiceAudio {
/**
   * Picos min/max por bucket de un asset del proyecto abierto.
   * `buckets` default 600, acotado por el backend a [16, 4000].
   */
  audioPeaks(assetId: string, buckets?: number): Promise<AudioPeaks>;

/** Picos de un archivo suelto, sin proyecto abierto (cola de carpeta). */
  audioPeaksPath(path: string, buckets?: number): Promise<AudioPeaks>;

/** Loudness de un archivo ya renderizado (lazo cerrado de entrega). */
  measureFileLoudness(path: string): Promise<FileLoudness>;

getDiarizeProvider(): Promise<DiarizeProviderInfo>;

saveDiarizeProvider(input: {
    kind: string;
    baseUrl: string;
    language: string;
    apiKey?: string;
  }): Promise<DiarizeProviderInfo>;

/** Hablantes por proveedor externo (Deepgram o AssemblyAI). */
  diarizeAudio(assetId: string, language?: string): Promise<DiarizeResult>;

/**
   * Mide el loudness de la mezcla del proyecto guardado (BS.1770-4 / EBU R128)
   * con el grafo de audio real del export, previo a la normalización.
   */
  analyzeMixLoudness(profileId?: string): Promise<MixLoudnessReport>;

/** Scopes de audio (oscilograma/espectro/espectrograma) de un archivo. */
  audioScopeAnalyze(path: string, range?: AudioScopeRange | null): Promise<AudioScopeData>;

/** Ídem pero resolviendo el asset del proyecto abierto por id. */
  audioScopeAnalyzeAsset(
    assetId: string,
    range?: AudioScopeRange | null,
  ): Promise<AudioScopeData>;

onLoudnessAnalysisProgress(
    handler: (event: LoudnessAnalysisProgress) => void,
  ): Promise<UnlistenFn>;

transcribeAsset(
    assetId: string,
    language?: string,
    model?: string,
  ): Promise<TranscriptionResult>;

voiceIsolationStatus(): Promise<VoiceIsolationStatus>;

voiceIsolateMedia(
    inputPath: string,
    model?: string,
    quality?: string,
  ): Promise<VoiceIsolationOutcome>;

/**
   * Genera (o reutiliza) el stem `vocals.wav` de un asset del proyecto en
   * `media/isolation/<assetId>/`. El render lo usa automáticamente en los
   * clips cuyo `audio.voiceIsolation.enabled` está activo.
   */
  voiceIsolationPrepare(
    assetId: string,
    quality?: string,
    force?: boolean,
  ): Promise<VoiceIsolationOutcome>;

listVoices(): Promise<VoiceInfo[]>;

synthesizeNarration(input: {
    text: string;
    voice?: string;
    fpsNum: number;
    fpsDen: number;
    provider?: 'windows-sapi';
  }): Promise<NarrationResult>;

enhanceDialogue(request: DialogueRequest): Promise<DialogueResult>;

onDialogueProgress(handler: (event: DialogueProgress) => void): Promise<UnlistenFn>;

synthesizeDub(request: SynthesizeDubRequest): Promise<DubResult>;

onDubProgress(handler: (event: DubProgress) => void): Promise<UnlistenFn>;

cloneVoice(request: CloneVoiceRequest): Promise<CloneVoiceResult>;

onCloneProgress(handler: (event: CloneProgress) => void): Promise<UnlistenFn>;

lipSync(request: LipSyncRequest): Promise<LipSyncResult>;

onLipSyncProgress(handler: (event: LipSyncProgress) => void): Promise<UnlistenFn>;

/**
   * Estado del motor nativo whisper.cpp: tabla de modelos `ggml` con su
   * estado en disco, modelo cargado, transcripción activa y descarga en
   * curso. No descarga nada ni toca red.
   */
whisperModelStatus(): Promise<NativeWhisperStatus>;

/**
   * Descarga un modelo `ggml` del motor nativo. `modelId` es el id de la
   * tabla del crate (`tiny`, `tiny.en`, `base`, `base.en`, `small`,
   * `small.en`). Devuelve la entrada del modelo ya actualizada; el progreso
   * llega por `onWhisperModelDownload` con bytes reales.
   */
whisperModelDownload(modelId: string): Promise<NativeWhisperModel>;

/**
   * Cancela la descarga de modelo en curso. No-op si no hay ninguna.
   */
whisperModelDownloadCancel(): Promise<void>;

/**
   * Evento `whisper-model-download`: progreso real de la descarga (y un
   * último evento con `error` si falló). Los eventos pueden llegar también
   * por descargas implícitas disparadas por `transcribe_asset`.
   */
onWhisperModelDownload(
    handler: (event: WhisperModelDownloadEvent) => void,
  ): Promise<UnlistenFn>;
}
