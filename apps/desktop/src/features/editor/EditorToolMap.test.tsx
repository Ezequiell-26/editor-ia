// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NAV_VIEWS } from '../../app/navigation';
import { WORKSPACE_GROUPS } from '../../app/workspace-map';
import { EditorToolMap } from './EditorToolMap';

afterEach(() => cleanup());

describe('EditorToolMap · una sola puerta para toda la app', () => {
  it('muestra los grupos y todas las herramientas con etiquetas reales', () => {
    const { container } = render(<EditorToolMap onNavigate={() => {}} />);
    expect(container.querySelectorAll('.editor-tool-map-group')).toHaveLength(
      WORKSPACE_GROUPS.length,
    );
    expect(container.querySelectorAll('.editor-tool-chip')).toHaveLength(NAV_VIEWS.length);
    for (const group of WORKSPACE_GROUPS) {
      expect(screen.getByText(group.label)).toBeTruthy();
    }
    expect(screen.getByText(`${NAV_VIEWS.length} / ${NAV_VIEWS.length}`)).toBeTruthy();
  });

  it('filtra por etiqueta/hint y navega a la vista real', () => {
    const onNavigate = vi.fn();
    const { container } = render(<EditorToolMap onNavigate={onNavigate} />);
    fireEvent.change(screen.getByRole('searchbox', { name: /Buscar herramienta/i }), {
      target: { value: 'Convertir' },
    });
    const chips = container.querySelectorAll('.editor-tool-chip');
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThan(NAV_VIEWS.length);
    fireEvent.click(screen.getByRole('button', { name: /^Convertir:/ }));
    expect(onNavigate).toHaveBeenCalledWith('convert');
  });

  it('marca la herramienta activa y avisa cuando no hay coincidencias', () => {
    const { container } = render(<EditorToolMap onNavigate={() => {}} currentView="lab" />);
    expect(container.querySelectorAll('.editor-tool-chip.is-here').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('searchbox', { name: /Buscar herramienta/i }), {
      target: { value: 'xyz-no-existe' },
    });
    expect(container.querySelectorAll('.editor-tool-chip')).toHaveLength(0);
    expect(screen.getByText(/Ninguna herramienta coincide/)).toBeTruthy();
  });
});
