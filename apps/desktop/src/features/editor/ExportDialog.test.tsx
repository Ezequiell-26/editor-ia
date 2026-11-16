// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ExportDialog } from './ExportDialog';
import type { HardwareEncoders } from '../../services/project-service';
import { ProjectProvider } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  applyCompression,
  ensureDelivery,
  updateProjectSettings,
} from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import type { RenderQueueEntry } from '../../state/render-queue';
import type { QualityGateReport } from '../../services/project-service';

const NOW = '2026-10-19T00:00:00.000Z';

function queueEntry(
  id: string,
  status: RenderQueueEntry['status'],
  projectId = 'otro-proyecto',
): RenderQueueEntry {
  return {
    id,
    profileId: `perfil-${id}`,
    profileName: `Perfil ${id}`,
    includeCaptions: false,
    status,
    outputPath: status === 'done' ? `C:\\tester\\Exports\\${id}.mp4` : null,
    message: status === 'error' ? 'falló' : null,
    queuedAt: NOW,
    projectId,
    projectName: 'Otro proyecto',
  };
}

function renderDialog(
  hardware?: HardwareEncoders,
  mutate?: (project: ProjectDocument) => ProjectDocument,
  seedQueue?: readonly RenderQueueEntry[],
) {
  const base = ensureDelivery(createEmptyProject('Lote masivo', NOW));
  const asset = readyAsset();
  const built = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 90,
  }).project;
  const project = mutate ? mutate(built) : built;
  const service = createFakeService();
  service.hardwareEncoders = async () =>
    hardware ?? { h264: null, hevc: null, av1: null, vp9: null, checked: true };
  if (seedQueue) void service.renderQueueSave(seedQueue);
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
      av1: null,
      vp9: null,
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
      av1: null,
      vp9: null,
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
      av1: null,
      vp9: null,
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

  it('ofrece la GPU AV1 detectada y la pasa al lote WebM', async () => {
    const { service } = renderDialog(
      { h264: null, hevc: null, av1: 'av1_nvenc', vp9: null, checked: true },
      (project) => applyCompression(project, 'equilibrado', 'av1'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Máxima calidad/i }));
    const gpu = await screen.findByRole('checkbox', { name: /Acelerar con GPU/i });
    await waitFor(() => expect(gpu.hasAttribute('disabled')).toBe(false));
    expect(screen.getByText(/av1_nvenc/i)).toBeTruthy();
    fireEvent.click(gpu);
    const spy = vi.spyOn(service, 'startRenderTo');
    fireEvent.click(screen.getByRole('button', { name: /Elegir carpeta y exportar lote/i }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[4]).toBe('av1_nvenc');
  });

  it('con ProRes sólo ofrece los pixel formats 10-bit que el backend emite', async () => {
    renderDialog(undefined, (project) => applyCompression(project, 'maximo', 'prores'));

    const codec = (await screen.findByLabelText(/^Códec de video$/i)) as HTMLSelectElement;
    expect(codec.value).toBe('prores');

    const pixel = screen.getByLabelText(/^Pixel format$/i) as HTMLSelectElement;
    expect(pixel.value).toBe('yuv422p10le');
    const byValue = (value: string) =>
      Array.from(pixel.options).find((option) => option.value === value);
    // 4:2:0/4:4:4 de 8 bits son inválidos con ProRes: el schema y
    // `pixel_format_for` los rechazan, así que la UI los deshabilita.
    expect(byValue('yuv420p')?.disabled).toBe(true);
    expect(byValue('yuv444p')?.disabled).toBe(true);
    expect(byValue('yuv422p10le')?.disabled).toBe(false);
    expect(byValue('yuva444p10le')?.disabled).toBe(false);
  });

  it('sin ProRes no ofrece los pixel formats 10-bit de edición', () => {
    renderDialog();

    const pixel = screen.getByLabelText(/^Pixel format$/i) as HTMLSelectElement;
    const values = Array.from(pixel.options).map((option) => option.value);
    expect(values).not.toContain('yuv422p10le');
    expect(values).not.toContain('yuva444p10le');
    expect(pixel.value).toBe('yuv420p');
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

describe('ExportDialog · Quality Gate', () => {
  it('guarda el proyecto y muestra el veredicto con sus hallazgos', async () => {
    const { service } = renderDialog();
    const report: QualityGateReport = {
      passed: false,
      errors: 1,
      warnings: 1,
      findings: [
        {
          check: 'missing-resources',
          severity: 'error',
          path: 'assets[0].file',
          message: 'el archivo del asset no existe en disco',
        },
        {
          check: 'loudness',
          severity: 'warning',
          path: 'audio.mix',
          message: 'loudness integrado fuera del objetivo',
        },
      ],
    };
    const gateSpy = vi.spyOn(service, 'qualityGateReview').mockResolvedValue(report);
    const saveSpy = vi.spyOn(service, 'saveProject');

    fireEvent.click(screen.getByRole('button', { name: /Revisar calidad/i }));

    await waitFor(() => expect(gateSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/No aprobado: 1 error\(es\) · 1 advertencia\(s\)/i)).toBeTruthy();
    expect(screen.getByText(/Recursos faltantes/)).toBeTruthy();
    expect(screen.getByText(/el archivo del asset no existe en disco/)).toBeTruthy();
    expect(screen.getByText(/loudness integrado fuera del objetivo/)).toBeTruthy();
    // El gate evalúa lo persistido: la UI guarda antes de pedir el veredicto.
    expect(saveSpy).toHaveBeenCalled();
  });

  it('muestra el veredicto aprobado cuando no hay errores', async () => {
    const { service } = renderDialog();
    vi.spyOn(service, 'qualityGateReview').mockResolvedValue({
      passed: true,
      errors: 0,
      warnings: 0,
      findings: [],
    });

    fireEvent.click(screen.getByRole('button', { name: /Revisar calidad/i }));

    expect(await screen.findByText(/Aprobado: sin errores bloqueantes/i)).toBeTruthy();
  });

  it('muestra el error del servicio sin inventar un veredicto', async () => {
    const { service } = renderDialog();
    vi.spyOn(service, 'qualityGateReview').mockRejectedValue(new Error('sin proyecto abierto'));

    fireEvent.click(screen.getByRole('button', { name: /Revisar calidad/i }));

    expect(await screen.findByText(/sin proyecto abierto/)).toBeTruthy();
    expect(screen.queryByText(/Aprobado/i)).toBeNull();
  });
});

describe('ExportDialog · limpieza de cola finalizada', () => {
  it('vacía las terminadas vía backend y refresca la lista', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { service } = renderDialog(undefined, undefined, [
      queueEntry('done-1', 'done'),
      queueEntry('done-2', 'error'),
      queueEntry('pendiente-ajeno', 'pending'),
    ]);
    const clearSpy = vi.spyOn(service, 'renderQueueClearFinished');

    // Las entradas sembradas son de otro proyecto: se listan pero no drenan.
    expect(await screen.findByText('Perfil done-1')).toBeTruthy();
    const clearButton = screen.getByRole('button', { name: /Limpiar finalizadas del equipo/i });
    expect(clearButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(clearButton);

    await waitFor(() => expect(clearSpy).toHaveBeenCalledTimes(1));
    // El backend devuelve la cola restante (sólo el pendiente ajeno).
    await waitFor(() => expect(screen.queryByText('Perfil done-1')).toBeNull());
    expect(screen.queryByText('Perfil done-2')).toBeNull();
    expect(screen.getByText('Perfil pendiente-ajeno')).toBeTruthy();
    // Con pocas terminadas no hubo confirmación.
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('pide confirmación cuando hay muchas finalizadas y respeta la cancelación', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { service } = renderDialog(undefined, undefined, [
      queueEntry('d1', 'done'),
      queueEntry('d2', 'done'),
      queueEntry('d3', 'error'),
      queueEntry('d4', 'cancelled'),
      queueEntry('d5', 'done'),
      queueEntry('d6', 'error'),
    ]);
    const clearSpy = vi.spyOn(service, 'renderQueueClearFinished');

    // Esperar la hidratación desde el backend antes de usar la cola.
    expect(await screen.findByText('Perfil d1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Limpiar finalizadas del equipo/i }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(clearSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Perfil d1')).toBeTruthy();
  });
});
