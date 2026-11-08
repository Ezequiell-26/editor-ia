import type { SaveLocalizedSubtitleRequest, SaveLocalizedSubtitleResult, SubtitlePipelineResult, TranslateSubtitlesRequest, TranslatedTexts } from '../subtitles';
import type { ExportShortRequest, ExportShortResult, ShortProgress } from '../render';
import type { FaceTrackRequest, FaceTrackResult } from '../media';
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
}
