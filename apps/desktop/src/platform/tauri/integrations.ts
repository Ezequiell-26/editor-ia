import type { DesktopService } from "../../services/contracts";
import type { NativeCall } from './shared';
import * as shared from './shared';
import type { BrowserInstanceInfo, CaptureDevices, ExtensionInstallStatus, FlowBrowserStatus, FlowEmbedStatus, FlowGenerateResult, McpAutoconnectResult, McpCallResult, McpDetectedClient, McpProbeResult, McpServerConfig, McpServerInfo, McpSessionInfo, ObsScene, PluginInfo, ScreenRecordPreview, ScreenRecordResult, ScreenRecordStatus, StickmanRenderResult, SystemInfo, WebSessionsStatus } from "../../services/contracts";
import { listen } from "@tauri-apps/api/event";

export function createIntegrationsService(call: NativeCall): Pick<DesktopService, 'listPlugins' | 'installPlugin' | 'removePlugin' | 'setPluginEnabled' | 'getFlowProxies' | 'setFlowProxy' | 'startMcpServer' | 'mcpServerStatus' | 'mcpRespond' | 'mcpDetectClients' | 'mcpAutoconnect' | 'onMcpCall' | 'extensionStatus' | 'prepareExtension' | 'notifyUser' | 'listMcpServers' | 'saveMcpServer' | 'deleteMcpServer' | 'probeMcpServer' | 'callMcpTool' | 'closeMcpSession' | 'mcpSessionStatus' | 'flowBrowserStatus' | 'flowBrowserLaunch' | 'flowBrowserStop' | 'flowEmbedStatus' | 'flowEmbedOpen' | 'flowEmbedClose' | 'flowEmbedNav' | 'flowEmbedEval' | 'webSessionsStatus' | 'webSessionOpen' | 'webSessionClose' | 'webSessionNav' | 'webSessionEval' | 'flowGenerateImage' | 'screenRecordStatus' | 'screenRecordDevices' | 'screenRecordStart' | 'screenRecordStop' | 'stickmanRender' | 'browserInstanceLaunch' | 'browserInstanceClose' | 'browserInstanceList' | 'browserInstanceNavigate' | 'browserInstanceEval' | 'obsSceneList' | 'obsSceneSave' | 'obsSceneDelete' | 'obsSceneStart' | 'obsScenePreview' | 'systemInfo' | 'chooseTool' | 'revealOutput' | 'openExternalUrl'> {
  return {
    async listPlugins() {
      return (await call(shared.PROJECT_COMMANDS.listPlugins, {})) as PluginInfo[];
    },
    async installPlugin(path) {
      return (await call(shared.PROJECT_COMMANDS.installPlugin, { path })) as PluginInfo;
    },
    async removePlugin(id) {
      await call(shared.PROJECT_COMMANDS.removePlugin, { id });
    },
    async setPluginEnabled(id, enabled) {
      await call(shared.PROJECT_COMMANDS.setPluginEnabled, { id, enabled });
    },
    async getFlowProxies() {
      return (await call(shared.PROJECT_COMMANDS.getFlowProxies, {})) as Record<string, string>;
    },
    async setFlowProxy(accountId, proxy) {
      return (await call(shared.PROJECT_COMMANDS.setFlowProxy, {
        accountId,
        proxy,
      })) as Record<string, string>;
    },
    async startMcpServer() {
      return (await call(shared.PROJECT_COMMANDS.startMcpServer, {})) as McpServerInfo;
    },
    async mcpServerStatus() {
      return (await call(shared.PROJECT_COMMANDS.mcpServerStatus, {})) as McpServerInfo | null;
    },
    async mcpRespond(id, ok, text) {
      return (await call(shared.PROJECT_COMMANDS.mcpRespond, { id, ok, text })) as boolean;
    },
    async mcpDetectClients() {
      return (await call(shared.PROJECT_COMMANDS.mcpDetectClients, {})) as readonly McpDetectedClient[];
    },
    async mcpAutoconnect(client) {
      return (await call(shared.PROJECT_COMMANDS.mcpAutoconnect, { client })) as McpAutoconnectResult;
    },
    async onMcpCall(handler) {
      return listen<{ id: string; tool: string; args: unknown }>('mcp-call', (event) =>
        handler(event.payload),
      );
    },
    async extensionStatus() {
      return (await call(shared.PROJECT_COMMANDS.extensionStatus)) as ExtensionInstallStatus;
    },
    async prepareExtension() {
      return (await call(shared.PROJECT_COMMANDS.prepareExtension)) as ExtensionInstallStatus;
    },
    async notifyUser(title, body) {
      await call(shared.PROJECT_COMMANDS.notifyUser, { title, body });
    },
    async listMcpServers() {
      const raw = await call(shared.PROJECT_COMMANDS.listMcpServers);
      return Array.isArray(raw) ? (raw as McpServerConfig[]) : [];
    },
    async saveMcpServer(input) {
      return (await call(shared.PROJECT_COMMANDS.saveMcpServer, { server: input })) as McpServerConfig;
    },
    async deleteMcpServer(id) {
      await call(shared.PROJECT_COMMANDS.deleteMcpServer, { id });
    },
    async probeMcpServer(id) {
      return (await call(shared.PROJECT_COMMANDS.probeMcpServer, { id })) as McpProbeResult;
    },
    async callMcpTool(id, tool, args) {
      return (await call(shared.PROJECT_COMMANDS.callMcpTool, {
        id,
        tool,
        arguments: args,
      })) as McpCallResult;
    },
    async closeMcpSession(id) {
      return (await call(shared.PROJECT_COMMANDS.closeMcpSession, { id })) === true;
    },
    async mcpSessionStatus() {
      const raw = await call(shared.PROJECT_COMMANDS.mcpSessionStatus);
      return Array.isArray(raw) ? (raw as McpSessionInfo[]) : [];
    },
    async flowBrowserStatus() {
      return (await call(shared.PROJECT_COMMANDS.flowBrowserStatus)) as FlowBrowserStatus;
    },
    async flowBrowserLaunch(url) {
      return (await call(shared.PROJECT_COMMANDS.flowBrowserLaunch, {
        url: url ?? null,
      })) as FlowBrowserStatus;
    },
    async flowBrowserStop() {
      return (await call(shared.PROJECT_COMMANDS.flowBrowserStop)) as boolean;
    },
    async flowEmbedStatus() {
      return (await call(shared.PROJECT_COMMANDS.flowEmbedStatus)) as FlowEmbedStatus;
    },
    async flowEmbedOpen(url) {
      return (await call(shared.PROJECT_COMMANDS.flowEmbedOpen, {
        url: url ?? null,
      })) as FlowEmbedStatus;
    },
    async flowEmbedClose() {
      return (await call(shared.PROJECT_COMMANDS.flowEmbedClose)) as boolean;
    },
    async flowEmbedNav(direction) {
      return (await call(shared.PROJECT_COMMANDS.flowEmbedNav, {
        direction,
      })) as boolean;
    },
    async flowEmbedEval(js) {
      return (await call(shared.PROJECT_COMMANDS.flowEmbedEval, { js })) as string;
    },
    async webSessionsStatus() {
      return (await call(shared.PROJECT_COMMANDS.webSessionsStatus)) as WebSessionsStatus;
    },
    async webSessionOpen(url, slot) {
      return (await call(shared.PROJECT_COMMANDS.webSessionOpen, {
        url,
        slot: slot ?? null,
      })) as WebSessionsStatus;
    },
    async webSessionClose(slot) {
      return (await call(shared.PROJECT_COMMANDS.webSessionClose, {
        slot: slot ?? null,
      })) as boolean;
    },
    async webSessionNav(direction, slot) {
      return (await call(shared.PROJECT_COMMANDS.webSessionNav, {
        direction,
        slot: slot ?? null,
      })) as boolean;
    },
    async webSessionEval(js, slot) {
      return (await call(shared.PROJECT_COMMANDS.webSessionEval, {
        js,
        slot: slot ?? null,
      })) as string;
    },
    async flowGenerateImage(input) {
      return (await call(shared.PROJECT_COMMANDS.flowGenerateImage, {
        prompt: input.prompt,
        outputDir: input.outputDir,
        slot: input.slot ?? null,
        url: input.url ?? null,
        timeoutSecs: input.timeoutSecs ?? null,
        reuseProject: input.reuseProject ?? null,
      })) as FlowGenerateResult;
    },
    async screenRecordStatus() {
      return (await call(shared.PROJECT_COMMANDS.screenRecordStatus)) as ScreenRecordStatus;
    },
    async screenRecordDevices() {
      return (await call(shared.PROJECT_COMMANDS.screenRecordDevices)) as CaptureDevices;
    },
    async screenRecordStart(input) {
      return (await call(shared.PROJECT_COMMANDS.screenRecordStart, {
        outputDir: input.outputDir,
        fps: input.fps ?? null,
        webcamDevice: input.webcamDevice ?? null,
        captureScreen: input.captureScreen ?? null,
        captureTarget: input.captureTarget ?? null,
        windowTitle: input.windowTitle ?? null,
        regionX: input.regionX ?? null,
        regionY: input.regionY ?? null,
        regionWidth: input.regionWidth ?? null,
        regionHeight: input.regionHeight ?? null,
        audioDevice: input.audioDevice ?? null,
        streamUrl: input.streamUrl ?? null,
        encoder: input.encoder ?? null,
      })) as ScreenRecordStatus;
    },
    async screenRecordStop() {
      return (await call(shared.PROJECT_COMMANDS.screenRecordStop)) as ScreenRecordResult;
    },
    async stickmanRender(input) {
      return (await call(shared.PROJECT_COMMANDS.stickmanRender, { request: input })) as StickmanRenderResult;
    },
    async browserInstanceLaunch(input) {
      return (await call(shared.PROJECT_COMMANDS.browserInstanceLaunch, {
        profileId: input.profileId,
        proxyUrl: input.proxyUrl ?? null,
        url: input.url ?? null,
      })) as BrowserInstanceInfo;
    },
    async browserInstanceClose(profileId) {
      return (await call(shared.PROJECT_COMMANDS.browserInstanceClose, { profileId })) as boolean;
    },
    async browserInstanceList() {
      return (await call(shared.PROJECT_COMMANDS.browserInstanceList)) as BrowserInstanceInfo[];
    },
    async browserInstanceNavigate(profileId, url) {
      return (await call(shared.PROJECT_COMMANDS.browserInstanceNavigate, { profileId, url })) as boolean;
    },
    async browserInstanceEval(profileId, expression) {
      return await call(shared.PROJECT_COMMANDS.browserInstanceEval, { profileId, expression });
    },
    async obsSceneList() {
      return (await call(shared.PROJECT_COMMANDS.obsSceneList)) as ObsScene[];
    },
    async obsSceneSave(scene) {
      return (await call(shared.PROJECT_COMMANDS.obsSceneSave, { scene })) as ObsScene;
    },
    async obsSceneDelete(id) {
      return (await call(shared.PROJECT_COMMANDS.obsSceneDelete, { id })) as boolean;
    },
    async obsSceneStart(id, outputDir) {
      return (await call(shared.PROJECT_COMMANDS.obsSceneStart, { id, outputDir })) as ScreenRecordStatus;
    },
    async obsScenePreview(id) {
      return (await call(shared.PROJECT_COMMANDS.obsScenePreview, { id })) as ScreenRecordPreview;
    },
    async systemInfo() {
      return (await call(shared.PROJECT_COMMANDS.systemInfo)) as SystemInfo;
    },
    async chooseTool(tool) {
      return (await call(shared.PROJECT_COMMANDS.chooseTool, { tool })) as SystemInfo | null;
    },
    async revealOutput(path) {
      await call(shared.PROJECT_COMMANDS.revealOutput, { path });
    },
    async openExternalUrl(url) {
      await call(shared.PROJECT_COMMANDS.openExternalUrl, { url });
    },
  };
}
