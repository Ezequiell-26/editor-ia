import type { AssetFileInfo, CopiedMedia, CreateProjectRequest, DuplicateAssetGroup, FsDeleteResult, FsFileContent, FsListing, FsWriteResult, ImportOutcome, MediaFolderListing, MissingAssetInfo, OpenedProject, ProjectVersionInfo, QualityGateReport, RelinkFolderResult, RelinkResult, RestoreProjectVersionResult, VariantWritten } from '../projects';
import type { MatchMediaPlanResult } from '../media';
import type { ProjectDocument } from '@editor-ia/project-schema';

export interface DesktopServiceProjects {
createProject(input: CreateProjectRequest): Promise<OpenedProject | null>;

openProject(): Promise<OpenedProject | null>;

openProjectAt(path: string): Promise<OpenedProject>;

adoptProject(path: string): Promise<OpenedProject>;

saveProject(project: ProjectDocument): Promise<OpenedProject>;

saveProjectAs(project: ProjectDocument): Promise<OpenedProject | null>;

/** Save the delivery `.zip` built by the interface. Null means cancelled. */
  saveDeliveryPackage(bytes: Uint8Array, fileName: string): Promise<string | null>;

closeProject(): Promise<void>;

importAssets(fpsNum: number, fpsDen: number): Promise<ImportOutcome | null>;

importMediaPaths(input: {
    paths: readonly string[];
    fpsNum: number;
    fpsDen: number;
    confirmRights?: boolean;
    provider?: string;
  }): Promise<ImportOutcome>;

listMediaFolder(input: {
    folder: string;
    root?: string;
  }): Promise<MediaFolderListing>;

/** Lista el contenido de una carpeta de la PC (carpetas primero, sin recursión). */
  listDirectory(path: string): Promise<FsListing>;

/** Lee un archivo de texto acotado (512 KiB máx). */
  readTextFile(path: string): Promise<FsFileContent>;

/** Escribe texto en un archivo del disco (crea carpetas padre). Tope 10 MiB. */
  writeTextFile(path: string, content: string): Promise<FsWriteResult>;

/** Crea una carpeta en el disco (padres incluidos por defecto). */
  makeDirectory(path: string, recursive?: boolean): Promise<FsWriteResult>;

/** Borra un archivo o carpeta del disco; carpetas con contenido exigen recursive=true. */
  deletePath(path: string, recursive?: boolean): Promise<FsDeleteResult>;

/** Mueve o renombra un archivo/carpeta del disco (el destino no debe existir). */
  movePath(from: string, to: string): Promise<FsWriteResult>;

matchMediaPlan(input: {
    sentences: readonly string[];
    images: readonly string[];
    /** Descripción medida del contenido, alineada con `images` por índice. */
    imageDescriptions?: readonly string[];
    approvedCost?: boolean;
  }): Promise<MatchMediaPlanResult>;

recentProjectThumbnail(path: string): Promise<string | null>;

/**
   * Quality Gate del proyecto abierto: revisa el documento persistido y los
   * archivos declarados por los assets. `passed` es false si hay errores.
   */
  qualityGateReview(): Promise<QualityGateReport>;

checkAssetFiles(paths: string[]): Promise<AssetFileInfo[]>;

/**
   * Fase 1 · Proyecto: medios faltantes, relink, historial y duplicados.
   * `projectPath` absoluto; si se omite se usa el proyecto abierto.
   */
  chooseMediaFolder(title?: string): Promise<string | null>;

findMissingAssets(projectPath?: string): Promise<MissingAssetInfo[]>;

/**
   * Repunta un asset a `newPath` (absoluto). Si está fuera de la raíz del
   * proyecto se copia a `<root>/media/relink/` y `copied` es true. Valida
   * existencia y nombre+tamaño; si el asset declara SHA-256 y el archivo lo
   * contradice, rechaza. Devuelve `bytes` (y `sha256` si se calculó) para que la
   * UI refresque `asset.integrity`. Requiere el proyecto abierto en la sesión.
   * Un proxy NO es un origen válido de relink: es sólo de previsualización.
   */
  relinkAsset(assetId: string, newPath: string): Promise<RelinkResult>;

/**
   * Relink masivo desde una carpeta: empareja faltantes por nombre+tamaño y
   * devuelve la ruta nueva de cada asset relinkeado.
   */
  relinkAssetsFromFolder(
    projectPath: string | null,
    folder: string,
  ): Promise<RelinkFolderResult>;

/** Snapshots de `<root>/.olyvia-history/`, del más nuevo al más viejo. */
  listProjectVersions(projectPath?: string): Promise<ProjectVersionInfo[]>;

/**
   * Restaura una versión. `in-place` reemplaza el proyecto guardando antes un
   * snapshot `before-restore`; `copy` crea `<nombre>-restored-<n>.editoria.json`.
   */
  restoreProjectVersion(
    projectPath: string,
    versionId: string,
    mode?: 'in-place' | 'copy',
  ): Promise<RestoreProjectVersionResult>;

/** Grupos de assets con contenido idéntico (SHA-256 del archivo). */
  findDuplicateAssets(projectPath?: string): Promise<DuplicateAssetGroup[]>;

writeProjectVariant(input: {
    directory: string;
    fileName: string;
    project: unknown;
  }): Promise<VariantWritten>;

/** Escribe un proyecto sin sesión abierta (cola por carpeta). */
  writeProjectFile(input: {
    directory: string;
    fileName: string;
    project: unknown;
  }): Promise<VariantWritten>;

/** Copia material externo a `media/` de la carpeta de entrega. */
  copyMediaInto(input: {
    directory: string;
    paths: readonly string[];
  }): Promise<readonly CopiedMedia[]>;

loadDirectorMemory(): Promise<unknown | null>;

saveDirectorMemory(memory: unknown): Promise<void>;

savePublicationManifest(manifest: unknown): Promise<string | null>;

mediaUrl(root: string, relativePath: string): string;

/** Convierte una ruta absoluta en URL cargable. Vacía fuera de la app nativa. */
  absoluteFileUrl(path: string): string;

joinPath(root: string, relativePath: string): string;
}
