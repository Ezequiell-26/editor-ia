// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { AppShell } from './AppShell';
import { AppearanceProvider } from '../state/AppearanceProvider';
import { ProjectProvider, useProjectStore } from '../state/project-store';
import { ensureDelivery } from '../state/project-actions';
import { createFakeService } from '../test/fake-service';

const NOW = '2026-11-03T00:00:00.000Z';

function fixture() {
  const project = ensureDelivery(createEmptyProject('Autosave', NOW));
  return {
    project,
    opened: {
      project,
      label: 'autosave.editoria.json',
      path: 'C:\\tester\\autosave.editoria.json',
      root: 'C:\\tester',
    },
  };
}

/** Controles mínimos para disparar los cambios de estado del store real. */
function Harness() {
  const store = useProjectStore();
  return (
    <div>
      <button type="button" onClick={() => store.update((doc) => doc, { history: false })}>
        marcar cambio
      </button>
      <button type="button" onClick={() => void store.saveNow()}>
        forzar guardado
      </button>
    </div>
  );
}

function renderShell(service = createFakeService()) {
  render(
    <AppearanceProvider>
      <ProjectProvider service={service} initial={fixture()}>
        <Harness />
        <AppShell activeId="home" onSelect={() => {}} content={<div />} />
      </ProjectProvider>
    </AppearanceProvider>,
  );
  return service;
}

function statusbarText(): string {
  return screen.getByRole('contentinfo').textContent ?? '';
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('statusbar · autoguardado visible', () => {
  it('muestra un proyecto abierto y sin cambios pendientes como «Sin cambios»', async () => {
    renderShell();

    expect(
      await screen.findByText('Autosave', { selector: '.statusbar-project' }),
    ).toBeTruthy();
    expect(statusbarText()).toContain('Sin cambios');
  });

  it('marca los cambios sin guardar con el retardo real de autoguardado', async () => {
    renderShell();

    fireEvent.click(await screen.findByRole('button', { name: /marcar cambio/i }));

    await waitFor(() => expect(statusbarText()).toMatch(/Cambios sin guardar/i));
    // El retardo sale de las preferencias reales (por defecto 1,4 s).
    expect(statusbarText()).toMatch(/autoguardado en 1,4 s/);
  });

  it('muestra «Guardando…» mientras persiste y «Guardado hh:mm» al terminar', async () => {
    const service = createFakeService();
    let resolveSave: (() => void) | null = null;
    const baseSave = service.saveProject.bind(service);
    service.saveProject = async (project) => {
      await new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
      return baseSave(project);
    };
    renderShell(service);

    fireEvent.click(await screen.findByRole('button', { name: /forzar guardado/i }));
    expect(statusbarText()).toContain('Guardando…');

    await act(async () => {
      resolveSave?.();
    });
    await waitFor(() => expect(statusbarText()).toMatch(/Guardado \d{1,2}:\d{2}/));
  });

  it('declara el fallo de guardado sin mostrarlo como éxito', async () => {
    const service = createFakeService();
    renderShell(service);

    service.setSaveFailure('disco lleno');
    fireEvent.click(await screen.findByRole('button', { name: /forzar guardado/i }));

    await waitFor(() => expect(statusbarText()).toContain('Error al guardar'));
    expect(statusbarText()).not.toMatch(/Guardado \d/);
  });
});
