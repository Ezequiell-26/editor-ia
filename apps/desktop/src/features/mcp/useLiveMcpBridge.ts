import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { detectNativeRuntime } from '../../services/project-service';
import type {
  RenderFinishedEvent,
  RenderProgressEvent,
} from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import {
  isMcpLiveEnabled,
  isMcpLiveExportEnabled,
  MCP_LIVE_EVENT,
} from '../../state/mcp-live';
import {
  ASSISTANT_TOOLS,
  findAssistantTool,
  validateToolArguments,
  type ToolOutcome,
} from '../assistant/assistant-tools';
import { createAssistantToolHost } from '../assistant/assistant-host';
import { liveBridgeContext } from './live-bridge-context';

interface LiveRequest {
  readonly requestId: string;
  readonly tool: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}

/**
 * Ejecución pura de un pedido en vivo: valida argumentos y convierte también
 * los throws síncronos de una herramienta en un resultado estructurado (si no,
 * el cliente esperaría hasta el timeout).
 */
export async function executeLiveRequest(
  request: Pick<LiveRequest, 'tool' | 'arguments'>,
  createHost: () => import('../assistant/assistant-tools').AssistantToolHost,
  options: { readonly allowExport?: boolean } = {},
): Promise<ToolOutcome> {
  try {
    const tool = findAssistantTool(request.tool);
    if (!tool) {
      return { ok: false, summary: `herramienta desconocida: ${request.tool}` };
    }
    if (tool.permission === 'export' && options.allowExport !== true) {
      return {
        ok: false,
        summary: 'la exportación está desactivada para MCP en vivo (activala en MCP → Puente en vivo)',
      };
    }
    const args = request.arguments ?? {};
    const errors = validateToolArguments(tool.parameters, args);
    if (errors.length > 0) {
      return { ok: false, summary: `argumentos inválidos: ${errors.join('; ')}` };
    }
    return await tool.execute(args, createHost());
  } catch (error) {
    return {
      ok: false,
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Puente MCP en vivo: escucha los pedidos que llegan por el puente HTTP
 * autenticado y los ejecuta con el mismo host del asistente. Se monta una vez
 * en App, por encima de Start/Shell; los pedidos se serializan para respetar el
 * único escritor del proyecto.
 */
export function useLiveMcpBridge(): void {
  const store = useProjectStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const renderProgressRef = useRef<RenderProgressEvent | null>(null);
  const renderFinishedRef = useRef<RenderFinishedEvent | null>(null);
  const sessionExportRef = useRef(false);
  const lastProgressEmitRef = useRef(0);
  const openedRoot = store.state.opened?.root ?? null;

  useEffect(() => {
    if (!detectNativeRuntime()) return;
    let active = true;
    let unlistenProgress: (() => void) | null = null;
    let unlistenFinished: (() => void) | null = null;
    void store.service
      .onRenderProgress((event) => {
        renderProgressRef.current = event;
        const now = Date.now();
        if (now - lastProgressEmitRef.current < 250) return;
        lastProgressEmitRef.current = now;
        void invoke('mcp_live_emit_event', {
          event: { type: 'render_progress', progress: event },
        }).catch(() => undefined);
      })
      .then((stop) => {
        if (active) unlistenProgress = stop;
        else stop();
      });
    void store.service
      .onRenderFinished((event) => {
        renderFinishedRef.current = event;
        void invoke('mcp_live_emit_event', {
          event: { type: 'render_finished', finished: event },
        }).catch(() => undefined);
      })
      .then((stop) => {
        if (active) unlistenFinished = stop;
        else stop();
      });
    return () => {
      active = false;
      unlistenProgress?.();
      unlistenFinished?.();
    };
  }, [store.service]);

  useEffect(() => {
    if (!detectNativeRuntime() || !openedRoot) return;
    void invoke('mcp_live_set_workspace', { path: openedRoot }).catch(() => undefined);
  }, [openedRoot]);

  useEffect(() => {
    if (!detectNativeRuntime() || typeof window === 'undefined') return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let queue: Promise<void> = Promise.resolve();

    const exportAllowed = () => isMcpLiveExportEnabled() || sessionExportRef.current;

    const liveSchemas = () => {
      const allowExport = exportAllowed();
      return ASSISTANT_TOOLS.filter((tool) => allowExport || tool.permission !== 'export').map(
        (tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
        }),
      );
    };

    async function sync(enabled: boolean): Promise<void> {
      try {
        await invoke<boolean>('mcp_live_set_enabled', { enabled });
        if (enabled) {
          await invoke<number>('mcp_live_register_tools', { tools: liveSchemas() });
        }
      } catch {
        // sin puente nativo (o comando ausente): el control en vivo no opera
      }
    }

    async function bootstrap(): Promise<void> {
      try {
        // El flag `--mcp-export` de la sesión headless viaja en el estado de Rust.
        const status = await invoke<{ enabled?: boolean; export?: boolean }>('mcp_live_status');
        sessionExportRef.current = status?.export === true;
        if (isMcpLiveEnabled()) {
          await sync(true);
          return;
        }
        // Bandera de desarrollo `--mcp-live` o entorno: el backend ya está
        // habilitado; la UI sólo registra los esquemas para que el cliente
        // pueda listarlos y ejecutarlos.
        if (status?.enabled) {
          await invoke<number>('mcp_live_register_tools', { tools: liveSchemas() });
        }
      } catch {
        // sin Tauri o sin puente
      }
    }

    async function execute(request: LiveRequest): Promise<ToolOutcome> {
      const context = liveBridgeContext();
      return executeLiveRequest(request, () =>
        createAssistantToolHost({
          store: storeRef.current,
          view: () => context.view,
          navigate: (view) =>
            context.navigate(view as Parameters<typeof context.navigate>[0]),
          ...(context.enterEditor ? { enterEditor: context.enterEditor } : {}),
          renderEvents: {
            progress: () => renderProgressRef.current,
            finished: () => renderFinishedRef.current,
          },
        }),
        { allowExport: exportAllowed() },
      );
    }

    async function handle(request: LiveRequest): Promise<void> {
      const outcome = await execute(request);
      try {
        await invoke('mcp_live_result', { requestId: request.requestId, outcome });
      } catch {
        // el pedido pudo expirar; la app no debe romperse por eso
      }
    }

    const onToggle = (): void => {
      if (!disposed) void sync(isMcpLiveEnabled());
    };
    window.addEventListener(MCP_LIVE_EVENT, onToggle);

    // El listener se registra antes de publicar herramientas: así el primer
    // tools/call no puede llegar antes de que la UI esté escuchando.
    void listen<LiveRequest>('mcp-live-request', (event) => {
      queue = queue.then(() => handle(event.payload)).catch(() => undefined);
    }).then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      void bootstrap();
    });

    return () => {
      disposed = true;
      window.removeEventListener(MCP_LIVE_EVENT, onToggle);
      unlisten?.();
    };
  }, []);
}
