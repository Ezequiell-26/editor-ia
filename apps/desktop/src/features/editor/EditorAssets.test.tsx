// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('navega las pestañas con flechas y mantiene un solo tab stop', () => {
    const view = renderRail();
    const tabs = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>('.rail-tabs button'),
    );
    expect(tabs[0]!.tabIndex).toBe(0);
    expect(tabs[1]!.tabIndex).toBe(-1);

    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.tabIndex).toBe(0);

    fireEvent.keyDown(tabs[1]!, { key: 'End' });
    expect(tabs[7]!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[7]);
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
    expect(cards).toHaveLength(9);
    // sin selección, los presets quedan bloqueados para aplicar pero siguen
    // siendo arrastrables a la timeline.
    for (const card of cards) {
      expect(card.getAttribute('aria-disabled')).toBe('true');
      expect(card.getAttribute('draggable')).toBe('true');
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
    expect(view.container.querySelectorAll('.transition-card').length).toBe(12);
  });

  it('arrastra una transición con su identificador', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[5]!);
    const card = view.container.querySelector('.transition-card');
    if (!(card instanceof HTMLElement)) throw new Error('se esperaba una tarjeta');
    const setData = vi.fn();
    fireEvent.dragStart(card, { dataTransfer: { setData, effectAllowed: '' } });
    expect(setData).toHaveBeenCalledWith('application/x-olyvia-transition', 'dissolve');
  });

  it('arrastra un preset de efectos con sus ajustes', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[4]!); // Índice 4: Efectos
    const card = view.container.querySelector('.preset-card');
    if (!(card instanceof HTMLElement)) throw new Error('se esperaba un preset');
    const setData = vi.fn();
    fireEvent.dragStart(card, { dataTransfer: { setData, effectAllowed: '' } });
    expect(setData).toHaveBeenCalledWith(
      'application/x-olyvia-effect-settings',
      expect.stringContaining('{'),
    );
  });
});
