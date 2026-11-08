import type { DesktopService } from "../../services/contracts";
import type { NativeCall } from './shared';
import * as shared from './shared';
import type { AudioTrack, ChannelProgressEvent, CreatorOutput, DownloadOutcome, DownloadProbe, DownloadProgressEvent, DownloaderBridgeInfo, DownloaderStatus, PlaylistEntry, ProxyHealth, RssItem, SourceChecksum, SponsorSegment, VpnConnection, WatchFile, WatchdogStatus, WireGuardInfo, YouTubeChannelReport } from "../../services/contracts";
import { listen } from "@tauri-apps/api/event";

export function createDownloaderService(call: NativeCall): Pick<DesktopService, 'chooseDownloadDirectory' | 'downloaderStatus' | 'downloaderBridgeInfo' | 'installDownloader' | 'updateDownloader' | 'pauseDownload' | 'resumeDownload' | 'cancelDownload' | 'creatorInjectHook' | 'creatorExportMultiAspect' | 'creatorInjectCta' | 'creatorInterleaveBroll' | 'creatorSplitChapters' | 'creatorBurnSubtitles' | 'downloadDiskSpace' | 'probeDownload' | 'sponsorblockPreview' | 'scanWatchFolder' | 'fetchRssFeed' | 'testProxy' | 'vpnList' | 'vpnConnect' | 'vpnDisconnect' | 'vpnWireguard' | 'vpnWireguardOpen' | 'probeSourceChecksum' | 'listPlaylistEntries' | 'listAudioTracks' | 'installWatchdog' | 'removeWatchdog' | 'watchdogStatus' | 'chooseCookiesFile' | 'downloadMedia' | 'cleanupDownload' | 'onDownloadProgress' | 'analyzeYoutubeChannel' | 'onChannelAnalysisProgress' | 'fetchPlatformRules'> {
  return {
    async chooseDownloadDirectory() {
      const raw = await call(shared.PROJECT_COMMANDS.chooseDownloadDirectory);
      return typeof raw === 'string' && raw ? raw : null;
    },
    async downloaderStatus() {
      return (await call(shared.PROJECT_COMMANDS.downloaderStatus)) as DownloaderStatus;
    },
    async downloaderBridgeInfo() {
      return (await call(shared.PROJECT_COMMANDS.downloaderBridgeInfo)) as DownloaderBridgeInfo;
    },
    async installDownloader() {
      return (await call(shared.PROJECT_COMMANDS.installDownloader)) as DownloaderStatus;
    },
    async updateDownloader() {
      return (await call(shared.PROJECT_COMMANDS.updateDownloader)) as DownloaderStatus;
    },
    async pauseDownload(runId) {
      return (await call(shared.PROJECT_COMMANDS.pauseDownload, {
        runId: runId ?? null,
      })) as boolean;
    },
    async resumeDownload(runId) {
      return (await call(shared.PROJECT_COMMANDS.resumeDownload, {
        runId: runId ?? null,
      })) as boolean;
    },
    async cancelDownload(runId) {
      return (await call(shared.PROJECT_COMMANDS.cancelDownload, {
        runId: runId ?? null,
      })) as boolean;
    },
    async creatorInjectHook(request) {
      return (await call(shared.PROJECT_COMMANDS.creatorInjectHook, {
        inputPath: request.inputPath,
        outputPath: request.outputPath,
        hookText: request.hookText,
        zoomPercent: request.zoomPercent ?? null,
        soundGainDb: request.soundGainDb ?? null,
      })) as CreatorOutput;
    },
    async creatorExportMultiAspect(request) {
      return (await call(shared.PROJECT_COMMANDS.creatorExportMultiAspect, {
        inputPath: request.inputPath,
        outputDir: request.outputDir,
        aspects: request.aspects ?? null,
      })) as CreatorOutput[];
    },
    async creatorInjectCta(request) {
      return (await call(shared.PROJECT_COMMANDS.creatorInjectCta, {
        inputPath: request.inputPath,
        outputPath: request.outputPath,
        ctaText: request.ctaText,
        url: request.url,
        ctaSeconds: request.ctaSeconds ?? null,
        addQr: request.addQr ?? null,
      })) as CreatorOutput;
    },
    async creatorInterleaveBroll(request) {
      return (await call(shared.PROJECT_COMMANDS.creatorInterleaveBroll, {
        inputPath: request.inputPath,
        brollDir: request.brollDir,
        outputPath: request.outputPath,
        intervalSeconds: request.intervalSeconds ?? null,
        clipSeconds: request.clipSeconds ?? null,
        maxInsertions: request.maxInsertions ?? null,
      })) as CreatorOutput;
    },
    async creatorSplitChapters(request) {
      return (await call(shared.PROJECT_COMMANDS.creatorSplitChapters, {
        inputPath: request.inputPath,
        outputDir: request.outputDir,
      })) as CreatorOutput[];
    },
    async creatorBurnSubtitles(request) {
      return (await call(shared.PROJECT_COMMANDS.creatorBurnSubtitles, {
        inputPath: request.inputPath,
        outputPath: request.outputPath,
        subtitleText: request.subtitleText,
      })) as CreatorOutput;
    },
    async downloadDiskSpace(path) {
      return (await call(shared.PROJECT_COMMANDS.downloadDiskSpace, {
        path: path ?? null,
      })) as number;
    },
    async probeDownload(url, cookiesFile, cookiesFromBrowser) {
      return (await call(shared.PROJECT_COMMANDS.probeDownload, {
        url,
        cookiesFile: cookiesFile ?? null,
        cookiesFromBrowser: cookiesFromBrowser ?? null,
      })) as DownloadProbe;
    },
    async sponsorblockPreview(url, categories) {
      return (await call(shared.PROJECT_COMMANDS.sponsorblockPreview, {
        url,
        categories: categories ?? null,
      })) as SponsorSegment[];
    },
    async scanWatchFolder(path) {
      return (await call(shared.PROJECT_COMMANDS.scanWatchFolder, { path })) as WatchFile[];
    },
    async fetchRssFeed(url, limit) {
      return (await call(shared.PROJECT_COMMANDS.fetchRssFeed, {
        url,
        limit: limit ?? null,
      })) as RssItem[];
    },
    async testProxy(proxy) {
      return (await call(shared.PROJECT_COMMANDS.testProxy, { proxy })) as ProxyHealth;
    },
    async vpnList() {
      return (await call(shared.PROJECT_COMMANDS.vpnList)) as VpnConnection[];
    },
    async vpnConnect(name) {
      return (await call(shared.PROJECT_COMMANDS.vpnConnect, { name })) as string;
    },
    async vpnDisconnect(name) {
      return (await call(shared.PROJECT_COMMANDS.vpnDisconnect, { name })) as string;
    },
    async vpnWireguard() {
      return (await call(shared.PROJECT_COMMANDS.vpnWireguard)) as WireGuardInfo;
    },
    async vpnWireguardOpen() {
      await call(shared.PROJECT_COMMANDS.vpnWireguardOpen);
    },
    async probeSourceChecksum(url) {
      return (await call(shared.PROJECT_COMMANDS.probeSourceChecksum, { url })) as SourceChecksum;
    },
    async listPlaylistEntries(url, limit) {
      return (await call(shared.PROJECT_COMMANDS.listPlaylistEntries, {
        url,
        limit: limit ?? null,
      })) as PlaylistEntry[];
    },
    async listAudioTracks(url) {
      return (await call(shared.PROJECT_COMMANDS.listAudioTracks, { url })) as AudioTrack[];
    },
    async installWatchdog() {
      return (await call(shared.PROJECT_COMMANDS.installWatchdog)) as WatchdogStatus;
    },
    async removeWatchdog() {
      return (await call(shared.PROJECT_COMMANDS.removeWatchdog)) as WatchdogStatus;
    },
    async watchdogStatus() {
      return (await call(shared.PROJECT_COMMANDS.watchdogStatus)) as WatchdogStatus;
    },
    async chooseCookiesFile() {
      const raw = await call(shared.PROJECT_COMMANDS.chooseCookiesFile);
      return typeof raw === 'string' ? raw : null;
    },
    async downloadMedia(request) {
      return (await call(shared.PROJECT_COMMANDS.downloadMedia, { request })) as DownloadOutcome;
    },
    async cleanupDownload(runId) {
      await call(shared.PROJECT_COMMANDS.cleanupDownload, { runId });
    },
    async onDownloadProgress(handler) {
      return listen<DownloadProgressEvent>('download-progress', (event) => handler(event.payload));
    },
    async analyzeYoutubeChannel(request) {
      return (await call(shared.PROJECT_COMMANDS.analyzeYoutubeChannel, {
        request,
      })) as YouTubeChannelReport;
    },
    async onChannelAnalysisProgress(handler) {
      return listen<ChannelProgressEvent>('channel-analysis-progress', (event) =>
        handler(event.payload),
      );
    },
    async fetchPlatformRules() {
      return call(shared.PROJECT_COMMANDS.fetchPlatformRules);
    },
  };
}
