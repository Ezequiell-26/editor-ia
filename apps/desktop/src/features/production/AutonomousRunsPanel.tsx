import { useCallback, useEffect, useState } from 'react';
import type { ProductionPlan } from '@editor-ia/project-schema';
import type { VoiceInfo } from '../../services/contracts/assistant';
import type { ProductionRun, StageRecord } from '../../services/contracts/studio';
import { useProjectStore } from '../../state/project-store';
import { buildProductionPlanFromProject } from '../../state/production-plan';
import { advanceProductionRun } from '../../state/production-runs';

const STAGE_LABELS: Record<string, string> = {
  plan: 'Plan',
  acquire: 'Adquisición',
  analyze: 'Análisis',
  scenes: 'Escenas',
  edit: 'Edición',
  render: 'Render',
  review: 'Revisión',
  deliver: 'Entrega',
};

const STATUS_LABELS: Record<ProductionRun['status'], string> = {
  planned: 'Planificada',
  running: 'En curso',
  paused: 'Pausada',
  cancelled: 'Cancelada',
  done: 'Terminada',
  failed: 'Fallida',
};

function stageMark(stage: StageRecord): string {
  switch (stage.status) {
    case 'done':
      return '✓';
    case 'running':
      return '…';
    case 'failed':
      return '✗';
    case 'skipped':
      return '–';
    default:
      return '·';
  }
}

/**
 * Corridas del estudio autónomo: listar, inspeccionar etapas y operar el
 * ciclo de vida (avanzar una etapa, reanudar, cancelar, eliminar). Cada
 * `advance` ejecuta UNA etapa — el render async queda `running` y hay que
 * volver a pulsar para sondear. Nada se simula: los errores del backend se
 * muestran tal cual.
 */
