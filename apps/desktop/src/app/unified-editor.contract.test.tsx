// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { createFakeService } from '../test/fake-service';

/**
 * UN SOLO EDITOR · contrato de identidad (doc 17 F1, Etapa B1).
 *
 * Hasta esta pasada no había ningún test que montara la app real y probara
 * que cambiar de herramienta NO remonta el editor. `editor-surface.test.ts`
 * sólo gatea clases (función pura) y `WorkspaceView.test.tsx` llama a la
 * vista como función sin renderizar. Acá se mide el DOM vivo: un solo
 * workspace, un solo chrome y los mismos nodos de Preview/Transport/Timeline
 * a lo largo de 11 cambios de modo.
 */

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

function renderApp() {
  const service = createFakeService();
  render(<App service={service} />);
  return service;
}

async function nav(label: string): Promise<void> {
  const navigation = screen.getByRole('navigation', { name: /vistas/i });
  const find = () => within(navigation).queryByRole('button', { name: label });
  if (!find()) {
    const more = within(navigation).queryByRole('button', { name: /Más herramientas/i });
    if (more) fireEvent.click(more);
  }
  const button = await waitFor(() => {
    const found = find();
    if (!found) throw new Error(`nav: no aparece el botón «${label}»`);
    return found;
  });
  fireEvent.click(button);
}

async function openProject(): Promise<void> {
  // El workspace y la timeline son chunks lazy: en jsdom bajo CPU cargada
  // tardan más que el timeout de 1 s de waitFor. Igual que App.test.tsx.
  const open = await screen.findByRole('button', { name: /Abrir proyecto/i }, { timeout: 10_000 });
  fireEvent.click(open);
  await waitFor(() => expect(document.querySelector('.timeline-surface')).toBeTruthy(), {
    timeout: 10_000,
  });
}

function chromeCounts(): { workspace: number; topbar: number; footer: number } {
  return {
    workspace: document.querySelectorAll('.editor-workspace.alaukcut-chrome').length,
    topbar: document.querySelectorAll('.alauk-topbar').length,
    footer: document.querySelectorAll('.alauk-footer').length,
  };
}

describe('contrato del editor unificado', () => {
  it('arranca directo en el editor, con un solo chrome y sin pantallas paralelas', async () => {
    renderApp();

    await waitFor(
      () => expect(document.querySelector('.editor-workspace.alaukcut-chrome')).toBeTruthy(),
      { timeout: 10_000 },
    );
    expect(chromeCounts()).toEqual({ workspace: 1, topbar: 1, footer: 1 });
    // Sin proyecto las pestañas de modos siguen visibles (ADR-0006 §3): son
    // la puerta a las herramientas cuando no hay documento abierto.
    expect(screen.getByRole('tablist', { name: 'Modos de edición' })).toBeTruthy();
    expect(document.querySelector('.editor-mode-panel')).toBeTruthy();
    expect(screen.getByText('Estudio de Edición de Video')).toBeTruthy();
    // Réplica retirada (P7), lanzador previo retirado, sin diálogo de Ajustes.
    expect(document.querySelector('.minimal-editor')).toBeNull();
    expect(document.querySelector('[data-start-screen]')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Configuración' })).toBeNull();
  });

  it('Preview, Transport y Timeline conservan identidad durante 11 cambios de herramienta', async () => {
    renderApp();
    await openProject();

    const preview = document.querySelector('.preview-panel');
    const transport = document.querySelector('.transport');
    const timeline = document.querySelector('.timeline-panel');
    expect(preview).toBeTruthy();
    expect(transport).toBeTruthy();
    expect(timeline).toBeTruthy();

    const modes = [
      'Mezcla',
      'Motion',
      'VFX',
      'Texto',
      'Guion',
      'Medios',
      'Producción',
      'Automático',
      'AI Hub',
      'Todo',
      'Edición',
    ] as const;

    const tabs = screen.getByRole('tablist', { name: 'Modos de edición' });
    for (const label of modes) {
      fireEvent.click(within(tabs).getByRole('tab', { name: label }));
      await waitFor(() =>
        expect(within(tabs).getByRole('tab', { name: label }).getAttribute('aria-selected')).toBe(
          'true',
        ),
      );
      // Mismo nodo DOM ⇒ no se desmontó el <video>, el grafo de audio ni la
      // timeline. Es el invariante que B2 fijó en el código y nadie gateaba.
      expect(document.querySelector('.preview-panel'), `preview tras ${label}`).toBe(preview);
      expect(document.querySelector('.transport'), `transport tras ${label}`).toBe(transport);
      expect(document.querySelector('.timeline-panel'), `timeline tras ${label}`).toBe(timeline);
      expect(chromeCounts(), `chrome tras ${label}`).toEqual({
        workspace: 1,
        topbar: 1,
        footer: 1,
      });
    }
  });

  it('Herramientas abre el mapa de herramientas del MISMO editor', async () => {
    renderApp();
    await openProject();
    // Nombre exacto: el rail clásico tiene «Más herramientas» y el menú
    // «Herramientas»; acá se apunta sólo al botón del chrome unificado.
    fireEvent.click(screen.getByRole('button', { name: 'Herramientas' }));
    await waitFor(() =>
      expect(document.querySelector('.editor-workspace')?.getAttribute('data-editor-mode')).toBe(
        'tools',
      ),
    );
    expect(chromeCounts()).toEqual({ workspace: 1, topbar: 1, footer: 1 });
    expect(document.querySelector('.timeline-panel')).toBeTruthy();
  });

  it('Ajustes es un panel del editor, no una ventana ni una pantalla aparte', async () => {
    renderApp();
    await nav('Ajustes');
    await waitFor(
      () =>
        expect(
          within(screen.getByRole('main')).getByRole('navigation', {
            name: /Secciones de Ajustes/i,
          }),
        ).toBeTruthy(),
      { timeout: 8000 },
    );
    expect(screen.queryByRole('dialog', { name: 'Configuración' })).toBeNull();
    const workspace = document.querySelector('.editor-workspace.alaukcut-chrome');
    expect(workspace).toBeTruthy();
    expect(
      within(workspace as HTMLElement).getByRole('navigation', {
        name: /Secciones de Ajustes/i,
      }),
    ).toBeTruthy();
    expect(chromeCounts()).toEqual({ workspace: 1, topbar: 1, footer: 1 });
  });
});
