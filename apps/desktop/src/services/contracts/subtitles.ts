
/** Traducción de un lote acotado de subtítulos con el proveedor configurado. */
export interface TranslateSubtitlesRequest {
  readonly texts: readonly string[];
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly glossary?: string;
  readonly approvedCost?: boolean;
}

export interface TranslatedTexts {
  readonly texts: string[];
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
}

export interface SaveLocalizedSubtitleRequest {
  readonly content: string;
  readonly outputDir: string;
  readonly baseName: string;
  readonly language: string;
  readonly format: 'srt' | 'vtt';
}

export interface SaveLocalizedSubtitleResult {
  readonly path: string;
  readonly bytes: number;
  readonly format: string;
  readonly language: string;
}

export interface ExtractedSubtitles {
  readonly language: string | null;
  readonly title: string | null;
  readonly srt: string;
}

export interface TranscriptionWord {
  readonly start: number;
  readonly end: number;
  readonly word: string;
  readonly probability: number;
}

export interface TranscriptionSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly words: readonly TranscriptionWord[];
}

export interface TranscriptionResult {
  readonly language: string;
  readonly languageProbability: number;
  readonly durationSeconds: number;
  readonly model: string;
  readonly segments: readonly TranscriptionSegment[];
}

export interface SubtitlePipelineResult {
  readonly ok: boolean;
  readonly assPath?: string;
  readonly outputPath?: string | null;
  readonly cues?: number;
  readonly language?: string;
  readonly translated?: boolean;
  readonly simulated?: boolean;
  readonly burned?: boolean;
}
