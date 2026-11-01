/**
 * Biblioteca de iconos animados Lottie MIT (react-useanimations).
 *
 * 12 iconos viajan dentro de la app (offline). El resto se descarga bajo
 * demanda, se verifica con SHA-256 en Rust y queda en caché local. El botón
 * "Usar en video" reutiliza el mismo rasterizador que el importador Lottie:
 * preview y archivo final comparten motor.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ViewId } from '../../../app/navigation';
import { Icon } from '../../../components/Icon';
import { addAsset, fpsOf, markAssetReady } from '../../../state/project-actions';
import { useProjectStore } from '../../../state/project-store';
import { LottiePreview } from '../LottiePreview';
import { rasterizeLottieToAsset } from '../lottie-import';
import { parseLottieDocument, planLottieExport } from '../lottie';
import { BUNDLED_MOTION_JSON } from './bundled';
import {
  MOTION_LIBRARY,
  MOTION_LIBRARY_VERSION,
  type MotionLibraryItem,
} from './catalog';
import {
  motionCacheStats,
  motionDownload,
  motionListCached,
  motionReadCached,
  motionRemoveCached,
  type CachedMotion,
  type MotionCacheStats,
} from './library-api';

const CATEGORIES: readonly string[] = [
  'todas',
  ...Array.from(new Set(MOTION_LIBRARY.map((item) => item.category))),
];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'no se pudo completar la operación';
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function scaleFor(document: { readonly width: number; readonly height: number }): number {
  const side = Math.max(document.width, document.height);
  return Math.max(1, Math.min(32, Math.floor(512 / side)));
}

export function MotionLibraryPanel({
  onNavigate,
}: {
  readonly onNavigate: (id: ViewId) => void;
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('todas');
  const [cached, setCached] = useState<Record<string, CachedMotion>>({});
  const [stats, setStats] = useState<MotionCacheStats | null>(null);
  const [selectedId, setSelectedId] = useState(MOTION_LIBRARY[0]?.id ?? '');
  const [previewDoc, setPreviewDoc] = useState<ReturnType<typeof parseLottieDocument> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    return MOTION_LIBRARY.filter((item) => {
      if (category !== 'todas' && item.category !== category) return false;
      if (!clean) return true;
      return `${item.label} ${item.category} ${item.tags.join(' ')}`
        .toLowerCase()
        .includes(clean);
    });
  }, [category, query]);

  const selected = MOTION_LIBRARY.find((item) => item.id === selectedId) ?? MOTION_LIBRARY[0];
  const cachedCount = Object.keys(cached).length;

  async function refreshCache(): Promise<void> {
    try {
      const [entries, nextStats] = await Promise.all([motionListCached(), motionCacheStats()]);
      setCached(Object.fromEntries(entries.map((entry) => [entry.id, entry])));
      setStats(nextStats);
    } catch {
      // Fuera de Tauri (preview web o tests sin IPC) la caché no está disponible.
      setStats(null);
    }
  }

  async function jsonFor(item: MotionLibraryItem): Promise<string> {
    const bundled = BUNDLED_MOTION_JSON[item.id];
    if (bundled) return bundled;
    return motionReadCached(item.id, item.sha256);
  }

  async function openPreview(item: MotionLibraryItem, assumeCached = false): Promise<void> {
    setSelectedId(item.id);
    setPreviewDoc(null);
    setPreviewError(null);
    if (!item.bundled && !assumeCached && !cached[item.id]) {
      setPreviewError('Descargá el icono para verlo y usarlo sin conexión.');
      return;
    }
    try {
      const text = await jsonFor(item);
      setPreviewDoc(parseLottieDocument(JSON.parse(text) as unknown));
    } catch (cause) {
      setPreviewError(messageOf(cause));
    }
  }

  useEffect(() => {
    void refreshCache();
    // La preview se abre al elegir un icono: no auto-reproducimos animaciones
    // al entrar a la vista (rendimiento y foco).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function download(item: MotionLibraryItem): Promise<void> {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      await motionDownload({
        id: item.id,
        url: item.fileUrl,
        sha256: item.sha256,
        bytes: item.bytes,
      });
      await refreshCache();
      await openPreview(item, true);
      setNotice(`${item.label} descargado y verificado con SHA-256. Queda disponible sin conexión.`);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: MotionLibraryItem): Promise<void> {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      await motionRemoveCached(item.id);
      await refreshCache();
      if (selectedId === item.id) {
        setPreviewDoc(null);
        setPreviewError('El icono se quitó de la caché; descargalo de nuevo para usarlo.');
      }
      setNotice(`${item.label} eliminado de la caché local.`);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function useInProject(item: MotionLibraryItem): Promise<void> {
    if (!project) {
      setError('Abrí o creá un proyecto antes de usar un icono.');
      return;
    }
    setConvertingId(item.id);
    setProgress(0);
    setError(null);
    setNotice(null);
    try {
      const text = await jsonFor(item);
      const document = parseLottieDocument(JSON.parse(text) as unknown);
      const plan = planLottieExport(document, {
        fps: fpsOf(project),
        scale: scaleFor(document),
      });
      const asset = await rasterizeLottieToAsset({
        service: store.service,
        document,
        plan,
        label: item.label,
        onProgress: setProgress,
      });
      const ok = store.mutate(
        (current) => ({
          project: markAssetReady(addAsset(current, asset), asset.id, 'allowed'),
        }),
        {
          notice: `Icono MIT en Medios: ${asset.label} · ${plan.width}×${plan.height} · ${plan.frameCount} frames.`,
        },
      );
      if (!ok) {
        setError('El icono no deja el proyecto en un estado válido.');
        return;
      }
      setNotice(`${asset.label} agregado a Medios con alfa. Ya se puede montar en la timeline.`);
      onNavigate('assets');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setConvertingId(null);
    }
  }

  return (
    <div className="card motion-library">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Biblioteca</p>
          <h3>
            <Icon name="sparkles" size={14} /> Iconos animados Lottie
          </h3>
        </div>
        <span className="fine-print" title={stats?.dir ?? undefined}>
          react-useanimations · MIT · {cachedCount} en caché
          {stats ? ` · ${formatBytes(stats.bytes)}` : ''}
        </span>
      </div>
      <p className="fine-print">
        {MOTION_LIBRARY.length} iconos vectoriales con licencia MIT. 12 viajan con la app
        (offline); el resto se descarga bajo demanda y se verifica con SHA-256 antes de
        guardarse en la caché local. Versión del catálogo: {MOTION_LIBRARY_VERSION}.
      </p>

      <div className="motion-library-toolbar">
        <input
          type="search"
          value={query}
          aria-label="Buscar iconos animados"
          placeholder="Buscar: check, datos, música…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          value={category}
          aria-label="Filtrar por categoría"
          onChange={(event) => setCategory(event.target.value)}
        >
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {value === 'todas' ? 'Todas las categorías' : value}
            </option>
          ))}
        </select>
        <span className="fine-print">
          {filtered.length} de {MOTION_LIBRARY.length}
        </span>
      </div>

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="motion-library-body">
        <div className="motion-library-grid" aria-label="Iconos animados disponibles">
          {filtered.map((item) => {
            const isCached = Boolean(cached[item.id]);
            return (
              <button
                key={item.id}
                type="button"
                className={`motion-library-item${item.id === selectedId ? ' active' : ''}`}
                aria-pressed={item.id === selectedId}
                onClick={() => void openPreview(item)}
              >
                <strong>{item.label}</strong>
                <small>{item.category}</small>
                <span className="motion-library-badge">
                  {item.bundled ? 'Offline' : isCached ? 'En caché' : 'Descargar'}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <p className="fine-print">No hay iconos que coincidan con el filtro.</p>
          ) : null}
        </div>

        {selected ? (
          <div className="motion-library-detail">
            <div className="motion-library-preview">
              {previewDoc ? (
                <LottiePreview document={previewDoc} />
              ) : (
                <div className="graphic-placeholder">
                  {previewError ?? 'Elegí un icono para ver la animación.'}
                </div>
              )}
            </div>
            <div className="motion-library-meta">
              <div>
                <strong>{selected.label}</strong>
                <p className="fine-print">
                  {selected.width}×{selected.height} px · {selected.durationSeconds.toFixed(2)} s ·{' '}
                  {formatBytes(selected.bytes)} · {selected.license} · {selected.author}
                </p>
              </div>
              <div className="actions compact">
                {!selected.bundled && !cached[selected.id] ? (
                  <button
                    type="button"
                    className="ghost"
                    disabled={busyId === selected.id}
                    onClick={() => void download(selected)}
                  >
                    {busyId === selected.id ? 'Descargando…' : 'Descargar'}
                  </button>
                ) : null}
                {!selected.bundled && cached[selected.id] ? (
                  <button
                    type="button"
                    className="ghost"
                    disabled={busyId === selected.id}
                    onClick={() => void remove(selected)}
                  >
                    Quitar de la caché
                  </button>
                ) : null}
                <button
                  type="button"
                  className="primary"
                  disabled={!project || convertingId === selected.id}
                  onClick={() => void useInProject(selected)}
                >
                  {convertingId === selected.id
                    ? `Convirtiendo… ${progress}%`
                    : 'Usar en video'}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void store.service.openExternalUrl(selected.source)}
                >
                  Fuente y licencia
                </button>
              </div>
              {convertingId === selected.id ? (
                <progress
                  className="lottie-progress"
                  max={100}
                  value={progress}
                  aria-label="Progreso del icono animado"
                />
              ) : null}
              {!project ? (
                <p className="fine-print">
                  Abrí o creá un proyecto para convertir el icono en un video con alfa.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
