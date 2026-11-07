// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortcutsCheatSheet } from './ShortcutsCheatSheet';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderSheet() {
  return render(<ShortcutsCheatSheet open onClose={vi.fn()} />);
}

function section(title: string): HTMLElement {
  const heading = screen.getByText(title, { selector: '.shortcuts-group-title span' });
  const group = heading.closest('.shortcuts-group');
  expect(group).not.toBeNull();
  return group as HTMLElement;
}

describe('ShortcutsCheatSheet · atajos de navegación por grupo del mapa', () => {
  it('subdivide los atajos nav.* según WORKSPACE_GROUPS', () => {
    renderSheet();

    expect(within(section('Navegación · Preparar')).getByText('Ir al Guion')).toBeTruthy();
    expect(within(section('Navegación · Preparar')).getByText('Ir a Descargar')).toBeTruthy();
    expect(within(section('Navegación · Editar')).getByText('Ir al Editor')).toBeTruthy();
    expect(within(section('Navegación · Editar')).getByText('Ir a la Fábrica')).toBeTruthy();
    expect(within(section('Navegación · Potenciar')).getByText('Ir al Director')).toBeTruthy();
    expect(
      within(section('Navegación · Aprender y ajustar')).getByText('Ir a Ajustes'),
    ).toBeTruthy();
  });

  it('ya no existe una única sección «Navegación» plana', () => {
    renderSheet();

    expect(
      screen.queryByText('Navegación', { selector: '.shortcuts-group-title span' }),
    ).toBeNull();
  });

  it('el filtro «Navegación» sigue listando los 9 atajos', () => {
    renderSheet();

    fireEvent.click(screen.getByRole('tab', { name: /Navegación/ }));

    const labels = [
      'Ir a Inicio',
      'Ir al Editor',
      'Ir al Guion',
      'Ir a la Biblioteca',
      'Ir a Producción',
      'Ir a la Fábrica',
      'Ir al Director',
      'Ir a Descargar',
      'Ir a Ajustes',
    ];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText('Guardar proyecto')).toBeNull();
  });

  it('la búsqueda encuentra atajos dentro de las nuevas secciones', () => {
    renderSheet();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'descargar' } });

    expect(screen.getByText('Ir a Descargar')).toBeTruthy();
    expect(screen.queryByText('Ir al Guion')).toBeNull();
  });
});
