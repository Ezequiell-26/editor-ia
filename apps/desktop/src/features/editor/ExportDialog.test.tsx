// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ExportDialog } from './ExportDialog';
import { ProjectProvider } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
  updateProjectSettings,
} from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';

const NOW = '2026-10-19T00:00:00.000Z';

function renderDialog() {
  const base = ensureDelivery(createEmptyProject('Lote masivo', NOW));
  const asset = readyAsset();
  const project = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 90,
  }).project;
  const service = createFakeService();
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
