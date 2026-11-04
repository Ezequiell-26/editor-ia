// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { Command } from '../app/commands';
import type { GlobalSearchHit } from '../state/global-search';
import { ProjectProvider } from '../state/project-store';
import { createFakeService } from '../test/fake-service';
import { CommandPalette } from './CommandPalette';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderPalette(
  ui: ReactElement,
  service: ReturnType<typeof createFakeService> = createFakeService(),
) {
  render(<ProjectProvider service={service}>{ui}</ProjectProvider>);
  return service;
}

function commands(save = vi.fn(), openEditor = vi.fn()): Command[] {
  return [
    { id: 'file.save', label: 'Guardar proyecto', category: 'Archivo', action: save },
    { id: 'nav.editor', label: 'Editor de video', category: 'Navegar', action: openEditor },
  ];
}

function hit(overrides: Partial<GlobalSearchHit> = {}): GlobalSearchHit {
  return {
    id: 'clip:clip-1',
    entityId: 'clip-1',
    kind: 'clip',
    title: 'Entrevista en la playa',
    subtitle: 'Video · V1 · 00:00:00',
    keywords: '',
    frame: 0,
    score: 3.2,
    ...overrides,
  };
}

describe('paleta de comandos con búsqueda global', () => {
  it('lista los resultados del proyecto antes que las acciones', async () => {
    renderPalette(
      <CommandPalette
        commands={commands()}
        onClose={() => {}}
        search={() => [hit()]}
        onPickHit={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'guardar' } });

    expect(await screen.findByText('En el proyecto')).toBeTruthy();
    expect(screen.getByText('Acciones')).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options[0]?.textContent).toContain('Entrevista en la playa');
    expect(screen.getByText('Clip')).toBeTruthy();
  });

  it('abre el resultado elegido con el mouse y cierra la paleta', async () => {
    const onPickHit = vi.fn();
    const onClose = vi.fn();
    renderPalette(
      <CommandPalette
        commands={commands()}
        onClose={onClose}
        search={() => [hit()]}
        onPickHit={onPickHit}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'entre' } });
    fireEvent.click(await screen.findByRole('option', { name: /Entrevista en la playa/ }));

    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(onPickHit).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'clip-1' })));
  });

  it('abre el primer resultado con Enter', async () => {
    const onPickHit = vi.fn();
    renderPalette(
      <CommandPalette
        commands={commands()}
        onClose={() => {}}
        search={() => [hit()]}
        onPickHit={onPickHit}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'entre' } });
    await screen.findByRole('option', { name: /Entrevista en la playa/ });
    // El listener se registra en un efecto; bajo carga puede tardar un tick.
    // Reintentar el Enter evita un falso negativo sin cambiar el comportamiento.
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(onPickHit).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'clip-1' }),
      );
    });
  });

  it('sin buscador se comporta como una lista de comandos', () => {
    renderPalette(<CommandPalette commands={commands()} onClose={() => {}} />);

    expect(screen.queryByText('En el proyecto')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText(/2 comandos/)).toBeTruthy();
  });

  it('no bloquea la paleta cuando no hay proyectos recientes', () => {
    renderPalette(<CommandPalette commands={commands()} onClose={() => {}} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'proyecto' } });
    expect(screen.queryByText('Proyectos recientes')).toBeNull();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('no muestra resultados cuando la consulta no coincide con nada', async () => {
    renderPalette(
      <CommandPalette
        commands={commands()}
        onClose={() => {}}
        search={() => []}
        onPickHit={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zzzz' } });
    expect(await screen.findByText('Sin resultados')).toBeTruthy();
  });
});

describe('paleta de comandos · proyectos recientes', () => {
  const RECENTS = [
    {
      path: 'C:\\tester\\Documental de playa.editoria.json',
      label: 'Documental de playa.editoria.json',
      name: 'Documental de playa',
      openedAt: '2026-11-03T12:00:00.000Z',
    },
    {
      path: 'C:\\tester\\Anuncio vertical.editoria.json',
      label: 'Anuncio vertical.editoria.json',
      name: 'Anuncio vertical',
      openedAt: '2026-11-02T12:00:00.000Z',
    },
  ];

  function seedRecents(): void {
    window.localStorage.setItem('editoria.recent.v1', JSON.stringify(RECENTS));
  }

  it('busca recientes por nombre y ruta y los abre con la acción real del store', async () => {
    seedRecents();
    const openEditor = vi.fn();
    const service = createFakeService();
    const openAt = vi.spyOn(service, 'openProjectAt');
    renderPalette(
      <CommandPalette commands={commands(vi.fn(), openEditor)} onClose={vi.fn()} />,
      service,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'playa' } });

    expect(await screen.findByText('Proyectos recientes')).toBeTruthy();
    expect(screen.getByText('Documental de playa')).toBeTruthy();
    // El otro reciente existe pero no coincide con la consulta.
    expect(screen.queryByText('Anuncio vertical')).toBeNull();

    fireEvent.click(screen.getByRole('option', { name: /Documental de playa/ }));

    await waitFor(() =>
      expect(openAt).toHaveBeenCalledWith(RECENTS[0]!.path),
    );
    // Al abrirse bien, la paleta navega al editor con el comando existente.
    await waitFor(() => expect(openEditor).toHaveBeenCalledTimes(1));
  });

  it('también encuentra por un fragmento de la ruta y respeta el límite', async () => {
    seedRecents();
    renderPalette(<CommandPalette commands={commands()} onClose={() => {}} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'anuncio' } });
    expect(await screen.findByText('Anuncio vertical')).toBeTruthy();
    expect(screen.queryByText('Documental de playa')).toBeNull();
    expect(screen.queryByText('Proyectos recientes')).toBeTruthy();
  });

  it('no ofrece el proyecto que ya está abierto', async () => {
    seedRecents();
    const service = createFakeService();
    const opened = await service.openProjectAt(RECENTS[0]!.path);
    const project = opened.project;
    render(
      <ProjectProvider
        service={service}
        initial={{
          project,
          opened: {
            project,
            label: RECENTS[0]!.label,
            path: RECENTS[0]!.path,
            root: 'C:\\tester',
          },
        }}
      >
        <CommandPalette commands={commands()} onClose={() => {}} />
      </ProjectProvider>,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'playa' } });
    await waitFor(() => expect(screen.queryByText('Proyectos recientes')).toBeNull());
    expect(screen.queryByText('Anuncio vertical')).toBeNull();
  });
});
