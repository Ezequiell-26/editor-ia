import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import type {
  McpProbeResult,
  McpServerConfig,
  McpServerInput,
  McpSessionInfo,
  McpToolInfo,
} from '../../services/project-service';
import {
  addAsset,
  addClipFromAsset,
  fpsOf,
  totalFrames,
} from '../../state/project-actions';
import { artifactPaths } from '../../state/flow';
import { FlowQueueCard } from './FlowQueueCard';
import { useProjectStore } from '../../state/project-store';
import type { Asset } from '@editor-ia/project-schema';

interface Draft {
  readonly id?: string;
  readonly name: string;
  readonly command: string;
  readonly argsText: string;
  readonly envText: string;
  readonly workingDir: string;
  readonly enabled: boolean;
}

const FLOW_IMAGE_MODELS = ['Nano Banana 2', 'Nano Banana Pro', 'Imagen 4'];
const FLOW_VIDEO_MODELS = ['Veo 3.1 - Fast', 'Veo 3.1 - Quality', 'Veo 3.1 - Lite', 'Omni Flash'];
const FLOW_IMAGE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const FLOW_VIDEO_RATIOS = ['16:9', '9:16'];
const FLOW_DURATIONS = ['4s', '6s', '8s', '10s'];

const EMPTY_DRAFT: Draft = {
  name: '',
  command: '',
  argsText: '',
  envText: '',
  workingDir: '',
  enabled: true,
};

export function parseArgsLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 32);
}

/** `KEY=value` per line. A bare key or `KEY=` preserves the stored secret. */
export function parseEnvLines(text: string): { key: string; value?: string }[] {
  const values = new Map<string, string | undefined>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    const key = (separator >= 0 ? line.slice(0, separator) : line).trim();
    if (!key) continue;
    const value = separator >= 0 ? line.slice(separator + 1).trim() : undefined;
    values.set(key, value ? value : undefined);
  }
  return [...values.entries()].slice(0, 24).map(([key, value]) =>
    value === undefined ? { key } : { key, value },
  );
}

/**
 * Ejemplo de argumentos a partir del esquema de la herramienta.
 *
 * Sólo se completan los campos obligatorios: mandar los opcionales con valores
 * vacíos hace que el servidor rechace la llamada (por ejemplo `button: ""`
 * cuando el enum es `left|right|middle`). Si un campo tiene `enum` o `default`,
 * se usa ese valor; así el ejemplo es ejecutable de entrada.
 */
export function exampleFromSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return {};
  const root = schema as { properties?: unknown; required?: unknown };
  const properties = root.properties;
  if (!properties || typeof properties !== 'object') return {};
  const required = Array.isArray(root.required)
    ? root.required.filter((name): name is string => typeof name === 'string')
    : null;
  const example: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(properties)) {
    if (required && !required.includes(name)) continue;
    const field =
      definition && typeof definition === 'object'
        ? (definition as { type?: unknown; enum?: unknown; default?: unknown })
        : {};
    if (Array.isArray(field.enum) && field.enum.length > 0) {
      example[name] = field.enum[0];
      continue;
    }
    if (field.default !== undefined) {
      example[name] = field.default;
      continue;
    }
    example[name] =
      field.type === 'number' || field.type === 'integer'
        ? 0
        : field.type === 'boolean'
          ? false
          : field.type === 'array'
            ? []
            : field.type === 'object'
              ? {}
              : '';
  }
  return example;
}

function draftFrom(server: McpServerConfig): Draft {
  return {
    id: server.id,
    name: server.name,
    command: server.command,
    argsText: server.args.join('\n'),
    envText: server.envKeys.map((key) => `${key}=`).join('\n'),
    workingDir: server.workingDir ?? '',
    enabled: server.enabled,
  };
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** “hace 3 min” para el estado de la sesión. */
function idleLabel(idleMs: number): string {
  if (!Number.isFinite(idleMs) || idleMs < 0) return 'un rato';
  const seconds = Math.round(idleMs / 1000);
  if (seconds < 10) return 'instantes';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/** MCP tools may return structured JSON as content[].text. */
function toolPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.structuredContent) return record.structuredContent;
  const content = record.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === 'object') {
        const text = (item as { text?: unknown }).text;
        if (typeof text === 'string') {
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        }
      }
    }
  }
  return value;
}

