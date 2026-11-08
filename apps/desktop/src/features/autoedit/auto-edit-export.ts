import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import type { DesktopService, MediaAnalysis } from '../../services/project-service';
import { chooseExportProfile } from '../../state/render-profile';
import { applyAutoEditVariant } from './apply-auto-edit';
import { subsetVariant, type AutoEditVariant } from './auto-edit';

/**
 * Exporta las variantes del editor automático a MP4 en lote.
 *
 * Cada variante se monta con `applyAutoEditVariant` (reemplazando la timeline:
 * la variante ES la edición), se escribe con `write_project_variant` — que
 * espeja los medios desde la raíz del proyecto — y se renderiza con
 * `render_project_variant`, que verifica el MP4 antes de publicarlo. No toca
 * el proyecto abierto ni la timeline actual.
 */

export interface AutoEditExportEntry {
  readonly variant: AutoEditVariant;
  /** Índices de corte elegidos (los chips de la tarjeta). */
  readonly indices: readonly number[];
  /** Título visible; también nombra el archivo de salida. */
  readonly title?: string | undefined;
}

export interface AutoEditExportOptions {
  readonly project: ProjectDocument;
  readonly assets: readonly Asset[];
  readonly entries: readonly AutoEditExportEntry[];
  readonly outputDir: string;
  readonly analysis: MediaAnalysis | null;
  readonly improveAudio: boolean;
  readonly addCaptions: boolean;
  readonly onProgress?: ((item: AutoEditExportItem) => void) | undefined;
}

export interface AutoEditExportItem {
  readonly name: string;
  readonly status: 'done' | 'skipped' | 'failed';
  readonly message: string;
  readonly videoPath?: string;
  readonly projectPath?: string;
  readonly durationSeconds?: number;
  readonly bytes?: number;
}

export interface AutoEditExportReport {
  readonly items: readonly AutoEditExportItem[];
  readonly done: number;
  readonly failed: number;
  readonly skipped: number;
}

type ExportService = Pick<
  DesktopService,
  'writeProjectVariant' | 'renderProjectVariant'
>;

function slug(name: string): string {
  const clean = name
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return clean.length > 0 ? clean.slice(0, 60) : 'variante';
}

function joinPath(directory: string, file: string): string {
  return `${directory.replace(/[\\/]+$/, '')}\\${file}`;
}

async function exportOne(
  service: ExportService,
  input: AutoEditExportOptions,
  entry: AutoEditExportEntry,
): Promise<AutoEditExportItem> {
  const name = entry.title ?? entry.variant.name;
  const base = { name };
  try {
    const chosen = subsetVariant(entry.variant, entry.indices);
    if (chosen.cuts.length === 0) {
      return { ...base, status: 'skipped', message: 'sin cortes seleccionados' };
    }
    const matched = input.assets.filter((asset) =>
      chosen.cuts.some((cut) => cut.assetId === asset.id),
    );
    const applied = applyAutoEditVariant(
      input.project,
      matched.length > 0 ? matched : input.assets,
      chosen,
      input.analysis,
      {
        replace: true,
        improveAudio: input.improveAudio,
        addCaptions: input.addCaptions && chosen.captions.length > 0,
        transition: chosen.recipe.transition,
        zoom: chosen.recipe.zoom,
      },
    );
    const profile = chooseExportProfile(applied.project);
    if (!profile) {
      return { ...base, status: 'failed', message: 'el proyecto no tiene perfil de render' };
    }
    const stem = slug(name);
    const written = await service.writeProjectVariant({
      directory: input.outputDir,
      fileName: `${stem}.editoria.json`,
      project: applied.project,
    });
    const rendered = await service.renderProjectVariant({
      projectPath: written.path,
      profileId: profile.id,
      outputPath: joinPath(input.outputDir, `${stem}.mp4`),
      includeCaptions: input.addCaptions && chosen.captions.length > 0,
    });
    return {
      ...base,
      status: 'done',
      message: `MP4 de ${rendered.durationSeconds.toFixed(1)} s verificado`,
      videoPath: rendered.path,
      projectPath: written.path,
      durationSeconds: rendered.durationSeconds,
      bytes: rendered.bytes,
    };
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      message: error instanceof Error ? error.message : 'error desconocido',
    };
  }
}

export async function exportAutoEditVariants(
  service: ExportService,
  input: AutoEditExportOptions,
): Promise<AutoEditExportReport> {
  const items: AutoEditExportItem[] = [];
  for (const entry of input.entries) {
    const item = await exportOne(service, input, entry);
    items.push(item);
    input.onProgress?.(item);
  }
  return {
    items,
    done: items.filter((item) => item.status === 'done').length,
    failed: items.filter((item) => item.status === 'failed').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
  };
}

/** Resumen corto para el aviso. */
export function autoEditExportSummary(report: AutoEditExportReport): string {
  if (report.items.length === 0) return 'No hay variantes para exportar.';
  return `${report.done} MP4 exportado(s) · ${report.failed} fallo(s) · ${report.skipped} salteado(s).`;
}
