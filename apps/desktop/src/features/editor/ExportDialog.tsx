import { useEffect, useRef, useState } from 'react';
import type { RenderFinishedEvent, RenderProgressEvent } from '../../services/project-service';
import { basename } from '../../lib/format';
import {
  COMPRESSION_PRESETS,
  applyCompression,
  applyProfileFit,
  compressionPresetOf,
  ensureDelivery,
  fpsOf,
  updateAudioMix,
} from '../../state/project-actions';
import {
  clearSettled,
  enqueueProfiles,
  loadRenderQueue,
  markDone,
  markFailed,
  markRunning,
  nextPending,
  queueFileName,
  removeEntry,
  retryEntry,
  saveRenderQueue,
  summarizeQueue,
  type RenderQueue,
} from '../../state/render-queue';
import { useProjectStore } from '../../state/project-store';
import { recordDirectorOutcome } from '../../state/editor-memory';
import { evaluateProjectQuality } from '../../state/quality';

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

function safeFilePart(value: string): string {
  const cleaned = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || 'export';
}

function joinOutputPath(folder: string, file: string): string {
  const separator = folder.includes('\\') ? '\\' : '/';
  return `${folder.replace(/[\\/]+$/, '')}${separator}${file}`;
}

interface BatchResult {
  readonly name: string;
  readonly status: string;
  readonly path: string | null;
  readonly message: string | null;
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
  const [batchProfiles, setBatchProfiles] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  // La cola sobrevive al cierre del diálogo: se hidrata en el primer render
  // (no en un efecto) y se persiste en cada cambio. Hidratar en un efecto
  // dejaría un render con la cola vacía que pisaría lo guardado.
  const [queue, setQueue] = useState<RenderQueue>(() => {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    return loadRenderQueue(window.localStorage);
  });
  const [queueBusy, setQueueBusy] = useState(false);
  const jobRef = useRef<string | null>(null);
  const batchResolverRef = useRef<((event: RenderFinishedEvent) => void) | null>(null);
  const folderRef = useRef<string | null>(null);
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
    const preferred =
      profiles.find((profile) => profile.name.startsWith('Formato del proyecto')) ?? profiles[0];
    setProfileId(preferred?.id ?? '');
    setBatchProfiles(new Set(profiles.map((profile) => profile.id)));
    setBatchResults([]);
    setBatchBusy(false);
    folderRef.current = null;
    // Only reset when the dialog opens, not on every project render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // La cola se persiste en cada cambio para que un cierre abrupto no pierda
  // los pendientes; la hidratación ya ocurrió en el estado inicial.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    saveRenderQueue(window.localStorage, queue);
  }, [queue]);

  // Runner de la cola: toma el primer pendiente y lo drena de a uno. El guardia
  // de `queueBusy` evita arrancar dos renders si el efecto se reejecuta por un
  // cambio de estado mientras el render sigue en curso.
  useEffect(() => {
    if (!open || !store.service.available || queueBusy) return;
    const entry = nextPending(queue);
    if (!entry) return;
    const currentProject = store.state.project;
    if (!currentProject) return;
    setQueueBusy(true);
    void (async () => {
      try {
        const saved = await store.saveNow();
        if (!saved) {
          setQueue((current) => markFailed(current, entry.id, 'no se pudo guardar el proyecto'));
          return;
        }
        let folder = folderRef.current;
        if (!folder) {
          folder = await store.service.chooseExportDirectory();
          if (!folder) {
            // Sin carpeta no se puede continuar: se saca la entrada para no
            // dejar la cola colgada pidiendo un diálogo en cada reapertura.
            setQueue((current) => removeEntry(current, entry.id));
            return;
          }
          folderRef.current = folder;
        }
        setQueue((current) => markRunning(current, entry.id));
        const outputPath = joinOutputPath(folder, queueFileName(currentProject.name, entry.profileName));
        const started = await store.service.startRenderTo(
          entry.profileId,
          outputPath,
          entry.includeCaptions,
        );
        if (!started) {
          setQueue((current) => markFailed(current, entry.id, 'el render no se inició'));
          return;
        }
        jobRef.current = started.jobId;
        setJobId(started.jobId);
        setProgress({
          jobId: started.jobId,
          percent: 0,
          processedSeconds: 0,
          totalSeconds: store.durationFrames / fpsOf(currentProject),
          phase: `cola · ${entry.profileName}`,
        });
        const event = await waitForJob(started.jobId);
        setQueue((current) =>
          event.status === 'completed'
            ? markDone(current, entry.id, event.outputPath ?? outputPath)
            : markFailed(current, entry.id, event.message ?? event.status),
        );
        jobRef.current = null;
        setJobId(null);
        setProgress(null);
      } catch (cause) {
        setQueue((current) =>
          markFailed(current, entry.id, cause instanceof Error ? cause.message : 'el render falló'),
        );
        jobRef.current = null;
        setJobId(null);
        setProgress(null);
      } finally {
        setQueueBusy(false);
      }
    })();
    // `waitForJob` y `fpsOf` son estables durante la vida del componente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queue, queueBusy, store]);

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
      const resolver = batchResolverRef.current;
      if (resolver) {
        batchResolverRef.current = null;
        resolver(event);
      }
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
  const currentProject = project;
  const quality = evaluateProjectQuality(currentProject);
  const hasQualityError = quality.some((finding) => finding.severity === 'error');
  const missingLoudness = quality.some((finding) => /loudness/i.test(finding.message));

  const profiles = project.renderProfiles;
  const selected = profiles.find((profile) => profile.id === profileId) ?? profiles[0];
  const running = Boolean(jobId) || starting || batchBusy || queueBusy;
  const fps = fpsOf(project);
  const selectedBatchProfiles = profiles.filter((profile) => batchProfiles.has(profile.id));
  const compression = selected ? compressionPresetOf(selected) : 'custom';

  async function learnBeforeExport(): Promise<void> {
    const opened = store.state.opened;
    const current = store.state.project;
    if (!opened || !current) return;
    await recordDirectorOutcome(store.service, opened.path, current, true).catch(() => null);
  }

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
      await learnBeforeExport();
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

  function waitForJob(jobId: string): Promise<RenderFinishedEvent> {
    return new Promise((resolve) => {
      batchResolverRef.current = (event) => {
        if (event.jobId === jobId) resolve(event);
      };
    });
  }

  async function startBatch(): Promise<void> {
    if (selectedBatchProfiles.length === 0) {
      setError('Elegí al menos un perfil para el lote.');
      return;
    }
    setError(null);
    setFinished(null);
    setProgress(null);
    setBatchResults([]);
    setStarting(true);
    setBatchBusy(true);
    try {
      const saved = await store.saveNow();
      if (!saved) {
        setError('No se pudo guardar el proyecto; el lote no se inició.');
        return;
      }
      await learnBeforeExport();
      const folder = await store.service.chooseExportDirectory();
      if (!folder) return;
      const results: BatchResult[] = [];
      for (const profile of selectedBatchProfiles) {
        const fileName = `${safeFilePart(currentProject.name)}-${safeFilePart(profile.name)}.mp4`;
        const outputPath = joinOutputPath(folder, fileName);
        const started = await store.service.startRenderTo(
          profile.id,
          outputPath,
          includeCaptions,
        );
        if (!started) {
          results.push({
            name: profile.name,
            status: 'failed',
            path: outputPath,
            message: 'no se inició',
          });
          setBatchResults([...results]);
          break;
        }
        jobRef.current = started.jobId;
        setJobId(started.jobId);
        setProgress({
          jobId: started.jobId,
          percent: 0,
          processedSeconds: 0,
          totalSeconds: store.durationFrames / fps,
          phase: `preparando ${profile.name}`,
        });
        const event = await waitForJob(started.jobId);
        results.push({
          name: profile.name,
          status: event.status,
          path: event.outputPath ?? outputPath,
          message: event.message,
        });
        setBatchResults([...results]);
        if (event.status !== 'completed') {
          setError(`El lote se detuvo en ${profile.name}: ${event.message ?? event.status}`);
          break;
        }
      }
      jobRef.current = null;
      setJobId(null);
      if (results.length > 0 && results.every((result) => result.status === 'completed')) {
        store.setNotice(`Lote completado: ${results.length} archivo(s) exportados.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'el lote no se pudo iniciar');
    } finally {
      setStarting(false);
      setBatchBusy(false);
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
                      {profile.aspectRatio} · {profile.videoCodec.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              {selected ? (
                <div className="export-compression">
                  <div className="export-compression-head">
                    <p className="eyebrow">Tamaño y velocidad</p>
                    <span>Se aplica a los {profiles.length} perfiles</span>
                  </div>
                  <div className="compression-presets" role="group" aria-label="Preset de compresión">
                    {COMPRESSION_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={compression === preset.id ? 'active' : ''}
                        aria-pressed={compression === preset.id}
                        disabled={running}
                        onClick={() =>
                          store.update((current) =>
                            applyCompression(
                              current,
                              preset.id,
                              selected.videoCodec === 'h265' ? 'h265' : 'h264',
                            ),
                          )
                        }
                      >
                        <strong>{preset.label}</strong>
                        <span>{preset.note}</span>
                        <em>CRF {preset.crf} · AAC {Math.round(preset.audioBitsPerSecond / 1000)}k</em>
                      </button>
                    ))}
                  </div>
                  <div className="export-compression-row">
                    <label className="field">
                      <span>Códec de video</span>
                      <select
                        value={selected.videoCodec === 'h265' ? 'h265' : 'h264'}
                        disabled={running}
                        onChange={(event) =>
                          store.update((current) =>
                            applyCompression(
                              current,
                              compression === 'custom' ? 'equilibrado' : compression,
                              event.target.value === 'h265' ? 'h265' : 'h264',
                            ),
                          )
                        }
                      >
                        <option value="h264">H.264 · máxima compatibilidad</option>
                        <option value="h265">H.265/HEVC · archivos más chicos</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Encuadre</span>
                      <select
                        value={selected.fit}
                        disabled={running}
                        onChange={(event) =>
                          store.update((current) =>
                            applyProfileFit(
                              current,
                              event.target.value === 'cover' ? 'cover' : 'contain',
                            ),
                          )
                        }
                      >
                        <option value="contain">Contener · mostrar todo</option>
                        <option value="cover">Recortar para llenar · sin barras</option>
                      </select>
                    </label>
                    <div className="compression-readout">
                      <span>Encoder</span>
                      <code>{selected.videoPreset}</code>
                      <span>Audio</span>
                      <code>{Math.round(selected.audioBitsPerSecond / 1000)} kbps</code>
                    </div>
                  </div>
                  <p className="fine-print">
                    {selected.videoCodec === 'h265'
                      ? 'H.265 reduce el tamaño, pero algunos reproductores y plataformas lo recomprimen o no lo aceptan. Para publicar sin sorpresas, H.264 es la opción segura. '
                      : 'Los tamaños reales dependen del contenido. “Compacto” usa CRF 27 y audio de 96 kbps; “Rápido” usa ultrafast para terminar antes. '}
                    “Recortar para llenar” hace un recorte centrado en el render; no es smart reframe por IA.
                  </p>
                </div>
              ) : null}
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
                        : `${Math.round(selected.bitrate.videoBitsPerSecond / 1_000_000)} Mbps`}{' '}
                      · {selected.videoPreset}
                    </dd>
                  </div>
                  <div>
                    <dt>Audio</dt>
                    <dd>
                      {selected.audioCodec.toUpperCase()} ·{' '}
                      {Math.round(selected.audioBitsPerSecond / 1000)} kbps
                    </dd>
                  </div>
                  <div>
                    <dt>Encuadre</dt>
                    <dd>{selected.fit === 'cover' ? 'Recortar para llenar' : 'Contener'}</dd>
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
              {quality.length > 0 ? (
                <div className="export-quality">
                  <p className="eyebrow">Calidad de entrega</p>
                  <ul>
                    {quality.map((finding, index) => (
                      <li key={`${finding.severity}-${index}`} className={`quality-${finding.severity}`}>
                        {finding.message}
                      </li>
                    ))}
                  </ul>
                  {missingLoudness ? (
                    <button
                      type="button"
                      className="small accent-outline"
                      onClick={() =>
                        store.update((current) =>
                          updateAudioMix(current, {
                            loudnessTarget:
                              current.video.height > current.video.width
                                ? { platform: 'shorts', integratedLufs: -14, truePeakDb: -1, toleranceDb: 1 }
                                : { platform: 'youtube', integratedLufs: -14, truePeakDb: -1, toleranceDb: 1 },
                          }),
                        )
                      }
                    >
                      Corregir loudness (-14 LUFS)
                    </button>
                  ) : null}
                </div>
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

              <div className="batch-export">
                <p className="eyebrow">Lote de variantes</p>
                <p className="fine-print">
                  Elegí una carpeta una sola vez y renderizá todos los perfiles seleccionados en
                  secuencia. Si un archivo ya existe o un render falla, el lote se detiene.
                </p>
                <div className="batch-profile-list">
                  {profiles.map((profile) => (
                    <label className="check" key={profile.id}>
                      <input
                        type="checkbox"
                        checked={batchProfiles.has(profile.id)}
                        onChange={(event) => {
                          const next = new Set(batchProfiles);
                          if (event.target.checked) next.add(profile.id);
                          else next.delete(profile.id);
                          setBatchProfiles(next);
                        }}
                        disabled={running}
                      />
                      <span>
                        {profile.name} · {profile.aspectRatio}
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="accent-outline"
                  onClick={() => void startBatch()}
                  disabled={running || selectedBatchProfiles.length === 0 || hasQualityError}
                  title={hasQualityError ? 'Corregí los errores de calidad antes de exportar' : undefined}
                >
                  {batchBusy
                    ? 'Exportando lote…'
                    : `Elegir carpeta y exportar lote (${selectedBatchProfiles.length})`}
                </button>
                {batchResults.length > 0 ? (
                  <ul className="batch-results">
                    {batchResults.map((result) => (
                      <li key={`${result.name}-${result.path ?? ''}`} className={result.status}>
                        <strong>{result.name}</strong>
                        <span>
                          {result.status === 'completed'
                            ? `OK · ${basename(result.path ?? '')}`
                            : `Falló · ${result.message ?? result.status}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="batch-export">
                <p className="eyebrow">Cola de entregas</p>
                <p className="fine-print">
                  Encolá perfiles y se renderizan en orden con el diálogo abierto. La cola queda
                  guardada en este equipo: si cerrás la app, lo pendiente se reanuda al volver.
                </p>
                <div className="actions compact">
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      setQueue((current) =>
                        enqueueProfiles(current, selected ? [selected] : [], includeCaptions),
                      )
                    }
                    disabled={running || !selected}
                  >
                    Encolar perfil seleccionado
                  </button>
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      setQueue((current) =>
                        enqueueProfiles(current, selectedBatchProfiles, includeCaptions),
                      )
                    }
                    disabled={running || selectedBatchProfiles.length === 0}
                  >
                    Encolar variantes del lote ({selectedBatchProfiles.length})
                  </button>
                  <button
                    type="button"
                    className="small ghost"
                    onClick={() => setQueue(clearSettled)}
                    disabled={
                      running ||
                      !queue.some((entry) => entry.status === 'done' || entry.status === 'error')
                    }
                  >
                    Limpiar terminadas
                  </button>
                </div>
                {queue.length > 0 ? (
                  <ul className="batch-results">
                    {queue.map((entry) => (
                      <li key={entry.id} className={entry.status}>
                        <strong>{entry.profileName}</strong>
                        <span>
                          {entry.status === 'pending'
                            ? 'En cola'
                            : entry.status === 'running'
                              ? 'Renderizando…'
                              : entry.status === 'done'
                                ? `OK · ${basename(entry.outputPath ?? '')}`
                                : `Falló · ${entry.message ?? 'error'}`}
                        </span>
                        {entry.status === 'error' || entry.status === 'done' ? (
                          <button
                            type="button"
                            className="small"
                            onClick={() => setQueue((current) => retryEntry(current, entry.id))}
                            disabled={running}
                          >
                            Reintentar
                          </button>
                        ) : null}
                        {entry.status !== 'running' ? (
                          <button
                            type="button"
                            className="small"
                            onClick={() => setQueue((current) => removeEntry(current, entry.id))}
                            disabled={running}
                          >
                            Quitar
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {(() => {
                  const summary = summarizeQueue(queue);
                  if (summary.pending + summary.running === 0) return null;
                  return (
                    <p className="fine-print">
                      {summary.pending} en cola · {summary.running} en curso · {summary.done} listos ·{' '}
                      {summary.error} con error
                    </p>
                  );
                })()}
              </div>

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
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void start()}
                    disabled={hasQualityError}
                    title={hasQualityError ? 'Corregí los errores de calidad antes de exportar' : undefined}
                  >
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
