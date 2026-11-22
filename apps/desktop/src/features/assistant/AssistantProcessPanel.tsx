import { useEffect, useRef, useState } from 'react';
import type { AssistantAction } from '../../services/project-service';
import type { OperatorAction } from '../ai-hub/operator';
import { MCP_TOOL_BY_NAME } from '../../state/mcp-catalog';
import type { OrchestratorJob } from '../../state/orchestrator';
import { Icon } from '../../components/Icon';

/**
 * Panel «Proceso» del asistente: qué está haciendo la IA, en orden cronológico.
 *
 * Dos fuentes reales, sin estado inventado:
 * - Los trabajos del orquestador de fábrica (`FACTORY_JOB_MANAGER`), que ya
 *   persisten su estado en `state/orchestrator.ts` y avisan con
 *   `MCP_ORCHESTRATOR_JOBS_UPDATED`. Cada trabajo es una entrada con su etapa
 *   (guion → voz → medios → montaje → render), progreso y error.
 * - Las acciones que el chat ejecutó en esta sesión (modelo u operador local),
 *   registradas por `AssistantDock` a medida que corren.
 *
 * El componente es presentacional: recibe los ítems ya normalizados y el
 * callback de reintento. No hay botón de reintento para acciones del chat ni
 * para trabajos que no sean del orquestador: el orquestador no ofrece retry
 * para ellas.
 */

export type ProcessItemStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'ok'
  | 'error'
  | 'cancelled';

export interface ProcessItem {
  readonly id: string;
  /** epoch ms; se usa sólo para ordenar la lista cronológica. */
  readonly at: number;
  readonly status: ProcessItemStatus;
  /** Nombre legible en español de la acción o del trabajo. */
  readonly title: string;
  /** Detalle corto: etapa, progreso, error o resumen del resultado. */
  readonly detail?: string | undefined;
  /** Línea secundaria opcional (p.ej. último mensaje del registro del job). */
  readonly note?: string;
  /** Sólo ítems originados en un trabajo del orquestador: habilita Reintentar. */
  readonly job?: OrchestratorJob;
}

const STATUS_LABEL: Record<ProcessItemStatus, string> = {
  pending: 'En cola',
  running: 'Ejecutando',
  waiting: 'Esperando confirmación',
  ok: 'Listo',
  error: 'Error',
  cancelled: 'Cancelado',
};

const JOB_STAGE_LABEL: Record<OrchestratorJob['stage'], string> = {
  script: 'Guion',
  narration: 'Voz',
  media: 'Medios IA',
  assemble: 'Montaje',
  write: 'Proyecto',
  render: 'Render',
  done: 'Listo',
};

