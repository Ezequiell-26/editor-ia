import { useEffect, useMemo, useState } from 'react';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import type {
  MediaAnalysis,
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
  defaultDirectorProfile,
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
  const [applied, setApplied] = useState(false);
  const [autoExport, setAutoExport] = useState(true);
  const [silenceDb, setSilenceDb] = useState(-32);
  const [minSilence, setMinSilence] = useState(0.35);

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

  const selectedAsset = videos.find((asset) => asset.id === assetId) ?? videos[0];
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

  async function resetMemory(): Promise<void> {
    const next: DirectorMemoryFile = {
      ...memory,
      profiles: {
        ...memory.profiles,
        [platform]: defaultDirectorProfile(platform),
      },
      pendingRun: null,
    };
    setMemory(next);
    try {
      await saveDirectorMemory(store.service, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudo guardar la memoria');
    }
  }

  if (!project) {
    return (
      <section className="view">
        <div className="view-head">
          <div>
            <p className="eyebrow">Dirección automática</p>
            <h2>Director</h2>
            <p className="view-summary">
              Analiza un video, decide cortes y mejoras, y deja una timeline editable.
            </p>
          </div>
        </div>
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
      <div className="view-head director-head">
        <div>
          <p className="eyebrow">Dirección automática</p>
          <h2>Director</h2>
          <p className="view-summary">
            Mide el material, recorta silencios y tomas repetidas, mejora el audio, normaliza
            loudness y deja subtítulos. Todo el plan es explicable y se puede deshacer.
          </p>
        </div>
        <div className="head-actions">
          <span className={`status-pill ${pendingDirty ? 'dirty' : 'saved'}`}>
            <span
              className={`status-pill-dot phase-${pendingDirty ? 'dirty' : 'saved'}`}
              aria-hidden="true"
            />
            {pendingDirty
              ? 'Cambios por aprender'
              : memory.pendingRun
                ? 'Plan activo'
                : `${profile.samples} muestra(s)`}
          </span>
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('production')}>
            <Icon name="film" size={14} />
            <span>Guion a video</span>
          </button>
        </div>
      </div>

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
            <div className="card director-memory">
              <div className="production-card-head">
                <div>
                  <p className="eyebrow">Memoria del Director</p>
                  <h3>{profile.samples} creación(es) aprendidas</h3>
                </div>
              </div>
              <p className="fine-print">
                Perfil local para {platformLabel(platform)}. Se calibra con los cortes, audio y
                subtítulos que conservás al exportar. No sube nada y no entrena una red neuronal.
              </p>
              <dl className="director-profile-list">
                <div><dt>Duración media de plano</dt><dd>{profile.minShotSeconds.toFixed(1)} s</dd></div>
                <div><dt>Agresividad de corte</dt><dd>{Math.round(profile.cutAggressiveness * 100)}%</dd></div>
                <div><dt>Transiciones</dt><dd>{Math.round(profile.transitionRate * 100)}%</dd></div>
                <div><dt>Loudness objetivo</dt><dd>{profile.audioTargetLufs.toFixed(1)} LUFS</dd></div>
                <div><dt>Subtítulos</dt><dd>{profile.captionCps.toFixed(0)} CPS · {profile.maxCaptionChars} car.</dd></div>
                <div><dt>Limpieza de voz</dt><dd>{Math.round(profile.denoiseBias * 100)}%</dd></div>
              </dl>
              <button type="button" className="ghost small" onClick={() => void resetMemory()}>
                Restablecer perfil de {platformLabel(platform)}
              </button>
              {memory.runs.length > 0 ? (
                <p className="fine-print">
                  Última corrida: {formatSeconds((memory.runs[0]?.outcome.finalFrames ?? 0) / 30)}{' '}
                  {memory.runs[0]?.exported ? '· exportada' : '· revisada'}
                </p>
              ) : null}
            </div>

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
