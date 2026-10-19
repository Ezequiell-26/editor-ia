import { useEffect, useRef, useState } from 'react';
import type { RenderFinishedEvent, RenderProgressEvent } from '../../services/project-service';
import { basename } from '../../lib/format';
import { ensureDelivery, fpsOf } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

interface ExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const [profileId, setProfileId] = useState('');
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RenderProgressEvent | null>(null);
  const [finished, setFinished] = useState<RenderFinishedEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<string | null>(null);
  jobRef.current = jobId;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFinished(null);
    setProgress(null);
    setJobId(null);
    jobRef.current = null;
    setIncludeCaptions((project?.captions.cues.length ?? 0) > 0);
    const profiles = project?.renderProfiles ?? [];
    setProfileId(profiles[0]?.id ?? '');
    // Only reset when the dialog opens, not on every project render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !store.service.available) return;
    let mounted = true;
    let offProgress: (() => void) | null = null;
    let offFinished: (() => void) | null = null;
    void store.service.onRenderProgress((event) => {
      if (!mounted) return;
      if (jobRef.current !== null && event.jobId !== jobRef.current) return;
      setProgress(event);
    }).then((off) => {
      offProgress = off;
    });
    void store.service.onRenderFinished((event) => {
      if (!mounted) return;
      if (jobRef.current !== null && event.jobId !== jobRef.current) return;
      setFinished(event);
      setJobId(null);
      setStarting(false);
      if (event.status === 'completed') {
        setProgress((current) => ({
          jobId: event.jobId,
          percent: 100,
          processedSeconds: event.durationSeconds ?? current?.totalSeconds ?? 0,
          totalSeconds: event.durationSeconds ?? current?.totalSeconds ?? 0,
          phase: 'completado',
        }));
      }
    }).then((off) => {
      offFinished = off;
    });
    void store.service
      .activeRender()
      .then((active) => {
        if (!mounted || !active) return;
        jobRef.current = active;
        setJobId(active);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      offProgress?.();
      offFinished?.();
    };
  }, [open, store.service]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !jobId) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jobId, onClose, open]);

  if (!open || !project) return null;

  const profiles = project.renderProfiles;
  const selected = profiles.find((profile) => profile.id === profileId) ?? profiles[0];
  const running = Boolean(jobId) || starting;
  const fps = fpsOf(project);

  async function start(): Promise<void> {
    setError(null);
    setFinished(null);
    setProgress(null);
    setStarting(true);
    try {
      const saved = await store.saveNow();
      if (!saved) {
        setError('No se pudo guardar el proyecto; el render no se inició.');
        setStarting(false);
        return;
      }
      const started = await store.service.startRender(selected?.id ?? null, includeCaptions);
      if (!started) {
        setStarting(false);
        return;
      }
      jobRef.current = started.jobId;
      setJobId(started.jobId);
      setProgress({
        jobId: started.jobId,
        percent: 0,
        processedSeconds: 0,
        totalSeconds: store.durationFrames / fps,
        phase: 'preparando',
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'el render no se pudo iniciar');
      setStarting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header className="modal-head">
          <div>
            <p className="eyebrow">Exportar</p>
            <h3 id="export-title">Render MP4 verificado</h3>
          </div>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose} disabled={running}>
            ×
          </button>
        </header>

        {profiles.length === 0 ? (
          <div className="modal-body">
            <p className="notice notice-warning">
              El proyecto no tiene perfiles de exportación. Agregá los perfiles 16:9 y 9:16 para
              continuar.
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => store.update((current) => ensureDelivery(current))}
            >
              Agregar perfiles por defecto
            </button>
          </div>
        ) : (
          <>
            <div className="modal-body">
              <label className="field">
                <span>Perfil</span>
                <select
                  value={selected?.id ?? ''}
                  onChange={(event) => setProfileId(event.target.value)}
                  disabled={running}
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · {profile.resolution.width}×{profile.resolution.height} ·{' '}
                      {profile.aspectRatio}
                    </option>
                  ))}
                </select>
              </label>
              {selected ? (
                <dl className="data-list compact">
                  <div>
                    <dt>Códec</dt>
                    <dd>
                      {selected.videoCodec} · {selected.audioCodec}
                    </dd>
                  </div>
                  <div>
                    <dt>FPS</dt>
                    <dd>
                      {selected.frameRate.num}/{selected.frameRate.den}
                    </dd>
                  </div>
                  <div>
                    <dt>Calidad</dt>
                    <dd>
                      {selected.bitrate.mode === 'crf'
                        ? `CRF ${selected.bitrate.crf}`
                        : `${Math.round(selected.bitrate.videoBitsPerSecond / 1_000_000)} Mbps`}
                    </dd>
                  </div>
                  <div>
                    <dt>Verificación</dt>
                    <dd>
                      mínimo {formatBytes(selected.qualityGate.minOutputBytes)} · tolerancia{' '}
                      {selected.qualityGate.durationToleranceFrames} frames
                    </dd>
                  </div>
                </dl>
              ) : null}
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeCaptions}
                  onChange={(event) => setIncludeCaptions(event.target.checked)}
                  disabled={running}
                />
                <span>
                  Quemar los subtítulos del proyecto en el video (libass). Actualmente hay{' '}
                  {project.captions.cues.length} subtítulo(s).
                </span>
              </label>
              <p className="fine-print">
                El render usa el archivo guardado en disco. Antes de iniciar se guarda el proyecto;
                si falla el guardado, no se renderiza. Elegís la ubicación del MP4 en el diálogo de
                Windows.
              </p>

              {progress ? (
                <div className="progress-block" role="status" aria-live="polite">
                  <div className="progress-head">
                    <strong>{progress.phase}</strong>
                    <span>{Math.round(progress.percent)}%</span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }} />
                  </div>
                  <p className="fine-print">
                    {progress.processedSeconds.toFixed(1)} s de {progress.totalSeconds.toFixed(1)} s
                  </p>
                </div>
              ) : null}

              {error ? <p className="notice notice-error">{error}</p> : null}

              {finished ? (
                <div className={finished.status === 'completed' ? 'render-result success' : 'render-result'}>
                  {finished.status === 'completed' ? (
                    <>
                      <strong>Render completado y verificado.</strong>
                      <p className="render-file">{basename(finished.outputPath ?? '')}</p>
                      <p>
                        {formatBytes(finished.outputBytes)} ·{' '}
                        {finished.durationSeconds?.toFixed(2)} s ·{' '}
                        {finished.width}×{finished.height} ·{' '}
                        {(finished.elapsedMs / 1000).toFixed(1)} s de proceso
                      </p>
                      <div className="actions compact">
                        <button
                          type="button"
                          className="small"
                          onClick={() => {
                            if (finished.outputPath) {
                              void store.service.revealOutput(finished.outputPath).catch((cause) => {
                                setError(cause instanceof Error ? cause.message : 'no se pudo abrir la carpeta');
                              });
                            }
                          }}
                        >
                          Abrir carpeta
                        </button>
                      </div>
                    </>
                  ) : finished.status === 'cancelled' ? (
                    <strong>Render cancelado. No se reporta ningún archivo.</strong>
                  ) : (
                    <>
                      <strong>El render falló.</strong>
                      <p>{finished.message ?? 'sin detalle'}</p>
                      {finished.detail ? <pre className="log-detail">{finished.detail}</pre> : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
            <footer className="modal-foot">
              {running ? (
                <>
                  <span className="fine-print">El proceso corre en FFmpeg nativo; podés cancelarlo.</span>
                  <button
                    type="button"
                    className="danger-ghost"
                    onClick={() => {
                      if (jobId) {
                        void store.service.cancelRender(jobId).catch((cause) => {
                          const message =
                            cause instanceof Error ? cause.message : 'no se pudo cancelar';
                          if (message.includes('NOT_FOUND') || message.includes('no está en curso')) {
                            jobRef.current = null;
                            setJobId(null);
                            setStarting(false);
                            setError('El render ya terminó; revisá la carpeta de salida.');
                          } else {
                            setError(message);
                          }
                        });
                      }
                    }}
                    disabled={!jobId}
                  >
                    Cancelar render
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="ghost" onClick={onClose}>
                    Cerrar
                  </button>
                  <button type="button" className="primary" onClick={() => void start()}>
                    Elegir destino y exportar
                  </button>
                </>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
