
export interface McpServerConfig {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly envKeys: readonly string[];
  readonly workingDir: string | null;
  readonly enabled: boolean;
}

export interface McpServerInput {
  readonly id?: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly key: string; readonly value?: string }[];
  readonly workingDir?: string;
  readonly enabled: boolean;
}

export interface McpToolInfo {
  readonly name: string;
  readonly description: string | null;
  readonly inputSchema: unknown;
}

export interface McpProbeResult {
  readonly serverId: string;
  readonly serverName: string;
  readonly serverVersion: string;
  readonly protocolVersion: string;
  readonly tools: readonly McpToolInfo[];
  readonly elapsedMs: number;
}

export interface McpCallResult {
  readonly serverId: string;
  readonly toolName: string;
  readonly result: unknown;
  readonly isError: boolean;
  readonly elapsedMs: number;
}

/**
 * Sesión MCP viva. Un servidor que maneja un navegador conserva ahí su estado
 * (página abierta, perfil, cookies) entre llamadas; `idleMs` dice cuánto hace
 * que no se usa y el proceso se cierra solo a los 10 minutos.
 */
export interface McpSessionInfo {
  readonly serverId: string;
  readonly pid: number;
  readonly calls: number;
  readonly startedAtMs: number;
  readonly idleMs: number;
}

export interface ToolResult {
  readonly path: string;
  readonly bytes: number;
  readonly message: string;
}

export interface PluginCommandInfo {
  readonly id: string;
  readonly label: string;
  readonly steps: readonly string[];
}

export interface PluginInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly official: boolean;
  readonly kind: 'plugin' | 'skill' | 'connector';
  readonly mcp: { readonly command: string; readonly args: readonly string[]; readonly env: readonly string[] } | null;
  readonly enabled: boolean;
  readonly directory: string;
  readonly error: string | null;
  readonly presets: {
    readonly effects: readonly unknown[];
    readonly exportProfiles: readonly unknown[];
    readonly captionStyles: readonly unknown[];
  };
  readonly commands: readonly PluginCommandInfo[];
}

export interface McpServerInfo {
  readonly url: string;
  readonly token: string;
}

/** Un cliente de IA (Claude Desktop, Antigravity…) que Olyvia sabe conectar con un clic. */
export interface McpDetectedClient {
  readonly id: string;
  readonly label: string;
  readonly installed: boolean;
  readonly downloadUrl: string;
}

export interface McpAutoconnectResult {
  readonly client: string;
  readonly configPath: string;
  readonly message: string;
}

export interface FlowBrowserStatus {
  readonly browser: string | null;
  readonly browserName: string | null;
  readonly running: boolean;
  readonly port: number | null;
  readonly cdpUrl: string | null;
  readonly profileDir: string;
  readonly reason: string | null;
}

export interface FlowEmbedStatus {
  readonly open: boolean;
  readonly url: string | null;
  readonly cdpUrl: string | null;
}

export interface WebSessionInfo {
  readonly name: string;
  readonly url: string | null;
  readonly cdpUrl: string | null;
}

export interface WebSessionsStatus {
  readonly sessions: readonly WebSessionInfo[];
}

export interface ScreenRecordStatus {
  readonly recording: boolean;
  readonly output?: string;
  readonly elapsedSecs?: number;
  readonly bytes?: number;
  readonly webcam?: string;
  readonly streaming?: boolean;
}

export interface ScreenRecordResult {
  readonly ok: boolean;
  readonly output?: string;
  readonly bytes?: number;
  readonly durationSecs?: number;
  readonly width?: number;
  readonly height?: number;
  readonly hasAudio?: boolean;
  readonly error?: string;
}

export interface BrowserInstanceInfo {
  readonly id: string;
  readonly port: number;
  readonly pid?: number;
  readonly cdpUrl: string;
  readonly profileDir: string;
  readonly proxy?: string;
  readonly browser: string;
}

export interface ObsScene {
  readonly id: string;
  readonly name: string;
  readonly fps?: number;
  readonly captureTarget?: 'desktop' | 'window' | 'region';
  readonly windowTitle?: string;
  readonly regionX?: number;
  readonly regionY?: number;
  readonly regionWidth?: number;
  readonly regionHeight?: number;
  readonly webcamDevice?: string;
  readonly audioDevice?: string;
  readonly streamUrl?: string;
  readonly encoder?: 'x264' | 'nvenc' | 'qsv' | 'amf' | 'mf';
  readonly captureScreen?: boolean;
}

export type ObsSceneInput = Omit<ObsScene, 'id'> & { readonly id?: string };

export interface ScreenRecordPreview {
  readonly ok: boolean;
  readonly path?: string;
  readonly width?: number;
  readonly height?: number;
  readonly error?: string;
}

/** Pose del stickman tal como lo serializa el serde de Rust (snake_case). */
export interface StickmanPoseInput {
  readonly spine?: number;
  readonly head?: number;
  readonly upper_arm_l?: number;
  readonly fore_arm_l?: number;
  readonly upper_arm_r?: number;
  readonly fore_arm_r?: number;
  readonly thigh_l?: number;
  readonly shin_l?: number;
  readonly thigh_r?: number;
  readonly shin_r?: number;
  readonly pelvis_dy?: number;
}

export interface StickmanKeyframeInput extends StickmanPoseInput {
  readonly frame: number;
}

export interface StickmanRenderResult {
  readonly ok: boolean;
  readonly path?: string;
  readonly action?: string;
  readonly frames?: number;
  readonly fps?: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationSeconds?: number;
  readonly probeWidth?: number | null;
  readonly probeHeight?: number | null;
  readonly hasAudio?: boolean;
  readonly verified?: boolean;
}

export interface CaptureDevices {
  readonly cameras: readonly string[];
  readonly microphones: readonly string[];
}

/** Conexión VPN nativa de Windows (GET /commands `vpn_list`). */
export interface VpnConnection {
  readonly name: string;
  readonly serverAddress: string;
  readonly tunnelType: string;
  /** Texto de Windows: `Connected` / `Disconnected` / `Connecting`. */
  readonly status: string;
}

export interface WireGuardInfo {
  readonly installed: boolean;
  readonly path: string | null;
}

export interface ExtensionInstallStatus {
  readonly available: boolean;
  readonly prepared: boolean;
  readonly sourcePath: string | null;
  readonly preparedPath: string | null;
  readonly hint: string | null;
}

export type NativeInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
