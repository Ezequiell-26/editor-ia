// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConcatWorkerEnvelope, ConcatWorkerEvent } from '../../services/project-service';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { ConcatWorkerExportPanel } from './ConcatWorkerExportPanel';

afterEach(cleanup);

function renderPanel(service: ReturnType<typeof createFakeService>) {
  render(
    <ProjectProvider service={service}>
      <ConcatWorkerExportPanel />
    </ProjectProvider>,
  );
}

const AVAILABLE_STATUS = {
  available: true,
  path: 'C:\\tools\\concat-worker.exe',
  reason: null,
  ops: ['ping', 'probe', 'decode_frame', 'render_export', 'shutdown'],
  running: false,
};

async function expandForm() {
  const toggle = await screen.findByRole('button', {
    name: /Configurar render con clips/i,
  });
  fireEvent.click(toggle);
  return screen.findByLabelText(/Archivo de salida/i);
}

describe('panel de export con concat-worker', () => {
  it('muestra el worker no disponible con el motivo real y sin formulario', async () => {
    renderPanel(createFakeService());
    // El estado aparece en el encabezado y en el detalle: ambos dicen lo mismo.
    expect((await screen.findAllByText(/No disponible/)).length).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText(/concat-worker\.exe no está compilado ni empaquetado/))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: /Configurar render con clips/i }),
    ).toBeNull();
  });

  it('en modo navegador declara que el worker sólo existe en la app', async () => {
    const service = {
      ...createFakeService(),
      available: false,
      unavailableReason: 'Esta es la versión web de evaluación.',
    };
    renderPanel(service as ReturnType<typeof createFakeService>);
    expect(
      await screen.findByText(/sólo existe en la app de escritorio/i),
    ).toBeTruthy();
  });

  it('worker disponible: valida el formulario antes de llamar al worker', async () => {
    const service = createFakeService();
    service.concatWorkerStatus = async () => AVAILABLE_STATUS;
    const request = vi.spyOn(service, 'concatWorkerRequest');
    renderPanel(service);

    await expandForm();
    const renderButton = screen.getByRole('button', {
      name: /Renderizar con concat-worker/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(renderButton.disabled).toBe(false));
    fireEvent.click(renderButton);

    // Sin salida ni clips no se gasta la request: error de validación local.
    expect(await screen.findByText(/Elegí el archivo de salida/)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });

  it('envía render_export con los params del protocolo y muestra el resultado', async () => {
    const service = createFakeService();
    service.concatWorkerStatus = async () => AVAILABLE_STATUS;
    const request = vi.spyOn(service, 'concatWorkerRequest');
    renderPanel(service);

    const output = await expandForm();
    fireEvent.change(output, { target: { value: 'C:\\exports\\mix.mp4' } });
    fireEvent.change(screen.getByPlaceholderText(/clip\.mp4/i), {
      target: { value: 'D:\\media\\a.mp4' },
    });
    fireEvent.change(screen.getByPlaceholderText('resto del medio'), {
      target: { value: '2' },
    });

    const renderButton = screen.getByRole('button', {
      name: /Renderizar con concat-worker/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(renderButton.disabled).toBe(false));
    fireEvent.click(renderButton);

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'render_export',
        expect.objectContaining({
          output: 'C:\\exports\\mix.mp4',
          codec: 'h264',
          frame_rate: '30',
          clips: [
            expect.objectContaining({
              path: 'D:\\media\\a.mp4',
              duration: '2',
              fit: 'contain',
              audio: false,
            }),
          ],
        }),
        600_000,
      ),
    );
    expect(await screen.findByText('Render completado')).toBeTruthy();
    expect(screen.getByText(/"codec": "h264"/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Abrir carpeta/i }),
    ).toBeTruthy();
  });

  it('muestra el error del envelope cuando el worker responde ok:false', async () => {
    const service = createFakeService();
    service.concatWorkerStatus = async () => AVAILABLE_STATUS;
    service.concatWorkerRequest = async () => ({
      ok: false,
      error: 'clip 1: no such file',
    });
    renderPanel(service);

    const output = await expandForm();
    fireEvent.change(output, { target: { value: 'C:\\exports\\mix.mp4' } });
    fireEvent.change(screen.getByPlaceholderText(/clip\.mp4/i), {
      target: { value: 'D:\\media\\a.mp4' },
    });
    const renderButton = screen.getByRole('button', {
      name: /Renderizar con concat-worker/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(renderButton.disabled).toBe(false));
    fireEvent.click(renderButton);

    expect(await screen.findByText('Falló el render')).toBeTruthy();
    expect(screen.getByText(/no such file/)).toBeTruthy();
  });

  it('muestra el progreso del worker y permite cancelar el render', async () => {
    const service = createFakeService();
    service.concatWorkerStatus = async () => AVAILABLE_STATUS;
    // Captura el handler del evento Tauri y deja la request pendiente:
    // el render "está en curso" hasta que el test la resuelve.
    let emitEvent: ((event: ConcatWorkerEvent) => void) | null = null;
    service.onConcatWorkerEvent = async (handler) => {
      emitEvent = handler;
      return () => {};
    };
    const cancelSpy = vi.spyOn(service, 'concatWorkerCancelRender');
    let resolveRequest: ((envelope: ConcatWorkerEnvelope) => void) | null = null;
    service.concatWorkerRequest = () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      });
    renderPanel(service);

    const output = await expandForm();
    fireEvent.change(output, { target: { value: 'C:\\exports\\mix.mp4' } });
    fireEvent.change(screen.getByPlaceholderText(/clip\.mp4/i), {
      target: { value: 'D:\\media\\a.mp4' },
    });
    const renderButton = screen.getByRole('button', {
      name: /Renderizar con concat-worker/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(renderButton.disabled).toBe(false));
    fireEvent.click(renderButton);

    // Evento de progreso del worker: fase + frames + porcentaje.
    act(() => {
      emitEvent?.({
        type: 'render_export_progress',
        phase: 'composite',
        frames: 5,
        frames_total: 10,
        percent: 0.5,
      });
    });
    expect(await screen.findByText(/Renderizando frames/)).toBeTruthy();
    expect(screen.getByText(/frame 5 de 10/)).toBeTruthy();
    expect(screen.getByText(/\(50 %\)/)).toBeTruthy();

    // Cancelar: llama al comando dedicado (no a concatWorkerRequest).
    const cancelButton = screen.getByRole('button', { name: /Cancelar render/i });
    fireEvent.click(cancelButton);
    await waitFor(() => expect(cancelSpy).toHaveBeenCalledTimes(1));

    // El worker confirma con cancel_ack y la request responde ok:false.
    act(() => {
      emitEvent?.({ type: 'cancel_ack', target: 'render_export' });
    });
    await waitFor(() => expect(screen.getByText(/cancelación enviada/)).toBeTruthy());
    act(() => {
      resolveRequest?.({ ok: false, error: 'render_export cancelled' });
    });
    expect(await screen.findByText('Render cancelado')).toBeTruthy();
    expect(screen.getByText(/cancelled/)).toBeTruthy();
  });

  it('un render exitoso limpia el progreso y muestra el resultado', async () => {
    const service = createFakeService();
    service.concatWorkerStatus = async () => AVAILABLE_STATUS;
    let emitEvent: ((event: ConcatWorkerEvent) => void) | null = null;
    service.onConcatWorkerEvent = async (handler) => {
      emitEvent = handler;
      return () => {};
    };
    // Request diferida: el render queda "en curso" hasta resolverla, así el
    // progreso emitido se puede observar antes del resultado.
    let resolveRequest: ((envelope: ConcatWorkerEnvelope) => void) | null = null;
    service.concatWorkerRequest = () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      });
    renderPanel(service);

    const output = await expandForm();
    fireEvent.change(output, { target: { value: 'C:\\exports\\ok.mp4' } });
    fireEvent.change(screen.getByPlaceholderText(/clip\.mp4/i), {
      target: { value: 'D:\\media\\a.mp4' },
    });
    const renderButton = screen.getByRole('button', {
      name: /Renderizar con concat-worker/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(renderButton.disabled).toBe(false));
    fireEvent.click(renderButton);

    act(() => {
      emitEvent?.({
        type: 'render_export_progress',
        phase: 'audio',
      });
    });
    expect(await screen.findByText(/Mezclando audio/)).toBeTruthy();
    // Sin frames en el evento de fase: no muestra "frame x de y".
    expect(screen.queryByText(/frame \d+ de \d+/)).toBeNull();

    act(() => {
      resolveRequest?.({
        ok: true,
        output: 'C:\\exports\\ok.mp4',
        frames: 10,
        codec: 'h264',
      });
    });
    await waitFor(() => expect(screen.findByText('Render completado')).toBeTruthy());
    // Terminó el render: el progreso ya no se muestra.
    expect(screen.queryByText(/Mezclando audio/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancelar render/i })).toBeNull();
  });

  it('un throw de transporte se muestra como fallo del render', async () => {
    const service = createFakeService();
    service.concatWorkerStatus = async () => AVAILABLE_STATUS;
    service.concatWorkerRequest = async () => {
      throw new Error('el concat-worker falló: proceso terminado');
    };
    renderPanel(service);

    const output = await expandForm();
    fireEvent.change(output, { target: { value: 'C:\\exports\\mix.mp4' } });
    fireEvent.change(screen.getByPlaceholderText(/clip\.mp4/i), {
      target: { value: 'D:\\media\\a.mp4' },
    });
    const renderButton = screen.getByRole('button', {
      name: /Renderizar con concat-worker/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(renderButton.disabled).toBe(false));
    fireEvent.click(renderButton);

    expect(await screen.findByText('Falló el render')).toBeTruthy();
    expect(screen.getByText(/proceso terminado/)).toBeTruthy();
  });
});

