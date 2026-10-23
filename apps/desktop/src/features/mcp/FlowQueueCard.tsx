import { useEffect, useMemo, useState } from 'react';
import {
  FLOW_IMAGE_MODELS,
  FLOW_IMAGE_RATIOS,
  FLOW_QUEUE_BOUNDS,
  parseFlowPrompts,
  type FlowQueueSettings,
  type FlowQueueState,
} from '../../state/flow-queue';
import { useFlowQueue } from '../../state/FlowQueueProvider';

const PROMPTS_DRAFT_KEY = 'editoria.flow-prompts.v1';

function loadDraft(): string {
  try {
    return window.localStorage.getItem(PROMPTS_DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(text: string): void {
  try {
    window.localStorage.setItem(PROMPTS_DRAFT_KEY, text);
  } catch {
    // Sin almacenamiento el borrador vive sólo en la sesión.
  }
}

function seconds(ms: number): string {
  return ms === 0 ? 'sin espera' : `${Math.round(ms / 1000)} s`;
}

const STATUS_LABEL: Record<FlowQueueState['status'], string> = {
  idle: 'Sin plan',
  running: 'Generando',
  stopped: 'Detenido',
  completed: 'Completado',
  failed: 'Falló',
};

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

interface Props {
  readonly serverId: string | null;
  readonly outputFolder: string;
}

/**
 * Cola de generación continua sobre Google Flow.
 *
 * Cada vuelta llama a `flow_generate_image` con `auto_confirm` —consume
 * créditos reales— y espera un enfriamiento antes de la siguiente. La
 * autorización es explícita y no se recuerda entre sesiones: sin la marca, el
 * botón queda deshabilitado.
 */
export function FlowQueueCard({ serverId, outputFolder }: Props) {
  const { state, running, start, resume, stop, reset, setSettings } = useFlowQueue();
  const [promptText, setPromptText] = useState(loadDraft);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    saveDraft(promptText);
  }, [promptText]);

  const prompts = useMemo(() => parseFlowPrompts(promptText), [promptText]);
  const settings = state.settings;
  const planned = prompts.length * settings.imagesPerPrompt;
  const target = Math.min(planned, settings.maxImages);
  const progress = target > 0 ? Math.min(100, Math.round((state.imagesGenerated / target) * 100)) : 0;
  const hasPlan = state.items.length > 0;
  const canStart =
    !running && prompts.length > 0 && authorized && Boolean(serverId) && Boolean(outputFolder);
  const canResume = !running && hasPlan && state.status === 'stopped' && Boolean(serverId);

  function patch(next: Partial<FlowQueueSettings>): void {
    setSettings({ ...settings, ...next });
  }

  function begin(): void {
    setError(null);
    if (!serverId || !outputFolder) {
      setError('Abrí un proyecto y probá el servidor Google Flow antes de generar.');
      return;
    }
    if (prompts.length === 0) {
      setError('Escribí al menos un prompt.');
      return;
    }
    if (!authorized) {
      setError('Marcá que autorizás el consumo de créditos de Flow.');
      return;
    }
    start({ serverId, prompts, settings, outputFolder });
  }

  return (
    <section className="flow-queue" aria-labelledby="flow-queue-title">
      <header className="flow-queue-head">
        <div>
          <h4 id="flow-queue-title">Generación continua</h4>
          <p>
            Encadena prompts y repite la lista hasta llegar al tope. Una imagen por vuelta, con
            espera entre medio: Flow es una sola sesión de Chrome y dos pedidos a la vez se pisan.
          </p>
        </div>
        <span className={running ? 'flow-queue-state running' : `flow-queue-state ${state.status}`}>
          {running ? STATUS_LABEL.running : STATUS_LABEL[state.status]}
        </span>
      </header>

      <label className="field">
        <span>Prompts · uno por línea ({prompts.length})</span>
        <textarea
          className="flow-queue-prompts"
          value={promptText}
          onChange={(event) => setPromptText(event.target.value)}
          rows={5}
          spellCheck={false}
          placeholder={'Un faro en un acantilado, plano general, luz de tormenta\nRetrato del personaje, plano medio, luz cálida'}
          disabled={running}
        />
      </label>

      <div className="flow-queue-grid">
        <label className="field">
          <span>Modelo</span>
          <select
            value={settings.model}
            onChange={(event) => patch({ model: event.target.value as FlowQueueSettings['model'] })}
            disabled={running}
          >
            {FLOW_IMAGE_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Aspecto</span>
          <select
            value={settings.ratio}
            onChange={(event) => patch({ ratio: event.target.value as FlowQueueSettings['ratio'] })}
            disabled={running}
          >
            {FLOW_IMAGE_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            Repeticiones por prompt <output>{settings.imagesPerPrompt}</output>
          </span>
          <input
            type="range"
            min={FLOW_QUEUE_BOUNDS.imagesPerPrompt.min}
            max={FLOW_QUEUE_BOUNDS.imagesPerPrompt.max}
            step={FLOW_QUEUE_BOUNDS.imagesPerPrompt.step}
            value={settings.imagesPerPrompt}
            aria-label="Repeticiones por prompt"
            onChange={(event) => patch({ imagesPerPrompt: Number(event.target.value) })}
            disabled={running}
          />
        </label>
        <label className="field">
          <span>
            Espera entre imágenes <output>{seconds(settings.cooldownMs)}</output>
          </span>
          <input
            type="range"
            min={FLOW_QUEUE_BOUNDS.cooldownMs.min}
            max={FLOW_QUEUE_BOUNDS.cooldownMs.max}
            step={FLOW_QUEUE_BOUNDS.cooldownMs.step}
            value={settings.cooldownMs}
            aria-label="Espera entre imágenes"
            onChange={(event) => patch({ cooldownMs: Number(event.target.value) })}
            disabled={running}
          />
        </label>
        <label className="field">
          <span>
            Tope de imágenes <output>{settings.maxImages}</output>
          </span>
          <input
            type="range"
            min={FLOW_QUEUE_BOUNDS.maxImages.min}
            max={FLOW_QUEUE_BOUNDS.maxImages.max}
            step={FLOW_QUEUE_BOUNDS.maxImages.step}
            value={settings.maxImages}
            aria-label="Tope de imágenes"
            onChange={(event) => patch({ maxImages: Number(event.target.value) })}
            disabled={running}
          />
        </label>
        <label className="field">
          <span>
            Cortar tras fallos seguidos <output>{settings.maxConsecutiveErrors}</output>
          </span>
          <input
            type="range"
            min={FLOW_QUEUE_BOUNDS.maxConsecutiveErrors.min}
            max={FLOW_QUEUE_BOUNDS.maxConsecutiveErrors.max}
            step={FLOW_QUEUE_BOUNDS.maxConsecutiveErrors.step}
            value={settings.maxConsecutiveErrors}
            aria-label="Cortar tras fallos seguidos"
            onChange={(event) => patch({ maxConsecutiveErrors: Number(event.target.value) })}
            disabled={running}
          />
        </label>
      </div>

      <div className="appearance-checks flow-queue-checks">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.repeatForever}
            onChange={(event) => patch({ repeatForever: event.target.checked })}
            disabled={running}
          />
          Repetir la lista hasta el tope
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.importToMedia}
            onChange={(event) => patch({ importToMedia: event.target.checked })}
            disabled={running}
          />
          Importar cada imagen a Medios
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.checkCredits}
            onChange={(event) => patch({ checkCredits: event.target.checked })}
            disabled={running}
          />
          Consultar saldo y cortar en cero
        </label>
      </div>

      <label className="check flow-queue-authorize">
        <input
          type="checkbox"
          checked={authorized}
          onChange={(event) => setAuthorized(event.target.checked)}
          disabled={running}
        />
        Autorizo consumir créditos de Flow en cada imagen de esta corrida
      </label>

      <div className="actions">
        <button type="button" className="primary" onClick={begin} disabled={!canStart}>
          {running ? 'Generando…' : `Iniciar lote${target > 0 ? ` (${target})` : ''}`}
        </button>
        <button type="button" onClick={stop} disabled={!running}>
          Detener
        </button>
        {canResume ? (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (!serverId) return;
              resume({ serverId, outputFolder });
            }}
          >
            Reanudar plan
          </button>
        ) : null}
        {hasPlan && !running ? (
          <button type="button" className="ghost" onClick={reset}>
            Limpiar plan
          </button>
        ) : null}
      </div>

      {error ? <p className="notice notice-warning">{error}</p> : null}

      {hasPlan ? (
        <div className="flow-queue-progress" role="status" aria-live="polite">
          <div className="flow-queue-bar" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="flow-queue-numbers">
            {plural(state.imagesGenerated, 'imagen', 'imágenes')} ·{' '}
            {plural(state.items.filter((item) => item.status === 'done').length, 'completado', 'completados')} ·{' '}
            {plural(state.items.filter((item) => item.status === 'failed').length, 'fallo', 'fallos')} ·{' '}
            {plural(state.cycles, 'vuelta', 'vueltas')}
          </p>
          {state.status === 'running' ? (
            <p className="flow-queue-current">
              {state.items.find((item) => item.status === 'running')?.prompt ?? 'Esperando…'}
            </p>
          ) : null}
          {state.stopReason ? <p className="fine-print">{state.stopReason}</p> : null}
        </div>
      ) : null}

      {state.log.length > 0 ? (
        <ol className="flow-queue-log">
          {state.log.slice(0, 6).map((entry) => (
            <li key={`${entry.at}-${entry.prompt}`} className={entry.error ? 'failed' : 'done'}>
              <span className="flow-queue-log-prompt">{entry.prompt}</span>
              <span className="flow-queue-log-meta">
                {entry.error
                  ? entry.error
                  : `${plural(entry.artifacts.length, 'archivo', 'archivos')} · ${new Date(
                      entry.at,
                    ).toLocaleTimeString()}`}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="fine-print">
        Detener no aborta la imagen en curso —la llamada MCP es bloqueante—: impide la siguiente.
        Cada generación consume créditos y el costo exacto lo decide Flow. Si Google pide login o
        verificación, la corrida falla y hay que resolverlo en la ventana de Chrome.
      </p>
    </section>
  );
}
