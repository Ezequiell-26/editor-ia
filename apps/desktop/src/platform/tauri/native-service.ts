import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { DesktopService, NativeInvoke } from "../../services/contracts";
import { createNativeCall, detectNativeRuntime } from "./shared";
import { createUnavailableService } from "./unavailable-service";
import { createAiService } from "./ai";
import { createAudioService } from "./audio";
import { createDownloaderService } from "./downloader";
import { createIntegrationsService } from "./integrations";
import { createMediaService } from "./media";
import { createProjectsService } from "./projects";
import { createProvidersService } from "./providers";
import { createRenderService } from "./render";
import { createSubtitlesService } from "./subtitles";

export * from "./shared";

export function createNativeDesktopService(invoke: NativeInvoke = tauriInvoke as NativeInvoke): DesktopService {
  const call = createNativeCall(invoke);
  return {
    available: true,
    unavailableReason: null,
    ...createAiService(call),
    ...createAudioService(call),
    ...createDownloaderService(call),
    ...createIntegrationsService(call),
    ...createMediaService(call),
    ...createProjectsService(call),
    ...createProvidersService(call),
    ...createRenderService(call),
    ...createSubtitlesService(call),
  };
}

export function createDesktopService(): DesktopService {
  if (!detectNativeRuntime()) return createUnavailableService();
  return createNativeDesktopService();
}
