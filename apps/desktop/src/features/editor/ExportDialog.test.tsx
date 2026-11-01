// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ExportDialog } from './ExportDialog';
import type { HardwareEncoders } from '../../services/project-service';
import { ProjectProvider } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
  updateProjectSettings,
} from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';

const NOW = '2026-10-19T00:00:00.000Z';

function renderDialog(hardware?: HardwareEncoders) {
  const base = ensureDelivery(createEmptyProject('Lote masivo', NOW));
  const asset = readyAsset();
  const project = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 90,
  }).project;
  const service = createFakeService();
  service.hardwareEncoders = async () =>
    hardware ?? { h264: null, hevc: null, checked: true };
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'lote.editoria.json',
          path: 'C:\\tester\\lote.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <ExportDialog open onClose={() => {}} />
    </ProjectProvider>,
  );
  return { service, project };
}

afterEach(() => cleanup());

describe('ExportDialog · lote de variantes', () => {
  it('exporta todos los perfiles a una carpeta en secuencia', async () => {
    const { service } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Elegir carpeta y exportar lote/i }));

    for (let index = 1; index <= 3; index += 1) {
      await waitFor(() => expect(service.calls.render).toBe(index));
      service.emitFinished({
        jobId: `job-${index}`,
        status: 'completed',
        code: null,
        message: null,
        detail: null,
        outputPath: `C:\\Users\\tester\\Exports\\lote-${index}.mp4`,
        outputBytes: 1000,
        durationSeconds: 1,
        width: 1920,
        height: 1080,
        elapsedMs: 10,
      });
    }

    await waitFor(() => expect(screen.getAllByText(/OK · lote-/i)).toHaveLength(3));
  });

  it('muestra el perfil del proyecto y aplica compresión compacta', () => {
    const base = updateProjectSettings(ensureDelivery(createEmptyProject('Formato raro', NOW)), {
      width: 1440,
      height: 1080,
    });
    const asset = readyAsset();
    const project = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 90,
    }).project;
    render(
      <ProjectProvider
        service={createFakeService()}
        initial={{
          project,
          opened: {
            project,
            label: 'formato.editoria.json',
            path: 'C:\\tester\\formato.editoria.json',
            root: 'C:\\tester',
          },
        }}
      >
        <ExportDialog open onClose={() => {}} />
      </ProjectProvider>,
    );

    const native = project.renderProfiles.find((profile) =>
      profile.name.startsWith('Formato del proyecto'),
    );
    expect(native?.aspectRatio).toBe('4:3');
    const select = screen.getByLabelText(/^Perfil$/i) as HTMLSelectElement;
    expect(select.value).toBe(native?.id);
    fireEvent.click(screen.getByRole('button', { name: /^Compacto/i }));
    expect(screen.getAllByText(/faster/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/96 kbps/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CRF 27/i).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(/^Encuadre$/i), {
      target: { value: 'cover' },
    });
    expect(screen.getAllByText(/Recortar para llenar/i).length).toBeGreaterThan(0);
  });

  it('no usa la GPU detectada cuando el render corto no la necesita', async () => {
    const { service } = renderDialog({
      h264: 'h264_amf',
      hevc: null,
      checked: true,
    });
    const gpu = await screen.findByRole('checkbox', { name: /Acelerar con GPU/i });
    expect(gpu.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/no recomendada para este render/i)).toBeTruthy();
    expect(screen.getByText(/mantiene el encoder por software/i)).toBeTruthy();

    const spy = vi.spyOn(service, 'startRenderTo');
    fireEvent.click(screen.getByRole('button', { name: /Elegir carpeta y exportar lote/i }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[4]).toBeNull();
  });

  it('ofrece la GPU detectada para un preset pesado y la pasa al lote', async () => {
    const { service } = renderDialog({
      h264: 'h264_amf',
      hevc: null,
      checked: true,
    });
    fireEvent.click(screen.getByRole('button', { name: /Máxima calidad/i }));
    const gpu = await screen.findByRole('checkbox', { name: /Acelerar con GPU/i });
    await waitFor(() => expect(gpu.hasAttribute('disabled')).toBe(false));
    fireEvent.click(gpu);
    const spy = vi.spyOn(service, 'startRenderTo');
    fireEvent.click(screen.getByRole('button', { name: /Elegir carpeta y exportar lote/i }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[4]).toBe('h264_amf');
  });

  it('apaga la GPU al volver a un preset rápido', async () => {
    renderDialog({
      h264: 'h264_amf',
      hevc: null,
      checked: true,
    });
    fireEvent.click(screen.getByRole('button', { name: /Máxima calidad/i }));
    const gpu = await screen.findByRole('checkbox', { name: /Acelerar con GPU/i });
    await waitFor(() => expect(gpu.hasAttribute('disabled')).toBe(false));
    fireEvent.click(gpu);
    expect((gpu as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^Equilibrado/i }));
    await waitFor(() => {
      expect(gpu.hasAttribute('disabled')).toBe(true);
      expect((gpu as HTMLInputElement).checked).toBe(false);
    });
  });

  it('se detiene si un render falla', async () => {
    const { service } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Elegir carpeta y exportar lote/i }));
    await waitFor(() => expect(service.calls.render).toBe(1));
    service.emitFinished({
      jobId: 'job-1',
      status: 'failed',
      code: 'RENDER_FAILED',
      message: 'ffmpeg falló',
      detail: null,
      outputPath: null,
      outputBytes: null,
      durationSeconds: null,
      width: null,
      height: null,
      elapsedMs: 10,
    });

    await waitFor(() => expect(screen.getByText(/El lote se detuvo/i)).toBeTruthy());
    expect(screen.getAllByText(/Falló · ffmpeg falló/i)).toHaveLength(1);
  });
});
