import { useEffect, useMemo, useState } from 'react';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type {
  ExportShortResult,
  FaceTrackResult,
  MediaAnalysis,
  ModelInfo,
  TranscriptionResult,
} from '../../services/project-service';
import {
  buildDirectorPlan,
  applyDirectorPlan,
  type DirectorOptions,
  type DirectorPlan,
} from '../../state/director';
import {
  DIRECTOR_PLATFORMS,
  createPendingRun,
  directorProfile,
  emptyDirectorMemory,
  loadDirectorMemory,
  platformForProject,
  recordDirectorOutcome,
  saveDirectorMemory,
  type DirectorMemoryFile,
  type DirectorPlatform,
} from '../../state/editor-memory';
import { useProjectStore } from '../../state/project-store';
import { buildShortCandidates, shortPlanText } from './shorts';
import {
  runShortBatch,
  type ShortBatchOutcome,
  type ShortBatchProgress,
} from './short-batch';

const DEFAULT_OPTIONS: DirectorOptions = {
  removeSilences: true,
  removeRetakes: true,
  removeFillers: true,
  removeBadFrames: true,
  splitScenes: true,
  enhanceAudio: true,
  normalizeLoudness: true,
  autoCaptions: true,
  autoColor: true,
};

function platformLabel(platform: DirectorPlatform): string {
  return {
    youtube: 'YouTube horizontal',
    shorts: 'Shorts / vertical',
    tiktok: 'TikTok',
    reels: 'Reels',
    podcast: 'Podcast',
    broadcast: 'Broadcast -23 LUFS',
  }[platform];
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0 s';
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return `${minutes}:${String(rest).padStart(2, '0')}`;
  }
  return `${seconds.toFixed(1)} s`;
}

function needsTranscript(options: DirectorOptions): boolean {
  return options.removeRetakes || options.removeFillers || options.autoCaptions;
}

function formatShortBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DirectorView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const openedPath = store.state.opened?.path ?? '';
  const videos = useMemo(
    () => (project?.assets ?? []).filter((asset): asset is Extract<Asset, { kind: 'video' }> => asset.kind === 'video' && asset.status === 'ready'),
    [project],
  );
  const [assetId, setAssetId] = useState('');
  const [platform, setPlatform] = useState<DirectorPlatform>('youtube');
  const [options, setOptions] = useState<DirectorOptions>(DEFAULT_OPTIONS);
  const [memory, setMemory] = useState<DirectorMemoryFile>(emptyDirectorMemory);
  const [analysis, setAnalysis] = useState<MediaAnalysis | null>(null);
  const [transcript, setTranscript] = useState<TranscriptionResult | null>(null);
  const [plan, setPlan] = useState<DirectorPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [auxWarning, setAuxWarning] = useState<string | null>(null);
  const [shortBusyId, setShortBusyId] = useState<string | null>(null);
  const [shortProgress, setShortProgress] = useState(0);
  const [shortResult, setShortResult] = useState<ExportShortResult | null>(null);
  const [shortError, setShortError] = useState<string | null>(null);
  const [shortBatch, setShortBatch] = useState<ShortBatchProgress | null>(null);
  const [shortBatchBusy, setShortBatchBusy] = useState(false);
  const [shortBatchOutcomes, setShortBatchOutcomes] = useState<ShortBatchOutcome[]>([]);
  const [smartReframe, setSmartReframe] = useState(false);
  const [faceModel, setFaceModel] = useState<ModelInfo | null>(null);
  const [faceModelBusy, setFaceModelBusy] = useState(false);
  const [faceTrack, setFaceTrack] = useState<FaceTrackResult | null>(null);
  const [faceTrackBusy, setFaceTrackBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [autoExport, setAutoExport] = useState(true);
  const [silenceDb, setSilenceDb] = useState(-32);
  const [minSilence, setMinSilence] = useState(0.35);

  useEffect(() => {
    setFaceTrack(null);
  }, [assetId]);

  useEffect(() => {
    if (!project) return;
    setPlatform(platformForProject(project));
    setAssetId(videos[0]?.id ?? '');
    setAnalysis(null);
    setTranscript(null);
    setPlan(null);
    setApplied(false);
    // Only reset when the opened project changes, not after every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    if (!project || !openedPath) return;
    let active = true;
    void (async () => {
      const loaded = await loadDirectorMemory(store.service);
      if (!active) return;
      if (loaded.pendingRun?.projectPath === openedPath) {
        try {
          const learned = await recordDirectorOutcome(
            store.service,
            openedPath,
            project,
            false,
          );
          if (active && learned) setMemory(learned);
          else setMemory(loaded);
        } catch {
          setMemory(loaded);
        }
      } else {
        setMemory(loaded);
      }
    })();
    return () => {
      active = false;
    };
    // Learn once when the view opens, not on every timeline mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedPath, project?.id, store.service]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    void store.service
      .onShortProgress((event) => {
        if (active) setShortProgress(event.percent);
      })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [store.service]);

  useEffect(() => {
    let active = true;
    void store.service
      .listModels()
      .then((models) => {
        if (!active) return;
        const found = models.find((model) => model.id === 'seeta-face') ?? null;
        setFaceModel(found);
        if (found?.downloaded) setSmartReframe(true);
      })
      .catch(() => {
        if (active) setFaceModel(null);
      });
    return () => {
      active = false;
    };
  }, [store.service]);

  const selectedAsset = videos.find((asset) => asset.id === assetId) ?? videos[0];
  const shortCandidates = useMemo(
    () => (analysis ? buildShortCandidates(analysis, transcript) : []),
    [analysis, transcript],
  );
  const profile = directorProfile(memory, platform);
  const pendingDirty = Boolean(
    memory.pendingRun &&
      memory.pendingRun.projectPath === openedPath &&
      memory.pendingRun.lastLearnedRevision !== (project?.revision ?? 0),
  );

  function updateOption(key: keyof DirectorOptions, value: boolean): void {
    setOptions((current) => ({ ...current, [key]: value }));
    setPlan(null);
    setApplied(false);
  }

  async function analyze(): Promise<void> {
    if (!project || !selectedAsset) return;
    setBusy(true);
    setError(null);
    setAuxWarning(null);
    setApplied(false);
    setPlan(null);
    setShortResult(null);
    setShortError(null);
    try {
      setStage('Midiendo silencios, escenas, negros y loudness…');
      const measured = await store.service.analyzeMedia(
        selectedAsset.id,
        0.35,
        silenceDb,
        minSilence,
      );
      setAnalysis(measured);
      let foundTranscript: TranscriptionResult | null = null;
      if (needsTranscript(options)) {
        setStage('Transcribiendo la voz con Whisper local…');
        try {
          foundTranscript = await store.service.transcribeAsset(
            selectedAsset.id,
            project.language === 'es' ? 'es' : undefined,
          );
          setTranscript(foundTranscript);
        } catch (cause) {
          setTranscript(null);
          setAuxWarning(
            cause instanceof Error
              ? `No se pudo transcribir: ${cause.message}. El plan sigue sin subtítulos ni detección de tomas repetidas.`
              : 'No se pudo transcribir el audio; el plan sigue sin subtítulos.',
          );
        }
      } else {
        setTranscript(null);
      }
      setStage('Planificando cortes y mejoras…');
      const nextPlan = buildDirectorPlan(
        project,
        selectedAsset,
        measured,
        foundTranscript,
        profile,
        platform,
        options,
      );
      setPlan(nextPlan);
      setStage('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'el análisis automático falló');
      setStage('');
    } finally {
      setBusy(false);
    }
  }

  async function apply(): Promise<void> {
    if (!project || !selectedAsset || !plan) return;
    setBusy(true);
    setError(null);
    try {
      if (openedPath) {
        await recordDirectorOutcome(store.service, openedPath, project, false).catch(
          () => null,
        );
      }
      const appliedRef: { project: ProjectDocument | null } = { project: null };
      const ok = store.update(
        (current) => {
          const result = applyDirectorPlan(current, selectedAsset, plan);
          appliedRef.project = result.project;
          return result.project;
        },
        {
          notice: `Director aplicó ${plan.cuts.length} toma(s) y ${plan.captions.length} subtítulo(s). Revisalos en el editor.`,
        },
      );
      if (!ok || !appliedRef.project) {
        throw new Error('el proyecto no aceptó el plan del Director');
      }
      store.setPlayhead(0);
      if (openedPath) {
        const current = await loadDirectorMemory(store.service);
        const nextProfile = directorProfile(current, plan.platform);
        const withPending: DirectorMemoryFile = {
          ...current,
          pendingRun: createPendingRun(
            openedPath,
            appliedRef.project,
            plan.platform,
            nextProfile,
            plan.summary,
          ),
        };
        await saveDirectorMemory(store.service, withPending);
        setMemory(withPending);
      }
      setApplied(true);
      setStage('');
      if (autoExport) {
        onNavigate('editor');
        store.requestExport();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudo aplicar el plan');
    } finally {
      setBusy(false);
    }
  }

  async function copyShortsPlan(): Promise<void> {
    if (shortCandidates.length === 0) return;
    try {
      await navigator.clipboard.writeText(shortPlanText(shortCandidates));
      store.setNotice('Plan de Auto Shorts copiado con tiempos, duración y score.');
    } catch {
      store.setNotice(
        'No se pudo copiar el plan automáticamente. Seleccioná los candidatos y copialos a mano.',
      );
    }
  }

  async function downloadFaceModel(): Promise<void> {
    if (faceModelBusy) return;
    setFaceModelBusy(true);
    setShortError(null);
    try {
      const info = await store.service.downloadModel('seeta-face');
      setFaceModel(info);
      setSmartReframe(true);
      store.setNotice('Modelo de rostros descargado y verificado. Smart reframe está disponible.');
    } catch (cause) {
      setShortError(
        cause instanceof Error
          ? cause.message
          : 'no se pudo descargar el modelo de rostros',
      );
    } finally {
      setFaceModelBusy(false);
    }
  }

  async function analyzeFaces(): Promise<void> {
    if (!selectedAsset || faceTrackBusy) return;
    const media = selectedAsset.media;
    if (!media) {
      setShortError('El video no tiene duración medida; volvé a importarlo.');
      return;
    }
    const fps = media.frameRate.num / media.frameRate.den;
    const duration = fps > 0 ? media.durationFrames / fps : 0;
    if (!(duration > 0)) {
      setShortError('El video no tiene una duración válida para analizar rostros.');
      return;
    }
    setFaceTrackBusy(true);
    setShortError(null);
    try {
      const result = await store.service.analyzeFaceTrack({
        path: selectedAsset.source.path,
        startSeconds: 0,
        endSeconds: Math.min(duration, 600),
      });
      setFaceTrack(result);
      store.setNotice(
        result.detections > 0
          ? `Rostro detectado en ${result.detections} muestras del video.`
          : 'No se detectó un rostro frontal; el encuadre caerá al centro.',
      );
    } catch (cause) {
      setShortError(
        cause instanceof Error
          ? cause.message
          : 'no se pudo analizar el track de rostro',
      );
    } finally {
      setFaceTrackBusy(false);
    }
  }

  async function exportShort(candidateId: string): Promise<void> {
    if (!selectedAsset || shortBusyId || shortBatchBusy) return;
    const candidate = shortCandidates.find((item) => item.id === candidateId);
    if (!candidate) return;
    setShortError(null);
    setShortResult(null);
    setShortProgress(0);
    let folder: string | null = null;
    try {
      folder = await store.service.chooseDownloadDirectory();
    } catch (cause) {
      setShortError(
        cause instanceof Error ? cause.message : 'no se pudo elegir la carpeta del short',
      );
      return;
    }
    if (!folder) return;
    setShortBusyId(candidateId);
    try {
      const result = await store.service.exportShort({
        path: selectedAsset.source.path,
        outputDir: folder,
        startSeconds: candidate.startSeconds,
        endSeconds: candidate.endSeconds,
        label: candidate.title,
        smartReframe: smartReframe && Boolean(faceModel?.downloaded),
      });
      setShortResult(result);
      store.setNotice(
        `Short vertical exportado: ${result.width}×${result.height}, ${formatShortBytes(
          result.bytes,
        )}.`,
      );
    } catch (cause) {
      setShortError(
        cause instanceof Error ? cause.message : 'no se pudo exportar el short',
      );
    } finally {
      setShortBusyId(null);
      setShortProgress(0);
    }
  }

  async function exportAllShorts(): Promise<void> {
    if (
      !selectedAsset ||
      shortBusyId ||
      shortBatchBusy ||
      shortCandidates.length === 0
    ) {
      return;
    }
    setShortError(null);
    setShortResult(null);
    setShortBatchOutcomes([]);
    let folder: string | null = null;
    try {
      folder = await store.service.chooseDownloadDirectory();
    } catch (cause) {
      setShortError(
        cause instanceof Error
          ? cause.message
          : 'no se pudo elegir la carpeta de los shorts',
      );
      return;
    }
    if (!folder) return;
    setShortBatchBusy(true);
    setShortBatch(null);
    try {
      const outcomes = await runShortBatch(
        shortCandidates,
        {
          videoPath: selectedAsset.source.path,
          outputDir: folder,
          smartReframe: smartReframe && Boolean(faceModel?.downloaded),
        },
        (request) => store.service.exportShort(request),
        (progress) => setShortBatch(progress),
      );
      setShortBatchOutcomes(outcomes);
      const exported = outcomes.filter((item) => item.ok).length;
      store.setNotice(
        `Auto Shorts: ${exported}/${outcomes.length} exportados en ${folder}.`,
      );
      if (exported < outcomes.length) {
        setShortError(
          `${outcomes.length - exported} short(s) fallaron; revisá el detalle del lote.`,
        );
      }
    } catch (cause) {
      setShortError(
        cause instanceof Error
          ? cause.message
          : 'no se pudo completar el lote de shorts',
      );
    } finally {
      setShortBatchBusy(false);
      setShortBatch(null);
    }
  }

  if (!project) {
    return (
      <section className="view">
        <p className="empty-state">No hay un proyecto abierto. Creá o abrí uno para dirigirlo.</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Ir a Proyectos
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="view director-view">
      <ViewToolbar
        label="Director"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('production')}>
            <Icon name="film" size={14} />
            <span>Guion a video</span>
          </button>
        }
      >
        <span className={`status-pill ${pendingDirty ? 'dirty' : 'saved'}`}>
          <span
            className={`status-pill-dot phase-${pendingDirty ? 'dirty' : 'saved'}`}
            aria-hidden="true"
          />
          {pendingDirty
            ? 'Revisión pendiente'
            : memory.pendingRun
              ? 'Plan activo'
              : 'Director listo'}
        </span>
      </ViewToolbar>

      {videos.length === 0 ? (
        <div className="empty-state director-empty">
          <strong>No hay videos listos para dirigir.</strong>
          <span>Importá un video en Medios y confirmá sus derechos. Para guion + imágenes usá Producción.</span>
          <button type="button" className="primary" onClick={() => onNavigate('assets')}>
            Abrir Medios
          </button>
        </div>
      ) : (
        <div className="director-layout">
          <div className="director-main">
            <div className="card director-source">
              <div className="production-card-head">
                <div>
                  <p className="eyebrow">Fuente</p>
                  <h3>Qué video va a dirigir</h3>
                </div>
                <span className="fine-print">Todo local · sin subir material</span>
              </div>
              <div className="director-source-row">
                <label className="field">
                  <span>Video</span>
                  <select
                    value={selectedAsset?.id ?? ''}
                    onChange={(event) => {
                      setAssetId(event.target.value);
                      setPlan(null);
                      setAnalysis(null);
                      setTranscript(null);
                      setApplied(false);
                    }}
                  >
                    {videos.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Destino / estilo</span>
                  <select
                    value={platform}
                    onChange={(event) => {
                      setPlatform(event.target.value as DirectorPlatform);
                      setPlan(null);
                    }}
                  >
                    {DIRECTOR_PLATFORMS.map((item) => (
                      <option key={item} value={item}>
                        {platformLabel(item)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="director-options">
                {(
                  [
                    ['removeSilences', 'Cortar silencios'],
                    ['removeRetakes', 'Quitar tomas repetidas'],
                    ['removeFillers', 'Limpiar muletillas'],
                    ['removeBadFrames', 'Quitar negros y freezes'],
                    ['splitScenes', 'Cortar en cambios de escena'],
                    ['enhanceAudio', 'Mejorar voz y ruido'],
                    ['normalizeLoudness', 'Normalizar loudness'],
                    ['autoCaptions', 'Subtítulos automáticos'],
                    ['autoColor', 'Corregir exposición/color'],
                  ] as const
                ).map(([key, label]) => (
                  <label className="check director-toggle" key={key}>
                    <input
                      type="checkbox"
                      checked={options[key]}
                      onChange={(event) => updateOption(key, event.target.checked)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="factory-grid director-tuning">
                <label className="field">
                  <span>Umbral de silencio (dB)</span>
                  <input
                    type="number"
                    min={-60}
                    max={-10}
                    step={1}
                    value={silenceDb}
                    onChange={(event) =>
                      setSilenceDb(Math.max(-60, Math.min(-10, Number(event.target.value) || -32)))
                    }
                  />
                </label>
                <label className="field">
                  <span>Silencio mínimo (s)</span>
                  <input
                    type="number"
                    min={0.15}
                    max={3}
                    step={0.05}
                    value={minSilence}
                    onChange={(event) =>
                      setMinSilence(
                        Math.max(0.15, Math.min(3, Number(event.target.value) || 0.35)),
                      )
                    }
                  />
                </label>
              </div>
              <div className="director-actions">
                <button
                  type="button"
                  className="primary icon-text"
                  onClick={() => void analyze()}
                  disabled={busy || !selectedAsset}
                >
                  <Icon name="sparkles" size={15} />
                  <span>{busy ? 'Analizando…' : 'Analizar y planificar'}</span>
                </button>
                {stage ? <span className="fine-print director-stage">{stage}</span> : null}
              </div>
            </div>

            {error ? (
              <div className="banner banner-error" role="alert">
                <span>{error}</span>
                <button type="button" className="link" onClick={() => setError(null)}>
                  Cerrar
                </button>
              </div>
            ) : null}
            {auxWarning ? (
              <div className="notice notice-warning" role="status">
                {auxWarning}
              </div>
            ) : null}

            {analysis ? (
              <div className="director-analysis-grid">
                <div className="card director-metric">
                  <span>Escenas</span>
                  <strong>{analysis.scenes.length}</strong>
                </div>
                <div className="card director-metric">
                  <span>Silencios</span>
                  <strong>{analysis.silences.length}</strong>
                </div>
                <div className="card director-metric">
                  <span>Loudness</span>
                  <strong>
                    {analysis.loudness?.integratedLufs !== null &&
                    analysis.loudness?.integratedLufs !== undefined
                      ? `${analysis.loudness.integratedLufs.toFixed(1)} LUFS`
                      : 'sin audio'}
                  </strong>
                </div>
                <div className="card director-metric">
                  <span>Negros / freezes</span>
                  <strong>{analysis.blacks.length + analysis.freezes.length}</strong>
                </div>
                <div className="card director-metric">
                  <span>Transcripción</span>
                  <strong>{transcript ? `${transcript.segments.length} segmentos` : 'sin texto'}</strong>
                </div>
              </div>
            ) : null}

            {analysis && shortCandidates.length > 0 ? (
              <div className="card director-shorts">
                <div className="production-card-head">
                  <div>
                    <p className="eyebrow">Auto Shorts</p>
                    <h3>{shortCandidates.length} cortes con gancho</h3>
                  </div>
                  <span className="fine-print">
                    Heurística local sobre voz, escenas y silencios
                  </span>
                </div>
                <div className="director-smart-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={smartReframe}
                      onChange={(event) => setSmartReframe(event.target.checked)}
                      disabled={
                        !faceModel?.downloaded ||
                        Boolean(shortBusyId) ||
                        shortBatchBusy
                      }
                    />
                    <span>Smart reframe: sigue el rostro más grande</span>
                  </label>
                  {faceModel?.downloaded ? (
                    <span className="fine-print">SeetaFace local · BSD-2-Clause</span>
                  ) : (
                    <button
                      type="button"
                      className="ghost icon-text"
                      onClick={() => void downloadFaceModel()}
                      disabled={
                        faceModelBusy || Boolean(shortBusyId) || shortBatchBusy
                      }
                    >
                      <Icon name="download" size={14} />
                      <span>
                        {faceModelBusy ? 'Descargando…' : 'Descargar modelo (1,2 MB)'}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost icon-text"
                    onClick={() => void analyzeFaces()}
                    disabled={
                      !faceModel?.downloaded ||
                      faceTrackBusy ||
                      Boolean(shortBusyId) ||
                      shortBatchBusy
                    }
                  >
                    <Icon name="eye" size={14} />
                    <span>
                      {faceTrackBusy ? 'Analizando rostros…' : 'Ver track de rostro'}
                    </span>
                  </button>
                </div>
                <p className="fine-print">
                  Detección frontal local: si el rostro está de perfil o no aparece, el
                  encuadre cae al centro. No identifica personas.
                </p>
                {faceTrack ? (
                  <div className="director-face-track" role="status">
                    <div className="production-card-head">
                      <div>
                        <p className="eyebrow">Track de rostro</p>
                        <h3>
                          {faceTrack.detections} muestras ·{' '}
                          {faceTrack.scaledWidth}×{faceTrack.scaledHeight}
                        </h3>
                      </div>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setFaceTrack(null)}
                      >
                        Cerrar
                      </button>
                    </div>
                    {faceTrack.detections > 0 ? (
                      <>
                        <div className="director-face-lane" aria-hidden="true">
                          {faceTrack.track.map((point, index) => {
                            const total = Math.max(0.001, faceTrack.durationSeconds);
                            const left = Math.max(
                              0,
                              Math.min(100, (point.time / total) * 100),
                            );
                            const top = Math.max(0, Math.min(100, point.y * 100));
                            return (
                              <span
                                key={`${point.time}-${index}`}
                                className="director-face-dot"
                                style={{ left: `${left}%`, top: `${top}%` }}
                              />
                            );
                          })}
                        </div>
                        <div className="director-face-axis">
                          <span>0 s</span>
                          <span>{formatSeconds(faceTrack.durationSeconds)}</span>
                        </div>
                        <p className="fine-print">
                          Cada punto es el centro del rostro más grande; la altura
                          representa su posición vertical y el ancho, el tiempo. El
                          encuadre final interpola estos puntos.
                        </p>
                      </>
                    ) : (
                      <p className="fine-print">
                        No se detectó un rostro frontal. Smart reframe usará el centro
                        del video.
                      </p>
                    )}
                  </div>
                ) : null}
                <ol className="director-shorts-list">
                  {shortCandidates.map((short, index) => (
                    <li key={short.id}>
                      <span className="director-short-index">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div>
                        <strong>{short.title}</strong>
                        <p className="fine-print">
                          {formatSeconds(short.startSeconds)} →{' '}
                          {formatSeconds(short.endSeconds)} ·{' '}
                          {short.durationSeconds.toFixed(1)} s
                        </p>
                        {short.excerpt ? (
                          <p className="director-short-excerpt">{short.excerpt}</p>
                        ) : null}
                        <div className="director-short-reasons">
                          {short.reasons.map((reason) => (
                            <span key={reason}>{reason}</span>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="ghost icon-text director-short-export"
                          onClick={() => void exportShort(short.id)}
                          disabled={Boolean(shortBusyId) || shortBatchBusy}
                        >
                          <Icon name="export" size={14} />
                          <span>
                            {shortBusyId === short.id
                              ? `Exportando ${Math.round(shortProgress)} %`
                              : 'Exportar 9:16'}
                          </span>
                        </button>
                      </div>
                      <span
                        className={`director-short-score${short.score >= 70 ? ' strong' : ''}`}
                        aria-label={`Puntaje ${short.score} de 100`}
                      >
                        {short.score}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="director-apply-actions">
                  <button
                    type="button"
                    className="primary icon-text"
                    onClick={() => void exportAllShorts()}
                    disabled={shortBatchBusy || Boolean(shortBusyId)}
                  >
                    <Icon name="export" size={15} />
                    <span>
                      {shortBatchBusy && shortBatch
                        ? `Exportando ${shortBatch.index}/${shortBatch.total}: ${shortBatch.title}`
                        : `Exportar todos (${shortCandidates.length})`}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ghost icon-text"
                    onClick={() => void copyShortsPlan()}
                  >
                    <Icon name="copy" size={15} />
                    <span>Copiar plan</span>
                  </button>
                  <p className="fine-print">
                    Elegí la carpeta una vez y se exportan en orden; un fallo no frena
                    el lote. Con smart reframe sigue el rostro más grande y, si no lo
                    encuentra, recorta al centro.
                  </p>
                </div>
              </div>
            ) : null}

            {shortError ? (
              <div className="banner banner-error" role="alert">
                <span>{shortError}</span>
                <button type="button" className="link" onClick={() => setShortError(null)}>
                  Cerrar
                </button>
              </div>
            ) : null}
            {shortResult ? (
              <div className="banner banner-notice" role="status">
                <span>
                  Short {shortResult.width}×{shortResult.height} ·{' '}
                  {formatShortBytes(shortResult.bytes)} ·{' '}
                  {shortResult.durationSeconds.toFixed(1)} s ·{' '}
                  {shortResult.reframe === 'smart'
                    ? `smart reframe (${shortResult.facesDetected} muestras con rostro)`
                    : 'recorte central'}{' '}
                  · {shortResult.path}
                </span>
                <div className="actions compact">
                  <button
                    type="button"
                    className="small primary"
                    onClick={() => void store.service.revealOutput(shortResult.path)}
                  >
                    Mostrar en carpeta
                  </button>
                  <button type="button" className="small ghost" onClick={() => setShortResult(null)}>
                    Cerrar
                  </button>
                </div>
              </div>
            ) : null}

            {shortBatchOutcomes.length > 0 ? (
              <div className="card director-batch" role="status">
                <div className="production-card-head">
                  <div>
                    <p className="eyebrow">Lote de Auto Shorts</p>
                    <h3>
                      {shortBatchOutcomes.filter((item) => item.ok).length} de{' '}
                      {shortBatchOutcomes.length} listos
                    </h3>
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setShortBatchOutcomes([])}
                  >
                    Cerrar lote
                  </button>
                </div>
                <ul className="director-batch-list">
                  {shortBatchOutcomes.map((item) => (
                    <li key={item.candidateId}>
                      <span
                        className={`tag${item.ok ? '' : ' tag-error'}`}
                        aria-label={item.ok ? 'exportado' : 'falló'}
                      >
                        {item.ok ? 'Listo' : 'Falló'}
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        {item.ok && item.result ? (
                          <>
                            <p className="compress-path">{item.result.path}</p>
                            <p className="fine-print">
                              {item.result.width}×{item.result.height} ·{' '}
                              {formatShortBytes(item.result.bytes)} ·{' '}
                              {item.result.durationSeconds.toFixed(1)} s ·{' '}
                              {item.result.reframe === 'smart'
                                ? 'smart reframe'
                                : 'recorte central'}
                            </p>
                          </>
                        ) : (
                          <p className="fine-print">{item.error}</p>
                        )}
                      </div>
                      {item.ok && item.result ? (
                        <button
                          type="button"
                          className="small ghost"
                          onClick={() =>
                            item.result
                              ? void store.service.revealOutput(item.result.path)
                              : undefined
                          }
                        >
                          Mostrar
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plan ? (
              <>
                <div className="card director-plan">
                  <div className="production-card-head">
                    <div>
                      <p className="eyebrow">Plan explicable</p>
                      <h3>{plan.cuts.length} tomas · {formatSeconds(plan.stats.outputFrames / plan.fps)}</h3>
                    </div>
                    <span className="fine-print">
                      {formatSeconds(plan.sourceDurationFrames / plan.fps)} originales →{' '}
                      {formatSeconds(plan.stats.outputFrames / plan.fps)}
                    </span>
                  </div>
                  <div className="director-plan-stats">
                    <div>
                      <span>Silencios</span>
                      <strong>{plan.stats.silenceRemovedSeconds.toFixed(1)} s</strong>
                    </div>
                    <div>
                      <span>Tomas repetidas</span>
                      <strong>{plan.stats.retakesRemoved}</strong>
                    </div>
                    <div>
                      <span>Muletillas</span>
                      <strong>{plan.stats.fillersRemoved}</strong>
                    </div>
                    <div>
                      <span>Subtítulos</span>
                      <strong>{plan.captions.length}</strong>
                    </div>
                    <div>
                      <span>Audio</span>
                      <strong>
                        {plan.audio.denoise
                          ? `HPF + denoise ${Math.round(plan.audio.denoise * 100)}%`
                          : plan.audio.compressor
                            ? 'HPF + compresor'
                            : 'sin cambios'}
                      </strong>
                    </div>
                    <div>
                      <span>Loudness</span>
                      <strong>
                        {plan.loudnessTarget
                          ? `${plan.loudnessTarget.integratedLufs} LUFS`
                          : 'sin normalizar'}
                      </strong>
                    </div>
                  </div>

                  <div className="director-cuts">
                    <p className="eyebrow">Cortes propuestos</p>
                    <ol>
                      {plan.cuts.map((cut, index) => (
                        <li key={`${cut.sourceInFrame}-${index}`}>
                          <span className="director-cut-index">{String(index + 1).padStart(2, '0')}</span>
                          <span className="director-cut-label">{cut.label}</span>
                          <span className="director-cut-meta">
                            {formatSeconds(cut.sourceInFrame / plan.fps)} →{' '}
                            {formatSeconds(cut.sourceOutFrame / plan.fps)}
                          </span>
                          <span className={`director-reason reason-${cut.reason}`}>
                            {cut.reason === 'speech'
                              ? 'voz'
                              : cut.reason === 'scene'
                                ? 'escena'
                                : cut.reason === 'silence'
                                  ? 'silencio'
                                  : cut.reason}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {plan.quality.length > 0 ? (
                    <div className="director-quality">
                      <p className="eyebrow">Puerta de calidad</p>
                      <ul>
                        {plan.quality.map((finding, index) => (
                          <li key={`${finding.severity}-${index}`} className={`quality-${finding.severity}`}>
                            {finding.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="director-apply">
                    <p className="fine-print">
                      Reemplaza los clips actuales por el plan. La operación queda en el historial
                      y podés deshacerla con Ctrl+Z.
                    </p>
                    <div className="director-apply-actions">
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={autoExport}
                          onChange={(event) => setAutoExport(event.target.checked)}
                        />
                        <span>Abrir exportación al aplicar</span>
                      </label>
                      <button
                        type="button"
                        className="primary icon-text"
                        onClick={() => void apply()}
                        disabled={busy || plan.quality.some((item) => item.severity === 'error')}
                      >
                        <Icon name="editor" size={15} />
                        <span>Aplicar a la timeline</span>
                      </button>
                    </div>
                  </div>
                </div>

                {applied ? (
                  <div className="banner banner-notice director-applied" role="status">
                    <span>Plan aplicado. Revisá el resultado y exportá desde el editor.</span>
                    <div className="actions compact">
                      <button type="button" className="small primary" onClick={() => onNavigate('editor')}>
                        Abrir editor
                      </button>
                      <button type="button" className="small ghost" onClick={() => setApplied(false)}>
                        Seguir ajustando
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <aside className="director-side">
            <div className="card director-help">
              <p className="eyebrow">Cómo decide</p>
              <ul>
                <li>Los cortes salen de silencios medidos, no de adivinar.</li>
                <li>Las tomas repetidas se detectan por similitud del texto.</li>
                <li>El denoise sólo se activa si el piso de ruido lo justifica.</li>
                <li>La exposición se corrige con muestras reales de luminancia.</li>
                <li>Todo queda como clips normales y se puede editar o deshacer.</li>
              </ul>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
