// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    const sceneRow = screen.getByText('Escritorio + stream').closest('li');
    expect(sceneRow).toBeTruthy();
    fireEvent.click(within(sceneRow as HTMLElement).getByRole('button', { name: 'Vista previa' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('scene-1'));
    await waitFor(() =>
      expect(screen.getByAltText('Vista previa de la escena')).toBeTruthy(),
    );
  });

  it('captura un frame de la grabación ad-hoc con la config del formulario', async () => {
    const service = renderView((svc) => {
      svc.screenRecordDevices = async () => ({
        cameras: ['Test camera'],
        microphones: ['Test microphone'],
      });
    });
    const spy = vi.spyOn(service, 'screenRecordSnapshot');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Test camera' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/C.mara \(webcam PiP\)/), {
      target: { value: 'Test camera' },
    });
    fireEvent.change(screen.getByLabelText('FPS'), { target: { value: '60' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Vista previa' })[0]!);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      fps: 60,
      webcamDevice: 'Test camera',
      captureScreen: true,
    });
    await waitFor(() =>
      expect(screen.getByAltText('Vista previa de la grabación')).toBeTruthy(),
    );
  });

  it('muestra el error del backend cuando el preview ad-hoc falla', async () => {
    const service = renderView((svc) => {
      svc.screenRecordSnapshot = async () => ({
        ok: false,
        error: 'ffmpeg no está disponible para el preview',
      });
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Vista previa' })[0]!);
    await waitFor(() =>
      expect(screen.getByText('ffmpeg no está disponible para el preview')).toBeTruthy(),
    );
    expect(screen.queryByAltText('Vista previa de la grabación')).toBeNull();
  });

  it('guarda los ajustes OBS de chroma key y cursor en una escena', async () => {
    const service = renderView((svc) => {
      svc.screenRecordDevices = async () => ({
        cameras: ['Test camera'],
        microphones: ['Test microphone'],
      });
    });
    const spy = vi.spyOn(service, 'obsSceneSave');

    await waitFor(() => expect(screen.getByRole('option', { name: 'Test camera' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/C.mara \(webcam PiP\)/), {
      target: { value: 'Test camera' },
    });
    await waitFor(() => expect(screen.getByLabelText(/Chroma key en la c.mara/)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Chroma key en la c.mara/));
    fireEvent.change(screen.getByLabelText('Color a eliminar'), {
      target: { value: '#00ff00' },
    });
    fireEvent.change(screen.getByLabelText(/Tolerancia/), {
      target: { value: '0.42' },
    });
    fireEvent.change(screen.getByLabelText(/Dureza del borde/), {
      target: { value: '0.15' },
    });
    fireEvent.change(screen.getByLabelText(/Cursor en el v/), {
      target: { value: '3d' },
    });
    fireEvent.change(screen.getByLabelText('Color del cursor'), {
      target: { value: 'amarillo' },
    });
    fireEvent.change(screen.getByLabelText(/Tama.o del cursor/), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByLabelText('Anillo en cada click'));

    fireEvent.change(screen.getByPlaceholderText('Ej. Charla con webcam'), {
      target: { value: 'Escena con efectos' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar escena/ }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      name: 'Escena con efectos',
      webcamDevice: 'Test camera',
      webcamChroma: { color: '#00ff00', similarity: 0.42, blend: 0.15 },
      cursorOverlay: { style: '3d', color: 'amarillo', scale: 2, ripple: false },
    });
  });

  it('restaura los ajustes OBS al editar una escena guardada', async () => {
    renderView((svc) => {
      svc.screenRecordDevices = async () => ({
        cameras: ['Test camera'],
        microphones: ['Test microphone'],
      });
      svc.obsSceneList = async () => [
        {
          id: 'scene-effects',
          name: 'Escena con efectos',
          captureTarget: 'desktop',
          webcamDevice: 'Test camera',
          webcamChroma: { color: '#00ff00', similarity: 0.42, blend: 0.15 },
          cursorOverlay: { style: '3d', color: 'amarillo', scale: 2, ripple: false },
        },
      ];
    });

    await waitFor(() => expect(screen.getByRole('option', { name: 'Test camera' })).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    expect((screen.getByLabelText(/Chroma key en la c.mara/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Color a eliminar') as HTMLInputElement).value).toBe('#00ff00');
    expect((screen.getByLabelText(/Tolerancia/) as HTMLInputElement).value).toBe('0.42');
    expect((screen.getByLabelText(/Dureza del borde/) as HTMLInputElement).value).toBe('0.15');
    expect((screen.getByLabelText(/Cursor en el v/) as HTMLSelectElement).value).toBe('3d');
    expect((screen.getByLabelText('Color del cursor') as HTMLSelectElement).value).toBe('amarillo');
    expect((screen.getByLabelText(/Tama.o del cursor/) as HTMLSelectElement).value).toBe('2');
    expect((screen.getByLabelText('Anillo en cada click') as HTMLInputElement).checked).toBe(false);
  });
});
