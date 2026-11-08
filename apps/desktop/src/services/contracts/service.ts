import type { DesktopServiceProjects } from './services/projects';
import type { DesktopServiceMedia } from './services/media';
import type { DesktopServiceAudio } from './services/audio';
import type { DesktopServiceAi } from './services/ai';
import type { DesktopServiceRender } from './services/render';
import type { DesktopServiceDownloader } from './services/downloader';
import type { DesktopServiceProviders } from './services/providers';
import type { DesktopServiceIntegrations } from './services/integrations';
import type { DesktopServiceSubtitles } from './services/subtitles';
import type { DesktopServiceStudio } from './services/studio';

export interface DesktopService extends DesktopServiceProjects, DesktopServiceMedia, DesktopServiceAudio, DesktopServiceAi, DesktopServiceRender, DesktopServiceDownloader, DesktopServiceProviders, DesktopServiceIntegrations, DesktopServiceSubtitles, DesktopServiceStudio {
readonly available: boolean;
readonly unavailableReason: string | null;
}