describe('curva de velocidad (speed_curve) del concat-worker', () => {
  async function fillClipForm() {
    const service = createFakeService();
    service.concatWorkerStatus = async () => AVAILABLE_STATUS;
    const request = vi.spyOn(service, 'concatWorkerRequest');
    renderPanel(service);
    const output = await expandForm();
    fireEvent.change(output, { target: { value: 'C:\\exports\\mix.mp4' } });
    fireEvent.change(screen.getByPlaceholderText(/clip\.mp4/i), {
      target: { value: 'D:\\media\\a.mp4' },
    });
    const renderButton = screen.getByRole('button', {
      name: /Renderizar con concat-worker/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(renderButton.disabled).toBe(false));
    return { request, renderButton };
  }

  function curveToggle() {
    return screen.getByRole('checkbox', { name: /Curva de velocidad/i });
  }

  it('activa y desactiva la curva; sin curva no se envía speed_curve', async () => {
    const { request, renderButton } = await fillClipForm();

    // Apagada: no hay inputs de puntos y el campo velocidad queda habilitado.
    expect(screen.queryByLabelText('Clip 1, punto 1: posición')).toBeNull();
    const speedInput = screen.getByLabelText(/Velocidad \(opcional\)/i) as HTMLInputElement;
    expect(speedInput.disabled).toBe(false);

    // Encendida: aparecen los 2 puntos semilla y la velocidad se deshabilita
    // (el worker ignoraría `speed` de todos modos).
    fireEvent.click(curveToggle());
    expect(screen.getByLabelText('Clip 1, punto 1: posición')).toBeTruthy();
    expect(screen.getByLabelText('Clip 1, punto 2: posición')).toBeTruthy();
    expect(speedInput.disabled).toBe(true);

    // Apagada de nuevo: el request no lleva speed_curve.
    fireEvent.click(curveToggle());
    expect(screen.queryByLabelText('Clip 1, punto 1: posición')).toBeNull();
    fireEvent.click(renderButton);
    await waitFor(() => expect(request).toHaveBeenCalled());
    const params = request.mock.calls[0]?.[1] as {
      clips: Record<string, unknown>[];
    };
    expect(params.clips[0]).not.toHaveProperty('speed_curve');
  });

  it('serializa speed_curve con {at,speed} y omite slope vacío', async () => {
    const { request, renderButton } = await fillClipForm();
    fireEvent.click(curveToggle());

    fireEvent.change(screen.getByLabelText('Clip 1, punto 1: velocidad'), {
      target: { value: '0.5' },
    });
    fireEvent.change(screen.getByLabelText('Clip 1, punto 1: pendiente'), {
      target: { value: '0.25' },
    });
    fireEvent.change(screen.getByLabelText('Clip 1, punto 2: velocidad'), {
      target: { value: '2' },
    });

    fireEvent.click(renderButton);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'render_export',
        expect.objectContaining({
          clips: [
            expect.objectContaining({
              speed_curve: [
                { at: 0, speed: 0.5, slope: 0.25 },
                { at: 1, speed: 2 },
              ],
            }),
          ],
        }),
        600_000,
      ),
    );
    expect(await screen.findByText('Render completado')).toBeTruthy();
  });

  it('rechaza posiciones no crecientes sin llamar al worker', async () => {
    const { request, renderButton } = await fillClipForm();
    fireEvent.click(curveToggle());
    fireEvent.change(screen.getByLabelText('Clip 1, punto 2: posición'), {
      target: { value: '0' },
    });

    fireEvent.click(renderButton);
    expect(
      await screen.findByText(/punto 2: las posiciones tienen que ser crecientes/),
    ).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });

  it('rechaza velocidad 0 en un punto sin llamar al worker', async () => {
    const { request, renderButton } = await fillClipForm();
    fireEvent.click(curveToggle());
    fireEvent.change(screen.getByLabelText('Clip 1, punto 1: velocidad'), {
      target: { value: '0' },
    });

    fireEvent.click(renderButton);
    expect(
      await screen.findByText(/velocidad tiene que ser un número mayor que 0/),
    ).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
});