export { artifactPaths } from '../../state/flow';

export function McpView() {
  const store = useProjectStore();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, McpProbeResult>>({});
  const [sessions, setSessions] = useState<readonly McpSessionInfo[]>([]);
  const [toolName, setToolName] = useState('');
  const [toolArgs, setToolArgs] = useState('{}');
  const [toolResult, setToolResult] = useState<{
    readonly text: string;
    readonly isError: boolean;
    readonly elapsedMs: number;
  } | null>(null);
  const [flowKind, setFlowKind] = useState<'image' | 'video'>('image');
  const [flowPrompt, setFlowPrompt] = useState('');
  const [flowModel, setFlowModel] = useState('Nano Banana 2');
  const [flowRatio, setFlowRatio] = useState('16:9');
  const [flowDuration, setFlowDuration] = useState('6s');
  const [flowCredits, setFlowCredits] = useState(false);
  const [flowRights, setFlowRights] = useState(false);
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [flowPayload, setFlowPayload] = useState<unknown>(null);
  const [flowPaths, setFlowPaths] = useState<string[]>([]);
  const [flowImporting, setFlowImporting] = useState(false);

  const refresh = useCallback(async () => {
    if (!store.service.available) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await store.service.listMcpServers();
      setServers(list);
      setSelectedId((current) =>
        current && list.some((server) => server.id === current) ? current : (list[0]?.id ?? null),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudieron leer los servidores MCP');
    } finally {
      setLoading(false);
    }
  }, [store.service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Las sesiones viven en el backend, no en este componente: se consultan al
   * entrar y después de cada llamada. Si el servicio no está disponible (modo
   * navegador) la lista queda vacía sin romper la vista.
   */
  const refreshSessions = useCallback(async () => {
    if (!store.service.available) {
      setSessions([]);
      return;
    }
    try {
      setSessions(await store.service.mcpSessionStatus());
    } catch {
      setSessions([]);
    }
  }, [store.service]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const selected = servers.find((server) => server.id === selectedId) ?? null;
  const session = sessions.find((item) => item.serverId === selectedId) ?? null;
  const probe = selectedId ? probes[selectedId] : undefined;
  const tool: McpToolInfo | undefined = useMemo(
    () => probe?.tools.find((item) => item.name === toolName) ?? probe?.tools[0],
    [probe, toolName],
  );
  const flowImageTool = probe?.tools.find((item) => item.name === 'flow_generate_image');
  const flowVideoTool = probe?.tools.find((item) => item.name === 'flow_generate_video');
  const flowTool = flowKind === 'video' ? flowVideoTool : flowImageTool;
  const isFlowServer = Boolean(flowImageTool || flowVideoTool);
  const project = store.state.project;
  const opened = store.state.opened;
  const flowOutputDir = opened ? store.service.joinPath(opened.root, 'media') : '';

  function newServer(): void {
    setDraft(EMPTY_DRAFT);
    setFormError(null);
  }

  async function save(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    setFormError(null);
    try {
      const input: McpServerInput = {
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        command: draft.command,
        args: parseArgsLines(draft.argsText),
        env: parseEnvLines(draft.envText),
        ...(draft.workingDir.trim() ? { workingDir: draft.workingDir.trim() } : {}),
        enabled: draft.enabled,
      };
      const saved = await store.service.saveMcpServer(input);
      setServers((current) => {
        const index = current.findIndex((server) => server.id === saved.id);
        if (index < 0) return [...current, saved];
        const next = [...current];
        next[index] = saved;
        return next;
      });
      setSelectedId(saved.id);
      setDraft(null);
      store.setNotice(`Servidor MCP “${saved.name}” guardado.`);
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'no se pudo guardar el servidor MCP');
    } finally {
      setSaving(false);
      // Guardar reinicia la sesión: el comando o el entorno pueden haber
      // cambiado y el proceso viejo ya no representa esta configuración.
      void refreshSessions();
    }
  }

  async function probeServer(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      const result = await store.service.probeMcpServer(id);
      setProbes((current) => ({ ...current, [id]: result }));
      setSelectedId(id);
      setToolName(result.tools[0]?.name ?? '');
      setToolArgs(pretty(exampleFromSchema(result.tools[0]?.inputSchema)));
      setToolResult(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'la prueba MCP falló');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await store.service.deleteMcpServer(id);
      setServers((current) => current.filter((server) => server.id !== id));
      setProbes((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setDeletingId(null);
      setSelectedId((current) => (current === id ? null : current));
      store.setNotice('Servidor MCP eliminado junto con sus variables guardadas.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo eliminar el servidor MCP');
    } finally {
      setBusyId(null);
      void refreshSessions();
    }
  }

  async function runTool(): Promise<void> {
    if (!selected || !tool) return;
    let args: unknown;
    try {
      args = JSON.parse(toolArgs || '{}');
    } catch {
      setToolResult({ text: 'Los argumentos no son JSON válido.', isError: true, elapsedMs: 0 });
      return;
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      setToolResult({ text: 'Los argumentos deben ser un objeto JSON.', isError: true, elapsedMs: 0 });
      return;
    }
    setBusyId(selected.id);
    setToolResult(null);
    try {
      const result = await store.service.callMcpTool(selected.id, tool.name, args);
      setToolResult({ text: pretty(result.result), isError: result.isError, elapsedMs: result.elapsedMs });
    } catch (failure) {
      setToolResult({
        text: failure instanceof Error ? failure.message : 'la herramienta MCP falló',
        isError: true,
        elapsedMs: 0,
      });
    } finally {
      setBusyId(null);
      // La primera llamada abre la sesión y el error la cierra: en los dos
      // casos el estado que muestra la UI cambió.
      void refreshSessions();
    }
  }

  async function closeSession(): Promise<void> {
    if (!selected) return;
    setBusyId(selected.id);
    try {
      const closed = await store.service.closeMcpSession(selected.id);
      store.setNotice(
        closed
          ? `Sesión MCP de “${selected.name}” cerrada; su proceso y su navegador se terminaron.`
          : `“${selected.name}” no tenía una sesión abierta.`,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo cerrar la sesión MCP');
    } finally {
      setBusyId(null);
      void refreshSessions();
    }
  }

  async function connectFlow(): Promise<void> {
    if (!selected) return;
    const connectTool = probe?.tools.find((item) => item.name === 'flow_connect');
    if (!connectTool) {
      setFlowError('El servidor no expone flow_connect.');
      return;
    }
    setFlowBusy(true);
    setFlowError(null);
    try {
      const result = await store.service.callMcpTool(selected.id, connectTool.name, {
        headless: false,
      });
      if (result.isError) {
        setFlowError('No se pudo abrir Chrome para Flow. Revisá el puerto 9333.');
      } else {
        store.setNotice(
          'Chrome de Flow abierto. Iniciá sesión manualmente y abrí el proyecto; después generá.',
        );
      }
    } catch (failure) {
      setFlowError(failure instanceof Error ? failure.message : 'no se pudo abrir Chrome para Flow');
    } finally {
      setFlowBusy(false);
    }
  }

  async function generateWithFlow(): Promise<void> {
    if (!selected || !flowTool || !opened) {
      setFlowError('Abrí un proyecto y probá el servidor Google Flow primero.');
      return;
    }
    if (!flowPrompt.trim()) {
      setFlowError('Escribí un prompt para Flow.');
      return;
    }
    if (!flowCredits) {
      setFlowError('Marcá que autorizás el consumo de créditos de Flow.');
      return;
    }
    setFlowBusy(true);
    setFlowError(null);
    setFlowPayload(null);
    setFlowPaths([]);
    try {
      const connectTool = probe?.tools.find((item) => item.name === 'flow_connect');
      if (connectTool) {
        const connection = await store.service.callMcpTool(selected.id, connectTool.name, {
          headless: false,
        });
        if (connection.isError) {
          setFlowError('No se pudo conectar Chrome con Flow. Revisá la sesión y el puerto 9333.');
          return;
        }
      }
      const args: Record<string, unknown> = {
        prompt: flowPrompt.trim(),
        model: flowModel,
        ratio: flowRatio,
        auto_confirm: true,
        output_folder: flowOutputDir,
        response_format: 'detailed',
      };
      if (flowKind === 'video') args.duration = flowDuration;
      const result = await store.service.callMcpTool(selected.id, flowTool.name, args);
      const payload = toolPayload(result.result);
      setFlowPayload(payload);
      const paths = artifactPaths(result.result);
      setFlowPaths(paths);
      if (result.isError) {
        setFlowError('Flow devolvió un error. Revisá el detalle y la sesión de Chrome.');
      } else if (paths.length === 0) {
        setFlowError(
          'Flow respondió pero no devolvió rutas de artefactos. Abrí el detalle para revisar el resultado.',
        );
      } else {
        store.setNotice(`Flow generó ${paths.length} archivo(s). Confirmá derechos para importarlos.`);
      }
    } catch (failure) {
      setFlowError(failure instanceof Error ? failure.message : 'la generación con Flow falló');
    } finally {
      setFlowBusy(false);
    }
  }

  async function importFlowArtifacts(mount: boolean): Promise<void> {
    if (!project || !opened || flowPaths.length === 0) return;
    if (!flowRights) {
      setFlowError('Confirmá que tenés derechos para usar los archivos generados.');
      return;
    }
    setFlowImporting(true);
    setFlowError(null);
    try {
      const outcome = await store.service.importMediaPaths({
        paths: flowPaths,
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: flowKind === 'video' ? 'google-flow-video' : 'google-flow-image',
      });
      if (outcome.assets.length > 0) {
        store.update((current) => {
          let next = current;
          for (const asset of outcome.assets as Asset[]) {
            next = addAsset(next, asset);
          }
          if (mount) {
            const fps = fpsOf(next);
            let at = totalFrames(next);
            for (const asset of outcome.assets as Asset[]) {
              const duration =
                'media' in asset && asset.media && 'durationFrames' in asset.media
                  ? asset.media.durationFrames
                  : Math.round(5 * fps);
              const added = addClipFromAsset(next, asset, {
                atFrame: at,
                durationFrames: duration,
              });
              next = added.project;
              at = totalFrames(next);
            }
          }
          return next;
        });
        store.setNotice(
          mount
            ? `${outcome.assets.length} artefacto(s) importados y montados en la timeline.`
            : `${outcome.assets.length} artefacto(s) importados a Medios.`,
        );
        setFlowPaths([]);
        setFlowPayload(null);
      }
      if (outcome.warnings.length > 0) {
        setFlowError(outcome.warnings.join(' · '));
      }
    } catch (failure) {
      setFlowError(failure instanceof Error ? failure.message : 'no se pudieron importar los artefactos');
    } finally {
      setFlowImporting(false);
    }
  }

  return (
    <section className="view mcp-view">
      <ViewToolbar
        label="Servidores MCP"
        actions={
          <>
            <button type="button" className="ghost icon-text" onClick={() => void refresh()} disabled={loading}>
              <Icon name="refresh" size={15} />
              <span>{loading ? 'Leyendo…' : 'Recargar'}</span>
            </button>
            <button type="button" className="primary icon-text" onClick={newServer}>
              <Icon name="plus" size={15} />
              <span>Agregar servidor</span>
            </button>
          </>
        }
      >
        <span className="view-count">{servers.length} servidores</span>
      </ViewToolbar>

      {!store.service.available ? (
        <p className="notice notice-warning">{store.service.unavailableReason}</p>
      ) : null}
      {error ? (
        <div className="banner banner-error mcp-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="link" onClick={() => setError(null)}>
            Cerrar
          </button>
        </div>
      ) : null}

      <div className="mcp-layout">
        <div className="mcp-list">
          {servers.length === 0 && !loading ? (
            <div className="mcp-empty">
              <Icon name="plug" size={26} />
              <strong>Sin servidores MCP</strong>
              <p>
                Agregá un servidor como <code>npx -y @modelcontextprotocol/server-everything</code>{' '}
                para inspeccionar sus herramientas desde acá.
              </p>
              <button type="button" className="primary" onClick={newServer}>
                Agregar el primero
              </button>
            </div>
          ) : null}
          {servers.map((server) => {
            const result = probes[server.id];
            return (
              <article
                key={server.id}
                className={`mcp-card${server.id === selectedId ? ' selected' : ''}`}
              >
                <button
                  type="button"
                  className="mcp-card-main"
                  onClick={() => {
                    setSelectedId(server.id);
                    setToolName('');
                    setToolResult(null);
                  }}
                >
                  <span className={`mcp-status ${server.enabled ? 'on' : 'off'}`} aria-hidden="true" />
                  <span className="mcp-card-copy">
                    <strong>{server.name}</strong>
                    <code>{[server.command, ...server.args].join(' ')}</code>
                    <span className="mcp-card-meta">
                      {server.enabled ? 'Activo' : 'Desactivado'}
                      {server.envKeys.length > 0 ? ` · ${server.envKeys.length} variable(s)` : ''}
                      {result ? ` · ${result.tools.length} herramienta(s)` : ''}
                    </span>
                  </span>
                </button>
                <div className="mcp-card-actions">
                  <button
                    type="button"
                    className="icon-button"
                    data-tooltip="Probar conexión y listar herramientas"
                    aria-label={`Probar ${server.name}`}
                    onClick={() => void probeServer(server.id)}
                    disabled={busyId !== null || !server.enabled}
                  >
                    <Icon name="refresh" size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    data-tooltip="Editar servidor"
                    aria-label={`Editar ${server.name}`}
                    onClick={() => {
                      setDraft(draftFrom(server));
                      setFormError(null);
                    }}
                  >
                    <Icon name="settings" size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    data-tooltip="Eliminar servidor"
                    aria-label={`Eliminar ${server.name}`}
                    onClick={() => setDeletingId(server.id)}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
                {deletingId === server.id ? (
                  <div className="mcp-confirm" role="alert">
                    <span>¿Eliminar “{server.name}” y sus variables?</span>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void remove(server.id)}
                      disabled={busyId !== null}
                    >
                      Eliminar
                    </button>
                    <button type="button" onClick={() => setDeletingId(null)}>
                      Cancelar
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}

          {draft ? (
            <form
              className="mcp-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <p className="eyebrow">{draft.id ? 'Editar servidor' : 'Nuevo servidor'}</p>
              <div className="form-grid">
                <label className="field">
                  <span>Nombre</span>
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    placeholder="Búsqueda web"
                    autoFocus
                  />
                </label>
                <label className="field">
                  <span>Comando</span>
                  <input
                    value={draft.command}
                    onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                    placeholder="npx"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="field wide">
                  <span>Argumentos · uno por línea</span>
                  <textarea
                    value={draft.argsText}
                    onChange={(event) => setDraft({ ...draft, argsText: event.target.value })}
                    placeholder={'-y\n@modelcontextprotocol/server-everything'}
                    rows={3}
                    spellCheck={false}
                  />
                </label>
                <label className="field wide">
                  <span>Variables de entorno · KEY=valor</span>
                  <textarea
                    value={draft.envText}
                    onChange={(event) => setDraft({ ...draft, envText: event.target.value })}
                    placeholder={'API_KEY=\nLOG_LEVEL=info'}
                    rows={3}
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>Carpeta de trabajo · opcional</span>
                  <input
                    value={draft.workingDir}
                    onChange={(event) => setDraft({ ...draft, workingDir: event.target.value })}
                    placeholder="D:\\mcp\\mi-servidor"
                    spellCheck={false}
                  />
                </label>
                <label className="check mcp-check">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                  />
                  Servidor activo
                </label>
              </div>
              {formError ? (
                <p className="notice notice-warning" role="alert">
                  {formError}
                </p>
              ) : null}
              <p className="fine-print">
                Dejá <code>KEY=</code> vacío para conservar un valor ya guardado. Los valores nunca
                se escriben en el JSON de configuración ni en el proyecto.
              </p>
              <div className="actions">
                <button type="submit" className="primary" disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar servidor'}
                </button>
                <button type="button" onClick={() => setDraft(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : null}
        </div>

        <aside className="mcp-detail">
          {!selected ? (
            <div className="mcp-detail-empty">
              <Icon name="plug" size={22} />
              <p>Elegí un servidor para ver sus herramientas.</p>
            </div>
          ) : (
            <>
              <header className="mcp-detail-head">
                <div>
                  <h3>{selected.name}</h3>
                  <code>{[selected.command, ...selected.args].join(' ')}</code>
                </div>
                <button
                  type="button"
                  className="primary icon-text"
                  onClick={() => void probeServer(selected.id)}
                  disabled={busyId !== null || !selected.enabled}
                >
                  <Icon name="plug" size={15} />
                  <span>{busyId === selected.id ? 'Probando…' : 'Probar'}</span>
                </button>
              </header>

              {selected.envKeys.length > 0 ? (
                <div className="mcp-env">
                  <span>Variables guardadas</span>
                  <div>
                    {selected.envKeys.map((key) => (
                      <code key={key}>{key}</code>
                    ))}
                  </div>
                </div>
              ) : null}

              {isFlowServer ? (
                <div className="flow-panel">
                  <div className="flow-panel-head">
                    <div>
                      <p className="eyebrow">Google Flow</p>
                      <strong>Generar fotos o videos con tu cuenta</strong>
                    </div>
                    <span className="flow-badge">MCP</span>
                  </div>
                  {!opened ? (
                    <p className="notice notice-warning">
                      Abrí un proyecto para que la salida se guarde en su carpeta media y se pueda
                      importar.
                    </p>
                  ) : null}
                  <div className="flow-kind-row" role="group" aria-label="Tipo de generación">
                    <button
                      type="button"
                      className={flowKind === 'image' ? 'active' : ''}
                      onClick={() => {
                        setFlowKind('image');
                        setFlowModel('Nano Banana 2');
                        setFlowRatio('16:9');
                        setFlowPaths([]);
                        setFlowPayload(null);
                      }}
                    >
                      Foto
                    </button>
                    <button
                      type="button"
                      className={flowKind === 'video' ? 'active' : ''}
                      onClick={() => {
                        setFlowKind('video');
                        setFlowModel('Veo 3.1 - Fast');
                        setFlowRatio('16:9');
                        setFlowPaths([]);
                        setFlowPayload(null);
                      }}
                    >
                      Video
                    </button>
                  </div>
                  <label className="field">
                    <span>Prompt para Flow</span>
                    <textarea
                      value={flowPrompt}
                      onChange={(event) => setFlowPrompt(event.target.value)}
                      rows={4}
                      placeholder="Un faro azul en un acantilado, ilustración plana, sin texto…"
                      maxLength={4_000}
                    />
                  </label>
                  <div className="form-grid flow-fields">
                    <label className="field">
                      <span>Modelo</span>
                      <select
                        value={flowModel}
                        onChange={(event) => setFlowModel(event.target.value)}
                      >
                        {(flowKind === 'video' ? FLOW_VIDEO_MODELS : FLOW_IMAGE_MODELS).map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Aspecto</span>
                      <select
                        value={flowRatio}
                        onChange={(event) => setFlowRatio(event.target.value)}
                      >
                        {(flowKind === 'video' ? FLOW_VIDEO_RATIOS : FLOW_IMAGE_RATIOS).map((ratio) => (
                          <option key={ratio} value={ratio}>
                            {ratio}
                          </option>
                        ))}
                      </select>
                    </label>
                    {flowKind === 'video' ? (
                      <label className="field">
                        <span>Duración</span>
                        <select
                          value={flowDuration}
                          onChange={(event) => setFlowDuration(event.target.value)}
                        >
                          {FLOW_DURATIONS.map((duration) => (
                            <option key={duration} value={duration}>
                              {duration}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  <p className="fine-print">
                    Salida: <code>{flowOutputDir || 'abrí un proyecto'}</code>. El conector usa el
                    perfil dedicado de Chrome en el puerto 9333; si Flow pide login, iniciá sesión
                    manualmente en esa ventana y volvé al proyecto.
                  </p>
                  <label className="check flow-credit">
                    <input
                      type="checkbox"
                      checked={flowCredits}
                      onChange={(event) => setFlowCredits(event.target.checked)}
                    />
                    <span>
                      Autorizo consumir créditos de Flow. El importe no lo puede calcular Olyvia.
                    </span>
                  </label>
                  <div className="actions">
                    <button
                      type="button"
                      className="ghost icon-text"
                      disabled={flowBusy || flowImporting}
                      onClick={() => void connectFlow()}
                    >
                      <Icon name="external" size={15} />
                      <span>{flowBusy ? 'Conectando…' : 'Abrir Chrome de Flow'}</span>
                    </button>
                    <button
                      type="button"
                      className="primary icon-text"
                      disabled={flowBusy || flowImporting || !opened || !flowTool}
                      onClick={() => void generateWithFlow()}
                    >
                      <Icon name="sparkles" size={15} />
                      <span>
                        {flowBusy
                          ? 'Flow está generando…'
                          : `Generar ${flowKind === 'video' ? 'video' : 'foto'} con Flow`}
                      </span>
                    </button>
                    {flowBusy ? (
                      <span className="fine-print">Un video puede tardar varios minutos.</span>
                    ) : null}
                  </div>
                  {flowError ? <p className="notice notice-warning">{flowError}</p> : null}
                  {flowPaths.length > 0 ? (
                    <div className="flow-artifacts">
                      <p>
                        <strong>{flowPaths.length} archivo(s) generados.</strong> Están en la
                        carpeta media del proyecto; confirmá derechos para registrarlos.
                      </p>
                      <ul>
                        {flowPaths.map((path) => (
                          <li key={path}>
                            <code>{path.split(/[\\/]/).pop()}</code>
                          </li>
                        ))}
                      </ul>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={flowRights}
                          onChange={(event) => setFlowRights(event.target.checked)}
                        />
                        <span>
                          Confirmo que tengo derechos para usar estos archivos generados.
                        </span>
                      </label>
                      <div className="actions">
                        <button
                          type="button"
                          className="primary"
                          disabled={!flowRights || flowImporting}
                          onClick={() => void importFlowArtifacts(false)}
                        >
                          {flowImporting ? 'Importando…' : 'Importar a Medios'}
                        </button>
                        <button
                          type="button"
                          className="accent-outline"
                          disabled={!flowRights || flowImporting}
                          onClick={() => void importFlowArtifacts(true)}
                        >
                          Importar y montar en timeline
                        </button>
                      </div>
                      <details>
                        <summary>Respuesta de Flow</summary>
                        <pre>{pretty(flowPayload)}</pre>
                      </details>
                    </div>
                  ) : null}

                  <FlowQueueCard
                    serverId={selected.id}
                    outputFolder={flowOutputDir}
                  />
                </div>
              ) : null}

              {selected.name === 'Google Flow' && !probe ? (
                <p className="fine-print">
                  Probá el servidor con “Probar” para cargar el generador de Flow.
                </p>
              ) : null}

              {probe ? (
                <div className="mcp-probe">
                  <p className="mcp-probe-meta">
                    {probe.serverName} {probe.serverVersion} · protocolo {probe.protocolVersion} ·{' '}
                    {probe.tools.length} herramienta(s) · {probe.elapsedMs} ms
                  </p>
                  {probe.tools.length === 0 ? (
                    <p className="empty-inline">El servidor no publica herramientas.</p>
                  ) : (
                    <>
                      <div className="mcp-tool-list">
                        {probe.tools.map((item) => (
                          <button
                            key={item.name}
                            type="button"
                            className={item.name === tool?.name ? 'active' : ''}
                            onClick={() => {
                              setToolName(item.name);
                              setToolArgs(pretty(exampleFromSchema(item.inputSchema)));
                              setToolResult(null);
                            }}
                          >
                            <strong>{item.name}</strong>
                            <span>{item.description ?? 'Sin descripción'}</span>
                          </button>
                        ))}
                      </div>
                      {tool ? (
                        <div className="mcp-runner">
                          <label className="field">
                            <span>Argumentos JSON · {tool.name}</span>
                            <textarea
                              className="mcp-json"
                              value={toolArgs}
                              onChange={(event) => setToolArgs(event.target.value)}
                              rows={7}
                              spellCheck={false}
                            />
                          </label>
                          <div className="actions">
                            <button
                              type="button"
                              className="primary icon-text"
                              onClick={() => void runTool()}
                              disabled={busyId !== null}
                            >
                              <Icon name="play" size={14} />
                              <span>{busyId === selected.id ? 'Ejecutando…' : 'Ejecutar herramienta'}</span>
                            </button>
                            {session ? (
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => void closeSession()}
                                disabled={busyId !== null}
                                title="Cierra el proceso del servidor y el navegador que tenga abierto"
                              >
                                Cerrar sesión
                              </button>
                            ) : null}
                          </div>
                          {session ? (
                            <p className="mcp-session" role="status">
                              <span className="mcp-session-dot" aria-hidden="true" />
                              Sesión activa · {session.calls} llamada
                              {session.calls === 1 ? '' : 's'} · pid {session.pid} · inactiva hace{' '}
                              {idleLabel(session.idleMs)}. El estado del servidor —por ejemplo la
                              página abierta— se conserva entre llamadas.
                            </p>
                          ) : (
                            <p className="mcp-session muted">
                              Sin sesión abierta. La primera herramienta la inicia y el estado se
                              mantiene hasta que la cierres o pasen 10 minutos sin uso.
                            </p>
                          )}
                          {toolResult ? (
                            <div
                              className={`mcp-result${toolResult.isError ? ' error' : ''}`}
                              role="status"
                            >
                              <div>
                                <span>{toolResult.isError ? 'Error del servidor' : 'Resultado'}</span>
                                <span>{toolResult.elapsedMs} ms</span>
                              </div>
                              <pre>{toolResult.text}</pre>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <details className="mcp-schema">
                        <summary>Esquema de {tool?.name ?? 'la herramienta'}</summary>
                        <pre>{pretty(tool?.inputSchema)}</pre>
                      </details>
                    </>
                  )}
                </div>
              ) : (
                <p className="empty-inline mcp-detail-hint">
                  Todavía no se probó este servidor. “Probar” inicia el proceso, hace el handshake
                  MCP y pide <code>tools/list</code>.
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
