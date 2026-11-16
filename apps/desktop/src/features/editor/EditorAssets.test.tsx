// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import type { ClipInspectorTab } from '../../state/inspector-tab-command';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { resetCatalogFavoritesForTests } from '../../state/catalog-favorites';
import { EditorAssets, TRANSITION_PRESETS } from './EditorAssets';

const NOW = '2026-10-20T00:00:00.000Z';

if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetCatalogFavoritesForTests();
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

function SelectClipOnMount({ id }: { id: string }): null {
  const store = useProjectStore();
  useEffect(() => {
    store.setSelection({ kind: 'clip', id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderAdjustmentsRail(
  onRequestInspectorTab?: (tab: ClipInspectorTab, subTab?: string) => void,
) {
  const base = ensureDelivery(createEmptyProject('Rail', NOW));
  const asset = readyAsset();
  const added = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 300,
  });
  const service = createFakeService();
  return render(
    <ProjectProvider
      service={service}
      initial={{
        project: added.project,
        opened: {
          project: added.project,
          label: 'rail.editoria.json',
          path: 'C:\\tester\\rail.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <SelectClipOnMount id={added.clipId} />
      <EditorAssets onNavigate={() => {}} onRequestInspectorTab={onRequestInspectorTab} />
    </ProjectProvider>,
  );
}

describe('EditorAssets · barra de herramientas y biblioteca estilo CapCut', () => {
  it('muestra las pestañas con icono y etiqueta', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    // Capturas 114–117: «Plantillas / Split Screen» es la novena vista real.
    expect(tabs).toHaveLength(9);
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
      'Plantillas',
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
    expect(cards).toHaveLength(9);
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
    expect(screen.getByText('Comenta')).toBeTruthy();
    expect(screen.getByText('Activa la campana')).toBeTruthy();
    expect(screen.getByText('Corazón')).toBeTruthy();
  });

  it('la pestaña Transiciones muestra las transiciones disponibles', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[5]!); // Índice 5: Transiciones
    expect(view.container.querySelectorAll('.transition-card').length).toBe(
      TRANSITION_PRESETS.length,
    );
  });

  it('la pestaña Plantillas muestra Split Screen y selecciona una plantilla real', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[8]!); // Índice 8: Plantillas (capturas 114–117)
    const templates = view.container.querySelectorAll('.fm-split-template-card');
    expect(templates.length).toBeGreaterThan(0);
    fireEvent.click(templates[0]!);
    expect(templates[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(view.container.querySelector('.fm-split-templates-note')?.textContent).toMatch(
      /Plantilla seleccionada/i,
    );
  });

  it('busca plantillas y las filtra por favoritos', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[8]!); // Plantillas

    const search = screen.getByRole('searchbox', { name: /Buscar plantilla/i });
    fireEvent.change(search, { target: { value: 'simple' } });
    expect(view.container.querySelectorAll('.fm-split-template-card').length).toBe(1);

    const fav = view.container.querySelector('.fm-split-template-wrap .catalog-fav');
    if (!(fav instanceof HTMLElement)) throw new Error('sin estrella de plantilla');
    fireEvent.click(fav);
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(
      view.container.querySelectorAll('.fm-split-template-card').length,
    ).toBeGreaterThan(1);

    const filter = view.container.querySelector('.catalog-fav-filter');
    if (!(filter instanceof HTMLElement)) throw new Error('sin filtro de favoritos');
    fireEvent.click(filter);
    expect(view.container.querySelectorAll('.fm-split-template-card').length).toBe(1);
    expect(window.localStorage.getItem('olyvia.catalog-favorites.v1')).toContain(
      'template:',
    );
  });
});

describe('EditorAssets · favoritos del catálogo', () => {
  it('marca un efecto, filtra por favoritos y lo persiste', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[4]!); // Índice 4: Efectos
    expect(screen.getByText('Suave')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Agregar Suave a favoritos' }));
    expect(
      screen
        .getByRole('button', { name: 'Quitar Suave de favoritos' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    const filter = view.container.querySelector('.catalog-fav-filter');
    if (!(filter instanceof HTMLElement)) throw new Error('sin filtro de favoritos');
    fireEvent.click(filter);

    expect(screen.getByText('Suave')).toBeTruthy();
    expect(screen.queryByText('Onírico')).toBeNull();
    expect(window.localStorage.getItem('olyvia.catalog-favorites.v1')).toContain(
      'effect:soft',
    );
  });

  it('busca transiciones por texto y limpia con el botón', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[5]!); // Transiciones

    const search = screen.getByRole('searchbox', { name: /Buscar transición/i });
    fireEvent.change(search, { target: { value: 'iris' } });
    const cards = view.container.querySelectorAll('.transition-card');
    expect(cards.length).toBe(1);
    expect(cards[0]?.textContent).toContain('Iris');

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(view.container.querySelectorAll('.transition-card').length).toBe(
      TRANSITION_PRESETS.length,
    );
  });

  it('marca un filtro como favorito y lo filtra', () => {
    const view = renderRail();
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[6]!); // Filtros

    const firstFav = view.container.querySelector('.catalog-fav');
    if (!(firstFav instanceof HTMLElement)) throw new Error('sin estrella de filtro');
    fireEvent.click(firstFav);
    expect(view.container.querySelectorAll('.catalog-fav.active').length).toBe(1);

    const filter = view.container.querySelector('.catalog-fav-filter');
    if (!(filter instanceof HTMLElement)) throw new Error('sin filtro de favoritos');
    fireEvent.click(filter);
    expect(view.container.querySelectorAll('.preset-card-wrap').length).toBe(1);
    expect(window.localStorage.getItem('olyvia.catalog-favorites.v1')).toContain('look:');
  });

  it('«Ruedas cromáticas» y «HDR» del árbol de Ajustes abren la subpestaña real del inspector', () => {
    const calls: Array<readonly [ClipInspectorTab, string | undefined]> = [];
    const view = renderAdjustmentsRail((tab, subTab) => calls.push([tab, subTab]));
    const tabs = view.container.querySelectorAll('.rail-tabs button');
    fireEvent.click(tabs[7]!); // Índice 7: Ajustes
    const treeButton = (label: string) =>
      Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('.rail-tree button'),
      ).find((button) => button.textContent?.includes(label));

    const wheels = treeButton('Ruedas cromáticas');
    const hdr = treeButton('HDR');
    expect(wheels).toBeTruthy();
    expect(hdr).toBeTruthy();
    // Ya no son pendientes: el inspector tiene las subpestañas reales.
    expect(wheels!.disabled).toBe(false);
    expect(wheels!.querySelector('.is-pending')).toBeNull();
    expect(hdr!.disabled).toBe(false);

    fireEvent.click(wheels!);
    fireEvent.click(hdr!);
    expect(calls).toEqual([
      ['color', 'wheels'],
      ['color', 'hdr'],
    ]);

    // No se cuelan como chips de filtro ni cambian el árbol de looks.
    const chips = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>('.rail-chips button'),
    ).map((button) => button.textContent);
    expect(chips.some((label) => label?.includes('Ruedas'))).toBe(false);
    expect(chips.some((label) => label === 'HDR')).toBe(false);
  });
});
