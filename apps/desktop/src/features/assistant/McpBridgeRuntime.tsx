import { useEffect, useRef } from 'react';
import { executeMcpTool, type McpToolContext } from '../../state/mcp-tools';
import { MCP_READ_ONLY_TOOL_NAMES } from '../../state/mcp-catalog';
import { useProjectStore } from '../../state/project-store';

// El catálogo MCP es la fuente única de clasificación de lecturas/escrituras.
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  '__catalog',
  ...MCP_READ_ONLY_TOOL_NAMES,
]);

/** Receptor MCP global: funciona con la ventana principal oculta en la bandeja. */
export function McpBridgeRuntime() {
  const store = useProjectStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const service = store.service;
  useEffect(() => {
    if (!service.available) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let writeQueue: Promise<void> = Promise.resolve();
    const selectView = (view: string) => {
      window.dispatchEvent(new CustomEvent('olyvia:mcp:navigate', { detail: view }));
    };
    const makeContext = (): McpToolContext => {
      const currentStore = storeRef.current;
      return {
        store: currentStore,
        selectView,
        runCommand: async (command: string): Promise<string> => {
          const normalized = command.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          const run = (tool: string, args: Record<string, unknown> = {}) => executeMcpTool(tool, args, makeContext());
          if (/\b(estado|status)\b/.test(normalized)) return run('app_status');
          if (/\b(resumen|summary)\b/.test(normalized)) return run('project_summary');
          if (/\b(guardar|guarda|save)\b/.test(normalized)) return run('project_save');
          if (/silenc/.test(normalized)) return run('run_automation', { kind: 'cut_silences' });
          if (/paus/.test(normalized)) return run('run_automation', { kind: 'cut_pauses' });
          if (/limpi|cleanup/.test(normalized)) return run('run_automation', { kind: 'auto_cleanup' });
          if (/piloto|export|render|entrega/.test(normalized)) return run('run_automation', { kind: 'auto_pilot' });
          if (/\b(deshacer|undo)\b/.test(normalized)) return run('undo');
          if (/\b(rehacer|redo)\b/.test(normalized)) return run('redo');
          return 'No reconoci ese comando en segundo plano. Usa las herramientas estructuradas project_summary, clip_update, run_automation o export_render.';
        },
      };
    };
    const execute = async (payload: { id: string; tool: string; args: unknown }) => {
      const currentStore = storeRef.current;
      try {
        const reply = await executeMcpTool(payload.tool, payload.args, makeContext());
        await currentStore.service.mcpRespond(payload.id, true, reply);
      } catch (error) {
        await currentStore.service.mcpRespond(payload.id, false, error instanceof Error ? error.message : 'la herramienta fallo');
      }
    };
    void (async () => {
      try {
        // Primero registra el receptor; luego abre el endpoint HTTP MCP.
        unlisten = await service.onMcpCall((payload) => {
          if (disposed) return;
          if (READ_ONLY_TOOLS.has(payload.tool)) {
            void execute(payload);
            return;
          }
          const next = writeQueue.then(() => execute(payload));
          writeQueue = next.then(() => undefined, () => undefined);
        });
        if (disposed) { unlisten(); unlisten = null; return; }
        await service.startMcpServer();
      } catch (error) {
        if (!disposed) storeRef.current.setNotice(error instanceof Error ? 'MCP no disponible: ' + error.message : 'MCP no disponible.');
      }
    })();
    return () => { disposed = true; unlisten?.(); unlisten = null; };
  }, [service]);
  return null;
}
