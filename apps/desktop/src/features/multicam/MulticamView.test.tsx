// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { MulticamView } from './MulticamView';

const NOW = '2026-10-24T00:00:00.000Z';

afterEach(cleanup);

function renderView(onNavigate = vi.fn()) {
  const first = readyAsset({ label: 'Cámara A' });
  const second = readyAsset({ label: 'Cámara B' });
  const project = addAsset(addAsset(ensureDelivery(createEmptyProject('Multi', NOW)), first), second);
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'multi.editoria.json',
          path: 'C:\\tester\\multi.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <MulticamView onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { onNavigate, service };
}

describe('vista multicámara', () => {
  it('selecciona dos cámaras, graba un cambio y crea la pista', async () => {
    const { onNavigate } = renderView();
    expect(
      screen.getByRole('heading', { name: /Multicámara en vivo/i }),
    ).toBeTruthy();

    const cameraTwo = await screen.findByRole('button', { name: /CAM 2/i });
    fireEvent.click(cameraTwo);
    expect(screen.getAllByText(/CAM 2 · Cámara B/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Crear pista multicámara/i }));
    expect(onNavigate).toHaveBeenCalledWith('editor');
  });

  it('sin dos videos explica cómo importarlos', () => {
    const service = createFakeService();
    const project = ensureDelivery(createEmptyProject('Sin cámaras', NOW));
    render(
      <ProjectProvider
        service={service}
        initial={{
          project,
          opened: {
            project,
            label: 'vacio.editoria.json',
            path: 'C:\\tester\\vacio.editoria.json',
            root: 'C:\\tester',
          },
        }}
      >
        <MulticamView onNavigate={() => {}} />
      </ProjectProvider>,
    );
    expect(screen.getByRole('heading', { name: /Faltan cámaras/i })).toBeTruthy();
  });
});

describe('vista multicámara · audio', () => {
  it('sincroniza las cámaras usando los picos de audio del backend', async () => {
    const { service } = renderView();
    let calls = 0;
    const spy = vi
      .spyOn(service, 'audioPeaks')
      .mockImplementation(async (assetId: string, buckets = 250) => {
        // Las cámaras se analizan en orden: la segunda llega 1 s tarde.
        const delayed = calls++ === 1;
        return {
          assetId,
          durationSeconds: 10,
          buckets,
          peaks: Array.from({ length: buckets }, (_, index) => {
            const shifted = delayed ? index - 25 : index;
            if (shifted < 0) return { min: -0.01, max: 0.01 };
            const wave = Math.sin(shifted * 12.9898) * 43758.5453;
            const value = 0.05 + Math.abs(wave - Math.floor(wave)) * 0.95;
            return { min: -value, max: value };
          }),
        };
      });
    const button = await screen.findByRole('button', { name: /Sincronizar por audio/i });
    fireEvent.click(button);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const offsetInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
      expect(offsetInputs.length).toBeGreaterThanOrEqual(2);
      expect(Number(offsetInputs[1]?.value)).toBeCloseTo(1, 1);
    });
  });
});
