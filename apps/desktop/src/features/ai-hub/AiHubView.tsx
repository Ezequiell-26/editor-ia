import { useEffect, useMemo, useState } from 'react';
import { NAV_VIEWS, type ViewId } from '../../app/navigation';
import { AiBrandMark } from '../../components/AiBrandMark';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import { detectAiBrand, endpointLabel } from '../../services/ai-models';
import type { ProviderInfo } from '../../services/project-service';
import { addMotionGraphic, fpsOf } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import {
  AI_BRIEF_LIMIT,
  AI_SKILLS,
  aiSkill,
  briefProblem,
  briefTokens,
  categoryLabel,
  composeSkillPrompt,
  listSkills,
  type AiSkill,
} from '../../state/ai-skills';
import {
  deleteCustomSkill,
  saveCustomSkill,
  type CustomSkill,
} from '../../state/custom-skills';
import { emptyDirectorMemory, normalizeDirectorMemory } from '../../state/editor-memory';
import {
  addAiMemory,
  forgetAiMemory,
  loadAiMemory,
  type AiMemoryNote,
} from '../../state/ai-memory';
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
    case 'motion':
      return 'Motion';
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
  const [skills, setSkills] = useState<readonly AiSkill[]>(() => listSkills());
  const [customForm, setCustomForm] = useState(false);
  const [customDraft, setCustomDraft] = useState({
    name: '',
    summary: '',
    category: 'guion' as AiSkill['category'],
    target: 'script' as ViewId,
    output: '',
    prompt: '',
  });
  const [memory, setMemory] = useState<{ runs: number; profiles: number } | null>(null);
  const [memoryNotes, setMemoryNotes] = useState<readonly AiMemoryNote[]>(() => loadAiMemory());
  const [memoryDraft, setMemoryDraft] = useState('');
  const [brief, setBrief] = useState('');
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerRetry, setProviderRetry] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const skill = aiSkill(skillId) ?? skills[0] ?? AI_SKILLS[0]!;
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
      .catch((cause: unknown) => {
        if (active) {
          setProvider(null);
          setProviderError(cause instanceof Error ? cause.message : 'no se pudo leer el proveedor');
        }
      });
    return () => {
      active = false;
    };
  }, [store.service, providerRetry]);

  // Memoria del Director: perfiles por plataforma + historial de runs.
  useEffect(() => {
    let active = true;
    void store.service
      .loadDirectorMemory()
      .then((raw) => {
        if (!active) return;
        const memory = normalizeDirectorMemory(raw);
        setMemory({
          runs: memory.runs.length,
          profiles: Object.values(memory.profiles).filter(
            (profile) => profile.samples > 0,
          ).length,
        });
      })
      .catch(() => {
        if (active) setMemory(null);
      });
    return () => {
      active = false;
    };
  }, [store.service]);

  function createCustomSkill(): void {
    const draft = customDraft;
    if (
      !draft.name.trim() ||
      !draft.summary.trim() ||
      !draft.prompt.trim() ||
      !draft.output.trim()
    ) {
      return;
    }
    const skill: CustomSkill = {
      id: `custom-${Date.now().toString(36)}`,
      name: draft.name.trim(),
      summary: draft.summary.trim(),
      category: draft.category,
      target: draft.target,
      output: draft.output.trim(),
      prompt: draft.prompt.trim(),
      custom: true,
      createdAt: new Date().toISOString(),
    };
    saveCustomSkill(skill);
    setSkills(listSkills());
    setSkillId(skill.id);
    setCustomForm(false);
    setCustomDraft({
      name: '',
      summary: '',
      category: 'guion',
      target: 'script',
      output: '',
      prompt: '',
    });
    setFeedback(`Skill «${skill.name}» creada. Ya podés usarla en el compositor.`);
  }

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
    } else if (skill.target === 'motion') {
      try {
        localStorage.setItem('editoria.motion.brief', brief.replace(/\s+/g, ' ').trim());
      } catch {
        setFeedback('No se pudo guardar el brief en este equipo.');
        return;
      }
      setFeedback('Brief guardado. Motion lo muestra al abrirse.');
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
    } else if (action.kind === 'motion') {
      const project = store.state.project;
      if (!project) {
        reply = 'Abrí o creá un proyecto para agregar un gráfico.';
      } else {
        const props: Record<string, unknown> =
          action.templateId === 'title-card'
            ? {
                title: action.text,
                subtitle: '',
                background: '#0f172a',
                accent: '#7dd3c0',
                align: 'left',
                animation: 'slide-up',
              }
            : action.templateId === 'lower-third'
              ? {
                  name: action.text,
                  role: action.secondary ?? '',
                  accent: '#7dd3c0',
                  side: 'left',
                  animation: 'slide-left',
                }
              : action.templateId === 'end-card'
                ? {
                    title: action.text,
                    cta: action.secondary ?? '',
                    background: '#0f172a',
                    accent: '#7dd3c0',
                    animation: 'fade',
                  }
                : {
                    value: action.text,
                    label: action.secondary ?? 'dato',
                    accent: '#7dd3c0',
                    animation: 'pop',
                  };
        let clipId: string | null = null;
        try {
          const ok = store.mutate(
            (current) => {
              const added = addMotionGraphic(current, {
                templateId: action.templateId,
                templateVersion: '1.0.0',
                props,
                durationFrames: Math.max(1, Math.round(fpsOf(current) * 3)),
                atFrame: store.getPlayhead(),
                label: action.text.slice(0, 80),
              });
              clipId = added.clipId;
              return { project: added.project };
            },
            { notice: `Gráfico agregado: ${action.text}.` },
          );
          if (ok && clipId) {
            store.setSelection({ kind: 'clip', id: clipId });
            onNavigate('editor');
            reply = `Gráfico agregado: ${action.text}.`;
          } else {
            reply = 'El gráfico no deja el proyecto en un estado válido.';
          }
        } catch (cause) {
          reply = cause instanceof Error ? cause.message : 'no se pudo agregar el gráfico';
        }
      }
    } else if (action.kind === 'status') {
      const project = store.state.project;
      reply = project
        ? `${project.name}: ${project.timeline.clips.length} clip(s), playhead en frame ${store.getPlayhead()}.`
        : 'No hay un proyecto abierto.';
    } else if (action.kind === 'help') {
      reply = OPERATOR_HELP;
    } else if (action.kind === 'media_folder') {
      reply = 'El montaje de carpetas se ejecuta desde el asistente flotante de Olyvia.';
    } else if (
      action.kind === 'new_project' ||
      action.kind === 'open_project' ||
      action.kind === 'import_file' ||
      action.kind === 'download_url' ||
      action.kind === 'add_clip' ||
      action.kind === 'delete_selected' ||
      action.kind === 'split_at_playhead' ||
      action.kind === 'goto' ||
      action.kind === 'add_caption' ||
      action.kind === 'set_speed' ||
      action.kind === 'set_gain' ||
      action.kind === 'mute_clip' ||
      action.kind === 'cut_silences' ||
      action.kind === 'auto_subtitles' ||
      action.kind === 'cut_voice_pauses' ||
      action.kind === 'auto_cleanup' ||
      action.kind === 'auto_pilot' ||
      action.kind === 'mcp_server' ||
      action.kind === 'brain'
    ) {
      reply = `Ese comando lo ejecuta el asistente flotante de Olyvia: abrilo con Ctrl+K o con el botón del chat y pedí «${action.kind}».`;
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
        <AiBrandMark
          brand={provider ? detectAiBrand(provider.baseUrl, provider.model) : 'mock'}
          size={34}
          title={provider?.model ?? 'sin modelo'}
        />
        <div>
          <strong>
            {provider
              ? `${provider.model || 'sin modelo'}`
              : 'Proveedor no consultado'}
          </strong>
          <span>
            {provider ? endpointLabel(provider.baseUrl) : '—'} · Las skills no llaman
            al modelo por sí solas. Guion y Localización usan este proveedor; si es
            remoto, esas vistas piden autorización de cuota.
            {providerError ? ` No se pudo leer el proveedor: ${providerError}` : ''}
          </span>
        </div>
        {providerError ? (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setProviderError(null);
              setProviderRetry((n) => n + 1);
            }}
          >
            Reintentar
          </button>
        ) : null}
        <button type="button" className="ghost" onClick={() => onNavigate('settings')}>
          Cambiar
        </button>
      </div>

      <div className="ai-hub-layout">
        <div className="ai-hub-skills">
          <p className="field-label">Biblioteca de skills</p>
          <div className="ai-hub-grid" role="group" aria-label="Biblioteca de skills">
            {skills.map((item) => (
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
                  {'custom' in item && item.custom ? ' · mía' : ''}
                </span>
                {'custom' in item && item.custom ? (
                  <button
                    type="button"
                    className="ghost ai-hub-skill-delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteCustomSkill(item.id);
                      setSkills(listSkills());
                      if (skillId === item.id) setSkillId(AI_SKILLS[0]!.id);
                    }}
                  >
                    Eliminar
                  </button>
                ) : null}
              </button>
            ))}
          </div>

          <div className="ai-hub-custom">
            {!customForm ? (
              <button
                type="button"
                className="ghost icon-text"
                onClick={() => setCustomForm(true)}
              >
                <Icon name="plus" size={14} />
                <span>Crear skill propia</span>
              </button>
            ) : (
              <div className="ai-hub-custom-form">
                <p className="field-label">Skill nueva (plantilla de prompt)</p>
                <input
                  type="text"
                  placeholder="Nombre"
                  value={customDraft.name}
                  onChange={(e) => setCustomDraft({ ...customDraft, name: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Resumen de una línea"
                  value={customDraft.summary}
                  onChange={(e) => setCustomDraft({ ...customDraft, summary: e.target.value })}
                />
                <div className="ai-hub-custom-row">
                  <select
                    aria-label="Categoría"
                    value={customDraft.category}
                    onChange={(e) =>
                      setCustomDraft({
                        ...customDraft,
                        category: e.target.value as AiSkill['category'],
                      })
                    }
                  >
                    <option value="guion">Guion</option>
                    <option value="crecimiento">Crecimiento</option>
                    <option value="produccion">Producción</option>
                    <option value="localizacion">Localización</option>
                    <option value="motion">Motion</option>
                  </select>
                  <select
                    aria-label="Destino"
                    value={customDraft.target}
                    onChange={(e) =>
                      setCustomDraft({ ...customDraft, target: e.target.value as ViewId })
                    }
                  >
                    <option value="script">Guion</option>
                    <option value="localization">Localización</option>
                    <option value="thumbnails">Miniaturas</option>
                    <option value="production">Producción</option>
                    <option value="motion">Motion</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Salida esperada"
                    value={customDraft.output}
                    onChange={(e) => setCustomDraft({ ...customDraft, output: e.target.value })}
                  />
                </div>
                <textarea
                  rows={4}
                  placeholder="Instrucciones/prompt que va a componer la app"
                  value={customDraft.prompt}
                  onChange={(e) => setCustomDraft({ ...customDraft, prompt: e.target.value })}
                />
                <div className="ai-hub-custom-row">
                  <button
                    type="button"
                    className="primary"
                    onClick={createCustomSkill}
                    disabled={
                      !customDraft.name.trim() ||
                      !customDraft.summary.trim() ||
                      !customDraft.prompt.trim() ||
                      !customDraft.output.trim()
                    }
                  >
                    Guardar skill
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setCustomForm(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="ai-hub-memory">
            <p className="field-label">Memoria de la IA</p>
            {memory ? (
              <p className="fine-print">
                Director: {memory.runs} corridas · {memory.profiles} perfiles calibrados.
              </p>
            ) : (
              <p className="fine-print">Director: sin memoria todavía.</p>
            )}
            {memoryNotes.length > 0 ? (
              <ul className="ai-hub-memory-list">
                {memoryNotes.map((note) => (
                  <li key={note.id}>
                    <span>{note.text}</span>
                    <button
                      type="button"
                      className="ghost"
                      aria-label={`Olvidar: ${note.text.slice(0, 40)}`}
                      onClick={() => setMemoryNotes(forgetAiMemory(note.id))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="fine-print">
                Sin notas propias. La IA guarda aquí lo que le pidas recordar o lo que
                ella misma decide persistir.
              </p>
            )}
            <div className="ai-hub-memory-add">
              <input
                type="text"
                placeholder="Anotá algo para la IA…"
                value={memoryDraft}
                onChange={(e) => setMemoryDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && memoryDraft.trim()) {
                    setMemoryNotes(addAiMemory(memoryDraft));
                    setMemoryDraft('');
                  }
                }}
              />
              <button
                type="button"
                className="ghost"
                disabled={!memoryDraft.trim()}
                onClick={() => {
                  setMemoryNotes(addAiMemory(memoryDraft));
                  setMemoryDraft('');
                }}
              >
                Guardar
              </button>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void store.service
                  .saveDirectorMemory(emptyDirectorMemory())
                  .then(() => setMemory({ runs: 0, profiles: 0 }))
                  .catch(() => setFeedback('No se pudo reiniciar la memoria del Director.'));
              }}
            >
              Reiniciar memoria del Director
            </button>
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
