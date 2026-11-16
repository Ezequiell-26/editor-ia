import type { BrowserInstanceInfo, CaptureDevices, CursorOverlaySpec, WebcamChromaSpec, ExtensionInstallStatus, FlowBrowserStatus, FlowEmbedStatus, McpAuditTail, McpAutoconnectResult, McpCallResult, McpDetectedClient, McpProbeResult, McpServerConfig, McpServerInfo, McpServerInput, McpSessionInfo, ObsScene, ObsSceneInput, PluginInfo, ScreenRecordPreview, ScreenRecordResult, ScreenRecordStatus, StickmanKeyframeInput, StickmanRenderResult, WebSessionsStatus, WhiteboardRenderResult, WhiteboardStatus } from '../integrations';
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

/** Frena el servidor MCP embebido y libera el puerto; `true` si había algo que detener. */
  mcpServerStop(): Promise<boolean>;

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

/**
   * Últimas `limit` entradas del audit log JSONL del servidor MCP propio
   * (`<config_dir>/mcp-audit.jsonl`), ya parseadas y sanitizadas. `limit`
   * default 50, tope 500 en el backend. Archivo inexistente → cola vacía;
   * archivo ilegible → error (la UI distingue "sin auditoría" de "no pude
   * leerla").
   */
  mcpAuditTail(limit?: number): Promise<McpAuditTail>;

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
    cursorOverlay?: CursorOverlaySpec | null;
    webcamChroma?: WebcamChromaSpec | null;
  }): Promise<ScreenRecordStatus>;

screenRecordStop(): Promise<ScreenRecordResult>;

/**
   * Captura UN frame PNG con la configuración de fuentes indicada (mismo
   * motor y filtergraph PiP que `screen_record_start`, sin grabar). Devuelve
   * la ruta del PNG en `path`; `ok: false` + `error` si la captura falla
   * (sin ffmpeg, dispositivo ocupado, timeout).
   */
screenRecordSnapshot(input: {
    fps?: number;
    webcamDevice?: string;
    captureScreen?: boolean;
    captureTarget?: 'desktop' | 'window' | 'region';
    windowTitle?: string;
    regionX?: number;
    regionY?: number;
    regionWidth?: number;
    regionHeight?: number;
    webcamChroma?: WebcamChromaSpec | null;
  }): Promise<ScreenRecordPreview>;

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

/**
 * Generador "Pizarra blanca" (whiteboard-animator, MIT): convierte
 * `imagePath` en un MP4 donde una mano dibuja los trazos. `audioPath`
 * opcional sincroniza el dibujo con una narración; `quality` es
 * `low|medium|high`. El video queda en el cache de la app y la UI lo revela.
 */
whiteboardStatus(): Promise<WhiteboardStatus>;
whiteboardGenerate(input: {
    imagePath: string;
    audioPath?: string;
    durationSeconds?: number;
    quality?: 'low' | 'medium' | 'high';
  }): Promise<WhiteboardRenderResult>;

systemInfo(): Promise<SystemInfo>;

/** Familias tipográficas instaladas en el sistema (DirectWrite en Windows). */
listSystemFonts(): Promise<string[]>;

chooseTool(tool: 'ffmpeg' | 'ffprobe'): Promise<SystemInfo | null>;

revealOutput(path: string): Promise<void>;

openExternalUrl(url: string): Promise<void>;
}
