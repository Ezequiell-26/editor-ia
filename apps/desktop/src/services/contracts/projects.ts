import type { Asset, ProjectDocument } from '@editor-ia/project-schema';

/**
 * The UI's only door to the native side.
 *
 * The webview never touches the filesystem, a shell or a credential. It calls
 * typed methods; every project document returned by Rust is parsed with the
 * canonical schema before it can reach a screen, and every native error is
 * stripped of absolute paths before it is rendered.
 */

export interface OpenedProject {
  readonly project: ProjectDocument;
  readonly label: string;
  readonly path: string;
  readonly root: string;
}

export interface CreateProjectRequest {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
}

export interface ImportOutcome {
  readonly assets: Asset[];
  readonly warnings: string[];
}

export interface MediaFolderFile {
  readonly path: string;
  readonly name: string;
  readonly kind: 'image' | 'audio' | 'video' | string;
  readonly bytes: number;
}

export interface MediaFolderListing {
  readonly directory: string;
  readonly files: readonly MediaFolderFile[];
}

export interface FsEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: 'dir' | 'image' | 'audio' | 'video' | 'subtitle' | 'text' | 'other' | string;
  readonly bytes: number;
}

export interface FsListing {
  readonly directory: string;
  readonly entries: readonly FsEntry[];
  readonly truncated: boolean;
}

export interface FsFileContent {
  readonly path: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly content: string;
}

export interface FsWriteResult {
  readonly path: string;
  readonly bytes: number;
}

export interface FsDeleteResult {
  readonly path: string;
  readonly recursive: boolean;
}

export interface AssetFileInfo {
  readonly path: string;
  readonly exists: boolean;
  readonly bytes: number;
}

// ─────────────── Quality Gate ───────────────
// Contrato nativo: `quality_gate_review`. Evalúa el último estado
// persistido del proyecto abierto (guardar antes de pedir el veredicto).

export type QualityGateCheck =
  | 'missing-resources'
  | 'clip-range'
  | 'caption-sync'
  | 'loudness'
  | 'resolution'
  | 'color'
  | 'render-verify'
  | 'rights';

export interface QualityGateFinding {
  readonly check: QualityGateCheck;
  readonly severity: 'error' | 'warning';
  /** Ruta JSON dentro del documento del proyecto. */
  readonly path: string;
  readonly message: string;
}

export interface QualityGateReport {
  readonly passed: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly findings: readonly QualityGateFinding[];
}

// ─────────────── Fase 1 · Recuperación, historial y duplicados ───────────────
// Contrato nativo: `choose_media_folder`, `find_missing_assets`, `relink_asset`,
// `relink_assets_from_folder`, `list_project_versions`,
// `restore_project_version`, `find_duplicate_assets`.
//
// Todas las rutas de proyecto son absolutas (la que muestra Recientes). Si se
// omite `projectPath`, el backend usa el proyecto abierto en la sesión.

export interface MissingAssetInfo {
  readonly assetId: string;
  readonly label: string;
  readonly kind: string;
  /** Ruta tal como la guarda el proyecto (relativa a la raíz). */
  readonly path: string;
  /** Clips del timeline que usan este medio (para explicar el impacto). */
  readonly usedByClipIds: readonly string[];
  /** Proxy válido existente (`media/proxies/...`) o null. */
  readonly proxyPath: string | null;
}

export interface RelinkResult {
  readonly ok: boolean;
  readonly assetId?: string;
  /** Ruta nueva relativa al proyecto, cuando `ok`. */
  readonly path?: string;
  /** Copia el archivo dentro de `<root>/media/relink/` si estaba fuera. */
  readonly copied?: boolean;
  /** Validación usada: nombre+tamaño o hash SHA-256. */
  readonly validatedBy?: 'name-size' | 'hash';
  /** Bytes del archivo final (para refrescar `asset.sizeBytes` en la UI). */
  readonly bytes?: number | null;
  /** SHA-256 calculado al validar/copiar; null si no se calculó. */
  readonly sha256?: string | null;
  /** Motivo legible cuando `ok` es false. */
  readonly reason?: string;
  readonly missing?: MissingAssetInfo;
}

export interface RelinkFolderRejected {
  readonly path: string;
  readonly reason: string;
}

export interface RelinkFolderResult {
  /** Resultados por asset: `assetId` + `path` nueva para actualizar el store. */
  readonly relinked: readonly RelinkResult[];
  readonly stillMissing: readonly MissingAssetInfo[];
  readonly rejected: readonly RelinkFolderRejected[];
}

export type ProjectVersionReason =
  | 'autosave'
  | 'manual'
  | 'pre-crash'
  | 'before-restore'
  | 'snapshot'
  | 'rotated';

export interface ProjectVersionInfo {
  /** Identificador estable: nombre del archivo de versión. */
  readonly id: string;
  readonly projectPath: string;
  /** Ruta absoluta del snapshot en `<root>/.olyvia-history/`. */
  readonly path: string;
  readonly savedAtMs: number;
  readonly bytes: number;
  readonly reason: ProjectVersionReason;
  readonly projectName: string | null;
  readonly assetCount: number;
  readonly clipCount: number;
}

export interface RestoreProjectVersionResult {
  /** `in-place` reemplaza el proyecto (con copia previa); `copy` crea otro archivo. */
  readonly restoreMode: 'in-place' | 'copy';
  readonly projectPath: string;
  /** Copia de seguridad del proyecto previo a restaurar (in-place). */
  readonly backupPath: string | null;
  readonly version: ProjectVersionInfo;
}

export interface DuplicateAssetGroup {
  readonly sha256: string;
  readonly bytes: number;
  readonly assetIds: readonly string[];
  readonly labels: readonly string[];
  readonly paths: readonly string[];
  /** Clip ids que usan cada asset (las copias en uso no se eliminan). */
  readonly usedByClipIds: Readonly<Record<string, readonly string[]>>;
}

export interface CopiedMedia {
  readonly source: string;
  readonly relativePath: string;
  readonly bytes: number;
}

export interface VariantWritten {
  readonly path: string;
  readonly bytes: number;
  readonly copiedAssets: number;
}

export interface VariantRendered {
  readonly path: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
}

export interface PickedSubtitleFile {
  readonly name: string;
  readonly text: string;
}
