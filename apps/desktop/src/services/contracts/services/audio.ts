import type { AudioPeaks, AudioScopeData, AudioScopeRange, CloneProgress, CloneVoiceRequest, CloneVoiceResult, DialogueProgress, DialogueRequest, DialogueResult, DiarizeProviderInfo, DiarizeResult, DubProgress, DubResult, FileLoudness, LipSyncProgress, LipSyncRequest, LipSyncResult, LoudnessAnalysisProgress, MixLoudnessReport, SynthesizeDubRequest, VoiceIsolationOutcome, VoiceIsolationStatus } from '../audio';
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
  diarizeAudio(path: string, language?: string): Promise<DiarizeResult>;

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
}
