import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import { fpsOf } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import {
  activeCameraAt,
  assetDurationFrames,
  buildMulticamProject,
  clampFrame,
  envelopeFromPeaks,
  normalizeCuts,
  programDurationFrames,
  recordCut,
  syncOffsetsFromEnvelopes,
  type MulticamBuild,
  type MulticamCamera,
  type MulticamCut,
} from './multicam';

function clock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}

function previewPath(asset: Asset): string {
  if ('proxy' in asset && asset.proxy) return asset.proxy.path;
  return asset.source.path;
}

/**
 * Multicámara v1: monitor con varias cámaras sincronizadas por un punto de
 * entrada manual, botones de ángulo en vivo y grabación de cortes. El corte
 * final se monta en una pista nueva; las originales no se tocan.
 */
export function MulticamView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const root = store.state.opened?.root ?? '';
  const fps = project ? fpsOf(project) : 30;
  const videos = useMemo(
    () => (project?.assets ?? []).filter((asset) => asset.kind === 'video' && asset.status === 'ready'),
    [project],
  );
  const videoKey = videos.map((asset) => asset.id).join('|');

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [cuts, setCuts] = useState<MulticamCut[]>([{ frame: 0, cameraIndex: 0 }]);
  const [activeCamera, setActiveCamera] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [programSeconds, setProgramSeconds] = useState(0);
  const [audioSyncBusy, setAudioSyncBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const rafRef = useRef(0);
  const clockRef = useRef<{ startWall: number; startProgram: number } | null>(null);

  useEffect(() => {
    setSelectedIds((current) => {
      const valid = current.filter((id) => videos.some((asset) => asset.id === id));
      if (valid.length > 0) return valid;
      return videos.slice(0, 2).map((asset) => asset.id);
    });
  }, [videoKey]);

  const cameras = useMemo<MulticamCamera[]>(
    () =>
      selectedIds.flatMap((id) => {
        const asset = videos.find((item) => item.id === id);
        if (!asset) return [];
        const seconds = Math.max(0, offsets[id] ?? 0);
        return [{ asset, offsetFrames: Math.round(seconds * fps) }];
      }),
    [selectedIds, offsets, videos, fps],
  );
  const totalFrames = programDurationFrames(cameras);
  const totalSeconds = totalFrames / fps;
  const programFrame = clampFrame(
    Math.round(programSeconds * fps),
    Math.max(0, totalFrames - 1),
  );
  const detectionIndex = activeCameraAt(cuts, programFrame);

  function stopClock(): void {
    if (rafRef.current !== 0) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    clockRef.current = null;
  }

  function pauseVideos(): void {
    for (const video of videoRefs.current) {
      try {
        video?.pause();
      } catch {
        // jsdom / video todavía sin metadata
      }
    }
  }

  function seekVideos(seconds: number): void {
    cameras.forEach((camera, index) => {
      const video = videoRefs.current[index];
      if (!video) return;
      try {
        video.currentTime = Math.max(
          0,
          Math.min(seconds + camera.offsetFrames / fps, assetDurationFrames(camera.asset) / fps - 0.05),
        );
      } catch {
        // metadata no disponible
      }
    });
  }

  function playVideos(seconds: number): void {
    cameras.forEach((camera, index) => {
      const video = videoRefs.current[index];
      if (!video) return;
      try {
        video.muted = index !== activeCamera;
        video.currentTime = Math.max(0, seconds + camera.offsetFrames / fps);
        void video.play().catch(() => {
          // autoplay bloqueado hasta que haya gesto; el botón ya es uno
        });
      } catch {
        // metadata no disponible
      }
    });
  }

  function resetMonitor(): void {
    stopClock();
    pauseVideos();
    setPlaying(false);
    setProgramSeconds(0);
    setCuts([{ frame: 0, cameraIndex: 0 }]);
    setActiveCamera(0);
    seekVideos(0);
  }

  const resetKey = `${selectedIds.join('|')}::${JSON.stringify(offsets)}`;
  useEffect(() => {
    resetMonitor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(
    () => () => {
      stopClock();
      pauseVideos();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  );

  async function syncByAudio(): Promise<void> {
    if (cameras.length < 2 || audioSyncBusy) return;
    setAudioSyncBusy(true);
    setError(null);
    try {
      const envelopes = [];
      for (const camera of cameras) {
        const duration = assetDurationFrames(camera.asset) / fps;
        const buckets = Math.max(16, Math.min(4000, Math.round(duration * 25)));
        const peaks = await store.service.audioPeaks(camera.asset.id, buckets);
        const envelope = envelopeFromPeaks(peaks);
        if (envelope.values.length === 0) {
          throw new Error(`${camera.asset.label} no tiene audio analizable.`);
        }
        envelopes.push(envelope);
      }
      const result = syncOffsetsFromEnvelopes(envelopes);
      if (!result) {
        throw new Error(
          'No encontré suficiente audio en común. Ajustá el punto de entrada a mano o usá cámaras con sonido ambiente compartido.',
        );
      }
      const next = { ...offsets };
      cameras.forEach((camera, index) => {
        const duration = assetDurationFrames(camera.asset) / fps;
        next[camera.asset.id] = Math.min(duration, Math.max(0, result.offsetsSeconds[index] ?? 0));
      });
      setOffsets(next);
      store.setNotice(
        `Multicámara sincronizada por audio: ${cameras.length} cámaras, confianza ${Math.round(
          Math.min(...result.scores) * 100,
        )}%.`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'no se pudo sincronizar las cámaras por audio',
      );
    } finally {
      setAudioSyncBusy(false);
    }
  }

  function togglePlay(): void {
    if (playing) {
      stopClock();
      pauseVideos();
      setPlaying(false);
      return;
    }
    if (cameras.length < 2 || totalSeconds <= 0) return;
    const start = programSeconds >= totalSeconds - 0.05 ? 0 : programSeconds;
    setProgramSeconds(start);
    clockRef.current = { startWall: performance.now(), startProgram: start };
    playVideos(start);
    setPlaying(true);
    const tick = (): void => {
      const current = clockRef.current;
      if (!current) return;
      const next = current.startProgram + (performance.now() - current.startWall) / 1000;
      if (next >= totalSeconds) {
        setProgramSeconds(totalSeconds);
        stopClock();
        pauseVideos();
        setPlaying(false);
        return;
      }
      setProgramSeconds(next);
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
  }

  function seekTo(seconds: number): void {
    const next = Math.max(0, Math.min(totalSeconds, seconds));
    setProgramSeconds(next);
    seekVideos(next);
    if (playing) {
      clockRef.current = { startWall: performance.now(), startProgram: next };
    }
  }

  function switchTo(index: number): void {
    if (!cameras[index]) return;
    setCuts((current) => recordCut(current, programFrame, index, totalFrames, cameras.length));
    setActiveCamera(index);
    cameras.forEach((camera, cameraIndex) => {
      const video = videoRefs.current[cameraIndex];
      if (video) video.muted = cameraIndex !== index;
    });
    const video = videoRefs.current[index];
    if (video) {
      try {
        video.currentTime = programSeconds + cameras[index]!.offsetFrames / fps;
        if (playing) void video.play().catch(() => undefined);
      } catch {
        // metadata no disponible
      }
    }
  }

  function toggleCamera(id: string, checked: boolean): void {
    setSelectedIds((current) => {
      if (checked) return [...current, id];
      return current.filter((value) => value !== id);
    });
  }

  function setOffset(asset: Asset, value: number): void {
    const max = assetDurationFrames(asset) / fps;
    const seconds = Math.max(0, Math.min(max, value));
    setOffsets((current) => ({ ...current, [asset.id]: seconds }));
  }

  function apply(): void {
    if (!project) return;
    let built: MulticamBuild | null = null;
    const ok = store.mutate(
      (current) => {
        built = buildMulticamProject(current, cameras, cuts);
        return { project: built.project };
      },
      {
        notice: `Multicámara: ${cuts.length} corte(s) de ${cameras.length} cámaras en una pista nueva.`,
      },
    );
    if (!ok || !built) {
      setError('No se pudo crear la pista multicámara; el proyecto quedó igual.');
      return;
    }
    setError(null);
    store.setSelection({ kind: 'none' });
    store.setPlayhead(0);
    onNavigate('editor');
  }

  return (
    <section className="view multicam-view">
      <ViewToolbar
        label="Multicámara"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
            <Icon name="learn" size={14} />
            <span>Ayuda</span>
          </button>
        }
      />

      <header className="multicam-head">
        <div>
          <h2>Multicámara en vivo</h2>
          <p>
            Elegí dos o más cámaras, sincronizá su punto de entrada y cambiá de ángulo mientras
            reproducís. Olyvia graba cada cambio y arma una pista nueva lista para el editor.
          </p>
        </div>
        <span className="fine-print">Sync manual + automática por audio · timecode pendiente</span>
      </header>

      {!project ? (
        <div className="card multicam-empty">
          <h3>Abrí un proyecto</h3>
          <p>La multicámara necesita un proyecto con al menos dos videos listos.</p>
          <button type="button" className="primary icon-text" onClick={() => onNavigate('projects')}>
            <Icon name="projects" size={15} />
            <span>Ir a Proyectos</span>
          </button>
        </div>
      ) : videos.length < 2 ? (
        <div className="card multicam-empty">
          <h3>Faltan cámaras</h3>
          <p>Importá al menos dos videos en Medios y confirmá sus derechos.</p>
          <button type="button" className="primary icon-text" onClick={() => onNavigate('assets')}>
            <Icon name="assets" size={15} />
            <span>Ir a Medios</span>
          </button>
        </div>
      ) : (
        <div className="multicam-layout">
          <div className="multicam-main">
            <div className="card multicam-cameras">
              <div className="multicam-cams-head">
                <p className="eyebrow">Cámaras y sincronización</p>
                <button
                  type="button"
                  className="small ghost icon-text"
                  onClick={() => void syncByAudio()}
                  disabled={audioSyncBusy || cameras.length < 2}
                  title="Compara la envolvente de audio de las cámaras (hasta ±10 s)"
                >
                  <Icon name="audio" size={13} />
                  <span>{audioSyncBusy ? 'Analizando audio…' : 'Sincronizar por audio'}</span>
                </button>
              </div>
              <ul>
                {videos.map((asset) => {
                  const selected = selectedIds.includes(asset.id);
                  const duration = assetDurationFrames(asset) / fps;
                  const media = 'media' in asset ? asset.media : null;
                  const dimensions =
                    media && 'width' in media ? `${media.width}×${media.height}` : 'sin medición';
                  return (
                    <li key={asset.id} className={selected ? 'selected' : ''}>
                      <label className="multicam-check">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) => toggleCamera(asset.id, event.target.checked)}
                        />
                        <span>
                          <strong>{asset.label}</strong>
                          <small>
                            {clock(duration)} · {dimensions}
                          </small>
                        </span>
                      </label>
                      {selected ? (
                        <label className="field multicam-offset">
                          <span>Entrada (s)</span>
                          <input
                            type="number"
                            min={0}
                            max={Math.max(0, duration)}
                            step={0.1}
                            value={offsets[asset.id] ?? 0}
                            onChange={(event) => setOffset(asset, Number(event.target.value) || 0)}
                          />
                        </label>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="fine-print multicam-sync-hint">
                «Sincronizar por audio» compara hasta 120 s de las envolventes de sonido (máx.
                ±10 s) y calcula el punto de entrada de cada cámara. El ajuste manual sigue
                disponible.
              </p>
            </div>

            <div className="card multicam-monitor">
              <div className="multicam-stage" aria-label="Monitor multicámara">
                {cameras.map((camera, index) => (
                  <video
                    key={camera.asset.id}
                    ref={(element) => {
                      videoRefs.current[index] = element;
                    }}
                    className={index === activeCamera ? 'active' : ''}
                    src={store.service.mediaUrl(root, previewPath(camera.asset))}
                    preload="auto"
                    playsInline
                    muted={index !== activeCamera}
                  />
                ))}
                <span className="multicam-badge">
                  CAM {activeCamera + 1} · {cameras[activeCamera]?.asset.label ?? 'sin cámara'}
                </span>
                {cameras.length === 0 ? (
                  <span className="multicam-stage-empty">Elegí al menos dos cámaras.</span>
                ) : null}
              </div>
              <div className="multicam-controls">
                <button
                  type="button"
                  className="primary icon-text"
                  onClick={togglePlay}
                  disabled={cameras.length < 2 || totalSeconds <= 0}
                  aria-label={playing ? 'Pausar multicámara' : 'Reproducir multicámara'}
                >
                  <Icon name={playing ? 'pause' : 'play'} size={14} />
                  <span>{playing ? 'Pausar' : 'Reproducir'}</span>
                </button>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() => seekTo(0)}
                  disabled={cameras.length < 2}
                >
                  <Icon name="skipBack" size={14} />
                  <span>Inicio</span>
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.01, totalSeconds)}
                  step={Math.max(0.01, 1 / fps)}
                  value={Math.min(programSeconds, totalSeconds)}
                  aria-label="Posición del programa multicámara"
                  onChange={(event) => seekTo(Number(event.target.value))}
                  disabled={cameras.length < 2 || totalSeconds <= 0}
                />
                <span className="multicam-time">
                  {clock(programSeconds)} / {clock(totalSeconds)}
                </span>
              </div>
              <div className="multicam-angles" role="group" aria-label="Cambiar de cámara en vivo">
                {cameras.map((camera, index) => (
                  <button
                    key={camera.asset.id}
                    type="button"
                    className={index === activeCamera ? 'primary' : 'ghost'}
                    aria-pressed={index === activeCamera}
                    onClick={() => switchTo(index)}
                  >
                    CAM {index + 1}
                    <small>{camera.asset.label}</small>
                  </button>
                ))}
              </div>
              {cameras.length >= 2 ? (
                <p className="fine-print">
                  Cambiá de ángulo con los botones mientras reproducís. Cada cambio queda como un
                  corte en el frame {programFrame} ({clock(programSeconds)}). La cámara activa es la
                  que suena.
                </p>
              ) : null}
            </div>
          </div>

          <aside className="card multicam-cuts">
            <header>
              <div>
                <p className="eyebrow">Cortes grabados</p>
                <h3>{cuts.length} cambio(s)</h3>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={resetMonitor}
                disabled={cuts.length <= 1 && programSeconds === 0}
              >
                Reiniciar
              </button>
            </header>
            <ol>
              {cuts.map((cut, index) => {
                const camera = cameras[cut.cameraIndex];
                return (
                  <li key={`${cut.frame}-${index}`}>
                    <span className="multicam-cut-time">{clock(cut.frame / fps)}</span>
                    <span>
                      CAM {cut.cameraIndex + 1} · {camera?.asset.label ?? 'sin cámara'}
                    </span>
                    {index === 0 ? (
                      <em>inicio</em>
                    ) : (
                      <button
                        type="button"
                        className="small ghost"
                        aria-label={`Quitar corte en ${clock(cut.frame / fps)}`}
                        onClick={() =>
                          setCuts((current) =>
                            normalizeCuts(
                              current.filter((_, cutIndex) => cutIndex !== index),
                              totalFrames,
                              cameras.length,
                            ),
                          )
                        }
                      >
                        Quitar
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className="fine-print">
              Activo ahora: CAM {detectionIndex + 1}. El corte se monta desde el inicio del
              programa; la duración se limita a la cámara más corta después de su entrada.
            </p>
            {error ? (
              <p className="notice notice-warning" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className="primary icon-text multicam-apply"
              onClick={apply}
              disabled={cameras.length < 2 || totalFrames <= 0}
            >
              <Icon name="editor" size={15} />
              <span>Crear pista multicámara</span>
            </button>
          </aside>
        </div>
      )}
    </section>
  );
}
