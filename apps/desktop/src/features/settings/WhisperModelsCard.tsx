import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import type {
  NativeWhisperModel,
  NativeWhisperStatus,
  WhisperModelDownloadEvent,
  WhisperModelDownloadProgress,
} from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';

/** Tamaño del modelo en MB legible (`sizeBytes` del backend, en bytes). */
export function whisperMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const mb = bytes / 1_048_576;
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/**
 * Porcentaje efectivo del progreso: el `percent` del backend cuando existe
 * y, si no, `received / total` calculado (el total puede ser estimado).
 * `null` cuando no hay forma honesta de medir.
 */
export function whisperProgressPercent(
  progress: WhisperModelDownloadProgress,
): number | null {
  if (typeof progress.percent === 'number' && Number.isFinite(progress.percent)) {
    return Math.max(0, Math.min(100, Math.round(progress.percent)));
  }
  if (progress.total > 0) {
    return Math.max(0, Math.min(100, Math.round((progress.received / progress.total) * 100)));
  }
  return null;
}

/** Etiqueta del estado del progreso según la fase real reportada. */
export function whisperProgressLabel(progress: WhisperModelDownloadProgress): string {
  if (progress.unpacking) return 'Verificando e instalando el modelo…';
  if (progress.done) return 'Descarga completa';
  return 'Descargando…';
}

/**
 * `true` cuando el modelo se puede descargar ahora: engine disponible, sin
 * descarga en curso y el modelo todavía no está en disco.
 */
export function canDownloadWhisperModel(
  model: NativeWhisperModel,
  status: NativeWhisperStatus | null,
): boolean {
  if (!status?.engineAvailable) return false;
  if (status.download.running) return false;
  return !model.downloaded;
}

/**
 * Modelos del motor nativo de transcripción (whisper.cpp in-process).
 *
 * Vive en Ajustes › Herramientas junto al concat-worker: es una herramienta
 * local más. El estado viene de `whisper_model_status` y el progreso de la
 * descarga llega por el evento `whisper-model-download` con bytes reales —
 * no hay polling ni porcentajes inventados. Si whisper.cpp no está
 * compilado en la build, se muestra como no disponible con el motivo.
 *
 * El botón «Cancelar» llama `whisper_model_download_cancel` del backend.
 */
