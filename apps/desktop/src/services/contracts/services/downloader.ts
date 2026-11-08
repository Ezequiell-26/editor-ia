import type { ChannelAnalysisRequest, ChannelProgressEvent, CreatorBrollRequest, CreatorBurnSubtitlesRequest, CreatorCtaRequest, CreatorHookRequest, CreatorMultiAspectRequest, CreatorOutput, CreatorSplitChaptersRequest, DownloadOutcome, DownloadProbe, DownloadProgressEvent, DownloadRequest, DownloaderBridgeInfo, DownloaderStatus, PlaylistEntry, ProxyHealth, RssItem, SourceChecksum, SponsorSegment, WatchFile, WatchdogStatus, YouTubeChannelReport } from '../downloader';
import type { VpnConnection, WireGuardInfo } from '../integrations';
import type { AudioTrack } from '../audio';
import type { UnlistenFn } from '../events';

export interface DesktopServiceDownloader {
downloaderStatus(): Promise<DownloaderStatus>;

downloaderBridgeInfo(): Promise<DownloaderBridgeInfo>;

installDownloader(): Promise<DownloaderStatus>;

updateDownloader(): Promise<DownloaderStatus>;

pauseDownload(runId?: string | null): Promise<boolean>;

resumeDownload(runId?: string | null): Promise<boolean>;

cancelDownload(runId?: string | null): Promise<boolean>;

creatorInjectHook(request: CreatorHookRequest): Promise<CreatorOutput>;

creatorExportMultiAspect(request: CreatorMultiAspectRequest): Promise<CreatorOutput[]>;

creatorInjectCta(request: CreatorCtaRequest): Promise<CreatorOutput>;

creatorInterleaveBroll(request: CreatorBrollRequest): Promise<CreatorOutput>;

creatorSplitChapters(request: CreatorSplitChaptersRequest): Promise<CreatorOutput[]>;

creatorBurnSubtitles(request: CreatorBurnSubtitlesRequest): Promise<CreatorOutput>;

downloadDiskSpace(path?: string | null): Promise<number>;

chooseDownloadDirectory(): Promise<string | null>;

probeDownload(
    url: string,
    cookiesFile?: string | null,
    cookiesFromBrowser?: string | null,
  ): Promise<DownloadProbe>;

sponsorblockPreview(url: string, categories?: string | null): Promise<SponsorSegment[]>;

scanWatchFolder(path: string): Promise<WatchFile[]>;

fetchRssFeed(url: string, limit?: number | null): Promise<RssItem[]>;

testProxy(proxy: string): Promise<ProxyHealth>;

vpnList(): Promise<VpnConnection[]>;

vpnConnect(name: string): Promise<string>;

vpnDisconnect(name: string): Promise<string>;

vpnWireguard(): Promise<WireGuardInfo>;

vpnWireguardOpen(): Promise<void>;

probeSourceChecksum(url: string): Promise<SourceChecksum>;

listPlaylistEntries(url: string, limit?: number | null): Promise<PlaylistEntry[]>;

listAudioTracks(url: string): Promise<AudioTrack[]>;

installWatchdog(): Promise<WatchdogStatus>;

removeWatchdog(): Promise<WatchdogStatus>;

watchdogStatus(): Promise<WatchdogStatus>;

chooseCookiesFile(): Promise<string | null>;

downloadMedia(request: DownloadRequest): Promise<DownloadOutcome>;

cleanupDownload(runId: string): Promise<void>;

onDownloadProgress(handler: (event: DownloadProgressEvent) => void): Promise<UnlistenFn>;

analyzeYoutubeChannel(request: ChannelAnalysisRequest): Promise<YouTubeChannelReport>;

onChannelAnalysisProgress(
    handler: (event: ChannelProgressEvent) => void,
  ): Promise<UnlistenFn>;

fetchPlatformRules(): Promise<unknown>;

/** Selector nativo de carpeta, sin proyecto abierto. */
  chooseDownloadDirectory(): Promise<string | null>;
}
