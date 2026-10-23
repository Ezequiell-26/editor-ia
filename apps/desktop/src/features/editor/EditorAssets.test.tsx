// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { EditorAssets } from './EditorAssets';

const NOW = '2026-10-20T00:00:00.000Z';

if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

afterEach(() => {
  cleanup();
});

function renderRail() {
  const base = ensureDelivery(createEmptyProject('Rail', NOW));
  const asset = readyAsset();
  const project = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 300,
  }).project;
  const service = createFakeService();
  return render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'rail.editoria.json',
          path: 'C:\\tester\\rail.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <EditorAssets onNavigate={() => {}} />
    </ProjectProvider>,
  );
}

describe('EditorAssets · barra de herramientas y biblioteca estilo CapCut', () => {
  it('muestra las pestañas con icono y etiqueta', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    expect(tabs).toHaveLength(8);
    const labels = Array.from(tabs).map((tab) => tab.textContent);
    expect(labels).toEqual([
      'Medios',
      'Audio',
      'Texto',
      'Stickers',
      'Efectos',
      'Transiciones',
      'Filtros',
      'Ajustes',
    ]);
    for (const tab of tabs) {
      expect(tab.querySelector('svg')).not.toBeNull();
    }
  });

  it('la pestaña Medios arranca activa y lista el medio del proyecto', async () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    await waitFor(() => {
      expect(view.container.querySelectorAll('.rail-asset').length).toBeGreaterThan(0);
    });
  });

  it('la pestaña Efectos muestra los presets y avisa sin clip seleccionado', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[4]!); // Índice 4: Efectos
    const cards = view.container.querySelectorAll('.preset-card');
    expect(cards).toHaveLength(8);
    // sin selección, los presets están deshabilitados y hay aviso
    for (const card of cards) {
      expect((card as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText(/Seleccioná un clip en la timeline/i)).toBeTruthy();
  });

  it('la pestaña Filtros muestra los looks de color', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[6]!); // Índice 6: Filtros
    const cards = view.container.querySelectorAll('.preset-card');
    expect(cards).toHaveLength(6);
    expect(view.container.querySelector('.preset-swatch')).not.toBeNull();
  });

  it('la pestaña Audio filtra a audios y explica las narraciones', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[1]!); // Índice 1: Audio
    expect(view.container.querySelector('.rail-view-hint')?.textContent).toMatch(/narracion/i);
  });

  it('la pestaña Texto conserva las plantillas', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[2]!); // Índice 2: Texto
    expect(view.container.querySelectorAll('.title-template-card').length).toBeGreaterThan(0);
  });

  it('la pestaña Stickers muestra elementos y emojis', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[3]!); // Índice 3: Stickers
    expect(view.container.querySelectorAll('.sticker-card').length).toBeGreaterThan(0);
  });

  it('la pestaña Transiciones muestra las transiciones disponibles', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[5]!); // Índice 5: Transiciones
    expect(view.container.querySelectorAll('.transition-card').length).toBe(7);
  });
});
