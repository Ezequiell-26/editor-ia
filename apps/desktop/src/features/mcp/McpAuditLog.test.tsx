// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpAuditTail } from '../../services/project-service';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { McpAuditLog } from './McpAuditLog';

afterEach(() => {
  cleanup();
});

function renderCard(service: ReturnType<typeof createFakeService>) {
  render(
    <ProjectProvider service={service}>
      <McpAuditLog />
    </ProjectProvider>,
  );
}

const SAMPLE_TAIL: McpAuditTail = {
  entries: [
    {
      ts: 1_700_000_000_000,
      tool: 'diagnostics',
      args: {},
      ok: true,
      durationMs: 12,
      result: '{"status":"ok"}',
    },
    {
      ts: 1_700_000_060_000,
      tool: 'clip_delete',
      ok: false,
      denied: 'scope',
      requiredScope: 'write',
      grantedScopes: ['read'],
    },
  ],
  skipped: 2,
  truncated: true,
};

describe('audit log del servidor MCP', () => {
  it('lista las entradas del fake con herramienta, estado y scopes', async () => {
    renderCard(createFakeService());
    expect(await screen.findByText('diagnostics')).toBeTruthy();
    expect(screen.getByText('project_status')).toBeTruthy();
    expect(screen.getByText('clip_delete')).toBeTruthy();
    // El más nuevo (project_status) va primero.
    const rows = document.querySelectorAll('.mcp-audit-row');
    expect(rows[0]?.textContent).toContain('project_status');
    // Rechazo por scope visible con el scope requerido.
    expect(screen.getByText(/requiere «write»/)).toBeTruthy();
    expect(screen.getByText(/concedidos: read/)).toBeTruthy();
  });

  it('muestra skipped y truncated del tail', async () => {
    const service = createFakeService();
    service.mcpAuditTail = async () => SAMPLE_TAIL;
    renderCard(service);
    expect(await screen.findByText('diagnostics')).toBeTruthy();
    expect(screen.getByText(/2 líneas del archivo no se pudieron leer/)).toBeTruthy();
    expect(screen.getByText(/se muestran sólo las últimas 50/)).toBeTruthy();
  });

  it('estado vacío honesto cuando no hay auditoría', async () => {
    const service = createFakeService();
    service.mcpAuditTail = async () => ({ entries: [], skipped: 0, truncated: false });
    renderCard(service);
    expect(await screen.findByText(/Todavía no hay llamadas auditadas/)).toBeTruthy();
  });

  it('distingue error de lectura del audit', async () => {
    const service = createFakeService();
    service.mcpAuditTail = async () => {
      throw new Error('no se pudo leer el audit log del MCP');
    };
    renderCard(service);
    expect(await screen.findByText(/no se pudo leer el audit log del MCP/)).toBeTruthy();
  });

  it('el selector de límite vuelve a pedir la cauda', async () => {
    const service = createFakeService();
    const spy = vi.spyOn(service, 'mcpAuditTail');
    renderCard(service);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(50));

    fireEvent.change(screen.getByLabelText(/Mostrar últimas/i), {
      target: { value: '100' },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(100));
  });

  it('en modo navegador explica que el audit sólo existe en la app', async () => {
    const service = {
      ...createFakeService(),
      available: false,
      unavailableReason: 'Esta es la versión web de evaluación.',
    };
    renderCard(service as ReturnType<typeof createFakeService>);
    expect(await screen.findByText(/sólo existe en la app de escritorio/i)).toBeTruthy();
  });
});
