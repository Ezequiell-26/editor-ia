import type { AudioProviderInfo, ProviderInfo, ProviderTestResult } from '../providers';

export interface DesktopServiceProviders {
/** Fija rutas de FFmpeg/FFprobe sin diálogo. */
  setToolPaths(input: { ffmpeg?: string; ffprobe?: string }): Promise<void>;

getProvider(): Promise<ProviderInfo>;

saveProvider(input: {
    kind: string;
    baseUrl: string;
    model: string;
    apiKey?: string;
  }): Promise<ProviderInfo>;

clearProviderKey(): Promise<ProviderInfo>;

/** Prueba la conexión con el proveedor configurado (Ajustes → IA). */
  testProvider(): Promise<ProviderTestResult>;

getAudioProvider(): Promise<AudioProviderInfo>;

saveAudioProvider(input: {
    kind: string;
    voiceId: string;
    modelId: string;
    externalUrl: string;
    approved: boolean;
    apiKey?: string;
  }): Promise<AudioProviderInfo>;

clearAudioProviderKey(): Promise<AudioProviderInfo>;
}
