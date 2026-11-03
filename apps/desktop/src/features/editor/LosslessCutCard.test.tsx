// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { LosslessCutCard } from './LosslessCutCard';

afterEach(cleanup);

function setup() {
  const service = createFakeService();
  const asset = readyAsset({ label: 'Toma', source: { type: 'local', path: 'media/toma.mp4' } });
  const project = addAsset(ensureDelivery(createEmptyProject('Corte', '2026-11-03T00:00:00.000Z')), asset);
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'corte.editoria.json',
          path: 'C://tester//corte.editoria.json',
          root: 'C://tester',
        },
      }}
    >
      <LosslessCutCard asset={asset} />
    </ProjectProvider>,
  );
  return { service, asset };
}

describe('corte sin recodificar', () => {
  it('corta el rango pedido y muestra la duración real', async () => {
    const { service } = setup();
    const cut = vi.spyOn(service, 'exportLossless').mockResolvedValue({
      path: 'C://tester//entregas//Toma-corte.mp4',
      bytes: 1024,
      requestedSeconds: 10,
      actualSeconds: 9.4,
      startShiftSeconds: 0.6,
    });
    fireEvent.change(screen.getByLabelText('Inicio (s)'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Fin (s)'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: /Cortar sin recodificar/ }));
    await waitFor(() => expect(cut).toHaveBeenCalled());
    const args = cut.mock.calls[0]?.[0];
    expect(args?.input.endsWith('media\\toma.mp4')).toBe(true);
    expect(args?.output.endsWith('entregas\\Toma-corte.mp4')).toBe(true);
    expect(args?.startSeconds).toBe(5);
    expect(args?.endSeconds).toBe(15);
    expect(await screen.findByText(/9\.40 s reales/)).toBeTruthy();
    expect(screen.getByText(/se corrió 0\.60 s/)).toBeTruthy();
  });

  it('pide corte exacto cuando se marca la casilla', async () => {
    const { service } = setup();
    const cut = vi.spyOn(service, 'exportLossless').mockResolvedValue({
      path: 'C:////tester////entregas////Toma-corte.mp4',
      bytes: 1024,
      requestedSeconds: 10,
      actualSeconds: 10,
      startShiftSeconds: 0,
    });
    fireEvent.change(screen.getByLabelText('Inicio (s)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Fin (s)'), { target: { value: '12' } });
    fireEvent.click(screen.getByLabelText(/Corte exacto/));
    fireEvent.click(screen.getByRole('button', { name: /Cortar sin recodificar/ }));
    await waitFor(() => expect(cut).toHaveBeenCalled());
    expect(cut.mock.calls[0]?.[0]?.exact).toBe(true);
  });

  it('cambia el contenedor sin recodificar', async () => {
    const { service } = setup();
    const remux = vi.spyOn(service, 'remux').mockResolvedValue({
      path: 'C:////tester////entregas////Toma.mkv',
      bytes: 2_000_000,
      requestedSeconds: 10,
      actualSeconds: 10,
      startShiftSeconds: 0,
    });
    fireEvent.change(screen.getByLabelText('Contenedor'), { target: { value: 'mkv' } });
    fireEvent.click(screen.getByRole('button', { name: /Cambiar contenedor/ }));
    await waitFor(() => expect(remux).toHaveBeenCalled());
    expect(remux.mock.calls[0]?.[0]?.output.endsWith('.mkv')).toBe(true);
    expect(await screen.findByText(/Contenedor cambiado a mkv/)).toBeTruthy();
  });

  it('avisa si no hay marcadores para escribir capítulos', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Escribir capítulos/ }));
    expect(await screen.findByText(/No hay marcadores/)).toBeTruthy();
  });

  it('avisa si el fin no es mayor que el inicio', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Inicio (s)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Fin (s)'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /Cortar sin recodificar/ }));
    expect(await screen.findByText(/El fin tiene que ser mayor/)).toBeTruthy();
  });
});
