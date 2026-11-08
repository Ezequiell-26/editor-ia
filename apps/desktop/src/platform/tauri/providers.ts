import type { DesktopService } from "../../services/contracts";
import type { NativeCall } from './shared';
import * as shared from './shared';
import type { AudioProviderInfo, ProviderInfo, ProviderTestResult } from "../../services/contracts";

export function createProvidersService(call: NativeCall): Pick<DesktopService, 'setToolPaths' | 'getProvider' | 'saveProvider' | 'clearProviderKey' | 'testProvider' | 'getAudioProvider' | 'saveAudioProvider' | 'clearAudioProviderKey'> {
  return {
    async setToolPaths(input) {
      await call(shared.PROJECT_COMMANDS.setToolPaths, {
        ffmpeg: input.ffmpeg,
        ffprobe: input.ffprobe,
      });
    },
    async getProvider() {
      return (await call(shared.PROJECT_COMMANDS.getProvider)) as ProviderInfo;
    },
    async saveProvider(input) {
      return (await call(shared.PROJECT_COMMANDS.saveProvider, {
        kind: input.kind,
        baseUrl: input.baseUrl,
        model: input.model,
        apiKey: input.apiKey ?? null,
      })) as ProviderInfo;
    },
    async clearProviderKey() {
      return (await call(shared.PROJECT_COMMANDS.clearProviderKey)) as ProviderInfo;
    },
    async testProvider() {
      return (await call(shared.PROJECT_COMMANDS.testProvider)) as ProviderTestResult;
    },
    async getAudioProvider() {
      return (await call(shared.PROJECT_COMMANDS.getAudioProvider)) as AudioProviderInfo;
    },
    async saveAudioProvider(input) {
      return (await call(shared.PROJECT_COMMANDS.saveAudioProvider, {
        kind: input.kind,
        voiceId: input.voiceId,
        modelId: input.modelId,
        externalUrl: input.externalUrl,
        approved: input.approved,
        apiKey: input.apiKey ?? null,
      })) as AudioProviderInfo;
    },
    async clearAudioProviderKey() {
      return (await call(shared.PROJECT_COMMANDS.clearAudioProviderKey)) as AudioProviderInfo;
    },
  };
}