export function WhisperModelsCard() {
  const store = useProjectStore();
  const [status, setStatus] = useState<NativeWhisperStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [live, setLive] = useState<WhisperModelDownloadEvent | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!store.service.available) {
      setStatus(null);
      setChecked(true);
      return;
    }
    // No limpia `error`: el fallo de una descarga llega por evento y debe
    // sobrevivir a la relectura de estado que lo acompaña.
    try {
      setStatus(await store.service.whisperModelStatus());
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'no se pudo leer el estado de los modelos whisper',
      );
    } finally {
      setChecked(true);
    }
  }, [store.service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Progreso real del backend: el evento trae los bytes que llegan de verdad.
  // Al terminar (done o error) se relee el estado para reflejar el `.bin`.
  useEffect(() => {
    if (!store.service.available) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void store.service
      .onWhisperModelDownload((event) => {
        if (disposed) return;
        setLive(event);
        if (event.error) {
          setError(`La descarga del modelo ${event.modelId} falló: ${event.error}`);
          void refresh();
        } else if (event.done) {
          void refresh();
        }
      })
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch(() => {
        // Sin runtime Tauri la descarga sigue funcionando; sólo se pierde el
        // progreso en vivo y el estado se relee al terminar el comando.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [store.service, refresh]);

  async function download(model: NativeWhisperModel): Promise<void> {
    setStarting(model.id);
    setError(null);
    setNotice(null);
    setLive(null);
    try {
      await store.service.whisperModelDownload(model.id);
      setNotice(`Modelo ${model.label} descargado y verificado.`);
      await refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : `no se pudo descargar el modelo ${model.id}`,
      );
      // El backend conserva el error en `download.error`: releerlo lo muestra.
      await refresh();
    } finally {
      setStarting(null);
    }
  }

  async function cancelDownload(): Promise<void> {
    setError(null);
    try {
      await store.service.whisperModelDownloadCancel();
      setNotice('Descarga cancelada.');
      await refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'no se pudo cancelar la descarga del modelo',
      );
    }
  }

  // El evento en vivo es más fresco que el snapshot del último status; el
  // snapshot cubre descargas disparadas fuera de esta tarjeta.
  const progress: WhisperModelDownloadProgress | null =
    live ?? status?.download.progress ?? null;
  const downloadRunning = status?.download.running === true;
  const progressVisible =
    downloadRunning || (live !== null && !live.done) || starting !== null;
  const percent = progress ? whisperProgressPercent(progress) : null;

  return (
    <article className="card">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Transcripción local</p>
          <h3>Modelos Whisper (nativo)</h3>
        </div>
        {status ? (
          <span className={`status-pill ${status.engineAvailable ? 'saved' : 'failed'}`}>
            {status.engineAvailable ? 'Motor disponible' : 'No disponible'}
          </span>
        ) : checked ? (
          <span className="status-pill dirty">Sin lectura</span>
        ) : (
          <span className="status-pill">Comprobando</span>
        )}
      </div>
      <p className="muted">
        whisper.cpp corre dentro de la app (sin Python) para transcribir audio a
        subtítulos. Los modelos <code>ggml</code> se descargan una vez y quedan en
        la carpeta de configuración; la primera transcripción con cada modelo
        tarda más porque lo carga en memoria.
      </p>

      {!store.service.available ? (
        <p className="fine-print">
          El estado de los modelos whisper sólo se puede leer en la app de escritorio.
        </p>
      ) : (
        <>
          {error ? (
            <p className="notice notice-warning" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="notice notice-notice" role="status">
              {notice}
            </p>
          ) : null}
          {status && !status.engineAvailable ? (
            <p className="notice notice-warning" role="status">
              El motor whisper.cpp no está compilado en esta build del escritorio:
              la transcripción nativa no está disponible. Seguí usando el motor
              Python (faster-whisper) si está instalado, o una build con whisper-rs.
            </p>
          ) : null}
          {status?.download.error ? (
            <p className="notice notice-warning" role="status">
              Última descarga fallida: {status.download.error}
            </p>
          ) : null}

          {status ? (
            <dl className="data-list">
              <div>
                <dt>Motor</dt>
                <dd>
                  {status.engineAvailable
                    ? 'whisper.cpp en proceso'
                    : 'whisper.cpp no compilado'}
                </dd>
              </div>
              <div>
                <dt>Modelo cargado</dt>
                <dd>{status.loadedModel ?? 'ninguno'}</dd>
              </div>
              <div>
                <dt>Estado</dt>
                <dd>{status.busy ? 'transcribiendo…' : 'inactivo'}</dd>
              </div>
              <div>
                <dt>Carpeta de modelos</dt>
                <dd className="path">{status.modelsDir}</dd>
              </div>
            </dl>
          ) : checked ? (
            <p className="empty-inline">No se pudo leer el estado de los modelos.</p>
          ) : (
            <p className="fine-print">Leyendo el estado de los modelos…</p>
          )}

          {progressVisible ? (
            <div className="whisper-download" role="status">
              <div className="proxy-progress" role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent ?? undefined}
                aria-label={progress ? `Descarga de ${progress.modelId}` : 'Descarga de modelo'}
              >
                <span style={{ width: `${percent ?? 0}%` }} />
              </div>
              <p className="fine-print">
                {progress
                  ? `${whisperProgressLabel(progress)} · ${progress.modelId}` +
                    (progress.total > 0
                      ? ` · ${whisperMegabytes(progress.received)} de ${whisperMegabytes(progress.total)}`
                      : '') +
                    (percent !== null ? ` · ${percent}%` : '')
                  : 'Iniciando la descarga del modelo…'}
              </p>
            </div>
          ) : null}

          {status && status.models.length > 0 ? (
            <ul className="models-list">
              {status.models.map((model) => {
                const downloading =
                  downloadRunning &&
                  (status.download.modelId === model.id ||
                    live?.modelId === model.id);
                return (
                  <li key={model.id} className="model-row">
                    <div className="model-copy">
                      <strong>
                        {model.label}
                        {model.id === status.loadedModel ? ' · cargado' : ''}
                      </strong>
                      <span>
                        {whisperMegabytes(model.sizeBytes)} ·{' '}
                        {model.downloaded ? 'descargado' : 'pendiente'}
                        {model.englishOnly ? ' · sólo inglés' : ''}
                      </span>
                      <small>{model.blurb}</small>
                      {model.path ? <small className="path">{model.path}</small> : null}
                    </div>
                    {model.downloaded ? (
                      <span className="status-pill saved">Descargado</span>
                    ) : (
                      <button
                        type="button"
                        className="primary small"
                        onClick={() => void download(model)}
                        disabled={
                          starting !== null ||
                          !canDownloadWhisperModel(model, status)
                        }
                        title={
                          status.download.running
                            ? `Ya hay una descarga en curso (${status.download.modelId ?? 'modelo desconocido'})`
                            : !status.engineAvailable
                              ? 'El motor whisper.cpp no está compilado en esta build'
                              : undefined
                        }
                      >
                        {downloading || starting === model.id
                          ? 'Descargando…'
                          : 'Descargar'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="actions">
            <button
              type="button"
              className="ghost small icon-text"
              onClick={() => {
                setError(null);
                void refresh();
              }}
              disabled={starting !== null}
            >
              <Icon name="refresh" size={14} />
              <span>Comprobar estado</span>
            </button>
            {downloadRunning ? (
              <button
                type="button"
                className="ghost small"
                onClick={() => void cancelDownload()}
                disabled={starting !== null}
              >
                Cancelar
              </button>
            ) : null}
          </div>
          <p className="fine-print">
            Las descargas usan el mirror de Concat con verificación SHA-256 y
            reanudación. «Sólo inglés» son variantes más chicas y precisas para
            material en inglés; el resto detecta el idioma solo.
          </p>
        </>
      )}
    </article>
  );
}