export function AutonomousRunsPanel() {
  const store = useProjectStore();
  const project = store.state.project;
  const [runs, setRuns] = useState<readonly ProductionRun[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objective, setObjective] = useState('');
  const [voices, setVoices] = useState<readonly VoiceInfo[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [musicBed, setMusicBed] = useState(false);
  const [titleCard, setTitleCard] = useState(false);
  const [describeText, setDescribeText] = useState('');
  const [approveRemoteCost, setApproveRemoteCost] = useState(false);
  const [planPreview, setPlanPreview] = useState<ProductionPlan | null>(null);
  const [planBusy, setPlanBusy] = useState<'text' | 'brief' | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRuns(await store.service.productionList());
    } catch {
      setRuns([]);
    }
  }, [store.service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Las voces SAPI sólo se piden cuando hay proyecto: sin proyecto el plan
  // no se puede crear igual, y el listado puede no existir en otros backends.
  useEffect(() => {
    if (!project) {
      setVoices([]);
      return;
    }
    let cancelled = false;
    store.service
      .listVoices()
      .then((list) => {
        if (!cancelled) setVoices(list);
      })
      .catch(() => {
        if (!cancelled) setVoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project, store.service]);

  async function act(runId: string, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(runId);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'la operación falló');
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function createRun() {
    if (!project || busy) return;
    const plan = buildProductionPlanFromProject(project, objective, undefined, {
      ...(voiceId ? { voice: voiceId } : {}),
      ...(musicBed ? { music: true } : {}),
      ...(titleCard ? { titleCard: true } : {}),
    });
    await act('new', () =>
      store.service.productionCreate(plan, { maxCostCents: plan.maxCostCents }),
    );
  }

  async function interpretText() {
    const text = describeText.trim();
    if (text.length < 10 || planBusy || busy) return;
    setPlanBusy('text');
    setError(null);
    try {
      const plan = await store.service.productionPlanFromText(text, {
        approvedCost: approveRemoteCost,
      });
      setPlanPreview(plan);
    } catch (cause) {
      // Error honesto del backend (provider sin configurar, mock, remote
      // sin approvedCost, respuesta inválida): queda a la vista y se
      // ofrece el brief local como alternativa sin costo.
      setError(cause instanceof Error ? cause.message : 'no se pudo interpretar el texto');
      setPlanPreview(null);
    } finally {
      setPlanBusy(null);
    }
  }

  async function planFromBriefLocal() {
    const text = describeText.trim();
    if (!text || planBusy || busy) return;
    setPlanBusy('brief');
    setError(null);
    try {
      const plan = await store.service.productionPlanFromBrief({ objective: text });
      setPlanPreview(plan);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudo armar el plan');
      setPlanPreview(null);
    } finally {
      setPlanBusy(null);
    }
  }

  async function createRunFromPreview() {
    if (!planPreview || busy || planBusy) return;
    setBusy('new');
    setError(null);
    try {
      await store.service.productionCreate(planPreview, {
        maxCostCents: planPreview.maxCostCents,
      });
      setPlanPreview(null);
      setDescribeText('');
      await refresh();
    } catch (cause) {
      // El preview queda a la vista para reintentar o descartar.
      setError(cause instanceof Error ? cause.message : 'no se pudo crear la corrida');
    } finally {
      setBusy(null);
    }
  }

  async function runAuto(runId: string) {
    if (busy) return;
    setBusy(runId);
    setStopRequested(false);
    setError(null);
    try {
      const final = await advanceProductionRun(store.service, runId, {
        shouldStop: () => stopRequested,
        onUpdate: (run) =>
          setRuns((current) => current.map((item) => (item.id === run.id ? run : item))),
      });
      if (final.status === 'done') {
        store.setNotice(`Corrida ${final.planId} terminada: entrega en deliverables/`);
      } else if (final.status === 'failed') {
        store.setNotice(`Corrida ${final.planId} falló: ${final.lastError ?? 'error desconocido'}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'la corrida falló');
    } finally {
      await refresh();
      setBusy(null);
      setStopRequested(false);
    }
  }

  const canCreate = project !== null && project.scenes.length > 0 && !busy;

  return (
    <section className="card autonomous-runs" aria-label="Producciones autónomas">
      <header className="folder-queue-head">
        <div>
          <p className="eyebrow">Estudio autónomo</p>
          <h3>Corridas de producción</h3>
        </div>
        <span className="fine-print">una etapa por avance</span>
      </header>
      <p className="fine-print">
        Cada corrida recorre plan → adquisición → análisis → escenas → edición → render →
        revisión → entrega usando sólo el material del proyecto. Los requisitos sin recurso
        local terminan en error explícito, nunca se simulan.
      </p>

      {project ? (
        <div className="inspector-grid">
          <label className="field">
            <span>Objetivo de la producción</span>
            <input
              type="text"
              value={objective}
              placeholder={project.name}
              onChange={(event) => setObjective(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Voz para narrar escenas con texto</span>
            <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
              <option value="">Sin narración generada</option>
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                  {voice.culture ? ` (${voice.culture})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Música de fondo</span>
            <select value={musicBed ? 'ambient' : ''} onChange={(event) => setMusicBed(event.target.value === 'ambient')}>
              <option value="">Sin cama musical</option>
              <option value="ambient">Ambiental generada (local, ffmpeg)</option>
            </select>
          </label>
          <label className="field">
            <span>Tarjeta de título</span>
            <select value={titleCard ? 'card' : ''} onChange={(event) => setTitleCard(event.target.value === 'card')}>
              <option value="">Sin portada generada</option>
              <option value="card">Portada con el objetivo (local, ffmpeg)</option>
            </select>
          </label>
          <div className="actions compact">
            <button
              type="button"
              className="small primary"
              disabled={!canCreate}
              onClick={() => void createRun()}
            >
              {busy === 'new' ? 'Creando…' : 'Nueva corrida desde el proyecto'}
            </button>
          </div>
        </div>
      ) : (
        <p className="muted">Abrí un proyecto para planificar una corrida autónoma.</p>
      )}

      <div className="inspector-grid">
        <label className="field">
          <span>Describí tu video</span>
          <input
            type="text"
            value={describeText}
            placeholder="Un resumen de 60 segundos sobre cómo editar más rápido"
            onChange={(event) => {
              setDescribeText(event.target.value);
              setPlanPreview(null);
            }}
          />
        </label>
        <label className="field">
          <span>Provider de IA</span>
          <select
            value={approveRemoteCost ? 'approved' : ''}
            onChange={(event) => setApproveRemoteCost(event.target.value === 'approved')}
          >
            <option value="">Sin costo remoto (provider local o sin IA)</option>
            <option value="approved">Autorizo el costo del provider remoto</option>
          </select>
        </label>
        <div className="actions compact">
          <button
            type="button"
            className="small"
            disabled={describeText.trim().length < 10 || planBusy !== null || busy !== null}
            onClick={() => void interpretText()}
          >
            {planBusy === 'text' ? 'Interpretando…' : 'Interpretar con IA'}
          </button>
          <button
            type="button"
            className="small ghost"
            disabled={!describeText.trim() || planBusy !== null || busy !== null}
            onClick={() => void planFromBriefLocal()}
            title="Arma el plan sin proveedor de IA: una escena por frase del objetivo"
          >
            {planBusy === 'brief' ? 'Armando…' : 'Plan simple (sin IA)'}
          </button>
        </div>
      </div>

      {planPreview ? (
        <article className="notice" aria-label="Plan preview">
          <p>
            <strong>Plan:</strong> {planPreview.brief.objective}
          </p>
          <p className="fine-print">
            {planPreview.scenes.length} escenas · {planPreview.target.platform}/
            {planPreview.target.aspectRatio} ·{' '}
            {Math.round(planPreview.target.targetDurationFrames / 30)}s
            {planPreview.maxCostCents !== undefined
              ? ` · tope $${(planPreview.maxCostCents / 100).toFixed(2)}`
              : ''}
          </p>
          <div className="actions compact">
            <button
              type="button"
              className="small primary"
              disabled={busy !== null || !project}
              title={project ? undefined : 'Abrí un proyecto para crear la corrida'}
              onClick={() => void createRunFromPreview()}
            >
              {busy === 'new' ? 'Creando…' : 'Crear corrida desde este plan'}
            </button>
            <button
              type="button"
              className="small ghost"
              disabled={busy !== null}
              onClick={() => setPlanPreview(null)}
            >
              Descartar
            </button>
          </div>
        </article>
      ) : null}

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}

      {runs.length === 0 ? (
        <p className="muted">Todavía no hay corridas persistidas.</p>
      ) : (
        <ul className="keyframe-list autonomous-run-list">
          {runs.map((run) => (
            <li key={run.id} className="autonomous-run">
              <div className="autonomous-run-head">
                <strong>{run.planId}</strong>
                <span className={`count-pill run-${run.status}`}>
                  {STATUS_LABELS[run.status]}
                </span>
                <span className="fine-print">
                  etapa: {STAGE_LABELS[run.currentStage] ?? run.currentStage}
                  {run.spentCents > 0 ? ` · $${(run.spentCents / 100).toFixed(2)}` : ''}
                </span>
              </div>
              <div className="fine-print" aria-label="Etapas">
                {run.stages.map((stage) => (
                  <span
                    key={stage.stage}
                    title={`${STAGE_LABELS[stage.stage] ?? stage.stage}: ${stage.status}${stage.error ? ` — ${stage.error}` : ''}`}
                  >
                    {stageMark(stage)} {STAGE_LABELS[stage.stage] ?? stage.stage}
                    {stage.error ? ' ⚠' : ''}
                  </span>
                ))}
              </div>
              {run.lastError ? (
                <p className="notice notice-warning" role="alert">
                  {run.lastError}
                </p>
              ) : null}
              <div className="actions compact">
                {!['done', 'cancelled', 'failed'].includes(run.status) ? (
                  <>
                    <button
                      type="button"
                      className="small primary"
                      disabled={busy !== null}
                      onClick={() => void runAuto(run.id)}
                    >
                      {busy === run.id ? 'Ejecutando…' : 'Correr'}
                    </button>
                    {busy === run.id ? (
                      <button
                        type="button"
                        className="small ghost"
                        onClick={() => setStopRequested(true)}
                      >
                        Detener
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="small"
                      disabled={busy === run.id}
                      onClick={() => void act(run.id, () => store.service.productionAdvance(run.id))}
                    >
                      Avanzar etapa
                    </button>
                    {run.status === 'running' ? (
                      <button
                        type="button"
                        className="small"
                        disabled={busy !== null}
                        onClick={() =>
                          void act(run.id, () => store.service.productionPause(run.id))
                        }
                      >
                        Pausar
                      </button>
                    ) : null}
                    {['planned', 'paused'].includes(run.status) ? (
                      <button
                        type="button"
                        className="small"
                        disabled={busy !== null}
                        title="El driver del backend conduce la corrida aunque cierres esta ventana"
                        onClick={() =>
                          void act(run.id, async () => {
                            const active = await store.service.productionStart(run.id);
                            if (!active) {
                              throw new Error('el driver backend no quedó activo para la corrida');
                            }
                          })
                        }
                      >
                        Correr autónomo
                      </button>
                    ) : null}
                  </>
                ) : null}
                {run.status === 'paused' || run.status === 'failed' ? (
                  <button
                    type="button"
                    className="small"
                    disabled={busy === run.id}
                    onClick={() => void act(run.id, () => store.service.productionResume(run.id))}
                  >
                    Reanudar
                  </button>
                ) : null}
                {['planned', 'running', 'paused'].includes(run.status) ? (
                  <button
                    type="button"
                    className="small ghost"
                    disabled={busy === run.id}
                    onClick={() => void act(run.id, () => store.service.productionCancel(run.id))}
                  >
                    Cancelar
                  </button>
                ) : null}
                {['done', 'cancelled', 'failed'].includes(run.status) ? (
                  <button
                    type="button"
                    className="small ghost"
                    disabled={busy === run.id}
                    onClick={() => void act(run.id, () => store.service.productionRemove(run.id))}
                  >
                    Eliminar
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
