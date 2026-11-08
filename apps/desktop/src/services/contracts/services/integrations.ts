import type { BrowserInstanceInfo, CaptureDevices, ExtensionInstallStatus, FlowBrowserStatus, FlowEmbedStatus, McpAutoconnectResult, McpCallResult, McpDetectedClient, McpProbeResult, McpServerConfig, McpServerInfo, McpServerInput, McpSessionInfo, ObsScene, ObsSceneInput, PluginInfo, ScreenRecordPreview, ScreenRecordResult, ScreenRecordStatus, StickmanKeyframeInput, StickmanRenderResult, WebSessionsStatus } from '../integrations';
import type { FlowGenerateResult } from '../media';
import type { SystemInfo } from '../providers';
import type { UnlistenFn } from '../events';

export interface DesktopServiceIntegrations {
/** Plugins instalados (oficiales y de usuario). */
  listPlugins(): Promise<readonly PluginInfo[]>;

installPlugin(path: string): Promise<PluginInfo>;

removePlugin(id: string): Promise<void>;

setPluginEnabled(id: string, enabled: boolean): Promise<void>;

/** Proxy por cuenta de Google Flow (se escribe en proxies.json del MCP). */
  getFlowProxies(): Promise<Record<string, string>>;

setFlowProxy(accountId: string, proxy: string | null): Promise<Record<string, string>>;

/** Servidor MCP local para que una IA externa maneje la app. */
  startMcpServer(): Promise<McpServerInfo>;

mcpServerStatus(): Promise<McpServerInfo | null>;

mcpRespond(id: string, ok: boolean, text: string): Promise<boolean>;

/** Clientes de IA que Olyvia sabe conectar con un botón (detecta si están instalados). */
  mcpDetectClients(): Promise<readonly McpDetectedClient[]>;

/** Arranca el servidor MCP si hace falta y conecta ese cliente con un clic. */
  mcpAutoconnect(client: string): Promise<McpAutoconnectResult>;

onMcpCall(
    handler: (payload: { readonly id: string; readonly tool: string; readonly args: unknown }) => void,
  ): Promise<UnlistenFn>;

extensionStatus(): Promise<ExtensionInstallStatus>;

prepareExtension(): Promise<ExtensionInstallStatus>;

notifyUser(title: string, body: string): Promise<void>;

listMcpServers(): Promise<McpServerConfig[]>;

saveMcpServer(input: McpServerInput): Promise<McpServerConfig>;

deleteMcpServer(id: string): Promise<void>;

probeMcpServer(id: string): Promise<McpProbeResult>;

callMcpTool(id: string, tool: string, args: unknown): Promise<McpCallResult>;

/** Cierra la sesión viva de un servidor y devuelve si había una abierta. */
  closeMcpSession(id: string): Promise<boolean>;

/** Sesiones vivas ahora mismo. */
  mcpSessionStatus(): Promise<McpSessionInfo[]>;

flowBrowserStatus(): Promise<FlowBrowserStatus>;

flowBrowserLaunch(url?: string): Promise<FlowBrowserStatus>;

flowBrowserStop(): Promise<boolean>;

flowEmbedStatus(): Promise<FlowEmbedStatus>;

flowEmbedOpen(url?: string): Promise<FlowEmbedStatus>;

flowEmbedClose(): Promise<boolean>;

flowEmbedNav(direction: 'back' | 'forward' | 'reload'): Promise<boolean>;

flowEmbedEval(js: string): Promise<string>;

webSessionsStatus(): Promise<WebSessionsStatus>;

webSessionOpen(url: string, slot?: string): Promise<WebSessionsStatus>;

webSessionClose(slot?: string): Promise<boolean>;

webSessionNav(direction: 'back' | 'forward' | 'reload', slot?: string): Promise<boolean>;

webSessionEval(js: string, slot?: string): Promise<string>;

flowGenerateImage(input: {
    prompt: string;
    outputDir: string;
    slot?: string;
    url?: string;
    timeoutSecs?: number;
    reuseProject?: boolean;
  }): Promise<FlowGenerateResult>;

screenRecordStatus(): Promise<ScreenRecordStatus>;

screenRecordDevices(): Promise<CaptureDevices>;

screenRecordStart(input: {
    outputDir: string;
    fps?: number;
    webcamDevice?: string;
    captureScreen?: boolean;
    captureTarget?: 'desktop' | 'window' | 'region';
    windowTitle?: string;
    regionX?: number;
    regionY?: number;
    regionWidth?: number;
    regionHeight?: number;
    audioDevice?: string;
    streamUrl?: string;
    encoder?: 'x264' | 'nvenc' | 'qsv' | 'amf' | 'mf';
  }): Promise<ScreenRecordStatus>;

screenRecordStop(): Promise<ScreenRecordResult>;

browserInstanceLaunch(input: {
    profileId: string;
    proxyUrl?: string;
    url?: string;
  }): Promise<BrowserInstanceInfo>;

browserInstanceClose(profileId: string): Promise<boolean>;

browserInstanceList(): Promise<BrowserInstanceInfo[]>;

browserInstanceNavigate(profileId: string, url: string): Promise<boolean>;

browserInstanceEval(profileId: string, expression: string): Promise<unknown>;

obsSceneList(): Promise<ObsScene[]>;

obsSceneSave(scene: ObsSceneInput): Promise<ObsScene>;

obsSceneDelete(id: string): Promise<boolean>;

obsSceneStart(id: string, outputDir: string): Promise<ScreenRecordStatus>;

obsScenePreview(id: string): Promise<ScreenRecordPreview>;

stickmanRender(input: {
    outputPath: string;
    action?: 'idle' | 'walk' | 'run' | 'wave' | 'jump' | 'custom';
    durationSeconds?: number;
    fps?: number;
    width?: number;
    height?: number;
    /** Keyframes de pose para `action: 'custom'` (snake_case, como el serde de Rust). */
    keyframes?: StickmanKeyframeInput[];
    boneHex?: string;
    bgHex?: string;
    particles?: {
      kind?: 'confetti' | 'snow' | 'sparks' | 'bounce';
      count?: number;
      colorHex?: string;
      gravity?: number;
      bounce?: number;
    };
  }): Promise<StickmanRenderResult>;

systemInfo(): Promise<SystemInfo>;

chooseTool(tool: 'ffmpeg' | 'ffprobe'): Promise<SystemInfo | null>;

revealOutput(path: string): Promise<void>;

openExternalUrl(url: string): Promise<void>;
}
