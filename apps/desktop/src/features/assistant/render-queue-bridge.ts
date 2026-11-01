/**
 * Puente entre las herramientas del agente y la cola de render viva.
 *
 * La cola corre en la UI (necesita el proyecto abierto y el host de render); las
 * herramientas no tienen acceso directo a React, así que el proveedor registra
 * esta API al montarse. Fuera de la app (MCP de archivos) no hay puente y las
 * herramientas fallan con un motivo claro.
 */
import type { RenderQueueAction, RenderQueueFinal, RenderQueueItem } from '../../state/scene-render-queue';

export interface RenderQueueSnapshot {
  readonly paused: boolean;
  readonly runningId: string | null;
  readonly items: readonly RenderQueueItem[];
  readonly finals: readonly RenderQueueFinal[];
}

export interface RenderQueueAddInput {
  readonly sceneIds: readonly string[];
  readonly includeCaptions: boolean;
  readonly concat?: boolean;
}

export interface RenderQueueApi {
  add(input: RenderQueueAddInput): Promise<{ ids: string[]; snapshot: RenderQueueSnapshot }>;
  status(): RenderQueueSnapshot;
  control(action: RenderQueueAction, id?: string): RenderQueueSnapshot;
}

let current: RenderQueueApi | null = null;

export function setRenderQueueApi(api: RenderQueueApi | null): void {
  current = api;
}

export function renderQueueApi(): RenderQueueApi | null {
  return current;
}
