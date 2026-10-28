// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider } from '../../state/AppearanceProvider';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { StartScreen } from './StartScreen';

function renderStartScreen() {
  render(
    <AppearanceProvider>
      <ProjectProvider service={createFakeService()}>
        <StartScreen onEnterApp={vi.fn()} />
      </ProjectProvider>
    </AppearanceProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('StartScreen · trampa de foco en el diálogo de nuevo proyecto', () => {
  it('al abrir enfoca el botón cerrar, el Tab recorre el formulario y no abandona el diálogo', () => {
    renderStartScreen();

    fireEvent.click(screen.getByRole('button', { name: /Crear proyecto/i }));

    const dialogo = screen.getByRole('dialog', { name: /Nuevo proyecto/i });
    const cerrar = screen.getByRole('button', { name: 'Cerrar diálogo' });
    expect(document.activeElement).toBe(cerrar);

    // Con Shift desde el primero salta al último control (el botón primario);
    // jsdom no navega el Tab intermedio por su cuenta: el hook maneja los
    // bordes del ciclo.
    fireEvent.keyDown(cerrar, { key: 'Tab', shiftKey: true });
    const crear = screen.getByRole('button', { name: /Crear y entrar al editor/i });
    expect(document.activeElement).toBe(crear);
    expect(dialogo.contains(document.activeElement)).toBe(true);

    // Desde el último vuelve al primero.
    fireEvent.keyDown(crear, { key: 'Tab' });
    expect(document.activeElement).toBe(cerrar);
  });

  it('cierra con Escape y devuelve el foco a la tarjeta que lo abrió', () => {
    renderStartScreen();

    const tarjeta = screen.getByRole('button', { name: /Crear proyecto/i });
    tarjeta.focus();
    fireEvent.click(tarjeta);
    expect(screen.getByRole('dialog', { name: /Nuevo proyecto/i })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(tarjeta);
  });
});
