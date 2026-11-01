// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { AssistantToolHost } from '../assistant/assistant-tools';
import { executeLiveRequest } from './useLiveMcpBridge';

const emptyHost = {
  project: () => null,
} as unknown as AssistantToolHost;

describe('ejecución de un pedido MCP en vivo', () => {
  it('convierte un throw síncrono en un resultado en vez de esperar el timeout', async () => {
    const outcome = await executeLiveRequest(
      { tool: 'project_inspect', arguments: {} },
      () => emptyHost,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('no hay un proyecto abierto');
  });

  it('rechaza herramientas desconocidas y argumentos inválidos', async () => {
    const unknown = await executeLiveRequest({ tool: 'hack', arguments: {} }, () => emptyHost);
    expect(unknown.ok).toBe(false);
    expect(unknown.summary).toContain('desconocida');

    const invalid = await executeLiveRequest(
      { tool: 'track_object', arguments: { x: 0.5 } },
      () => emptyHost,
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.summary).toContain('argumentos inválidos');
  });

  it('bloquea exportar/renderizar sin el permiso separado', async () => {
    const denied = await executeLiveRequest(
      { tool: 'render_start', arguments: {} },
      () => emptyHost,
    );
    expect(denied.ok).toBe(false);
    expect(denied.summary).toContain('exportación está desactivada');
    const allowed = await executeLiveRequest(
      { tool: 'render_start', arguments: {} },
      () => emptyHost,
      { allowExport: true },
    );
    expect(allowed.summary).not.toContain('exportación está desactivada');
    expect(allowed.summary).toContain('no hay un proyecto abierto');
  });
});
