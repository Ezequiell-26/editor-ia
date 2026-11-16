
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
  /** Causa reportada por ffmpeg cuando la grabación murió sola. */
  readonly error?: string;
}

/** Cursor estilizado para grabaciones de escritorio (se quema con ffmpeg). */
export interface CursorOverlaySpec {
  readonly style: 'flecha' | 'punto' | 'cruz' | 'cheia' | '3d';
  readonly color: 'blanco' | 'negro' | 'amarillo' | 'verde';
  readonly scale: 0.5 | 1 | 2;
  readonly ripple: boolean;
}

/**
 * Chroma key de la webcam durante la grabación (paridad
 * `gravar_webcam_chroma` de AlaukCut): el filtro `chromakey` de FFmpeg se
 * aplica a la fuente dshow antes del PiP. Misma semántica que
 * `ChromaKeySchema` de la timeline.
 */
export interface WebcamChromaSpec {
  readonly color: string;
  readonly similarity: number;
  readonly blend: number;
}

export interface ScreenRecordResult {
  readonly ok: boolean;
  readonly output?: string;
  readonly bytes?: number;
  readonly durationSecs?: number;
  readonly width?: number;
  readonly height?: number;
  readonly hasAudio?: boolean;
  readonly cursorBurned?: boolean;
  readonly warning?: string;
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
  /**
   * Sólo ENTRADA (obsSceneSave): URL RTMP completa que el usuario pegó —
   * puede incluir la stream key, que el backend separa y guarda en el
   * llavero del sistema (nunca se persiste). En las escenas devueltas por
   * `obsSceneList`/`obsSceneSave` viene ausente.
   */
  readonly streamUrl?: string;
  /**
   * Endpoint RTMP persistido SIN la clave de stream. En `ObsSceneInput`,
   * `''` (string vacío) limpia toda la configuración de streaming de la
   * escena (endpoint + clave del llavero).
   */
  readonly streamEndpoint?: string;
  readonly encoder?: 'x264' | 'nvenc' | 'qsv' | 'amf' | 'mf';
  readonly captureScreen?: boolean;
  /** Settings used by screen_record_start; absent in older saved scenes. */
  readonly cursorOverlay?: CursorOverlaySpec | null;
  readonly webcamChroma?: WebcamChromaSpec | null;
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

/** Resultado de `whiteboard_generate` (WhiteboardOutcome del backend). */
export interface WhiteboardRenderResult {
  readonly videoPath: string;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly processingTimeMs: number;
}

/** Estado del motor Python whiteboard-animator (`whiteboard_status`). */
export interface WhiteboardStatus {
  readonly available: boolean;
  readonly python?: string | null;
  readonly reason?: string | null;
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

// ───────────────────────── Audit log del MCP ─────────────────────────
// Comando `mcp_audit_tail`: últimas líneas del JSONL
// `<config_dir>/mcp-audit.jsonl` que escribe `JsonlMcpAuditSink`. Las
// entradas ya vienen sanitizadas del backend (secretos `[redacted]`), pero
// el archivo es texto plano: la UI las trata como datos no confiables.

/**
 * Una línea del audit ya parseada. Los campos son opcionales porque el
 * archivo puede venir de una versión vieja o editado a mano: la UI muestra
 * lo que haya sin inventar.
 */
export interface McpAuditEntry {
  /** Epoch ms (SystemTime UNIX) de la llamada. */
  readonly ts?: number;
  /** Herramienta auditada (`tools/call`); ausente en líneas de otra forma. */
  readonly tool?: string;
  /** Argumentos ya sanitizados (`[redacted]` en claves sensibles). */
  readonly args?: unknown;
  readonly ok?: boolean;
  /** Duración de la llamada en ms (sólo entradas del dispatcher). */
  readonly durationMs?: number;
  /** Texto de resultado sanitizado (sólo entradas del dispatcher). */
  readonly result?: string;
  /** Presente cuando el scope rechazó la llamada (`denied: "scope"`). */
  readonly denied?: string;
  readonly requiredScope?: string;
  readonly grantedScopes?: readonly string[];
}

/** `AuditTail` del backend (serde camelCase). */
export interface McpAuditTail {
  /** Entradas parseadas en orden cronológico, ya sanitizadas. */
  readonly entries: readonly McpAuditEntry[];
  /** Líneas no vacías que no parsearon como JSON (cuenta, no contenido). */
  readonly skipped: number;
  /** `true` si el archivo tiene más líneas de las devueltas. */
  readonly truncated: boolean;
}

export type NativeInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
