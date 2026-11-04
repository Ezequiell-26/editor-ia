// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { App } from '../../App';
import { HomeView } from './HomeView';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
} from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';

const NOW = '2026-11-03T00:00:00.000Z';

function projectDocument(withClip: boolean): ProjectDocument {
  let project = ensureDelivery(createEmptyProject('Home contextual', NOW));
  if (!withClip) return project;
  const asset = readyAsset();
  project = addAsset(project, asset);
  const added = project.assets[project.assets.length - 1]!;
  project = addClipFromAsset(project, added, { atFrame: 0 }).project;
  return project;
}

function renderHome(configure: (service: ReturnType<typeof createFakeService>) => void = () => {}) {
  const service = createFakeService();
  configure(service);
  const onNavigate = vi.fn();
  render(
    <ProjectProvider service={service}>
      <HomeView onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { service, onNavigate };
}

function renderHomeWithProject(withClip: boolean) {
  const project = projectDocument(withClip);
  const onNavigate = vi.fn();
  render(
    <ProjectProvider
      service={createFakeService()}
      initial={{
        project,
        opened: {
          project,
          label: 'home.editoria.json',
          path: 'C:\\tester\\home.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <HomeView onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { onNavigate };
}

/** Lector mínimo del estado real del store, sin mocks. */
function ExportProbe() {
  const store = useProjectStore();
  return <span data-testid="export-requested">{store.state.exportRequested ? 'sí' : 'no'}</span>;
}

/** Botones del hero, sin confundirlos con los del resto de la vista. */
function heroActions(): HTMLElement {
  const element = document.querySelector('.home-hero-actions');
  if (!(element instanceof HTMLElement)) throw new Error('no se encontró el hero de Inicio');
  return element;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('Inicio · sin demos muertas y con errores visibles', () => {
  it('no ofrece los CTAs "Probar demo" que apuntaban a proyectos inexistentes', async () => {
    render(<App service={createFakeService()} />);
    // La portada de Inicio se monta en el shell: se espera su título.
    expect(await screen.findByText(/Creá videos virales|Continuar con/i)).toBeTruthy();
    expect(screen.queryByText(/Probar demo/i)).toBeNull();
    expect(screen.queryByText(/demo Reels|demo YouTube/i)).toBeNull();
  });

  it('muestra el motivo cuando abrir un proyecto falla', async () => {
    const service = createFakeService();
    service.openProject = async () => {
      throw new Error('no se pudo leer el proyecto elegido');
    };
    render(<App service={service} />);

    fireEvent.click(await screen.findByRole('button', { name: /Abrir proyecto/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/no se pudo leer el proyecto elegido/i);
  });
});

describe('Inicio · acciones contextuales', () => {
  it('sin proyecto ofrece abrir, crear y la guía', () => {
    renderHome();

    const actions = heroActions();
    expect(within(actions).getByRole('button', { name: /Abrir proyecto/i })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: /Nuevo proyecto/i })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: /Ver la guía/i })).toBeTruthy();
  });

  it('con proyecto abierto prioriza continuar, exportar y guion', () => {
    const { onNavigate } = renderHomeWithProject(false);

    const actions = heroActions();
    expect(within(actions).getByRole('button', { name: /Continuar edición/i })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: /^Guion$/i })).toBeTruthy();
    const exportar = within(actions).getByRole('button', { name: /^Exportar$/i });
    // Sin clips no se puede exportar: el botón lo declara y no finge.
    expect(exportar).toHaveProperty('disabled', true);
    expect(exportar.getAttribute('title')).toMatch(/Montá al menos un clip/i);

    fireEvent.click(within(actions).getByRole('button', { name: /Continuar edición/i }));
    expect(onNavigate).toHaveBeenCalledWith('editor');

    fireEvent.click(within(actions).getByRole('button', { name: /^Guion$/i }));
    expect(onNavigate).toHaveBeenCalledWith('script');
  });

  it('con clips montados exportar navega al editor y deja la solicitud real', async () => {
    const project = projectDocument(true);
    const onNavigate = vi.fn();
    render(
      <ProjectProvider
        service={createFakeService()}
        initial={{
          project,
          opened: {
            project,
            label: 'home.editoria.json',
            path: 'C:\\tester\\home.editoria.json',
            root: 'C:\\tester',
          },
        }}
      >
        <HomeView onNavigate={onNavigate} />
        <ExportProbe />
      </ProjectProvider>,
    );

    const exportar = await within(heroActions()).findByRole('button', { name: /^Exportar$/i });
    await waitFor(() => expect(exportar).toHaveProperty('disabled', false));
    expect(screen.getByTestId('export-requested').textContent).toBe('no');

    fireEvent.click(exportar);

    expect(onNavigate).toHaveBeenCalledWith('editor');
    expect(screen.getByTestId('export-requested').textContent).toBe('sí');
  });
});
