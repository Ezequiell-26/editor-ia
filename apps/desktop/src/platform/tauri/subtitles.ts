import type { DesktopService } from "../../services/contracts";
import type { NativeCall } from './shared';
import * as shared from './shared';
import type { ExportShortResult, FaceTrackResult, SaveLocalizedSubtitleResult, ShortProgress, SubtitlePipelineResult, TranslatedTexts } from "../../services/contracts";
import { listen } from "@tauri-apps/api/event";

export function createSubtitlesService(call: NativeCall): Pick<DesktopService, 'translateSubtitles' | 'saveLocalizedSubtitle' | 'exportShort' | 'onShortProgress' | 'analyzeFaceTrack' | 'subtitlesPipeline'> {
  return {
    async translateSubtitles(request) {
      return (await call(shared.PROJECT_COMMANDS.translateSubtitles, {
        request,
      })) as TranslatedTexts;
    },
    async saveLocalizedSubtitle(request) {
      return (await call(shared.PROJECT_COMMANDS.saveLocalizedSubtitle, {
        request,
      })) as SaveLocalizedSubtitleResult;
    },
    async exportShort(request) {
      return (await call(shared.PROJECT_COMMANDS.exportShort, {
        request,
      })) as ExportShortResult;
    },
    async onShortProgress(handler) {
      return listen<ShortProgress>('short-progress', (event) => handler(event.payload));
    },
    async analyzeFaceTrack(request) {
      return (await call(shared.PROJECT_COMMANDS.analyzeFaceTrack, {
        request,
      })) as FaceTrackResult;
    },
    async subtitlesPipeline(input) {
      return (await call(shared.PROJECT_COMMANDS.subtitlesPipeline, { request: input })) as SubtitlePipelineResult;
    },
  };
}
