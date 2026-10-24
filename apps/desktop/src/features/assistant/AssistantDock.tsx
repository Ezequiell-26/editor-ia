import { useEffect, useRef, useState } from 'react';
import { NAV_VIEWS, type ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import {
  isLocalProviderUrl,
  type AssistantAction,
  type ProviderInfo,
} from '../../services/project-service';
import { addMotionGraphic, fpsOf } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import {
  OPERATOR_HELP,
  parseOperatorCommand,
  type OperatorAction,
} from '../ai-hub/operator';
import { PetCompanion, type PetMood } from './PetCompanion';

interface ChatEntry {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

const GREETING: ChatEntry = {
  role: 'assistant',
  text:
    'Hola, soy Olyvia. Puedo controlar la app, resumir el proyecto o crear un gráfico. Probá «abrir editor» o «estado».',
};

function motionProps(
  templateId: string,
  text: string,
  secondary?: string,
): Record<string, unknown> | null {
  if (templateId === 'title-card') {
    return {
      title: text,
      subtitle: secondary ?? '',
      background: '#0f172a',
      accent: '#35d6ff',
      align: 'left',
      animation: 'slide-up',
    };
  }
  if (templateId === 'lower-third') {
    return {
      name: text,
      role: secondary ?? '',
      accent: '#35d6ff',
      side: 'left',
      animation: 'slide-left',
    };
  }
  if (templateId === 'end-card') {
    return {
      title: text,
      cta: secondary ?? '',
      background: '#0f172a',
      accent: '#35d6ff',
      animation: 'fade',
    };
  }
  if (templateId === 'stat-callout') {
    return {
      value: text,
      label: secondary || 'dato',
      accent: '#35d6ff',
      animation: 'pop',
    };
  }
  return null;
}

export function AssistantDock({
  activeId,
  onSelect,
}: {
  readonly activeId: ViewId;
  readonly onSelect: (view: ViewId) => void;
}) {
  const store = useProjectStore();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<readonly ChatEntry[]>([GREETING]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [consent, setConsent] = useState(false);
  const [listening, setListening] = useState(false);
  const [replying, setReplying] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const replyTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
    },
    [],
  );

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

  useEffect(() => {
    if (!open) return;
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, open, busy]);

  const needsConsent =
    provider !== null &&
    provider.kind !== 'mock' &&
    provider.baseUrl.length > 0 &&
    !isLocalProviderUrl(provider.baseUrl);

  const mood: PetMood = busy
    ? 'thinking'
    : replying
      ? 'replying'
      : listening
        ? 'listening'
        : 'awake';

  function flashReply(): void {
    setReplying(true);
    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
    replyTimerRef.current = window.setTimeout(() => setReplying(false), 2400);
  }

  function toggleOpen(): void {
    if (open) {
      setOpen(false);
      setListening(false);
      setReplying(false);
    } else {
      setOpen(true);
    }
  }

  function append(entry: ChatEntry): void {
    setMessages((current) => [...current, entry].slice(-24));
  }

  function navigate(view: string, label?: string): string {
    const target = NAV_VIEWS.find((item) => item.id === view);
    if (!target) return 'No conozco esa vista.';
    onSelect(target.id);
    return `Abriendo ${label ?? target.label}.`;
  }

  async function executeOperator(action: Exclude<OperatorAction, { kind: 'unknown' }>): Promise<string> {
    switch (action.kind) {
      case 'navigate':
        return navigate(action.view, action.label);
      case 'play':
        store.setPlaying(true);
        return 'Reproduciendo.';
      case 'pause':
        store.setPlaying(false);
        return 'Pausado.';
      case 'undo':
        store.undo();
        return 'Deshice el último cambio.';
      case 'redo':
        store.redo();
        return 'Rehice el cambio.';
      case 'save':
        return (await store.saveNow()) ? 'Proyecto guardado.' : 'No hay un proyecto abierto para guardar.';
      case 'export':
        if (activeId !== 'editor') onSelect('editor');
        store.requestExport();
        return 'Abrí el diálogo de exportación.';
      case 'status': {
        const project = store.state.project;
        if (!project) return 'No hay un proyecto abierto.';
        return `${project.name}: ${project.timeline.clips.length} clip(s), playhead ${store.state.playheadFrame}, ${fpsOf(project).toFixed(0)} fps.`;
      }
      case 'create':
        window.localStorage.setItem('editoria.factory.brief', action.topic);
        onSelect('factory');
        return `Brief «${action.topic}» enviado a Fábrica.`;
      case 'help':
        return OPERATOR_HELP;
      case 'motion': {
        const project = store.state.project;
        if (!project) return 'Abrí o creá un proyecto para agregar un gráfico.';
        const props = motionProps(action.templateId, action.text, action.secondary);
        if (!props) return 'La plantilla de motion no es válida.';
        let clipId: string | null = null;
        const ok = store.mutate(
          (current) => {
            const added = addMotionGraphic(current, {
              templateId: action.templateId,
              templateVersion: '1.0.0',
              props,
              durationFrames: Math.max(1, Math.round(fpsOf(current) * 3)),
              atFrame: store.state.playheadFrame,
              label: action.text.slice(0, 80),
            });
            clipId = added.clipId;
            return { project: added.project };
          },
          { notice: `Gráfico agregado: ${action.text}.` },
        );
        if (!ok || !clipId) return 'El gráfico no deja el proyecto en un estado válido.';
        store.setSelection({ kind: 'clip', id: clipId });
        onSelect('editor');
        return `Gráfico agregado: ${action.text}.`;
      }
    }
  }

  async function runAssistantAction(action: AssistantAction): Promise<void> {
    if (action.kind === 'navigate') {
      navigate(action.view);
      return;
    }
    if (action.kind === 'play' || action.kind === 'pause') {
      store.setPlaying(action.kind === 'play');
      return;
    }
    if (action.kind === 'undo') {
      store.undo();
      return;
    }
    if (action.kind === 'redo') {
      store.redo();
      return;
    }
    if (action.kind === 'save') {
      await store.saveNow();
      return;
    }
    if (action.kind === 'export') {
      if (activeId !== 'editor') onSelect('editor');
      store.requestExport();
      return;
    }
    if (action.kind === 'status') {
      return;
    }
    if (action.kind === 'motion') {
      const project = store.state.project;
      if (!project) return;
      const props = motionProps(action.templateId, action.text, action.secondary);
      if (!props) return;
      let clipId: string | null = null;
      const ok = store.mutate((current) => {
        const added = addMotionGraphic(current, {
          templateId: action.templateId,
          templateVersion: '1.0.0',
          props,
          durationFrames: Math.max(1, Math.round(fpsOf(current) * 3)),
          atFrame: store.state.playheadFrame,
          label: action.text.slice(0, 80),
        });
        clipId = added.clipId;
        return { project: added.project };
      });
      if (ok && clipId) {
        store.setSelection({ kind: 'clip', id: clipId });
        onSelect('editor');
      }
    }
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || busy) return;
    if (needsConsent && !consent) {
      setError('Marcá “Permitir llamada remota” para usar el proveedor configurado.');
      return;
    }
    setInput('');
    setError(null);
    append({ role: 'user', text });

    const local = parseOperatorCommand(text, NAV_VIEWS);
    if (local.kind !== 'unknown') {
      const reply = await executeOperator(local);
      append({ role: 'assistant', text: reply });
      flashReply();
      return;
    }

    setBusy(true);
    try {
      const context = store.state.project
        ? {
            projectName: store.state.project.name,
            clips: store.state.project.timeline.clips.length,
            playheadFrame: store.state.playheadFrame,
            fps: Number(fpsOf(store.state.project).toFixed(2)),
            view: activeId,
          }
        : { view: activeId };
      const history = [...messages, { role: 'user' as const, text }]
        .filter((entry) => entry.text !== GREETING.text)
        .slice(-12)
        .map((entry) => ({ role: entry.role, content: entry.text }));
      const result = await store.service.assistantChat({
        messages: history,
        context,
        approvedCost: consent,
      });
      if (result.action) await runAssistantAction(result.action);
      append({ role: 'assistant', text: result.reply });
      flashReply();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no se pudo contactar al asistente');
    } finally {
      setBusy(false);
    }
  }

  function quick(text: string): void {
    setInput(text);
    setError(null);
  }

  return (
    <>
      {open ? (
        <section
          id="olyvia-assistant-panel"
          className="assistant-panel"
          role="dialog"
          aria-label="Asistente Olyvia"
        >
          <header className="assistant-head">
            <div className="assistant-identity">
              <PetCompanion mood={mood} />
              <div>
                <strong>Olyvia Assistant</strong>
                <span>
                  {provider
                    ? provider.kind === 'mock'
                      ? 'Modo simulado · sin red'
                      : `${provider.model || 'Proveedor'} · ${provider.baseUrl}`
                    : 'Proveedor no consultado'}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Cerrar asistente"
              onClick={toggleOpen}
            >
              <Icon name="close" size={15} />
            </button>
          </header>

          <div className="assistant-log" role="log" aria-live="polite" ref={logRef}>
            {messages.map((entry, index) => (
              <p key={`${entry.role}-${index}`} className={`assistant-message ${entry.role}`}>
                {entry.text}
              </p>
            ))}
            {busy ? <p className="assistant-message assistant">Pensando…</p> : null}
          </div>

          {error ? (
            <p className="assistant-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="assistant-quick" role="group" aria-label="Acciones rápidas">
            <button type="button" onClick={() => quick('abrir editor')}>Editor</button>
            <button type="button" onClick={() => quick('estado')}>Estado</button>
            <button type="button" onClick={() => quick('guardar')}>Guardar</button>
            <button type="button" onClick={() => quick('exportar')}>Exportar</button>
          </div>

          {needsConsent ? (
            <label className="assistant-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>Permitir llamada remota (puede consumir cuota)</span>
            </label>
          ) : null}

          <form
            className="assistant-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              maxLength={800}
              autoFocus
              aria-label="Mensaje para Olyvia"
              placeholder="Pedile algo a Olyvia…"
              onFocus={() => setListening(true)}
              onBlur={() => setListening(false)}
            />
            <button type="submit" className="primary" aria-label="Enviar mensaje" disabled={busy || !input.trim()}>
              <Icon name="send" size={15} />
            </button>
          </form>

          <footer className="assistant-foot">
            <button type="button" className="link" onClick={() => onSelect('settings')}>
              Configurar proveedor
            </button>
            <span>Atajos locales sin tokens</span>
          </footer>
        </section>
      ) : null}

      <button
        type="button"
        className="assistant-launcher"
        aria-label={open ? 'Cerrar asistente Olyvia' : 'Abrir asistente Olyvia'}
        aria-expanded={open}
        aria-controls="olyvia-assistant-panel"
        title="Olyvia Assistant"
        onClick={toggleOpen}
      >
        <Icon name={open ? 'close' : 'chat'} size={20} />
      </button>
    </>
  );
}
