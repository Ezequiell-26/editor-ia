import { useEffect, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import type {
  DownloaderStatus,
  DownloadOutcome,
  DownloadProbe,
  DownloadProgressEvent,
  DownloadQuality,
} from '../../services/project-service';
import { addAsset } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

type Stage = 'idle' | 'installing' | 'probing' | 'downloading' | 'importing';

const COMPRESSION_OPTIONS = [
  { value: 'none', label: 'Original · sin recomprimir' },
  { value: 'high', label: 'Alta calidad · CRF 20' },
  { value: 'balanced', label: 'Equilibrada · CRF 24 (recomendada)' },
  { value: 'compact', label: 'Compacta · CRF 27' },
] as const;

const KIND_LABELS: Record<DownloadProbe['kind'], string> = {
  video: 'Video',
  image: 'Imagen',
  audio: 'Audio',
  gallery: 'Carrusel / lista corta',
};

const STAGE_LABELS: Record<DownloadProgressEvent['stage'], string> = {
  engine: 'Motor',
  probing: 'Analizando',
  downloading: 'Descargando',
  compressing: 'Comprimiendo',
  done: 'Listo',
};

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return 'tamaño desconocido';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${bytes} B`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return 'duración desconocida';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function qualitySummary(quality: DownloadQuality): string {
  const parts = [quality.label];
  if (quality.fps) parts.push(`${Math.round(quality.fps)} fps`);
  if (quality.ext) parts.push(quality.ext.toUpperCase());
  if (quality.filesize) parts.push(`≈ ${formatBytes(quality.filesize)}`);
  return parts.join(' · ');
}

export function DownloadView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const service = store.service;
  const [url, setUrl] = useState('');
  const [probe, setProbe] = useState<DownloadProbe | null>(null);
  const [engine, setEngine] = useState<DownloaderStatus | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState<DownloadProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rights, setRights] = useState(false);
  const [selectedHeight, setSelectedHeight] = useState<number | null>(null);
  const [compression, setCompression] = useState<(typeof COMPRESSION_OPTIONS)[number]['value']>(
    'balanced',
  );
  const [codec, setCodec] = useState<'h265' | 'h264'>('h265');
  const [outcome, setOutcome] = useState<DownloadOutcome | null>(null);
  const [importedCount, setImportedCount] = useState(0);

  const busy = stage !== 'idle';

  useEffect(() => {
    let cancelled = false;
    void service
      .downloaderStatus()
      .then((status) => {
        if (!cancelled) setEngine(status);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'no se pudo consultar el motor');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void service
      .onDownloadProgress((event) => {
        setProgress(event);
      })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // Los eventos son una mejora de la UI; la descarga sigue funcionando sin ellos.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [service]);

  async function installEngine(): Promise<void> {
    setStage('installing');
    setError(null);
    try {
      const status = await service.installDownloader();
      setEngine(status);
      store.setNotice(`Motor de descargas instalado (${status.version ?? 'yt-dlp'}).`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo instalar el motor');
    } finally {
      setStage('idle');
      setProgress(null);
    }
  }

  async function analyze(): Promise<void> {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Pegá la URL de un video, una foto o un carrusel.');
      return;
    }
    setStage('probing');
    setError(null);
    setWarnings([]);
    setProbe(null);
    setOutcome(null);
    setImportedCount(0);
    setProgress(null);
    try {
      const result = await service.probeDownload(trimmed);
      setProbe(result);
      setSelectedHeight(result.maxHeight);
      setRights(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo analizar la URL');
    } finally {
      setStage('idle');
      setProgress(null);
    }
  }

  async function download(): Promise<void> {
    if (!probe || !project) return;
    if (!rights) {
      setError('Confirmá que tenés derechos para descargar y usar este contenido.');
      return;
    }
    setStage('downloading');
    setError(null);
    setWarnings([]);
    setOutcome(null);
    setImportedCount(0);
    setProgress(null);
    let downloaded: DownloadOutcome | null = null;
    try {
      downloaded = await service.downloadMedia({
        url: probe.url,
        maxHeight: selectedHeight,
        compression,
        codec,
        kind: probe.kind,
        playlist: probe.kind === 'gallery',
      });
      setOutcome(downloaded);
      setWarnings([...downloaded.warnings]);
      setStage('importing');
      const imported = await service.importMediaPaths({
        paths: downloaded.files.map((file) => file.path),
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'social-download',
      });
      if (imported.assets.length === 0) {
        setError(
          imported.warnings.length
            ? imported.warnings.join(' ')
            : 'La descarga terminó pero no se pudo importar al proyecto.',
        );
        setWarnings([...downloaded.warnings, ...imported.warnings]);
        return;
      }
      store.mutate(
        (current) => {
          let next = current;
          for (const asset of imported.assets as Asset[]) {
            next = addAsset(next, asset);
          }
          return { project: next };
        },
        {
          notice: `${imported.assets.length} archivo(s) descargados e importados al proyecto.`,
        },
      );
      setImportedCount(imported.assets.length);
      setWarnings([...downloaded.warnings, ...imported.warnings]);
      if (imported.warnings.length === 0) {
        await service.cleanupDownload(downloaded.runId).catch(() => {});
      }
      store.setNotice(
        `${imported.assets.length} archivo(s) listos en Medios. Revisá los derechos antes de exportar.`,
      );
      setProgress({ stage: 'done', percent: 100, message: 'Importado al proyecto.' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'la descarga falló');
      if (downloaded && downloaded.files.length > 0) {
        setWarnings([
          ...downloaded.warnings,
          `Los archivos quedaron en ${downloaded.directory} por si querés importarlos a mano.`,
        ]);
      }
    } finally {
      setStage('idle');
    }
  }

  const qualityOptions = probe?.qualities ?? [];
  const canDownload =
    Boolean(probe) &&
    Boolean(project) &&
    rights &&
    !busy &&
    (probe?.kind !== 'gallery' || probe.entryCount > 0);

  return (
    <section className="view download-view">
      <div className="view-head">
        <div>
          <p className="eyebrow">Medios externos</p>
          <h2>Descargar</h2>
          <p className="view-summary">
            Bajá videos, fotos y audio de sitios compatibles con yt-dlp, hasta 8K cuando el sitio
            lo ofrezca. Se importan al proyecto y podés recomprimirlos con FFmpeg antes de
            editarlos.
          </p>
        </div>
        <div className="head-actions">
          <button type="button" className="ghost" onClick={() => onNavigate('assets')}>
            <Icon name="assets" size={14} />
            <span>Ir a Medios</span>
          </button>
        </div>
      </div>

      {!project ? (
        <div className="notice notice-warning" role="status">
          Necesitás un proyecto abierto para importar lo que descargues.{' '}
          <button type="button" className="small ghost" onClick={() => onNavigate('projects')}>
            Crear o abrir proyecto
          </button>
        </div>
      ) : null}

      <div className="download-layout">
        <div className="download-main">
          <div className="card download-engine">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Motor de descargas</p>
                <h3>
                  {engine == null
                    ? 'Verificando…'
                    : engine.available
                      ? `yt-dlp ${engine.version ?? ''}`
                      : 'Sin instalar'}
                </h3>
              </div>
              {engine?.available ? (
                <span className="download-engine-badge">Listo</span>
              ) : (
                <button
                  type="button"
                  className="small"
                  disabled={busy || engine?.canInstall === false}
                  onClick={() => void installEngine()}
                >
                  {stage === 'installing' ? 'Instalando…' : 'Instalar motor'}
                </button>
              )}
            </div>
            <p className="fine-print">
              {engine?.available
                ? 'El motor es un ejecutable oficial de yt-dlp. Editor IA no incluye ni redistribuye yt-dlp.'
                : engine?.hint ??
                  'Instalá el motor para descargar. Sólo se acepta contenido público o con permiso.'}
            </p>
          </div>

          <div className="card download-source">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Enlace</p>
                <h3>Video, foto, carrusel o audio</h3>
              </div>
            </div>
            <form
              className="download-url"
              onSubmit={(event) => {
                event.preventDefault();
                void analyze();
              }}
            >
              <input
                type="url"
                value={url}
                placeholder="https://www.instagram.com/p/… o cualquier enlace público compatible"
                aria-label="URL para descargar"
                disabled={busy}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setProbe(null);
                  setOutcome(null);
                  setError(null);
                }}
              />
              <button type="submit" className="primary icon-text" disabled={busy || !url.trim()}>
                <Icon name="search" size={14} />
                <span>{stage === 'probing' ? 'Analizando…' : 'Analizar'}</span>
              </button>
            </form>
            <p className="fine-print">
              Sitios con inicio de sesión obligatorio, DRM, transmisiones en vivo o contenido
              privado pueden fallar. Descargá sólo lo que te pertenece o tenés permiso de usar.
            </p>

            {probe ? (
              <div className="download-probe">
                <div className="download-probe-title">
                  <span className="asset-kind kind-video">{KIND_LABELS[probe.kind]}</span>
                  <strong>{probe.title}</strong>
                </div>
                <div className="download-probe-meta">
                  {probe.uploader ? <span>{probe.uploader}</span> : null}
                  <span>{formatDuration(probe.durationSeconds)}</span>
                  {probe.entryCount > 1 ? <span>{probe.entryCount} elementos</span> : null}
                  {probe.estimatedBytes ? (
                    <span>≈ {formatBytes(probe.estimatedBytes)}</span>
                  ) : null}
                  {probe.maxHeight ? <span>máx. {probe.maxHeight}p</span> : null}
                </div>
              </div>
            ) : null}
          </div>

          {probe ? (
            <div className="card download-options">
              <div className="production-card-head">
                <div>
                  <p className="eyebrow">Salida</p>
                  <h3>Calidad y compresión</h3>
                </div>
              </div>
              {probe.kind === 'video' && qualityOptions.length > 0 ? (
                <label className="field">
                  <span>Calidad a descargar</span>
                  <select
                    value={selectedHeight ?? qualityOptions[0]?.height ?? ''}
                    disabled={busy}
                    onChange={(event) => setSelectedHeight(Number(event.target.value))}
                  >
                    {qualityOptions.map((quality) => (
                      <option key={quality.height} value={quality.height}>
                        {qualitySummary(quality)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="fine-print">
                  {probe.kind === 'gallery'
                    ? 'El carrusel se descarga con la mejor calidad disponible de cada elemento (hasta 12).'
                    : probe.kind === 'image'
                      ? 'La imagen se descarga en su formato y resolución originales.'
                      : 'El audio se descarga en la mejor calidad disponible.'}
                </p>
              )}
              <div className="inspector-grid">
                <label className="field">
                  <span>Compresión</span>
                  <select
                    value={compression}
                    disabled={busy || probe.kind === 'image'}
                    onChange={(event) =>
                      setCompression(
                        event.target.value as (typeof COMPRESSION_OPTIONS)[number]['value'],
                      )
                    }
                  >
                    {COMPRESSION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Códec de compresión</span>
                  <select
                    value={codec}
                    disabled={busy || compression === 'none' || probe.kind === 'image'}
                    onChange={(event) => setCodec(event.target.value as 'h265' | 'h264')}
                  >
                    <option value="h265">H.265 · más chico</option>
                    <option value="h264">H.264 · más compatible</option>
                  </select>
                </label>
              </div>
              <p className="fine-print">
                Recomprimir tarda y puede cambiar el aspecto: se conserva el archivo comprimido
                sólo si queda más chico. Los videos HDR/10-bit se convierten a SDR 8-bit; para
                conservarlos intactos elegí «Original».
              </p>
            </div>
          ) : null}
        </div>

        <aside className="download-side">
          <div className="card download-run">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Descarga</p>
                <h3>{busy ? 'Trabajando…' : 'Listo para empezar'}</h3>
              </div>
            </div>
            {progress ? (
              <div className="download-progress" role="status" aria-live="polite">
                <div className="download-progress-head">
                  <span>{STAGE_LABELS[progress.stage]}</span>
                  {progress.percent != null ? <strong>{Math.round(progress.percent)}%</strong> : null}
                </div>
                {progress.percent != null ? (
                  <div
                    className="download-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress.percent)}
                    aria-label="Progreso de la descarga"
                  >
                    <span style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} />
                  </div>
                ) : null}
                <p className="fine-print">{progress.message}</p>
              </div>
            ) : null}
            <label className="check">
              <input
                type="checkbox"
                checked={rights}
                disabled={busy || !probe}
                onChange={(event) => setRights(event.target.checked)}
              />
              <span>Tengo derechos para descargar y usar este contenido.</span>
            </label>
            <button
              type="button"
              className="primary icon-text"
              disabled={!canDownload}
              onClick={() => void download()}
            >
              <Icon name="download" size={15} />
              <span>{stage === 'downloading' ? 'Descargando…' : 'Descargar e importar'}</span>
            </button>
            {error ? (
              <div className="notice notice-warning" role="alert">
                {error}
              </div>
            ) : null}
            {warnings.length > 0 ? (
              <ul className="download-warnings">
                {warnings.map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {outcome ? (
              <div className="download-outcome">
                <p className="eyebrow">Archivos</p>
                <ul>
                  {outcome.files.map((file) => (
                    <li key={file.path}>
                      <span>{file.name}</span>
                      <strong>{formatBytes(file.bytes)}</strong>
                    </li>
                  ))}
                </ul>
                {importedCount > 0 ? (
                  <button
                    type="button"
                    className="small"
                    onClick={() => onNavigate('assets')}
                  >
                    Ver {importedCount} archivo(s) en Medios
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="card download-notes">
            <p className="eyebrow">Cómo funciona</p>
            <ul>
              <li>Analizá el enlace para ver las calidades reales que ofrece el sitio.</li>
              <li>Elegí hasta 8K o una resolución menor para bajar más rápido.</li>
              <li>La compresión usa FFmpeg local: no sube tus archivos a ningún servicio.</li>
              <li>Al importar quedan como medios del proyecto y podés confirmar la licencia en Medios.</li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}
