import { useEffect, useRef, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type {
  DownloaderBridgeInfo,
  DownloaderStatus,
  DownloadOutcome,
  DownloadProbe,
  DownloadProgressEvent,
  DownloadQuality,
} from '../../services/project-service';
import { addAsset } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { takePendingDownloadUrl } from './pending';
import { normalizeDownloadUrl } from './url';

type Stage = 'idle' | 'installing' | 'probing' | 'downloading' | 'importing';

const COMPRESSION_OPTIONS = [
  { value: 'none', label: 'Original · sin recomprimir' },
  { value: 'high', label: 'Alta calidad · CRF 20' },
  { value: 'balanced', label: 'Equilibrada · CRF 24 (recomendada)' },
  { value: 'compact', label: 'Compacta · CRF 27' },
] as const;

const DOWNLOAD_DIR_KEY = 'editor-ia.download-dir.v1';

function loadDownloadDir(): string | null {
  try {
    const value = window.localStorage.getItem(DOWNLOAD_DIR_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

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
  const [pendingUrl] = useState(takePendingDownloadUrl);
  const [url, setUrl] = useState(pendingUrl);
  const autoAnalyzed = useRef(false);
  const [cookiesPath, setCookiesPath] = useState<string | null>(null);
  const [probe, setProbe] = useState<DownloadProbe | null>(null);
  const [engine, setEngine] = useState<DownloaderStatus | null>(null);
  const [bridge, setBridge] = useState<DownloaderBridgeInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState<DownloadProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rights, setRights] = useState(false);
  const [quality, setQuality] = useState<'best' | 'worst' | number>('best');
  const [destinationRoot, setDestinationRoot] = useState<string | null>(loadDownloadDir);
  const [compression, setCompression] = useState<(typeof COMPRESSION_OPTIONS)[number]['value']>(
    'balanced',
  );
  const [format, setFormat] = useState<'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a'>('mp4');
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
    void service
      .downloaderBridgeInfo()
      .then((info) => {
        if (!cancelled) setBridge(info);
      })
      .catch((reason) => {
        if (!cancelled) {
          setBridgeError(
            reason instanceof Error ? reason.message : 'el puente para la extensión no está disponible',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  async function copyBridge(): Promise<void> {
    if (!bridge) return;
    try {
      await navigator.clipboard.writeText(`${bridge.port}:${bridge.token}`);
      store.setNotice('Conexión copiada. Pegala en la extensión una vez.');
    } catch {
      store.setNotice('No se pudo copiar; seleccioná el token a mano.');
    }
  }

  useEffect(() => {
    if (autoAnalyzed.current || !pendingUrl.trim()) return;
    autoAnalyzed.current = true;
    void analyze();
    // Sólo se autoanaliza la URL que llegó desde otra vista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUrl]);

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

  async function chooseDestination(): Promise<void> {
    setError(null);
    try {
      const picked = await service.chooseDownloadDirectory();
      if (!picked) return;
      setDestinationRoot(picked);
      try {
        window.localStorage.setItem(DOWNLOAD_DIR_KEY, picked);
      } catch {
        // The choice still applies to this session.
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo elegir la carpeta');
    }
  }

  function useDefaultDestination(): void {
    setDestinationRoot(null);
    try {
      window.localStorage.removeItem(DOWNLOAD_DIR_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }

  async function chooseCookies(): Promise<void> {
    setError(null);
    try {
      const picked = await service.chooseCookiesFile();
      if (!picked) return;
      setCookiesPath(picked);
      setProbe(null);
      setOutcome(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo abrir el archivo de cookies');
    }
  }

  async function analyze(): Promise<void> {
    const trimmed = normalizeDownloadUrl(url);
    if (!trimmed) {
      setError(
        'Pegá un enlace http(s) válido, por ejemplo https://youtu.be/… o youtube.com/watch?v=…',
      );
      return;
    }
    setUrl(trimmed);
    setStage('probing');
    setError(null);
    setWarnings([]);
    setProbe(null);
    setOutcome(null);
    setImportedCount(0);
    setProgress(null);
    try {
      const result = await service.probeDownload(trimmed, cookiesPath);
      setProbe(result);
      setQuality('best');
      setFormat(result.kind === 'audio' ? 'm4a' : 'mp4');
      setCompression(result.kind === 'image' ? 'none' : 'balanced');
      setRights(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo analizar la URL');
    } finally {
      setStage('idle');
      setProgress(null);
    }
  }

  async function download(): Promise<void> {
    if (!probe) return;
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
        maxHeight: typeof quality === 'number' ? quality : null,
        quality: typeof quality === 'number' ? 'height' : quality,
        compression,
        codec,
        kind: probe.kind,
        playlist: probe.kind === 'gallery',
        cookiesFile: cookiesPath,
        format,
        saveToDownloads: true,
        destinationRoot,
      });
      setOutcome(downloaded);
      setWarnings([...downloaded.warnings]);
      if (!project) {
        setStage('idle');
        setProgress({ stage: 'done', percent: 100, message: 'Guardado en Videos descargados.' });
        store.setNotice(`Descarga terminada en ${destinationPath}.`);
        // El backend mueve los archivos fuera del caché. No borramos el run
        // aquí: con un backend anterior los archivos todavía viven ahí.
        return;
      }
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
  const bestQuality = qualityOptions[0];
  const minQuality = qualityOptions[qualityOptions.length - 1];
  const destinationPath =
    destinationRoot ?? bridge?.downloadsDir ?? 'Descargas\\Videos descargados';
  const destinationDrive = destinationPath.match(/^[A-Za-z]:/)?.[0] ?? null;
  const canDownload =
    Boolean(probe) &&
    rights &&
    !busy &&
    (probe?.kind !== 'gallery' || probe.entryCount > 0);

  return (
    <section className="view download-view">
      <ViewToolbar
        label="Descargar"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('assets')}>
            <Icon name="assets" size={14} />
            <span>Ir a Medios</span>
          </button>
        }
      />

      {!project ? (
        <div className="notice" role="status">
          <strong>No necesitás un proyecto para descargar.</strong> El archivo se guarda en{' '}
          <code>Descargas/Videos descargados/&lt;Plataforma&gt;/&lt;Nombre del video&gt;</code>{' '}
          y queda disponible en la biblioteca. Si después querés editarlo, abrí un proyecto e
          importalo desde Medios.
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
                ? 'El motor es un ejecutable oficial de yt-dlp. Olyvia no incluye ni redistribuye yt-dlp.'
                : engine?.hint ??
                  'Instalá el motor para descargar. Sólo se acepta contenido público o con permiso.'}
            </p>
            <div className="download-bridge">
              <div>
                <p className="eyebrow">Extensión de Chrome / Edge</p>
                <p className="fine-print">
                  {bridge
                    ? `Puente local en 127.0.0.1:${bridge.port} · token ${bridge.token.slice(0, 8)}…`
                    : bridgeError ?? 'Conectando el puente local…'}
                </p>
              </div>
              {bridge ? (
                <button type="button" className="small" onClick={() => void copyBridge()}>
                  Copiar conexión
                </button>
              ) : null}
            </div>
            {bridge ? (
              <p className="fine-print">
                En Chrome o Edge abrí <code>chrome://extensions</code>, activá Modo desarrollador,
                elegí «Cargar descomprimida» y apuntá a <code>extensions/editor-ia-downloader</code>.
                Pegá la conexión una vez en la extensión.
              </p>
            ) : null}
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
                type="text"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                value={url}
                placeholder="Pegá un enlace de YouTube, Instagram, TikTok o cualquier sitio público…"
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
            <div className="download-cookies">
              <div>
                <span className="eyebrow">Cookies (opcional)</span>
                <p className="fine-print">
                  {cookiesPath
                    ? `Usando ${cookiesPath.split(/[\\/]/).pop()} sólo para esta sesión.`
                    : 'Para contenido con login, exportá cookies.txt en formato Netscape y elegilo acá. No se guardan en el proyecto.'}
                </p>
              </div>
              <div className="actions compact">
                <button type="button" className="small ghost" disabled={busy} onClick={() => void chooseCookies()}>
                  {cookiesPath ? 'Cambiar cookies' : 'Elegir cookies.txt'}
                </button>
                {cookiesPath ? (
                  <button
                    type="button"
                    className="small ghost"
                    disabled={busy}
                    onClick={() => {
                      setCookiesPath(null);
                      setProbe(null);
                    }}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
            </div>
            <p className="fine-print">
              Sitios con DRM, captchas, transmisiones en vivo o contenido privado pueden fallar
              incluso con cookies. Descargá sólo lo que te pertenece o tenés permiso de usar.
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
                <>
                  <label className="field">
                    <span>Calidad a descargar</span>
                    <select
                      value={String(quality)}
                      disabled={busy}
                      onChange={(event) => {
                        const value = event.target.value;
                        setQuality(
                          value === 'best' || value === 'worst' ? value : Number(value),
                        );
                      }}
                    >
                      <option value="best">
                        Mejor disponible
                        {bestQuality ? ` · ${qualitySummary(bestQuality)}` : ''}
                      </option>
                      <option value="worst">
                        Mínima disponible
                        {minQuality ? ` · ${qualitySummary(minQuality)}` : ''}
                      </option>
                      {qualityOptions.map((item) => (
                        <option key={item.height} value={item.height}>
                          Solo {qualitySummary(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="fine-print">
                    Mejor y Mínima eligen automáticamente la pista de video y audio del sitio;
                    las opciones con altura fijan un tope.
                  </p>
                </>
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
                  <span>Formato de salida</span>
                  <select
                    value={format}
                    disabled={busy || probe.kind === 'image'}
                    onChange={(event) => {
                      const value = event.target.value as 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a';
                      setFormat(value);
                      if (value !== 'mp4') setCompression('none');
                    }}
                  >
                    <option value="mp4">MP4 · más compatible</option>
                    <option value="mkv">MKV · contenedor flexible</option>
                    <option value="webm">WebM · web</option>
                    <option value="mp3">MP3 · sólo audio</option>
                    <option value="m4a">M4A · audio AAC</option>
                  </select>
                </label>
                <label className="field">
                  <span>Compresión</span>
                  <select
                    value={compression}
                    disabled={busy || probe.kind === 'image' || format !== 'mp4'}
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
                    disabled={
                      busy ||
                      compression === 'none' ||
                      probe.kind === 'image' ||
                      format !== 'mp4'
                    }
                    onChange={(event) => setCodec(event.target.value as 'h265' | 'h264')}
                  >
                    <option value="h265">H.265 · más chico</option>
                    <option value="h264">H.264 · más compatible</option>
                  </select>
                </label>
              </div>
              <p className="fine-print">
                MP3/M4A extraen sólo el audio; MKV/WebM cambian el contenedor y dependen de los
                códecs del sitio. La compresión sólo se aplica a MP4, tarda y puede cambiar el
                aspecto: se conserva el archivo comprimido sólo si queda más chico. HDR/10-bit pasa
                a SDR 8-bit; para conservarlo, elegí compresión «Original».
              </p>
            </div>
          ) : null}
        </div>

        <aside className="download-side">
          <div className="card download-run">
            <div className="production-card-head">
              <div>
                <p className="eyebrow">Descarga</p>
                <h3>{busy ? 'Trabajando…' : project ? 'Listo para importar' : 'Descarga sin proyecto'}</h3>
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
            <div className="download-destination">
              <div className="download-destination-head">
                <Icon name="folder" size={15} />
                <div>
                  <p className="eyebrow">Guardar en</p>
                  <strong>
                    {destinationRoot ? destinationDrive ?? 'Carpeta elegida' : 'Predeterminada'}
                  </strong>
                </div>
              </div>
              <code title={destinationPath}>{destinationPath}</code>
              <div className="actions compact">
                <button
                  type="button"
                  className="small"
                  onClick={() => void chooseDestination()}
                  disabled={busy}
                >
                  Elegir carpeta…
                </button>
                {destinationRoot ? (
                  <button
                    type="button"
                    className="small"
                    onClick={useDefaultDestination}
                    disabled={busy}
                  >
                    Usar predeterminada
                  </button>
                ) : null}
              </div>
              <p className="fine-print">
                Se agrega automáticamente <code>&lt;Red&gt;/&lt;Nombre del video&gt;</code> dentro
                de esa carpeta.
              </p>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={rights}
                disabled={busy || !probe}
                onChange={(event) => setRights(event.target.checked)}
              />
              <span>Tengo derechos para descargar y usar este contenido.</span>
            </label>
            {!project ? (
              <p className="fine-print">
                Se guarda en la biblioteca y no se importa a Medios.
              </p>
            ) : null}
            <button
              type="button"
              className="primary icon-text"
              disabled={!canDownload}
              onClick={() => void download()}
            >
              <Icon name="download" size={15} />
              <span>
                {stage === 'downloading'
                  ? 'Descargando…'
                  : project
                    ? 'Descargar e importar'
                    : 'Descargar a la biblioteca'}
              </span>
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
                <p className="fine-print">
                  Guardado en <code>{outcome.directory}</code>
                </p>
                <div className="actions compact">
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => {
                      const path = outcome.files[0]?.path ?? outcome.directory;
                      void store.service.revealOutput(path).catch((reason) =>
                        store.setNotice(
                          reason instanceof Error
                            ? reason.message
                            : 'no se pudo abrir la carpeta',
                        ),
                      );
                    }}
                  >
                    Mostrar en carpeta
                  </button>
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
              </div>
            ) : null}
          </div>

          <div className="card download-notes">
            <p className="eyebrow">Cómo funciona</p>
            <ul>
              <li>Analizá el enlace para ver las calidades reales que ofrece el sitio.</li>
              <li>Elegí hasta 8K o una resolución menor para bajar más rápido.</li>
              <li>La compresión usa FFmpeg local: no sube tus archivos a ningún servicio.</li>
              <li>Cada descarga queda en <code>Descargas/Videos descargados/&lt;Plataforma&gt;/&lt;Video&gt;</code>.</li>
              <li>Con un proyecto abierto, además se importa a Medios para confirmar la licencia.</li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}