function collapse(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Normaliza un trabajo del orquestador a un ítem del panel. */
export function jobToProcessItem(job: OrchestratorJob): ProcessItem {
  const status: ProcessItemStatus =
    job.status === 'queued'
      ? 'pending'
      : job.status === 'running'
        ? 'running'
        : job.status === 'done'
          ? 'ok'
          : job.status === 'cancelled'
            ? 'cancelled'
            : 'error';
  const pct = Math.round(Math.max(0, Math.min(1, job.progress)) * 100);
  let detail: string;
  if (status === 'error') {
    detail = job.error ?? 'El trabajo falló.';
  } else if (status === 'ok') {
    detail = job.result
      ? `Listo · ${job.result.clipCount} clips · ${job.result.captionCount} subtítulos`
      : 'Completado.';
  } else if (status === 'cancelled') {
    detail = 'Cancelado.';
  } else {
    detail = `${JOB_STAGE_LABEL[job.stage]} · ${pct}%`;
  }
  const lastLog = job.log[job.log.length - 1]?.message;
  return {
    id: `job-${job.id}`,
    at: Date.parse(job.createdAt) || 0,
    status,
    title: job.name,
    detail,
    ...(lastLog && status !== 'error' ? { note: collapse(lastLog) } : {}),
    job,
  };
}

type DockAction = AssistantAction | OperatorAction;

/**
 * Acciones de transporte/UI que no son pipeline de edición: no ensucian el
 * panel de proceso. El resto (edición, montaje, MCP, fábrica) sí se registra.
 */
const NON_PIPELINE_KINDS: ReadonlySet<string> = new Set([
  'navigate',
  'play',
  'pause',
  'status',
  'help',
  'unknown',
]);

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Etiqueta legible en español para una acción del chat (modelo u operador).
 * Devuelve `null` para acciones que no son pipeline: el llamador no las
 * registra en el panel.
 */
export function processActionLabel(
  action: DockAction,
): { readonly title: string; readonly detail?: string } | null {
  if (NON_PIPELINE_KINDS.has(action.kind)) return null;
  switch (action.kind) {
    case 'new_project':
      return { title: `Crear proyecto «${action.name.trim() || 'sin nombre'}»` };
    case 'import_file':
      return { title: `Importar «${baseName(action.path)}»` };
    case 'download_url':
      return { title: 'Enviar URL a la cola de descargas' };
    case 'add_clip':
      return { title: `Agregar clip «${action.asset}»` };
    case 'delete_selected':
      return { title: 'Borrar la selección' };
    case 'split_at_playhead':
      return { title: 'Dividir el clip en el playhead' };
    case 'goto':
      return { title: `Mover el playhead a ${action.seconds.toFixed(1)} s` };
    case 'add_caption':
      return { title: `Subtítulo «${collapse(action.text, 60)}»` };
    case 'set_speed':
      return { title: 'Ajustar velocidad del clip', detail: `×${action.speed}` };
    case 'set_gain':
      return {
        title: 'Ajustar volumen del clip',
        detail: `${action.db > 0 ? '+' : ''}${action.db} dB`,
      };
    case 'mute_clip':
      return { title: action.muted ? 'Silenciar el clip' : 'Activar el audio del clip' };
    case 'cut_silences':
      return {
        title: 'Cortar silencios',
        detail: `mín. ${action.minSilenceSeconds} s de silencio`,
      };
    case 'auto_subtitles':
      return {
        title: 'Generar subtítulos',
        detail: action.scope === 'project' ? 'todo el proyecto' : 'clip seleccionado',
      };
    case 'cut_voice_pauses':
      return { title: 'Cortar pausas de voz' };
    case 'auto_cleanup':
      return { title: 'Limpieza automática del proyecto' };
    case 'auto_pilot':
      return { title: 'Piloto automático (guion → render)' };
    case 'motion':
      return { title: `Gráfico «${collapse(action.text, 60)}»`, detail: action.templateId };
    case 'brain':
      return {
        title:
          action.mode === 'report'
            ? 'Diagnóstico del cerebro de edición'
            : action.mode === 'all'
              ? 'Edición completa del cerebro'
              : 'Edición segura del cerebro',
      };
    case 'media_folder':
      return { title: `Montar carpeta «${action.folder}»` };
    case 'create':
      return { title: `Brief para Fábrica «${collapse(action.topic, 60)}»` };
    case 'mcp_server':
      return { title: 'Iniciar el servidor MCP' };
    case 'mcp_call': {
      const title = MCP_TOOL_BY_NAME.get(action.tool)?.annotations?.title ?? action.tool;
      return { title: `MCP: ${title}`, detail: 'Herramienta del catálogo' };
    }
    case 'save':
      return { title: 'Guardar proyecto' };
    case 'export':
      return { title: 'Exportar' };
    case 'undo':
      return { title: 'Deshacer' };
    case 'redo':
      return { title: 'Rehacer' };
    default:
      return null;
  }
}

/**
 * Clasifica el resumen que devuelve una acción. Es una heurística sobre el
 * texto: el dock no recibe un código de error estructurado, así que se marca
 * `error` sólo cuando el propio resumen admite que no se hizo nada.
 */
export function classifyActionSummary(summary: string | null): ProcessItemStatus {
  if (summary === null) return 'ok';
  const text = summary.trim();
  if (/quiero borrar|necesita confirmaci[oó]n|confirm[aá] abajo/i.test(text)) {
    return 'waiting';
  }
  if (
    /^no\b/i.test(text) ||
    /\bno (pude|hay|encontr|ejecut|deja|conoce|se pudo|es v[aá]lido|qued[oó] en un estado)/i.test(
      text,
    ) ||
    /\b(ya no existe|desconocid[ao]|fall[oó]|no se aplic[oó])/i.test(text)
  ) {
    return 'error';
  }
  return 'ok';
}

interface AssistantProcessPanelProps {
  readonly items: readonly ProcessItem[];
  /**
   * `false` cuando hay un trabajo de fábrica en curso o no hay proyecto
   * abierto: el reintento necesita ambos (servicio + proyecto base).
   */
  readonly canRetryJobs: boolean;
  readonly onRetryJob?: (job: OrchestratorJob) => void;
}

export function AssistantProcessPanel({
  items,
  canRetryJobs,
  onRetryJob,
}: AssistantProcessPanelProps) {
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeCount = items.filter(
    (item) =>
      item.status === 'running' ||
      item.status === 'pending' ||
      item.status === 'waiting',
  ).length;

  // Auto-scroll al ítem activo (o al último si no hay ninguno en curso).
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const target =
      list.querySelector<HTMLElement>('[data-process-active="true"]') ??
      list.querySelector<HTMLElement>('.assistant-process-item:last-child');
    target?.scrollIntoView?.({ block: 'nearest' });
  }, [items, open]);

  return (
    <section className="assistant-process" aria-label="Proceso de la IA">
      <button
        type="button"
        className="assistant-process-head"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="sparkles" size={12} />
        <span>Proceso</span>
        {activeCount > 0 ? (
          <span className="assistant-process-badge">{activeCount} en curso</span>
        ) : null}
        <Icon name="chevron-down" size={12} className="assistant-process-chevron" />
      </button>
      {open ? (
        <div className="assistant-process-list" ref={listRef}>
          {items.length === 0 ? (
            <p className="assistant-process-empty">La IA todavía no ejecutó nada.</p>
          ) : (
            <ul>
              {items.map((item) => {
                const isActive =
                  item.status === 'running' ||
                  item.status === 'pending' ||
                  item.status === 'waiting';
                const job = item.job;
                const retryLabel = job?.projectPath
                  ? 'Reanudar render'
                  : job?.options.generateMedia
                    ? 'Reintentar (gasta créditos)'
                    : 'Reintentar';
                return (
                  <li
                    key={item.id}
                    className={`assistant-process-item ${item.status}`}
                    data-process-active={isActive ? 'true' : undefined}
                  >
                    <span className="assistant-process-dot" aria-hidden="true" />
                    <div className="assistant-process-body">
                      <span className="assistant-process-title">{item.title}</span>
                      {item.detail ? (
                        <span className="assistant-process-detail">{item.detail}</span>
                      ) : null}
                      {item.note ? (
                        <span className="assistant-process-note">{item.note}</span>
                      ) : null}
                      {item.status === 'error' && job && onRetryJob && canRetryJobs ? (
                        <button
                          type="button"
                          className="small ghost assistant-process-retry"
                          title={
                            job.options.generateMedia
                              ? 'Reintentar puede volver a consumir créditos de Flow.'
                              : undefined
                          }
                          onClick={() => onRetryJob(job)}
                        >
                          {retryLabel}
                        </button>
                      ) : null}
                    </div>
                    <span className={`assistant-process-status ${item.status}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
