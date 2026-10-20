import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectDocument } from '@editor-ia/project-schema';
import type { DesktopService, McpServerConfig } from '../../services/project-service';
import { Icon } from '../../components/Icon';
import {
  createOrchestratorJob,
  loadOrchestratorJobs,
  orchestratorMedia,
  runOrchestratorJob,
  saveOrchestratorJobs,
  upsertOrchestratorJob,
  type OrchestratorJob,
  type OrchestratorOptions,
} from '../../state/orchestrator';

export interface AutopilotDefaults {
  readonly brief: string;
  readonly scenes: number;
  readonly language: string;
  readonly width: number;
  readonly height: number;
  readonly outputDir: string;
  readonly photoMotion: 'auto' | 'none';
  readonly transitionFrames: number;
  readonly renderVideo: boolean;
  readonly confirmRights: boolean;
}

interface AutopilotPanelProps {
  readonly project: ProjectDocument;
  readonly service: DesktopService;
  readonly defaults: AutopilotDefaults;
  readonly onOpenProject: (path: string) => Promise<boolean>;
  readonly onNavigateEditor: () => void;
  readonly onNavigateMcp: () => void;
}

const STAGE_LABEL: Record<OrchestratorJob['stage'], string> = {
  script: 'Guion',
  narration: 'Voz',
  media: 'Medios IA',
  assemble: 'Montaje',
  write: 'Proyecto',
  render: 'Render',
  done: 'Listo',
};

