
export interface LoudnessSummary {
  readonly integratedLufs: number | null;
  readonly truePeakDb: number | null;
  readonly lraDb: number | null;
  readonly noiseFloorDb: number | null;
}

/** Avance del análisis de loudness de la mezcla. */
export interface LoudnessAnalysisProgress {
  readonly percent: number;
  readonly seconds: number;
  readonly totalSeconds: number;
}

/** Una muestra del medidor cada 100 ms de audio. */
export interface MixLoudnessSample {
  readonly seconds: number;
  readonly momentaryLufs: number;
  readonly shortTermLufs: number;
}

/** Medición EBU R128 de la mezcla completa (previa a loudnorm). */
export interface MixLoudnessReport {
  readonly durationSeconds: number;
  readonly integratedLufs: number;
  readonly loudnessRangeLu: number;
  readonly maxMomentaryLufs: number;
  readonly maxShortTermLufs: number;
  readonly samplePeakDbfs: number;
  readonly truePeakDbtp: number;
  readonly targetLufs: number | null;
  readonly targetDeltaDb: number | null;
  readonly samples: readonly MixLoudnessSample[];
}

/** Scopes de audio calculados en Rust (oscilograma, espectro y espectrograma). */
export interface AudioScopeData {
  readonly sampleRate: number;
  readonly durationSeconds: number;
  /** Pares [min, max] por bucket temporal, en [-1, 1]. */
  readonly waveform: readonly (readonly [number, number])[];
  /** Magnitud promedio en dBFS por bin (0..Nyquist). */
  readonly spectrum: readonly number[];
  readonly spectrogramCols: number;
  readonly spectrogramRows: number;
  /** dBFS [-120, 0], orden columna-mayor (`col * rows + row`). */
  readonly spectrogram: readonly number[];
}

/** Ventana opcional de análisis de scopes, en segundos del archivo fuente. */
export interface AudioScopeRange {
  readonly startSeconds: number;
  readonly durationSeconds: number;
}

export type DialoguePreset = 'dialogo' | 'voz' | 'podcast' | 'suave';

/** Mejora de voz con la cadena DSP local de FilmCraft. */
export interface DialogueRequest {
  readonly inputPath: string;
  readonly outputDir?: string | null;
  readonly preset?: DialoguePreset;
}

export interface DialogueResult {
  readonly path: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly preset: string;
  readonly effects: readonly string[];
}

export interface DialogueProgress {
  readonly percent: number;
  readonly stage: string;
}

export interface DubCue {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

export interface SynthesizeDubRequest {
  readonly path: string;
  readonly outputDir: string;
  readonly language: string;
  readonly voice?: string;
  readonly cues: readonly DubCue[];
  readonly endSeconds?: number;
  readonly bedVolume?: number;
}

export interface DubResult {
  readonly path: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly language: string;
  readonly voice: string;
  readonly cues: number;
  readonly replacedOriginalAudio: boolean;
  readonly originalAudioVolume: number;
  readonly warnings: readonly string[];
}

export interface DubProgress {
  readonly percent: number;
}

export type CloneEngine = 'xtts' | 'gpt-sovits';

export interface CloneVoiceRequest {
  readonly text: string;
  readonly referencePath: string;
  readonly engineUrl: string;
  readonly engine?: CloneEngine;
  readonly language: string;
  readonly promptText?: string;
  readonly apiKey?: string;
}

export interface CloneVoiceResult {
  readonly path: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly language: string;
  readonly engine: string;
  readonly referenceSha256: string;
}

export interface CloneProgress {
  readonly percent: number;
  readonly stage?: string;
}

export interface LipSyncRequest {
  readonly videoPath: string;
  readonly audioPath: string;
  readonly outputDir: string;
  readonly engineUrl: string;
  readonly engine?: string;
  readonly apiKey?: string;
}

export interface LipSyncResult {
  readonly path: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly engine: string;
}

export interface LipSyncProgress {
  readonly percent: number;
  readonly stage?: string;
}

/**
 * Picos de audio para dibujar la forma de onda de la timeline.
 *
 * Contrato nativo (`audio_peaks`, FFmpeg + FFprobe):
 * - `buckets` default 600; el backend lo limita a [16, 4000] y devuelve el
 *   valor efectivo en `buckets` (nunca es mayor que 4000).
 * - `peaks` tiene exactamente `buckets` pares `{ min, max }` mono en [-1, 1];
 *   son muestras, no amplitudes normalizadas a [0, 1].
 * - `durationSeconds` viene de la primera pista de audio; puede ser 0 cuando el
 *   contenedor no declara duración.
 * - Sin audio, asset inexistente o FFmpeg/FFprobe ausentes el comando rechaza
 *   con `ProjectError` (no devuelve un array vacío).
 */
export interface AudioPeaks {
  readonly assetId: string;
  readonly durationSeconds: number;
  readonly buckets: number;
  readonly peaks: readonly { readonly min: number; readonly max: number }[];
}

export interface DiarizeProviderInfo {
  readonly kind: string;
  readonly baseUrl: string;
  readonly language: string;
  readonly hasKey: boolean;
}

export interface DiarizeResult {
  readonly provider: string;
  readonly segments: readonly {
    readonly start: number;
    readonly end: number;
    readonly text: string;
    readonly speaker: string;
  }[];
}

export interface FileLoudness {
  readonly integratedLufs: number;
  readonly truePeakDb: number;
  readonly lraLu: number;
}

export interface VoiceIsolationStatus {
  readonly available: boolean;
  readonly python: string | null;
  readonly reason: string | null;
}

export interface VoiceIsolationOutcome {
  readonly vocalsPath: string;
  readonly accompanimentPath: string | null;
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly processingTimeMs: number;
  /** true cuando se reutilizó un stem ya generado (no corrió el modelo). */
  readonly cached: boolean;
}

export interface AudioTrack {
  readonly formatId: string;
  readonly language: string | null;
  readonly ext: string | null;
  readonly abr: number | null;
  readonly note: string | null;
}
