// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FlowQueueProvider } from '../../state/FlowQueueProvider';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { McpView, artifactPaths, exampleFromSchema, parseArgsLines, parseEnvLines } from './McpView';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderView() {
  const service = createFakeService();
  render(
    <ProjectProvider service={service}>
      <FlowQueueProvider>
        <McpView />
      </FlowQueueProvider>
    </ProjectProvider>,
  );
  return service;
}

describe('gestor MCP', () => {
  it('extrae artefactos desde el contenido JSON del servidor MCP', () => {
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            artifacts: [
              { type: 'image', path: 'C:\\media\\flow_123.png' },
              { type: 'video', path: 'C:\\media\\flow_456.mp4' },
            ],
          }),
        },
      ],
    };
    expect(artifactPaths(result)).toEqual([
      'C:\\media\\flow_123.png',
      'C:\\media\\flow_456.mp4',
    ]);
    expect(artifactPaths({ content: [{ type: 'text', text: 'sin json' }] })).toEqual([]);
  });

  it('parsea argumentos y variables sin perder claves existentes', () => {
    expect(parseArgsLines('-y\n\n server-everything \n')).toEqual([
      '-y',
      'server-everything',
    ]);
    expect(parseEnvLines('API_KEY=secreto\nLOG_LEVEL=info\nSIN_VALOR=\n# comentario')).toEqual([
      { key: 'API_KEY', value: 'secreto' },
      { key: 'LOG_LEVEL', value: 'info' },
      { key: 'SIN_VALOR' },
    ]);
  });

  it('genera un ejemplo ejecutable: sólo obligatorios y con el enum válido', () => {
    // Esquema real de `browser_click` de Playwright MCP.
    expect(
      exampleFromSchema({
        type: 'object',
        properties: {
          element: { type: 'string' },
          target: { type: 'string' },
          doubleClick: { type: 'boolean' },
          button: { type: 'string', enum: ['left', 'right', 'middle'] },
          modifiers: { type: 'array', items: { type: 'string' } },
        },
        required: ['target'],
      }),
    ).toEqual({ target: '' });

    // Sin `required` se completan todos, pero el enum toma su primer valor.
    expect(
      exampleFromSchema({
        type: 'object',
        properties: {
          count: { type: 'integer' },
          ratio: { type: 'number', default: 0.5 },
          mode: { type: 'string', enum: ['fast', 'slow'] },
          flag: { type: 'boolean' },
        },
      }),
    ).toEqual({ count: 0, ratio: 0.5, mode: 'fast', flag: false });

    expect(exampleFromSchema(null)).toEqual({});
    expect(exampleFromSchema({ type: 'object' })).toEqual({});
  });

  it('muestra el generador de Flow cuando el servidor expone sus herramientas', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText(/Sin servidores MCP/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Agregar servidor$/i }));
    fireEvent.change(screen.getByLabelText(/^Nombre$/i), {
      target: { value: 'Google Flow' },
    });
    fireEvent.change(screen.getByLabelText(/^Comando$/i), { target: { value: 'node' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar servidor/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Probar Google Flow/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Probar Google Flow/i }));
    await waitFor(() => expect(screen.getByText(/Generar fotos o videos con tu cuenta/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Generar foto con Flow/i })).toBeTruthy();
    // La cola continua tiene su propia autorización; acá se busca la del
    // generador de una sola imagen.
    expect(
      screen.getByText('Autorizo consumir créditos de Flow. El importe no lo puede calcular Editor IA.'),
    ).toBeTruthy();
  });

  it('agrega, prueba y ejecuta una herramienta desde la vista', async () => {
    const service = renderView();
    await waitFor(() => expect(screen.getByText(/Sin servidores MCP/i)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /^Agregar servidor$/i }));
    fireEvent.change(screen.getByLabelText(/^Nombre$/i), {
      target: { value: 'Servidor de prueba' },
    });
    fireEvent.change(screen.getByLabelText(/^Comando$/i), { target: { value: 'node' } });
    fireEvent.change(screen.getByLabelText(/Argumentos/i), {
      target: { value: 'fixture.mjs\n--verbose' },
    });
    fireEvent.change(screen.getByLabelText(/Variables de entorno/i), {
      target: { value: 'API_KEY=local' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar servidor/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Probar Servidor de prueba/i })).toBeTruthy(),
    );
    expect(await service.listMcpServers()).toEqual([
      expect.objectContaining({
        name: 'Servidor de prueba',
        command: 'node',
        args: ['fixture.mjs', '--verbose'],
        envKeys: ['API_KEY'],
      }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Probar Servidor de prueba/i }));
    await waitFor(() => expect(screen.getByText(/fixture-mcp|Servidor de prueba 1.0.0/i)).toBeTruthy());

    const detail = document.querySelector('.mcp-detail') as HTMLElement;
    const run = within(detail).getByRole('button', { name: /Ejecutar herramienta/i });
    fireEvent.click(run);
    await waitFor(() => expect(detail.querySelector('pre')?.textContent).toMatch(/text/));
  });

  it('abre una sesión al ejecutar y la cierra a pedido', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText(/Sin servidores MCP/i)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /^Agregar servidor$/i }));
    fireEvent.change(screen.getByLabelText(/^Nombre$/i), { target: { value: 'Navegador' } });
    fireEvent.change(screen.getByLabelText(/^Comando$/i), { target: { value: 'node' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar servidor/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Probar Navegador/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Probar Navegador/i }));

    const detail = document.querySelector('.mcp-detail') as HTMLElement;
    await waitFor(() =>
      expect(within(detail).getByRole('button', { name: /Ejecutar herramienta/i })).toBeTruthy(),
    );
    // Antes de ejecutar no hay sesión: se avisa que la primera llamada la abre.
    expect(within(detail).getByText(/Sin sesión abierta/i)).toBeTruthy();

    fireEvent.click(within(detail).getByRole('button', { name: /Ejecutar herramienta/i }));
    await waitFor(() => expect(within(detail).getByText(/Sesión activa/i)).toBeTruthy());
    expect(within(detail).getByText(/1 llamada/)).toBeTruthy();

    fireEvent.click(within(detail).getByRole('button', { name: /Cerrar sesión/i }));
    await waitFor(() => expect(within(detail).getByText(/Sin sesión abierta/i)).toBeTruthy());
  });
});