const STATUS_LABEL: Record<OrchestratorJob['status'], string> = {
  queued: 'En cola',
  running: 'Ejecutando',
  cancelled: 'Cancelado',
  done: 'Completado',
  error: 'Con error',
};

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} kB`;
  return `${bytes} B`;
}

export function AutopilotPanel({
  project,
  service,
  defaults,
  onOpenProject,
  onNavigateEditor,
  onNavigateMcp,
}: AutopilotPanelProps) {
  const media = useMemo(() => orchestratorMedia(project), [project]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [serverId, setServerId] = useState('');
  const [generateMedia, setGenerateMedia] = useState(false);
  const [flowKind, setFlowKind] = useState<'image' | 'video'>('image');
  const [flowModel, setFlowModel] = useState('Nano Banana 2');
  const [flowRatio, setFlowRatio] = useState('16:9');
  const [flowDuration, setFlowDuration] = useState('6s');
  const [credits, setCredits] = useState(false);
  const [rights, setRights] = useState(defaults.confirmRights);
  const effectiveRights = rights || defaults.confirmRights;
  const [jobs, setJobs] = useState<OrchestratorJob[]>(() => loadOrchestratorJobs());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    setSelected(new Set(media.map((item) => item.id)));
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    void service
      .listMcpServers()
      .then((list) => {
        if (!active) return;
        setServers(list);
        const flow = list.find((item) => /flow/i.test(item.name)) ?? list[0];
        setServerId((current) => current || flow?.id || '');
      })
      .catch(() => {
        if (active) setServers([]);
      });
    return () => {
      active = false;
    };
  }, [service]);

  function persist(next: OrchestratorJob[]): void {
    setJobs(next);
    saveOrchestratorJobs(next);
  }

  function toggleMedia(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function start(job: OrchestratorJob, resume?: { stage: 'render' }): Promise<void> {
    cancelRef.current = false;
    setBusyId(job.id);
    setError(null);
    persist(upsertOrchestratorJob(jobs, job));
    const final = await runOrchestratorJob(
      job,
      {
        service,
        baseProject: project,
        onUpdate: (updated) =>
          setJobs((current) => {
            const next = upsertOrchestratorJob(current, updated);
            saveOrchestratorJobs(next);
            return next;
          }),
        shouldCancel: () => cancelRef.current,
      },
      resume ?? {},
    );
    setBusyId(null);
    if (final.status === 'done') {
      setError(null);
    } else if (final.status === 'error') {
      setError(final.error ?? 'el autopiloto falló');
    }
    persist(upsertOrchestratorJob(loadOrchestratorJobs(), final));
  }

  function create(): void {
    if (!defaults.brief.trim()) {
      setError('Escribí el brief arriba para que el autopiloto escriba el guion.');
      return;
    }
    if (!defaults.outputDir.trim()) {
      setError('Indicá la carpeta de salida.');
      return;
    }
    if (!effectiveRights) {
      setError('Confirmá los derechos de los medios y de la voz.');
      return;
    }
    if (generateMedia && !serverId) {
      setError('Elegí un servidor MCP de Flow o desactivá la generación de medios.');
      return;
    }
    if (generateMedia && !credits) {
      setError('Autorizá el consumo de créditos de Flow para generar medios.');
      return;
    }
    const options: OrchestratorOptions = {
      brief: defaults.brief.trim(),
      scenes: defaults.scenes,
      language: defaults.language,
      width: defaults.width,
      height: defaults.height,
      fpsNum: 30,
      fpsDen: 1,
      outputDir: defaults.outputDir.trim(),
      mediaIds: [...selected],
      voiceProvider: 'windows-sapi',
      photoMotion: defaults.photoMotion,
      transitionFrames: defaults.transitionFrames,
      includeCaptions: true,
      renderVideo: defaults.renderVideo,
      generateMedia,
      ...(serverId ? { flowServerId: serverId } : {}),
      flowKind,
      flowModel,
      flowRatio,
      flowDuration,
      approveCredits: credits,
      confirmRights: true,
    };    const job = createOrchestratorJob({
      name: defaults.brief.trim().slice(0, 80) || 'Video automático',
      options,
    });
    persist(upsertOrchestratorJob(jobs, job));
    void start(job);
  }

  const activeJob = jobs.find((job) => job.id === busyId) ?? null;
  const canStart = busyId === null;

  return (
    <section className="card autopilot" aria-label="Autopiloto de contenido">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Autopiloto IA</p>
          <h3>Del brief al MP4, sin pasos manuales</h3>
        </div>
        <span className={`status-pill ${busyId ? 'saving' : 'saved'}`}>
          <span className={`status-pill-dot phase-${busyId ? 'saving' : 'saved'}`} aria-hidden="true" />
          {busyId ? `${STAGE_LABEL[activeJob?.stage ?? 'script']}…` : `${jobs.length} trabajo(s)`}
        </span>
      </div>

      <p className="fine-print">
        Guion → voz local → medios de Flow (opcional) → montaje con video o imagen por escena →
        proyecto portable → MP4 verificado. La cola se guarda y sobrevive al reinicio. No gasta
        créditos sin esta autorización y no publica en redes.
      </p>

      <div className="autopilot-media">
        <div className="production-card-head">
          <div>
            <p className="eyebrow">Medios de partida</p>
            <span className="fine-print">
              {selected.size} de {media.length} seleccionados
            </span>
          </div>
          <button
            type="button"
            className="small ghost"
            onClick={() => setSelected(new Set(media.map((item) => item.id)))}
          >
            Todos
          </button>
        </div>
        {media.length === 0 ? (
          <p className="fine-print">
            No hay medios listos. Podés generar todo con Flow debajo o importarlos en Medios.
          </p>
        ) : (
          <div className="autopilot-media-list">
            {media.map((item) => (
              <label className="check" key={item.id}>
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleMedia(item.id)}
                />
                <span>
                  {item.label}{' '}
                  <code>{item.kind === 'video' ? 'VIDEO' : 'IMG'}</code>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="autopilot-flow">
        <label className="check">
          <input
            type="checkbox"
            checked={generateMedia}
            onChange={(event) => setGenerateMedia(event.target.checked)}
          />
          <span>Generar una imagen o un video por escena con el MCP de Google Flow.</span>
        </label>
        {generateMedia ? (
          <div className="autopilot-grid">
            <label className="field">
              <span>Servidor MCP</span>
              <select value={serverId} onChange={(event) => setServerId(event.target.value)}>
                <option value="">Elegí un servidor…</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Medio</span>
              <select
                value={flowKind}
                onChange={(event) => setFlowKind(event.target.value as 'image' | 'video')}
              >
                <option value="image">Imagen</option>
                <option value="video">Video</option>
              </select>
            </label>
            <label className="field">
              <span>Modelo</span>
              <input value={flowModel} onChange={(event) => setFlowModel(event.target.value)} />
            </label>
            <label className="field">
              <span>Relación</span>
              <input value={flowRatio} onChange={(event) => setFlowRatio(event.target.value)} />
            </label>
            {flowKind === 'video' ? (
              <label className="field">
                <span>Duración</span>
                <input
                  value={flowDuration}
                  onChange={(event) => setFlowDuration(event.target.value)}
                />
              </label>
            ) : null}
            <label className="check autopilot-credits">
              <input
                type="checkbox"
                checked={credits}
                onChange={(event) => setCredits(event.target.checked)}
              />
              <span>Autorizo el consumo de créditos de Flow para este trabajo.</span>
            </label>
            {servers.length === 0 ? (
              <button type="button" className="small ghost" onClick={onNavigateMcp}>
                Configurar MCP
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="autopilot-rights">
        <label className="check">
          <input
            type="checkbox"
            checked={effectiveRights}
            disabled={defaults.confirmRights}
            onChange={(event) => setRights(event.target.checked)}
          />
          <span>
            Confirmo los derechos de los medios, la voz y lo que genere Flow para este trabajo.
          </span>
        </label>
        <p className="fine-print">
          Salida: <code>{defaults.outputDir || 'sin definir'}</code>. El brief, las escenas y la
          carpeta se editan en las tarjetas de arriba y de abajo.
        </p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="primary icon-text"
          onClick={create}
          disabled={!canStart}
        >
          <Icon name="sparkles" size={15} />
          <span>{canStart ? 'Ejecutar autopiloto' : 'Trabajo en curso…'}</span>
        </button>
        {busyId ? (
          <button
            type="button"
            className="small danger-ghost"
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            Cancelar al terminar la etapa
          </button>
        ) : null}
        <button type="button" className="small ghost" onClick={onNavigateMcp}>
          Abrir Flow
        </button>
      </div>

      {error ? (
        <p className="notice notice-warning" role="status">
          {error}
        </p>
      ) : null}

      {jobs.length > 0 ? (
        <div className="autopilot-jobs">
          <p className="eyebrow">Cola persistente</p>
          <ul>
            {[...jobs].reverse().map((job) => (
              <li key={job.id} className={`autopilot-job ${job.status}`}>
                <div className="autopilot-job-head">
                  <div>
                    <strong>{job.name}</strong>
                    <span>
                      {STATUS_LABEL[job.status]} · {STAGE_LABEL[job.stage]} ·{' '}
                      {Math.round(job.progress * 100)}%
                    </span>
                  </div>
                  <div className="actions compact">
                    {job.status === 'error' && job.projectPath ? (
                      <button
                        type="button"
                        className="small"
                        disabled={!canStart}
                        onClick={() => void start(job, { stage: 'render' })}
                      >
                        Reanudar render
                      </button>
                    ) : null}
                    {job.status === 'error' && !job.projectPath ? (
                      <button
                        type="button"
                        className="small"
                        disabled={!canStart}
                        onClick={() => void start(job)}
                      >
                        {job.options.generateMedia ? 'Reintentar (gasta créditos)' : 'Reintentar'}
                      </button>
                    ) : null}
                    {job.projectPath ? (
                      <>
                        <button
                          type="button"
                          className="small ghost"
                          onClick={() =>
                            void service.revealOutput(job.projectPath ?? '').catch(() => {})
                          }
                        >
                          Mostrar
                        </button>
                        <button
                          type="button"
                          className="small"
                          disabled={Boolean(busyId)}
                          onClick={() => {
                            if (
                              window.confirm(
                                'Se abrirá esta variante y se reemplazará el proyecto actual. ¿Continuar?',
                              )
                            ) {
                              void onOpenProject(job.projectPath!).then((ok) => {
                                if (ok) onNavigateEditor();
                              });
                            }
                          }}
                        >
                          Abrir
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="autopilot-progress" aria-hidden="true">
                  <span style={{ width: `${Math.max(2, job.progress * 100)}%` }} />
                </div>
                {job.error ? <p className="fine-print autopilot-error">{job.error}</p> : null}
                {job.status === 'error' && !job.projectPath && job.options.generateMedia ? (
                  <p className="fine-print">
                    Reintentar vuelve a llamar a Flow y puede consumir créditos otra vez. Si el
                    proyecto ya se escribió, usá Reanudar render, que no genera medios.
                  </p>
                ) : null}
                <p className="fine-print">
                  {job.cost.generations > 0
                    ? `${job.cost.generations} generación(es) de Flow · `
                    : ''}
                  {job.result
                    ? `${(job.result.durationFrames / 30).toFixed(1)} s · ${job.result.clipCount} clips · ${job.result.captionCount} subtítulos`
                    : 'Sin resultado todavía'}
                  {job.videoBytes ? ` · MP4 ${formatBytes(job.videoBytes)}` : ''}
                </p>
                {job.projectPath ? <code>{job.projectPath}</code> : null}
                {job.videoPath ? <code>{job.videoPath}</code> : null}
                {job.log.length > 0 ? (
                  <details>
                    <summary>Registro ({job.log.length})</summary>
                    <ul className="autopilot-log">
                      {job.log.slice(-12).map((entry, index) => (
                        <li key={`${entry.at}-${index}`} className={entry.level}>
                          <span>{new Date(entry.at).toLocaleTimeString()}</span> {entry.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
