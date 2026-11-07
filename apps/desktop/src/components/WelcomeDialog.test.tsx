// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectProvider } from '../state/project-store';
import { WORKSPACE_STEPS } from '../app/workspace-map';
import { createFakeService } from '../test/fake-service';
import { WelcomeDialog } from './WelcomeDialog';

/** El diálogo sólo se muestra en runtime nativo: se simula Tauri. */
function simularRuntimeNativo(): void {
  (window as unknown as { __TAURI_INTERNALS__: { invoke: () => void } }).__TAURI_INTERNALS__ = {
    invoke: () => {},
  };
}

function renderWelcome(onOpenTour?: () => void) {
  const onNavigate = vi.fn();
  render(
    <ProjectProvider service={createFakeService()}>
      <WelcomeDialog onNavigate={onNavigate} {...(onOpenTour ? { onOpenTour } : {})} />
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

    // El recorrido canónico tiene 6 pasos (workspace-map); el copy no puede
    // quedar desfasado como pasó con «cinco pasos».
    expect(screen.getByText(/6 pasos del recorrido/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Crear mi primer video/ }));

    expect(onNavigate).toHaveBeenCalledWith('projects');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem('editor-ia.welcome.v1')).toBe('seen');
  });
});

describe('diálogo de bienvenida · recorrido único', () => {
  it('muestra las mismas seis etapas de WORKSPACE_STEPS', () => {
    simularRuntimeNativo();
    renderWelcome();

    const journey = screen.getByRole('list', { name: 'El recorrido de producción' });
    const labels = WORKSPACE_STEPS.map((step) => step.label);
    expect(labels).toHaveLength(6);
    for (const label of labels) {
      expect(journey.textContent).toContain(label);
    }
  });

  it('Pando narra los pasos del recorrido, no consejos sueltos', () => {
    simularRuntimeNativo();
    renderWelcome();

    // Primer consejo: saludo; al avanzar empieza el paso 1 del recorrido.
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente consejo de Pando' }));
    expect(screen.getByText('Paso 1: Proyecto')).toBeTruthy();
    expect(screen.getByText(WORKSPACE_STEPS[0]!.tip)).toBeTruthy();
  });

  it('ofrece el tour guiado del mismo recorrido y lo abre al elegirlo', () => {
    simularRuntimeNativo();
    const onOpenTour = vi.fn();
    renderWelcome(onOpenTour);

    fireEvent.click(
      screen.getByRole('button', { name: /Ver el recorrido guiado/ }),
    );

    expect(onOpenTour).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem('editor-ia.welcome.v1')).toBe('seen');
  });
});
