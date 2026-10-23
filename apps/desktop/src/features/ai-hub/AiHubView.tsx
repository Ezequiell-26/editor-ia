import { useEffect, useMemo, useState } from 'react';
import { NAV_VIEWS, type ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type { ProviderInfo } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import {
  AI_BRIEF_LIMIT,
  AI_SKILLS,
  aiSkill,
  briefProblem,
  briefTokens,
  categoryLabel,
  composeSkillPrompt,
  type AiSkill,
} from './ai-hub';
import { OPERATOR_HELP, parseOperatorCommand } from './operator';

const BRIEF_KEY = 'editoria.aihub.brief';

function targetLabel(target: ViewId): string {
  switch (target) {
    case 'script':
      return 'Guion';
    case 'localization':
      return 'Localización';
    case 'thumbnails':
      return 'Miniaturas';
    case 'production':
      return 'Producción';
    default:
      return 'la vista';
  }
}

export function AiHubView({
  onNavigate,
}: {
  readonly onNavigate: (id: ViewId) => void;
}) {
  const store = useProjectStore();
  const [operatorInput, setOperatorInput] = useState('');
  const [operatorLog, setOperatorLog] = useState<readonly { role: 'user' | 'agent'; text: string }[]>([
    { role: 'agent', text: 'Operador local listo. Escribí “ayuda” para ver los comandos.' },
  ]);
  const [skillId, setSkillId] = useState(AI_SKILLS[0]!.id);
  const [brief, setBrief] = useState('');
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const skill = aiSkill(skillId) ?? AI_SKILLS[0]!;
  const composed = useMemo(() => composeSkillPrompt(skill, brief), [skill, brief]);
  const problem = briefProblem(brief);
  const ready = !problem && brief.trim().length >= 10;

  useEffect(() => {
    let active = true;
    void store.service
      .getProvider()
      .then((info) => {
        if (active) setProvider(info);
      })
      .catch(() => {
        if (active) setProvider(null);
      });
    return () => {
      active = false;
    };
  }, [store.service]);

  function pick(next: AiSkill): void {
    setSkillId(next.id);
    setFeedback(null);
  }

  async function copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(composed.prompt);
      setFeedback('Prompt copiado. Pegalo en el modelo o en un chat de tu proveedor.');
    } catch {
      setFeedback(
        'No se pudo copiar automáticamente. Seleccioná el texto del recuadro y copialo.',
      );
    }
  }

  function sendBrief(): void {
    if (!ready) {
      setFeedback(problem ?? 'Escribí un brief de al menos 10 caracteres.');
      return;
    }
    if (skill.target === 'script') {
      try {
        localStorage.setItem(BRIEF_KEY, brief.replace(/\s+/g, ' ').trim());
      } catch {
        setFeedback('No se pudo guardar el brief en este equipo.');
        return;
      }
      setFeedback('Brief guardado. Guion lo va a cargar al abrirse.');
    } else {
      setFeedback(
        `El prompt quedó listo para copiar. ${targetLabel(skill.target)} no acepta briefs de texto directamente todavía.`,
      );
    }
    onNavigate(skill.target);
  }

  async function runOperator(): Promise<void> {
    const text = operatorInput.trim();
    if (!text) return;
    const action = parseOperatorCommand(text, NAV_VIEWS);
    let reply = '';
    if (action.kind === 'navigate') {
      onNavigate(action.view);
      reply = `Abriendo ${action.label}.`;
    } else if (action.kind === 'play') {
      store.setPlaying(true);
      reply = 'Reproduciendo.';
    } else if (action.kind === 'pause') {
      store.setPlaying(false);
      reply = 'Pausado.';
    } else if (action.kind === 'undo') {
      store.undo();
      reply = 'Deshice el último cambio.';
    } else if (action.kind === 'redo') {
      store.redo();
      reply = 'Rehice el cambio.';
    } else if (action.kind === 'save') {
      reply = (await store.saveNow()) ? 'Proyecto guardado.' : 'No hay un proyecto abierto para guardar.';
    } else if (action.kind === 'export') {
      store.requestExport();
      reply = 'Abrí el diálogo de exportación.';
    } else if (action.kind === 'create') {
      localStorage.setItem('editoria.factory.brief', action.topic);
      onNavigate('factory');
      reply = `Brief “${action.topic}” enviado a Fábrica. Elegí formato y variantes ahí para generarlo.`;
    } else if (action.kind === 'status') {
      const project = store.state.project;
      reply = project
        ? `${project.name}: ${project.timeline.clips.length} clip(s), playhead en frame ${store.state.playheadFrame}.`
        : 'No hay un proyecto abierto.';
    } else if (action.kind === 'help') {
      reply = OPERATOR_HELP;
    } else {
      reply = action.message;
    }
    setOperatorLog((current) => [...current, { role: 'user', text }, { role: 'agent', text: reply }]);
    setOperatorInput('');
  }

  return (
    <section className="view compress-view ai-hub-view">
      <ViewToolbar
        label="AI Hub"
        actions={
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('settings')}>
            <Icon name="settings" size={14} />
            <span>Proveedor</span>
          </button>
        }
      />

      <div className="card ai-operator">
        <div className="production-card-head">
          <div>
            <p className="eyebrow">Operador local</p>
            <h3>Controlá la app con comandos</h3>
          </div>
          <span className="fine-print">Sin tokens · determinista</span>
        </div>
        <div className="ai-operator-log" role="log" aria-live="polite">
          {operatorLog.map((entry, index) => (
            <p key={`${entry.role}-${index}`} className={`ai-operator-${entry.role}`}>
              {entry.text}
            </p>
          ))}
        </div>
        <form
          className="ai-operator-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runOperator();
          }}
        >
          <input
            value={operatorInput}
            onChange={(event) => setOperatorInput(event.target.value)}
            placeholder="abrir editor, reproducir, exportar, estado…"
            aria-label="Comando para el operador"
          />
          <button type="submit" className="primary icon-text">
            <Icon name="sparkles" size={14} />
            <span>Ejecutar</span>
          </button>
        </form>
        <p className="fine-print">
          Operador local de comandos: no es un chat con un modelo ni gasta tokens. Próximo paso:
          conectar el proveedor para intención libre.
        </p>
      </div>

      <header className="compress-head">
        <div>
          <h2>Skills compactas para no gastar tokens de más</h2>
          <p>
            Elegí una tarea, escribí el brief y la app arma un pedido acotado con
            contrato de salida. No hay chat ni llamada automática: el prompt se copia
            o se envía como brief a la vista que corresponda.
          </p>
        </div>
      </header>

      {feedback ? (
        <p className="notice" role="status">
          {feedback}
        </p>
      ) : null}

      <div className="localization-provider">
        <Icon name="sparkles" size={17} />
        <div>
          <strong>
            {provider
              ? provider.kind === 'mock'
                ? 'Proveedor simulado'
                : `${provider.model || 'Proveedor'} · ${provider.baseUrl}`
              : 'Proveedor no consultado'}
          </strong>
          <span>
            Las skills no llaman al modelo por sí solas. Guion y Localización usan
            este proveedor; si es remoto, esas vistas piden autorización de cuota.
          </span>
        </div>
        <button type="button" className="ghost" onClick={() => onNavigate('settings')}>
          Cambiar
        </button>
      </div>

      <div className="ai-hub-layout">
        <div className="ai-hub-skills">
          <p className="field-label">Biblioteca de skills</p>
          <div className="ai-hub-grid" role="group" aria-label="Biblioteca de skills">
            {AI_SKILLS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ai-hub-skill${item.id === skill.id ? ' active' : ''}`}
                aria-pressed={item.id === skill.id}
                onClick={() => pick(item)}
              >
                <span className="ai-hub-skill-category">{categoryLabel(item.category)}</span>
                <strong>{item.name}</strong>
                <p>{item.summary}</p>
                <span className="ai-hub-skill-target">
                  {targetLabel(item.target)} · {item.output}
                </span>
              </button>
            ))}
          </div>

          <div className="ai-hub-budget">
            <Icon name="info" size={14} />
            <div>
              <strong>Cómo ahorra contexto</strong>
              <ul>
                <li>Una skill por pedido, sin arrastrar la conversación completa.</li>
                <li>Contrato de salida corto al final para evitar explicaciones.</li>
                <li>El brief se limita a {AI_BRIEF_LIMIT.toLocaleString('es-AR')} caracteres.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="ai-hub-composer">
          <div className="ai-hub-selected">
            <span className="ai-hub-skill-category">{categoryLabel(skill.category)}</span>
            <h3>{skill.name}</h3>
            <p>{skill.summary}</p>
            <span className="fine-print">
              Salida esperada: {skill.output}. Destino: {targetLabel(skill.target)}.
            </span>
          </div>

          <label className="field">
            <span>Brief del video</span>
            <textarea
              value={brief}
              rows={7}
              maxLength={AI_BRIEF_LIMIT + 200}
              placeholder="Qué video querés hacer, para quién, qué debe entender y qué material tenés…"
              onChange={(event) => {
                setBrief(event.target.value);
                setFeedback(null);
              }}
            />
          </label>

          <div className="ai-hub-meter">
            <span>
              {brief.length.toLocaleString('es-AR')} /{' '}
              {AI_BRIEF_LIMIT.toLocaleString('es-AR')} caracteres
            </span>
            <span>≈ {briefTokens(brief).toLocaleString('es-AR')} tokens de brief</span>
            <span>
              Prompt ≈ {composed.estimatedTokens.toLocaleString('es-AR')} tokens
            </span>
          </div>
          {problem ? (
            <p className="notice notice-warning" role="alert">
              {problem}
            </p>
          ) : (
            <p className="fine-print">
              {brief.trim().length < 10
                ? 'Escribí al menos 10 caracteres para habilitar el prompt y el envío.'
                : 'Listo: el pedido entra en el presupuesto y no arrastra conversación.'}
            </p>
          )}

          <div className="ai-hub-prompt">
            <div className="ai-hub-prompt-head">
              <strong>Prompt compuesto</strong>
              <span>{composed.characters.toLocaleString('es-AR')} caracteres</span>
            </div>
            <pre>{composed.prompt}</pre>
          </div>

          <div className="compress-actions">
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void copyPrompt()}
              disabled={!ready}
            >
              <Icon name="copy" size={15} />
              <span>Copiar prompt</span>
            </button>
            <button
              type="button"
              className="ghost icon-text"
              onClick={sendBrief}
              disabled={!ready}
            >
              <Icon name="external" size={15} />
              <span>
                {skill.target === 'script'
                  ? 'Usar brief en Guion'
                  : `Abrir ${targetLabel(skill.target)}`}
              </span>
            </button>
          </div>

          <p className="fine-print">
            La app no envía nada al copiar. Si después usás Guion o Localización, esas
            vistas muestran el proveedor y piden autorización cuando la llamada puede
            consumir cuota.
          </p>
        </div>
      </div>
    </section>
  );
}
