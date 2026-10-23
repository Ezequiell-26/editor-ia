// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../app/commands';
import type { GlobalSearchHit } from '../state/global-search';
import { CommandPalette } from './CommandPalette';

afterEach(cleanup);

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
    render(
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
    render(
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
    render(
      <CommandPalette
        commands={commands()}
        onClose={() => {}}
        search={() => [hit()]}
        onPickHit={onPickHit}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'entre' } });
    await screen.findByRole('option', { name: /Entrevista en la playa/ });
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(onPickHit).toHaveBeenCalledTimes(1));
  });

  it('sin buscador se comporta como una lista de comandos', () => {
    render(<CommandPalette commands={commands()} onClose={() => {}} />);

    expect(screen.queryByText('En el proyecto')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText(/2 comandos/)).toBeTruthy();
  });

  it('no muestra resultados cuando la consulta no coincide con nada', async () => {
    render(
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
