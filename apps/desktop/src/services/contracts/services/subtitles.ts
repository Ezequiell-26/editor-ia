import type { SaveLocalizedSubtitleRequest, SaveLocalizedSubtitleResult, SubtitlePipelineResult, TranslateSubtitlesRequest, TranslatedTexts , SubtitleInspectResult } from '../subtitles';
import type { ExportShortRequest, ExportShortResult, ShortProgress } from '../render';
import type { FaceTrackRequest, FaceTrackResult, ObjectTrackRequest, ObjectTrackResult } from '../media';
import type { UnlistenFn } from '../events';

export interface DesktopServiceSubtitles {
subtitlesPipeline(input: {
    inputPath: string;
    outputPath?: string;
    targetLanguage?: string;
    sourceLanguage?: string;
    model?: string;
    burn?: boolean;
  }): Promise<SubtitlePipelineResult>;

translateSubtitles(request: TranslateSubtitlesRequest): Promise<TranslatedTexts>;

saveLocalizedSubtitle(
    request: SaveLocalizedSubtitleRequest,
  ): Promise<SaveLocalizedSubtitleResult>;

exportShort(request: ExportShortRequest): Promise<ExportShortResult>;

onShortProgress(handler: (event: ShortProgress) => void): Promise<UnlistenFn>;

analyzeFaceTrack(request: FaceTrackRequest): Promise<FaceTrackResult>;

trackObject(request: ObjectTrackRequest): Promise<ObjectTrackResult>;

  /** Inspecciona un archivo de subtítulos: formato detectado, cues, duración. */
  subtitlesInspectFile(path: string): Promise<SubtitleInspectResult>;

  /** Convierte subtítulos entre srt/vtt/scc/mcc/stl/ttml/dfxp (formato por extensión). */
  subtitlesConvertFile(input: string, output: string): Promise<string>;
}
