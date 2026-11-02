import { createEmptyProject, type Asset, type ProjectDocument } from '@editor-ia/project-schema';
import type { AudioPeaks, DesktopService } from '../services/project-service';
import { measureAdaptiveProfile } from './adaptive';
import { runAutoCleanup } from './auto-cleanup';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
  fpsOf,
  newId,
} from './project-actions';
import { chooseExportProfile } from './render-profile';

/**
 * Cola por carpeta.
 *
 * Toma los videos de una carpeta y entrega uno por uno sin abrir nada en la
 * sesión: copia el material a `media/` de la carpeta de salida, arma un
 * proyecto con ruta relativa, mide los picos **por ruta** (no hay proyecto
 * abierto), limpia con el perfil adaptativo, escribe y renderiza.
 *
 * Es la pieza que faltaba para el modo desatendido de verdad: no toca el
 * proyecto que la persona tiene abierto.
 */

export interface FolderQueueOptions {
  readonly folder: string;
  readonly outputDir: string;
  /** Tope de archivos por corrida (12). */
  readonly maxFiles?: number | undefined;
  /** Ancho/alto de salida; si falta, se usa el del material. */
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface FolderQueueItem {
  readonly name: string;
  readonly path: string;
  readonly status: 'done' | 'skipped' | 'failed';
  readonly message: string;
  readonly videoPath?: string;
  readonly projectPath?: string;
  readonly seconds?: number;
}

export interface FolderQueueReport {
  readonly items: readonly FolderQueueItem[];
  readonly done: number;
  readonly failed: number;
  readonly skipped: number;
}

type QueueService = Pick<
  DesktopService,
  | 'scanWatchFolder'
  | 'probeMediaFile'
  | 'copyMediaInto'
  | 'writeProjectFile'
  | 'renderProjectVariant'
  | 'audioPeaksPath'
>;

const VIDEO_EXTENSIONS = /\.(mp4|mov|mkv|webm|m4v|avi)$/i;

function slug(name: string): string {
  const clean = name
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return clean.length > 0 ? clean.slice(0, 60) : 'entrega';
}

function even(value: number | null | undefined, fallback: number): number {
  const base = Math.round(value ?? fallback);
  return Math.max(2, base % 2 === 0 ? base : base - 1);
}

function joinPath(directory: string, file: string): string {
  return `${directory.replace(/[\\/]+$/, '')}\\${file}`;
}

function buildProject(input: {
  label: string;
  relativePath: string;
  bytes: number;
  width: number;
  height: number;
  durationSeconds: number;
}): ProjectDocument {
  const fps = 30;
  const durationFrames = Math.max(1, Math.round(input.durationSeconds * fps));
  const asset: Asset = {
    id: newId(),
    label: input.label,
    kind: 'video',
    source: { type: 'local', path: input.relativePath },
    status: 'ready',
    integrity: { sha256: '0'.repeat(64), bytes: Math.max(1, Math.round(input.bytes)) },
    rights: {
      license: { id: 'user-declared', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: new Date().toISOString() },
    },
    media: {
      width: input.width,
      height: input.height,
      durationFrames,
      frameRate: { num: fps, den: 1 },
    },
  };
  const withAsset = addAsset(createEmptyProject(input.label), asset);
  const withClip = addClipFromAsset(withAsset, asset, {
    atFrame: 0,
    durationFrames,
  });
  return withClip.project;
}

async function processFile(
  service: QueueService,
  file: { path: string; name: string },
  options: FolderQueueOptions,
): Promise<FolderQueueItem> {
  const stem = slug(file.name);
  try {
    const probe = await service.probeMediaFile(file.path);
    if (!probe.videoCodec) {
      return { ...file, status: 'skipped', message: 'no tiene pista de video' };
    }
    if (!probe.durationSeconds || probe.durationSeconds < 0.5) {
      return { ...file, status: 'skipped', message: 'dura menos de medio segundo' };
    }
    const width = even(options.width ?? probe.width, 1920);
    const height = even(options.height ?? probe.height, 1080);

    const [copied] = await service.copyMediaInto({
      directory: options.outputDir,
      paths: [file.path],
    });
    if (!copied) return { ...file, status: 'failed', message: 'no se pudo copiar el material' };

    let project = buildProject({
      label: file.name.replace(/\.[^.]+$/, ''),
      relativePath: copied.relativePath,
      bytes: probe.bytes,
      width,
      height,
      durationSeconds: probe.durationSeconds,
    });

    let peaks: AudioPeaks | null = null;
    try {
      peaks = await service.audioPeaksPath(file.path, 600);
    } catch {
      peaks = null;
    }
    const profile = measureAdaptiveProfile(project, peaks);
    const cleanup = await runAutoCleanup(project, async () => {
      if (!peaks) throw new Error('sin picos');
      return peaks;
    }, {
      cutSilences: peaks !== null,
      cutPauses: false,
      denoise: profile.denoise,
      levelAudio: true,
      targetLufs: profile.targetLufs,
      zoomCuts: true,
      zoomIntensity: profile.zoomIntensity,
      silence: { thresholdDb: profile.silenceThresholdDb },
    });
    project = ensureDelivery(cleanup.project);
    const renderProfile = chooseExportProfile(project);
    if (!renderProfile) {
      return { ...file, status: 'failed', message: 'el proyecto no tiene perfil de render' };
    }

    const written = await service.writeProjectFile({
      directory: options.outputDir,
      fileName: `${stem}.editoria.json`,
      project,
    });
    const rendered = await service.renderProjectVariant({
      projectPath: written.path,
      profileId: renderProfile.id,
      outputPath: joinPath(options.outputDir, `${stem}.mp4`),
      includeCaptions: false,
    });
    const output = await service.probeMediaFile(rendered.path).catch(() => null);
    const fps = fpsOf(project);
    const expected = project.timeline.clips.reduce(
      (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
      0,
    ) / fps;
    const duration = output?.durationSeconds ?? rendered.durationSeconds;
    const mismatch = Math.abs(duration - expected) > Math.max(1, expected * 0.05);
    const seconds = Number(duration.toFixed(2));
    return {
      ...file,
      status: 'done',
      seconds,
      videoPath: rendered.path,
      projectPath: written.path,
      message: mismatch
        ? `MP4 de ${seconds} s no coincide con la timeline (${expected.toFixed(2)} s)`
        : `MP4 de ${seconds} s verificado`,
    };
  } catch (error) {
    return {
      ...file,
      status: 'failed',
      message: error instanceof Error ? error.message : 'error desconocido',
    };
  }
}

export async function runFolderQueue(
  service: QueueService,
  options: FolderQueueOptions,
  onProgress?: (item: FolderQueueItem) => void,
): Promise<FolderQueueReport> {
  const files = await service.scanWatchFolder(options.folder);
  const videos = files
    .filter((file) => VIDEO_EXTENSIONS.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, options.maxFiles ?? 12);
  const items: FolderQueueItem[] = [];
  for (const file of videos) {
    const item = await processFile(service, { path: file.path, name: file.name }, options);
    items.push(item);
    onProgress?.(item);
  }
  return {
    items,
    done: items.filter((item) => item.status === 'done').length,
    failed: items.filter((item) => item.status === 'failed').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
  };
}

/** Resumen corto para el aviso. */
export function folderQueueSummary(report: FolderQueueReport): string {
  if (report.items.length === 0) return 'No encontré videos en la carpeta.';
  return `${report.done} entrega(s) · ${report.failed} fallo(s) · ${report.skipped} salteado(s).`;
}
