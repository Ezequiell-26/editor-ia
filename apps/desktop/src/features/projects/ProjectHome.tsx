import { useEffect, useMemo, useState } from 'react';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import type {
  DuplicateAssetGroup,
  MissingAssetInfo,
  ProjectVersionInfo,
  ProjectVersionReason,
  RelinkResult,
} from '../../services/project-service';
import { Icon } from '../../components/Icon';
import { queueDownloadUrl } from '../download/pending';
import { normalizeDownloadUrl } from '../download/url';
import {
  framesToSeconds,
  fpsOf,
  formatTimecode,
  totalFrames,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { forgetRecent, loadRecents, rememberRecent, type RecentProject } from '../../lib/recents';
import {
  FPS_PRESETS,
  FORMAT_PRESETS,
  aspectRatioOf,
  evenDimension,
  formatFps,
  validFpsRange,
} from '../../state/video-format';

interface ProjectHomeProps {
  readonly onNavigate: (id: ViewId) => void;
}

type MediaCheckState = 'idle' | 'checking' | 'ready' | 'error' | 'unavailable';
type VersionsState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
type DuplicatesState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

const MEDIA_KIND_LABEL: Record<string, string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Imagen',
  graphic: 'Gráfico',
};

const VERSION_REASON_LABEL: Record<ProjectVersionReason, string> = {
  autosave: 'Autoguardado',
  manual: 'Guardado manual',
  'pre-crash': 'Sesión interrumpida',
  'before-restore': 'Antes de restaurar',
  snapshot: 'Instantánea',
  rotated: 'Versión conservada',
};

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

function formatVersionDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString('es-AR');
  } catch {
    return 'fecha desconocida';
  }
}

