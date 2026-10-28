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

function renderView() {
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
      <MulticamView onNavigate={() => {}} />
    </ProjectProvider>,
  );
  return { service };
}

describe('vista multicámara · cadena de fallbacks', () => {
  it('prueba el timecode primero y, si no sirve, degrada al audio e informa', async () => {
    const { service } = renderView();
    // El servicio falso no reporta timecode: la cadena tiene que caer al audio.
    const probeSpy = vi.spyOn(service, 'probeMediaFile');
    let calls = 0;
    const peaksSpy = vi
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

    fireEvent.click(await screen.findByRole('button', { name: /Sincronizar todo/i }));

    await waitFor(() => expect(probeSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(peaksSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status.textContent).toMatch(/timecode no sirvió/i);
      expect(status.textContent).toMatch(/sincronizada por audio/i);
    });
    await waitFor(() => {
      const offsetInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
      expect(offsetInputs.length).toBeGreaterThanOrEqual(2);
      expect(Number(offsetInputs[1]?.value)).toBeCloseTo(1, 1);
    });
  });

  it('si el timecode y el audio fallan, avisa que queda el ajuste manual y no toca las entradas', async () => {
    const { service } = renderView();
    const probeSpy = vi.spyOn(service, 'probeMediaFile');
    vi.spyOn(service, 'audioPeaks').mockImplementation(async (assetId: string, buckets = 250) => ({
      assetId,
      durationSeconds: 10,
      buckets,
      // Silencio plano: la correlación no puede encontrar señal común.
      peaks: Array.from({ length: buckets }, () => ({ min: -0.2, max: 0.2 })),
    }));

    fireEvent.click(await screen.findByRole('button', { name: /Sincronizar todo/i }));

    await waitFor(() => expect(probeSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status.textContent).toMatch(/sin sincronización automática/i);
      expect(status.textContent).toMatch(/a mano/i);
    });
    const offsetInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    expect(offsetInputs.map((input) => input.value)).toEqual(['0', '0']);
  });
});
