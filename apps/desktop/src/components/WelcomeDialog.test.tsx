// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectProvider } from '../state/project-store';
import { createFakeService } from '../test/fake-service';
import { WelcomeDialog } from './WelcomeDialog';

/** El diálogo sólo se muestra en runtime nativo: se simula Tauri. */
function simularRuntimeNativo(): void {
  (window as unknown as { __TAURI_INTERNALS__: { invoke: () => void } }).__TAURI_INTERNALS__ = {
    invoke: () => {},
  };
}

function renderWelcome() {
  const onNavigate = vi.fn();
  render(
    <ProjectProvider service={createFakeService()}>
      <WelcomeDialog onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { onNavigate };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  window.localStorage.clear();
});

describe('diálogo de bienvenida · trampa de foco', () => {
  it('abre con el foco en el primer control, atrapa el Tab y cierra con Escape marcando la guía como vista', () => {
    simularRuntimeNativo();
    renderWelcome();

    const siguiente = screen.getByRole('button', { name: 'Siguiente consejo de Pando' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.activeElement).toBe(siguiente);

    // Con Shift desde el primero salta al último; desde el último vuelve al primero.
    const empezar = screen.getByRole('button', { name: 'Empezar por mi cuenta' });
    fireEvent.keyDown(siguiente, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(empezar);
    fireEvent.keyDown(empezar, { key: 'Tab' });
    expect(document.activeElement).toBe(siguiente);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem('editor-ia.welcome.v1')).toBe('seen');
  });

  it('elegir una opción cierra el diálogo y navega a la vista pedida', () => {
    simularRuntimeNativo();
    const { onNavigate } = renderWelcome();

    fireEvent.click(screen.getByRole('button', { name: /Crear mi primer video/ }));

    expect(onNavigate).toHaveBeenCalledWith('projects');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem('editor-ia.welcome.v1')).toBe('seen');
  });
});
