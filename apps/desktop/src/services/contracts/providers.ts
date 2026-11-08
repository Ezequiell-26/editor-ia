
export interface ExecutableInfo {
  readonly available: boolean;
  readonly path: string | null;
  readonly version: string | null;
  readonly hint: string | null;
}

export interface SystemInfo {
  readonly appVersion: string;
  readonly os: string;
  readonly arch: string;
  readonly ffmpeg: ExecutableInfo;
  readonly ffprobe: ExecutableInfo;
  readonly powershell: ExecutableInfo;
  readonly hardware: HardwareEncoders;
  readonly configDir: string;
  readonly cacheDir: string;
}

export interface ProviderInfo {
  readonly kind: 'openai-compatible' | 'mock' | string;
  readonly baseUrl: string;
  readonly model: string;
  readonly hasKey: boolean;
  readonly keyringAvailable: boolean;
}

/**
 * Resultado tipado de «probar conexión» con el proveedor de IA.
 *
 * `status` distingue lo accionable de lo genérico: sin configurar, sin clave,
 * 401, 404, timeout, sin conexión o éxito. La interfaz puede mostrar `detail`
 * tal cual porque el backend ya lo redacta sin rutas ni secretos.
 */
export type ProviderTestStatus =
  | 'ok'
  | 'mock'
  | 'unconfigured'
  | 'missing-key'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'timeout'
  | 'unreachable'
  | 'http-error'
  | 'invalid-response';

export interface ProviderTestResult {
  readonly status: ProviderTestStatus | string;
  readonly ok: boolean;
  readonly httpStatus: number | null;
  readonly latencyMs: number;
  /** Modelo configurado si el proveedor lo lista; si no, el primero listado. */
  readonly model: string | null;
  readonly detail: string;
  readonly baseUrl: string;
}

export interface AudioProviderInfo {
  readonly kind: 'windows-sapi' | 'elevenlabs' | 'external-web' | string;
  readonly voiceId: string;
  readonly modelId: string;
  readonly approved: boolean;
  readonly externalUrl: string;
  readonly hasKey: boolean;
  readonly keyringAvailable: boolean;
}

/** Automático (GPU si existe), hardware forzado o software. */
export type EncoderPreference = 'auto' | 'hardware' | 'software';

/** Un modelo de IA local: peso, licencia y estado de descarga. */
export interface ModelInfo {
  readonly id: string;
  readonly capability: string;
  readonly purpose: string;
  readonly bytes: number;
  readonly downloaded: boolean;
  readonly license: { readonly id: string; readonly detail: string; readonly url: string };
  readonly sourceUrl: string;
}

/** Una capacidad de la app y sus backends, con estado medido. */
export interface CapabilityInfo {
  readonly id: string;
  readonly label: string;
  readonly purpose: string;
  readonly backends: readonly {
    readonly id: string;
    readonly kind: string;
    readonly detail: string;
    readonly available: boolean;
    readonly reason: string | null;
  }[];
  readonly available: boolean;
}

export interface HardwareEncoders {
  readonly h264: string | null;
  readonly hevc: string | null;
  readonly av1: string | null;
  readonly vp9: string | null;
  readonly checked: boolean;
}

/**
 * Matriz REAL de lo que el FFmpeg de la app puede exportar, sondeada con
 * `-encoders` (comando `export_capabilities`). La UI no debe ofrecer nada que
 * no esté acá: contenedores/códecs no soportados por el build aparecen fuera o
 * con listas vacías. Este FFmpeg LGPL no incluye x264/x265 por licencia, pero
 * sí `libopenh264`/`h264_mf`/hardware; por eso las listas son dinámicas.
 */
export interface ExportCapabilities {
  readonly containers: readonly {
    readonly container: 'mp4' | 'mov' | 'webm';
    readonly videoCodecs: readonly string[];
    readonly audioCodecs: readonly string[];
  }[];
  readonly pixelFormats: readonly string[];
  readonly videoCodecs: Readonly<
    Record<string, { readonly software: readonly string[]; readonly hardware: readonly string[] }>
  >;
  readonly audioCodecs: readonly string[];
  /** Metadatos HDR10/HLG: el build actual NO los inyecta (siempre SDR). */
  readonly hdr: boolean;
  readonly maxWidth: number;
  readonly maxHeight: number;
}
