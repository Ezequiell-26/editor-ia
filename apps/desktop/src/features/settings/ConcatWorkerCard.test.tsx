// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { ConcatWorkerCard } from './ConcatWorkerCard';

afterEach(cleanup);

function renderCard(service: ReturnType<typeof createFakeService>) {
  render(
    <ProjectProvider service={service}>
      <ConcatWorkerCard />
    </ProjectProvider>,
  );
}

const AVAILABLE_STATUS = {
  available: true,
  path: 'C:\\tools\\concat-worker.exe',
  reason: null,
  ops: ['ping', 'probe', 'decode_frame', 'shutdown'],
  running: false,
};

describe('tarjeta del concat-worker', () => {
  it('muestra el worker no disponible con el motivo real del backend', async () => {
    renderCard(createFakeService());
    expect(await screen.findByText('No disponible')).toBeTruthy();
    expect(
      screen.getByText(/concat-worker\.exe no está compilado ni empaquetado/),
    ).toBeTruthy();
    // Sin binario no se puede probar la conexión.
    expect(
      (screen.getByRole('button', { name: /Probar conexión/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('con worker disponible muestra ruta, ops y estado de sesión', async () => {
    const service = createFakeService();
    service.concatWorkerStatus = async () => ({ ...AVAILABLE_STATUS, running: true });
    renderCard(service);
    expect(await screen.findByText('Disponible')).toBeTruthy();
    expect(screen.getByText(/Binario presente · proceso activo/)).toBeTruthy();
    expect(screen.getByText('C:\\tools\\concat-worker.exe')).toBeTruthy();
    const list = document.querySelector('.data-list');
    expect(list?.textContent).toContain('ping');
    expect(list?.textContent).toContain('decode_frame');
    expect(list?.textContent).toContain('shutdown');
  });

  it('«Probar conexión» llama ping y muestra el envelope real', async () => {
    const service = createFakeService();
    service.concatWorkerStatus = async () => AVAILABLE_STATUS;
    const request = vi.spyOn(service, 'concatWorkerRequest');
    renderCard(service);

    const ping = await screen.findByRole('button', { name: /Probar conexión/i });
    await waitFor(() => expect((ping as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(ping);

    await waitFor(() => expect(request).toHaveBeenCalledWith('ping', null, 10_000));
    expect(await screen.findByText('Respuesta del worker')).toBeTruthy();
    expect(screen.getByText(/"pong": true/)).toBeTruthy();
  });

  it('muestra el error del envelope cuando el worker responde ok:false', async () => {
    const service = createFakeService();
    service.concatWorkerStatus = async () => AVAILABLE_STATUS;
    service.concatWorkerRequest = async () => ({
      ok: false,
      error: 'timeout esperando respuesta del worker',
    });
    renderCard(service);

    const ping = await screen.findByRole('button', { name: /Probar conexión/i });
    await waitFor(() => expect((ping as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(ping);

    expect(await screen.findByText('Falló la prueba')).toBeTruthy();
    expect(screen.getByText(/timeout esperando respuesta/)).toBeTruthy();
  });

  it('un throw de transporte se muestra como fallo de la prueba', async () => {
    const service = createFakeService();
    service.concatWorkerStatus = async () => AVAILABLE_STATUS;
    service.concatWorkerRequest = async () => {
      throw new Error('el concat-worker falló: proceso terminado');
    };
    renderCard(service);

    const ping = await screen.findByRole('button', { name: /Probar conexión/i });
    await waitFor(() => expect((ping as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(ping);

    expect(await screen.findByText('Falló la prueba')).toBeTruthy();
    expect(screen.getByText(/proceso terminado/)).toBeTruthy();
  });

  it('en modo navegador explica que el estado sólo existe en la app', async () => {
    const service = {
      ...createFakeService(),
      available: false,
      unavailableReason: 'Esta es la versión web de evaluación.',
    };
    renderCard(service as ReturnType<typeof createFakeService>);
    expect(await screen.findByText(/sólo se puede leer en la app de escritorio/i)).toBeTruthy();
  });
});
