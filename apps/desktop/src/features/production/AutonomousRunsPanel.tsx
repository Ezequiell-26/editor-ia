import { useCallback, useEffect, useState } from 'react';
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
    });
    await act('new', () =>
      store.service.productionCreate(plan, { maxCostCents: plan.maxCostCents }),
    );
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
