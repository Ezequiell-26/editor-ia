// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { RecordView } from './RecordView';

const NOW = '2026-11-07T00:00:00.000Z';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderView(patch?: (service: ReturnType<typeof createFakeService>) => void) {
  const project = createEmptyProject('Grabación', NOW);
  const service = createFakeService();
  patch?.(service);
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'grabacion.editoria.json',
          path: 'C:\\tester\\grabacion.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <RecordView onNavigate={() => undefined} />
    </ProjectProvider>,
  );
  return service;
}

describe('RecordView', () => {
  it('muestra la captura rápida y las escenas guardadas', async () => {
    renderView();
    expect(screen.getByText('Grabación y escenas OBS')).toBeTruthy();
    expect(screen.getByText('Escritorio completo')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Escritorio + stream')).toBeTruthy());
  });

  it('inicia una grabación con la configuración del formulario', async () => {
    const service = renderView((svc) => {
      svc.chooseDownloadDirectory = async () => 'C:\\recordings';
    });
    const spy = vi.spyOn(service, 'screenRecordStart');
    fireEvent.click(screen.getByRole('button', { name: /Grabar/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Grabación iniciada|streameando/)).toBeTruthy());
  });

  it('guarda una escena nueva con el nombre escrito', async () => {
    const service = renderView();
    const spy = vi.spyOn(service, 'obsSceneSave');
    fireEvent.change(screen.getByPlaceholderText('Ej. Charla con webcam'), {
      target: { value: 'Mi escena' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar escena/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const saved = spy.mock.calls[0]?.[0] as { name: string };
    expect(saved.name).toBe('Mi escena');
  });

  it('pide preview de una escena y muestra el frame', async () => {
    const service = renderView();
    const spy = vi.spyOn(service, 'obsScenePreview');
    await waitFor(() => expect(screen.getByText('Escritorio + stream')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Vista previa' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('scene-1'));
    await waitFor(() =>
      expect(screen.getByAltText('Vista previa de la escena')).toBeTruthy(),
    );
  });
});