function localAssetPaths(project: ProjectDocument): string[] {
  const paths: string[] = [];
  for (const asset of project.assets) {
    if (asset.source.type !== 'local') continue;
    const path = asset.source.path?.trim();
    if (!path) continue;
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}

/** Fallback de detección cuando el backend de Fase 1 aún no expone relink. */
function clipIdsByAsset(project: ProjectDocument): Map<string, readonly string[]> {
  const usage = new Map<string, string[]>();
  for (const clip of project.timeline.clips) {
    if (clip.source.type !== 'asset') continue;
    const list = usage.get(clip.source.assetId) ?? [];
    list.push(clip.id);
    usage.set(clip.source.assetId, list);
  }
  return usage;
}

function missingFromCheckRows(
  project: ProjectDocument,
  rows: readonly { readonly path: string; readonly exists: boolean }[],
): MissingAssetInfo[] {
  const usage = clipIdsByAsset(project);
  return rows
    .filter((row) => !row.exists)
    .map((row) => {
      const matching = project.assets.filter(
        (asset) => asset.source.type === 'local' && asset.source.path === row.path,
      );
      return {
        assetId: matching[0]?.id ?? row.path,
        label: matching[0]?.label ?? fileNameOf(row.path),
        kind: matching[0]?.kind ?? 'desconocido',
        path: row.path,
        usedByClipIds: matching.flatMap((asset) => usage.get(asset.id) ?? []),
        proxyPath: null,
      };
    });
}

/**
 * Aplica el resultado del relink al documento del store.
 *
 * El backend devuelve la ruta relativa nueva y, cuando pudo, `bytes`/`sha256`.
 * Si no calculó hash, el asset queda `unverified` (honesto: el archivo se
 * reemplazó por nombre/tamaño, no por contenido) y se omite el integrity previo.
 */
function assetWithRelink(asset: Asset, result: RelinkResult): Asset {
  if (asset.source.type !== 'local' || !result.path) return asset;
  const sha256 =
    result.sha256 ?? (result.validatedBy === 'hash' ? asset.integrity?.sha256 ?? null : null);
  const bytes = result.bytes ?? asset.integrity?.bytes ?? null;
  const source = { ...asset.source, path: result.path };
  if (sha256 && typeof bytes === 'number' && bytes > 0) {
    return { ...asset, source, status: 'ready', integrity: { sha256, bytes } };
  }
  const { integrity: _previousIntegrity, ...withoutIntegrity } = asset;
  return { ...withoutIntegrity, source, status: 'unverified' };
}

function projectWithRelinks(
  project: ProjectDocument,
  results: readonly RelinkResult[],
): ProjectDocument {
  const byAsset = new Map<string, RelinkResult>();
  for (const result of results) {
    if (result.ok && result.assetId && result.path) byAsset.set(result.assetId, result);
  }
  if (byAsset.size === 0) return project;
  return {
    ...project,
    assets: project.assets.map((asset) => {
      const result = byAsset.get(asset.id);
      return result ? assetWithRelink(asset, result) : asset;
    }),
  };
}

export function ProjectHome({ onNavigate }: ProjectHomeProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const opened = store.state.opened;
  const [name, setName] = useState('');
  const [formatId, setFormatId] = useState(FORMAT_PRESETS[0]?.id ?? 'landscape');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fpsId, setFpsId] = useState('30');
  const [fpsNum, setFpsNum] = useState(30);
  const [fpsDen, setFpsDen] = useState(1);
  const [recents, setRecents] = useState<RecentProject[]>(() => loadRecents());
  const [busy, setBusy] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  // Medios faltantes / relink (contrato Fase 1).
  const [mediaState, setMediaState] = useState<MediaCheckState>('idle');
  const [missingAssets, setMissingAssets] = useState<readonly MissingAssetInfo[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaTotal, setMediaTotal] = useState(0);
  const [mediaReload, setMediaReload] = useState(0);
  const [relinkBusy, setRelinkBusy] = useState(false);
  const [relinkError, setRelinkError] = useState<string | null>(null);
  const [relinkNotice, setRelinkNotice] = useState<string | null>(null);
  // Historial de versiones del archivo.
  const [versionsState, setVersionsState] = useState<VersionsState>('idle');
  const [versions, setVersions] = useState<readonly ProjectVersionInfo[]>([]);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionsNotice, setVersionsNotice] = useState<string | null>(null);
  const [versionsReload, setVersionsReload] = useState(0);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // Duplicados por hash (análisis a pedido).
  const [duplicatesState, setDuplicatesState] = useState<DuplicatesState>('idle');
  const [duplicateGroups, setDuplicateGroups] = useState<readonly DuplicateAssetGroup[]>([]);
  const [duplicatesError, setDuplicatesError] = useState<string | null>(null);
  const [duplicatesNotice, setDuplicatesNotice] = useState<string | null>(null);
  const [keepByHash, setKeepByHash] = useState<Record<string, string>>({});

  useEffect(() => {
    if (store.state.opened) {
      setRecents(rememberRecent(store.state.opened));
      setName('');
    }
  }, [store.state.opened]);

  // Firma estable de las rutas locales: re-comprueba si cambian los medios
  // (importar, quitar o un relink) sin repetir la comprobación en cada edición.
  const assetSignature = useMemo(() => {
    if (!project) return '';
    return project.assets
      .filter((asset) => asset.source.type === 'local')
      .map((asset) => (asset.source.type === 'local' ? asset.source.path : ''))
      .join('\u0000');
  }, [project]);

  // Al cambiar de proyecto se limpian los mensajes de la sesión de mantenimiento;
  // durante un relink, el aviso de resultado debe sobrevivir a la re-detección.
  useEffect(() => {
    setRelinkError(null);
    setRelinkNotice(null);
  }, [opened?.path]);

  useEffect(() => {
    if (!opened || !project) {
      setMediaState('idle');
      setMissingAssets([]);
      setMediaError(null);
      setMediaTotal(0);
      return;
    }
    if (!store.service.available) {
      setMediaState('unavailable');
      setMissingAssets([]);
      setMediaError(null);
      setMediaTotal(0);
      return;
    }
    const paths = localAssetPaths(project);
    setMediaTotal(paths.length);
    if (paths.length === 0) {
      setMediaState('ready');
      setMissingAssets([]);
      setMediaError(null);
      return;
    }
    let active = true;
    setMediaState('checking');
    setMediaError(null);
    const detection =
      typeof store.service.findMissingAssets === 'function'
        ? store.service.findMissingAssets(opened.path)
        : store.service
            .checkAssetFiles(paths)
            .then((rows) => missingFromCheckRows(project, rows));
    void detection
      .then((list) => {
        if (!active) return;
        setMissingAssets(list);
        setMediaState('ready');
        setMediaError(null);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setMediaState('error');
        setMediaError(
          failure instanceof Error
            ? failure.message
            : 'no se pudieron comprobar los medios del proyecto',
        );
      });
    return () => {
      active = false;
    };
    // `project` se lee dentro del efecto, pero la dependencia real es la firma
    // de rutas: así una edición de clips no re-dispara la comprobación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetSignature, mediaReload, opened?.path, store.service]);

  // Historial de versiones del archivo (backend Fase 1).
  useEffect(() => {
    setVersionsNotice(null);
    if (!opened || !project) {
      setVersionsState('idle');
      setVersions([]);
      setVersionsError(null);
      return;
    }
    if (!store.service.available) {
      setVersionsState('unavailable');
      setVersions([]);
      setVersionsError(null);
      return;
    }
    let active = true;
    setVersionsState('loading');
    setVersionsError(null);
    void store.service
      .listProjectVersions(opened.path)
      .then((list) => {
        if (!active) return;
        setVersions([...list].sort((left, right) => right.savedAtMs - left.savedAtMs));
        setVersionsState('ready');
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setVersionsState('error');
        setVersionsError(
          failure instanceof Error ? failure.message : 'no se pudo leer el historial del proyecto',
        );
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?.path, versionsReload, store.service]);

  const locked = !store.service.available || busy;
  const duration = project ? totalFrames(project) : 0;
  const fps = project ? fpsOf(project) : 30;

  function confirmLeave(action: string): boolean {
    const phase = store.state.phase;
    if (phase === 'saving') {
      store.setNotice('El proyecto se está guardando; esperá un instante y reintentá.');
      return false;
    }
    if (phase === 'dirty' || phase === 'failed') {
      const detail =
        phase === 'failed'
          ? 'El último guardado falló y hay cambios sin guardar.'
          : 'Hay cambios sin guardar.';
      return window.confirm(`${detail} ¿${action} igual?`);
    }
    return true;
  }

  async function create(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      store.setNotice('Poné un nombre para el proyecto.');
      return;
    }
    if (!validFpsRange(fpsNum, fpsDen)) {
      store.setNotice('La tasa de frames debe quedar entre 1 y 240 fps.');
      return;
    }
    if (!confirmLeave('Crear un proyecto nuevo')) return;
    setBusy(true);
    const safeWidth = evenDimension(width);
    const safeHeight = evenDimension(height);
    const ok = await store.createProject({
      name: trimmed,
      width: safeWidth,
      height: safeHeight,
      fpsNum: Math.max(1, Math.round(fpsNum || 30)),
      fpsDen: Math.max(1, Math.round(fpsDen || 1)),
    });
    setBusy(false);
    if (ok) {
      onNavigate('editor');
    }
  }

  async function open(): Promise<void> {
    if (!confirmLeave('Abrir otro proyecto')) return;
    setBusy(true);
    const ok = await store.openProject();
    setBusy(false);
    if (ok) {
      onNavigate('editor');
    }
  }

  async function openRecent(recent: RecentProject): Promise<void> {
    if (!confirmLeave('Abrir otro proyecto')) return;
    setBusy(true);
    const ok = await store.openProjectAt(recent.path);
    setBusy(false);
    if (ok) {
      onNavigate('editor');
    }
  }

  function quickDownload(): void {
    const normalized = normalizeDownloadUrl(downloadUrl);
    if (!normalized) {
      store.setNotice('Pegá un enlace http(s) válido para descargar.');
      return;
    }
    queueDownloadUrl(normalized);
    onNavigate('download');
  }

  function close(): void {
    if (!confirmLeave('Cerrar el proyecto')) return;
    store.closeProject();
    if (store.service.available) {
      void store.service.closeProject().catch(() => {
        // Closing the native session is best-effort; the screen is already empty.
      });
    }
  }

  function chooseFormat(id: string): void {
    setFormatId(id);
    const preset = FORMAT_PRESETS.find((item) => item.id === id);
    if (preset) {
      setWidth(preset.width);
      setHeight(preset.height);
    }
  }

  function chooseFps(id: string): void {
    setFpsId(id);
    const preset = FPS_PRESETS.find((item) => item.id === id);
    if (preset) {
      setFpsNum(preset.num);
      setFpsDen(preset.den);
    }
  }

  function applyRelinks(results: readonly RelinkResult[]): boolean {
    const applied = results.filter((result) => result.ok && result.assetId && result.path);
    if (applied.length === 0) return false;
    const ok = store.update((current) => projectWithRelinks(current, applied));
    if (!ok) {
      // El backend reconectó pero el documento local no quedó válido: se
      // declara el fallo y no se muestra éxito (la UI nunca debe divergir).
      setRelinkError(
        'El backend reconectó el medio pero el proyecto local no pudo actualizarse; volvé a comprobar los medios.',
      );
      return false;
    }
    setMediaReload((value) => value + 1);
    return true;
  }

  async function chooseReplacement(asset: MissingAssetInfo): Promise<string | null> {
    const title = `Elegir el archivo que reemplaza a ${asset.label}`;
    switch (asset.kind) {
      case 'video':
        return store.service.chooseVideoFile(title);
      case 'audio':
        return store.service.chooseAudioFile(title);
      case 'image':
      case 'graphic':
        return store.service.chooseImageFile(title);
      default:
        return null;
    }
  }

  async function relinkOne(asset: MissingAssetInfo): Promise<void> {
    if (relinkBusy) return;
    setRelinkError(null);
    setRelinkNotice(null);
    setRelinkBusy(true);
    try {
      const chosen = await chooseReplacement(asset);
      if (!chosen) {
        return;
      }
      const result = await store.service.relinkAsset(asset.assetId, chosen);
      if (!result.ok) {
        setRelinkError(
          `${asset.label}: ${result.reason ?? 'no se pudo reconectar el medio (validación fallida)'}`,
        );
        return;
      }
      if (!applyRelinks([result])) return;
      setRelinkNotice(
        `${asset.label} reconectado${result.copied ? ' (se copió el archivo a la carpeta del proyecto)' : ''} · validado por ${
          result.validatedBy === 'hash' ? 'hash SHA-256' : 'nombre y tamaño'
        }${result.sha256 ? ' con hash nuevo' : ''}.`,
      );
    } catch (failure) {
      setRelinkError(
        failure instanceof Error
          ? failure.message
          : 'no se pudo reconectar el medio (revisá que el backend de relink esté disponible)',
      );
    } finally {
      setRelinkBusy(false);
    }
  }

  async function relinkFromFolder(): Promise<void> {
    if (relinkBusy || !opened) return;
    setRelinkError(null);
    setRelinkNotice(null);
    setRelinkBusy(true);
    try {
      const folder = await store.service.chooseMediaFolder(
        'Elegir la carpeta que contiene los medios faltantes',
      );
      if (!folder) {
        return;
      }
      const result = await store.service.relinkAssetsFromFolder(opened.path, folder);
      const applied = applyRelinks(result.relinked);
      if (result.relinked.length > 0 && !applied) return;
      const parts: string[] = [];
      parts.push(
        `${result.relinked.length} medio(s) reconectado(s)${folder ? ` desde ${folder}` : ''}`,
      );
      if (result.stillMissing.length > 0) {
        parts.push(`${result.stillMissing.length} siguen faltando`);
      }
      if (result.rejected.length > 0) {
        const reasons = result.rejected
          .slice(0, 2)
          .map((item) => `${fileNameOf(item.path)}: ${item.reason}`)
          .join('; ');
        parts.push(`${result.rejected.length} rechazado(s): ${reasons}`);
      }
      setRelinkNotice(parts.join(' · '));
    } catch (failure) {
      setRelinkError(
        failure instanceof Error ? failure.message : 'no se pudo reconectar la carpeta de medios',
      );
    } finally {
      setRelinkBusy(false);
    }
  }

  async function restoreVersion(
    version: ProjectVersionInfo,
    mode: 'in-place' | 'copy',
  ): Promise<void> {
    if (!opened || restoringId !== null) return;
    const reason = VERSION_REASON_LABEL[version.reason] ?? version.reason;
    const message =
      mode === 'in-place'
        ? `Se reemplaza el archivo del proyecto actual por la versión del ${formatVersionDate(
            version.savedAtMs,
          )} (${reason}) y se guarda una copia previa. ¿Restaurar?`
        : `Se crea una copia restaurada de la versión del ${formatVersionDate(
            version.savedAtMs,
          )} (${reason}) y se abre; el proyecto actual no se modifica. ¿Restaurar?`;
    if (!window.confirm(message)) return;
    setRestoringId(version.id);
    setVersionsError(null);
    setVersionsNotice(null);
    try {
      const result = await store.service.restoreProjectVersion(opened.path, version.id, mode);
      const openedOk = await store.openProjectAt(result.projectPath);
      if (!openedOk) {
        setVersionsError(
          'La versión se restauró pero no se pudo abrir el proyecto restaurado. Abrílo desde Recientes.',
        );
        return;
      }
      setVersionsNotice(
        `Versión del ${formatVersionDate(version.savedAtMs)} restaurada ${
          result.restoreMode === 'in-place' ? 'en el sitio' : 'como copia'
        }${result.backupPath ? ` · copia previa: ${fileNameOf(result.backupPath)}` : ''}.`,
      );
      setVersionsReload((value) => value + 1);
    } catch (failure) {
      setVersionsError(
        failure instanceof Error ? failure.message : 'no se pudo restaurar la versión del proyecto',
      );
    } finally {
      setRestoringId(null);
    }
  }

  async function analyzeDuplicates(): Promise<void> {
    if (!opened || duplicatesState === 'loading') return;
    setDuplicatesState('loading');
    setDuplicatesError(null);
    setDuplicatesNotice(null);
    try {
      const groups = await store.service.findDuplicateAssets(opened.path);
      setDuplicateGroups(groups);
      setKeepByHash((current) => {
        const next: Record<string, string> = {};
        for (const group of groups) {
          const preferred =
            current[group.sha256] && group.assetIds.includes(current[group.sha256]!)
              ? current[group.sha256]!
              : group.assetIds[0];
          if (preferred) next[group.sha256] = preferred;
        }
        return next;
      });
      setDuplicatesState('ready');
    } catch (failure) {
      setDuplicatesState('error');
      setDuplicatesError(
        failure instanceof Error
          ? failure.message
          : 'no se pudieron analizar los duplicados del proyecto',
      );
    }
  }

  async function removeDuplicateCopies(group: DuplicateAssetGroup): Promise<void> {
    const keepId = keepByHash[group.sha256] ?? group.assetIds[0];
    if (!keepId) return;
    const removeIds = group.assetIds.filter((id) => id !== keepId);
    if (removeIds.length === 0) return;
    const inUse = removeIds.filter((id) => (group.usedByClipIds[id]?.length ?? 0) > 0);
    if (inUse.length > 0) {
      setDuplicatesError(
        `Hay ${inUse.length} copia(s) en uso en la timeline: no se quitó ninguna. Cambiá la referencia desde el editor o mantené esa copia.`,
      );
      return;
    }
    const confirmed = window.confirm(
      `Se quitarán ${removeIds.length} copia(s) del proyecto y se conservará una. ` +
        'Ningún archivo del disco será borrado. ¿Continuar?',
    );
    if (!confirmed) return;
    const ok = store.update((current) => ({
      ...current,
      assets: current.assets.filter((asset) => !removeIds.includes(asset.id)),
    }));
    if (!ok) {
      setDuplicatesError('No se pudo actualizar el proyecto; no se quitó ninguna copia.');
      return;
    }
    setDuplicateGroups((current) => current.filter((item) => item.sha256 !== group.sha256));
    setDuplicatesError(null);
    setDuplicatesNotice(
      `Se quitaron ${removeIds.length} copia(s) del proyecto. Ningún archivo del disco fue borrado.`,
    );
  }

  return (
    <section className="view projects-view" aria-label="Proyectos">
      <div className="project-toolbar">
        <button type="button" className="ghost icon-text" onClick={open} disabled={locked}>
          <Icon name="projects" size={15} />
          <span>Abrir proyecto…</span>
        </button>
        <form
          className="quick-download"
          onSubmit={(event) => {
            event.preventDefault();
            quickDownload();
          }}
        >
          <Icon name="download" size={15} />
          <input
            type="text"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            value={downloadUrl}
            placeholder="Pegá un enlace de YouTube, Instagram, TikTok o cualquier sitio público…"
            aria-label="URL para descargar"
            onChange={(event) => setDownloadUrl(event.target.value)}
          />
          <button type="submit" className="primary" disabled={!downloadUrl.trim()}>
            Descargar
          </button>
        </form>
      </div>

      {!store.service.available ? (
        <p className="notice notice-warning" role="status">
          {store.service.unavailableReason ||
            'Abrí la app de escritorio de Olyvia para crear, abrir y guardar proyectos.'}
        </p>
      ) : null}

      {project ? (
        <article className="project-current">
          <div className="project-current-head">
            <div>
              <p className="eyebrow">Proyecto abierto</p>
              <h3>{project.name}</h3>
              <p className="muted">
                {project.video.width}×{project.video.height} · {fps} fps ·{' '}
                {formatTimecode(duration, fps)} · {project.timeline.clips.length} clips ·{' '}
                {project.assets.length} medios · {project.scenes.length} escenas
              </p>
            </div>
            <span className={`status-pill ${store.state.phase}`}>{store.statusText}</span>
          </div>
          <div className="project-metrics">
            <div>
              <span>Archivo</span>
              <strong>{opened?.label ?? 'sin archivo'}</strong>
            </div>
            <div>
              <span>Duración</span>
              <strong>{framesToSeconds(duration, fps).toFixed(1)} s</strong>
            </div>
            <div>
              <span>Perfiles</span>
              <strong>{project.renderProfiles.length}</strong>
            </div>
            <div>
              <span>Guion</span>
              <strong>{project.scenes.length} escenas</strong>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={() => onNavigate('editor')}>
              Abrir editor
            </button>
            <button type="button" onClick={() => onNavigate('script')}>
              Guion y escenas
            </button>
            <button type="button" onClick={() => onNavigate('assets')}>
              Medios
            </button>
            <button
              type="button"
              onClick={() => {
                void store.saveNow();
              }}
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => {
                void store.saveAs();
              }}
            >
              Guardar como…
            </button>
            <button type="button" className="danger-ghost" onClick={close}>
              Cerrar proyecto
            </button>
          </div>
        </article>
      ) : (
        <div className="empty-state view-empty projects-empty">
          <span className="view-empty-icon" aria-hidden="true">
            <Icon name="projects" size={20} />
          </span>
          <strong>No hay proyectos abiertos</strong>
          <p>Creá uno abajo con nombre, formato y fps, o abrí un archivo .olyvia existente.</p>
        </div>
      )}

      {project ? (
        <article className="card" aria-labelledby="project-media-title">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Mantenimiento</p>
              <h3 id="project-media-title">Medios del proyecto</h3>
            </div>
            {mediaState === 'ready' ? (
              <span className={`status-pill ${missingAssets.length > 0 ? 'dirty' : 'saved'}`}>
                {missingAssets.length > 0
                  ? `${missingAssets.length} faltante${missingAssets.length === 1 ? '' : 's'}`
                  : 'Al día'}
              </span>
            ) : null}
          </div>

          {mediaState === 'unavailable' ? (
            <p className="fine-print">
              La comprobación de medios necesita la app de escritorio: el navegador no puede leer
              el disco.
            </p>
          ) : null}

          {mediaState === 'idle' || mediaState === 'checking' ? (
            <p className="fine-print" role="status">
              Comprobando {mediaTotal > 0 ? `${mediaTotal} ` : ''}medio(s) locales del proyecto…
            </p>
          ) : null}

          {mediaState === 'error' ? (
            <>
              <p className="notice notice-warning" role="alert">
                No se pudieron comprobar los medios: {mediaError}
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setMediaReload((value) => value + 1)}
                >
                  Reintentar
                </button>
              </div>
            </>
          ) : null}

          {mediaState === 'ready' && missingAssets.length === 0 ? (
            <p className="fine-print">
              {mediaTotal === 0
                ? 'El proyecto no tiene medios locales que comprobar.'
                : `${mediaTotal} medio(s) locales verificados: todos están disponibles.`}
            </p>
          ) : null}

          {mediaState === 'ready' && missingAssets.length > 0 ? (
            <>
              <p className="notice notice-warning" role="alert">
                Faltan {missingAssets.length} de {mediaTotal} medios locales. Podés reconectarlos
                uno por uno o buscando la carpeta; la detección no modifica ni borra archivos.
              </p>
              <ul className="recent-list">
                {missingAssets.map((asset) => {
                  const clips = asset.usedByClipIds.length;
                  return (
                    <li key={`${asset.assetId}:${asset.path}`}>
                      <span className="recent-name">{asset.label}</span>
                      <span className="recent-file">
                        {MEDIA_KIND_LABEL[asset.kind] ?? asset.kind} · {asset.path}
                      </span>
                      <span className="recent-date">
                        {clips > 0 ? `En uso por ${clips} clip${clips === 1 ? '' : 's'}` : 'Sin uso en la timeline'}
                        {asset.proxyPath
                          ? ' · Proxy disponible (sólo previsualización)'
                          : ''}
                      </span>
                      <span className="actions compact">
                        <button
                          type="button"
                          className="small"
                          disabled={relinkBusy}
                          onClick={() => void relinkOne(asset)}
                          title="Elegir el archivo que reemplaza a este medio"
                        >
                          Relink…
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void relinkFromFolder()}
                  disabled={relinkBusy}
                >
                  {relinkBusy ? 'Reconectando…' : 'Buscar carpeta…'}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setMediaReload((value) => value + 1)}
                  disabled={relinkBusy}
                >
                  Volver a comprobar
                </button>
              </div>
              <p className="fine-print">
                El proxy, si existe, sólo se usa para previsualizar: el archivo original sigue
                faltando. Relink valida el archivo elegido por nombre y tamaño (o hash cuando el
                backend lo calcula) y nunca borra medios del disco.
              </p>
            </>
          ) : null}

          {relinkError ? (
            <p className="notice notice-warning" role="alert">
              {relinkError}
            </p>
          ) : null}
          {relinkNotice ? (
            <p className="notice notice-notice" role="status">
              {relinkNotice}
            </p>
          ) : null}
        </article>
      ) : null}

      {project ? (
        <article className="card" aria-labelledby="project-history-title">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Historial</p>
              <h3 id="project-history-title">Versiones del proyecto</h3>
            </div>
            {versionsState === 'ready' ? (
              <span className="status-pill">{versions.length} versión(es)</span>
            ) : null}
          </div>

          {versionsState === 'unavailable' ? (
            <p className="fine-print">
              El historial de versiones vive en la carpeta del proyecto y necesita la app de
              escritorio.
            </p>
          ) : null}

          {versionsState === 'idle' || versionsState === 'loading' ? (
            <p className="fine-print" role="status">
              Leyendo el historial del proyecto…
            </p>
          ) : null}

          {versionsState === 'error' ? (
            <>
              <p className="notice notice-warning" role="alert">
                No se pudo leer el historial: {versionsError}
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setVersionsReload((value) => value + 1)}
                >
                  Reintentar
                </button>
              </div>
            </>
          ) : null}

          {versionsState === 'ready' && versions.length === 0 ? (
            <p className="fine-print">
              Todavía no hay versiones anteriores. Se guardan antes de cada guardado (en
              `.olyvia-history/`, rotación de 20) y antes de restaurar una versión.
            </p>
          ) : null}

          {versionsState === 'ready' && versions.length > 0 ? (
            <ul className="recent-list">
              {versions.slice(0, 8).map((version) => (
                <li key={version.id}>
                  <span className="recent-name">
                    {formatVersionDate(version.savedAtMs)} ·{' '}
                    {VERSION_REASON_LABEL[version.reason] ?? version.reason}
                  </span>
                  <span className="recent-file">
                    {fileNameOf(version.path)} · {formatBytes(version.bytes)}
                    {version.projectName ? ` · ${version.projectName}` : ''}
                  </span>
                  <span className="recent-date">
                    {version.clipCount} clips · {version.assetCount} medios
                  </span>
                  <span className="actions compact">
                    <button
                      type="button"
                      className="small"
                      disabled={restoringId !== null}
                      onClick={() => void restoreVersion(version, 'in-place')}
                      title="Reemplaza el proyecto actual guardando una copia previa"
                    >
                      {restoringId === version.id ? 'Restaurando…' : 'Restaurar'}
                    </button>
                    <button
                      type="button"
                      className="small ghost"
                      disabled={restoringId !== null}
                      onClick={() => void restoreVersion(version, 'copy')}
                    >
                      Como copia…
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {versionsState === 'ready' && versions.length > 8 ? (
            <p className="fine-print">
              Se muestran las 8 versiones más recientes de {versions.length}.
            </p>
          ) : null}

          {store.state.recoveryOffer ? (
            <p className="fine-print">
              También hay una sesión sin guardar de la última interrupción: usá el aviso superior
              para recuperarla o descartarla.
            </p>
          ) : null}

          {versionsError && versionsState === 'ready' ? (
            <p className="notice notice-warning" role="alert">
              {versionsError}
            </p>
          ) : null}
          {versionsNotice ? (
            <p className="notice notice-notice" role="status">
              {versionsNotice}
            </p>
          ) : null}
        </article>
      ) : null}

      {project ? (
        <article className="card" aria-labelledby="project-duplicates-title">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Duplicados</p>
              <h3 id="project-duplicates-title">Copias idénticas en el proyecto</h3>
            </div>
            <button
              type="button"
              className="small ghost"
              onClick={() => void analyzeDuplicates()}
              disabled={duplicatesState === 'loading'}
            >
              {duplicatesState === 'loading' ? 'Analizando…' : 'Analizar duplicados'}
            </button>
          </div>

          {duplicatesState === 'idle' ? (
            <p className="fine-print">
              Analiza el proyecto por hash SHA-256 para encontrar el mismo archivo importado más de
              una vez. Quitar copias nunca borra archivos del disco: sólo quita registros del
              proyecto.
            </p>
          ) : null}

          {duplicatesState === 'error' ? (
            <p className="notice notice-warning" role="alert">
              No se pudieron analizar los duplicados: {duplicatesError}
            </p>
          ) : null}

          {duplicatesState === 'ready' && duplicateGroups.length === 0 ? (
            <p className="fine-print">
              No se encontraron duplicados por hash en los medios del proyecto.
            </p>
          ) : null}

          {duplicatesState === 'ready' && duplicateGroups.length > 0 ? (
            <>
              <p className="fine-print">
                {duplicateGroups.length} grupo(s) de copias idénticas. Elegí qué copia conservar;
                las demás se pueden quitar del proyecto (los archivos del disco no se tocan).
              </p>
              <ul className="recent-list">
                {duplicateGroups.map((group) => (
                  <li key={group.sha256}>
                    <span className="recent-name">
                      {group.assetIds.length} copias · {formatBytes(group.bytes)} cada una · hash{' '}
                      {group.sha256.slice(0, 12)}…
                    </span>
                    {group.assetIds.map((assetId, index) => {
                      const clips = group.usedByClipIds[assetId]?.length ?? 0;
                      return (
                        <label className="check" key={assetId}>
                          <input
                            type="radio"
                            name={`keep-${group.sha256}`}
                            checked={(keepByHash[group.sha256] ?? group.assetIds[0]) === assetId}
                            onChange={() =>
                              setKeepByHash((current) => ({
                                ...current,
                                [group.sha256]: assetId,
                              }))
                            }
                          />
                          <span>
                            {group.labels[index] ?? assetId}
                            {clips > 0 ? ` · en uso por ${clips} clip(s)` : ' · sin uso'}
                          </span>
                        </label>
                      );
                    })}
                    <span className="actions compact">
                      <button
                        type="button"
                        className="small"
                        onClick={() => void removeDuplicateCopies(group)}
                      >
                        Quitar copias no conservadas
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {duplicatesError && duplicatesState !== 'error' ? (
            <p className="notice notice-warning" role="alert">
              {duplicatesError}
            </p>
          ) : null}
          {duplicatesNotice ? (
            <p className="notice notice-notice" role="status">
              {duplicatesNotice}
            </p>
          ) : null}
        </article>
      ) : null}

      <div className="home-grid">
        <article className="card">
          <p className="eyebrow">Nuevo</p>
          <h3>Crear un proyecto</h3>
          <div className="form-grid">
            <label className="field">
              <span>Nombre</span>
              <input
                id="project-name"
                type="text"
                value={name}
                placeholder="Mi próximo video"
                maxLength={120}
                disabled={locked}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void create();
                  }
                }}
              />
            </label>
            <label className="field">
              <span>Formato</span>
              <select
                value={formatId}
                disabled={locked}
                onChange={(event) => chooseFormat(event.target.value)}
              >
                {FORMAT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} · {preset.width}×{preset.height}
                  </option>
                ))}
                <option value="custom">Personalizado…</option>
              </select>
            </label>
            {formatId === 'custom' ? (
              <div className="format-custom">
                <label className="field">
                  <span>Ancho</span>
                  <input
                    type="number"
                    min={16}
                    max={32_768}
                    step={2}
                    value={width}
                    disabled={locked}
                    onChange={(event) => setWidth(Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Alto</span>
                  <input
                    type="number"
                    min={16}
                    max={32_768}
                    step={2}
                    value={height}
                    disabled={locked}
                    onChange={(event) => setHeight(Number(event.target.value))}
                  />
                </label>
              </div>
            ) : null}
            <label className="field">
              <span>Tasa de frames</span>
              <select
                value={fpsId}
                disabled={locked}
                onChange={(event) => chooseFps(event.target.value)}
              >
                {FPS_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} fps
                  </option>
                ))}
                <option value="custom">Personalizada…</option>
              </select>
            </label>
            {fpsId === 'custom' ? (
              <div className="format-custom">
                <label className="field">
                  <span>FPS numerador</span>
                  <input
                    type="number"
                    min={1}
                    max={240_000}
                    value={fpsNum}
                    disabled={locked}
                    onChange={(event) => setFpsNum(Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span>FPS denominador</span>
                  <input
                    type="number"
                    min={1}
                    max={100_100}
                    value={fpsDen}
                    disabled={locked}
                    onChange={(event) => setFpsDen(Number(event.target.value))}
                  />
                </label>
              </div>
            ) : null}
          </div>
          <div className="project-format-summary">
            <span>
              <strong>{aspectRatioOf(evenDimension(width), evenDimension(height))}</strong>
            </span>
            <span>
              {evenDimension(width)}×{evenDimension(height)}
            </span>
            <span>{formatFps(fpsNum, fpsDen)} fps</span>
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={() => void create()} disabled={locked}>
              {busy ? 'Creando…' : 'Crear y elegir ubicación…'}
            </button>
            <button type="button" className="ghost" onClick={() => onNavigate('learn')}>
              Ver tutorial
            </button>
          </div>
          <p className="fine-print">
            Cualquier formato y fps exacto. Se abre el diálogo de Windows para guardar el archivo;
            nada se escribe hasta que elegís la carpeta.
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">Recientes</p>
          <h3>Retomar</h3>
          {recents.length === 0 ? (
            <p className="empty-inline">Todavía no hay proyectos recientes en este equipo.</p>
          ) : (
            <ul className="recent-list">
              {recents.map((recent) => (
                <li key={recent.path}>
                  <button
                    type="button"
                    className="recent-open"
                    disabled={locked}
                    onClick={() => void openRecent(recent)}
                    title={recent.label}
                  >
                    <span className="recent-name">{recent.name}</span>
                    <span className="recent-file">{recent.label}</span>
                    <span className="recent-date">
                      {new Date(recent.openedAt).toLocaleString('es-AR')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Quitar ${recent.name} de recientes`}
                    onClick={() => setRecents(forgetRecent(recent.path))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}
