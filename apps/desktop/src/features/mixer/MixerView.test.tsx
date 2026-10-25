// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, addClipFromAsset, addTrack, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { MixerView } from './MixerView';

const NOW = '2026-10-24T00:00:00.000Z';

afterEach(cleanup);

function renderMixer(withTracks = true) {
  let project = ensureDelivery(createEmptyProject('Mezcla E2E', NOW));
  if (withTracks) {
    const music = addTrack(project, 'audio', 'Música');
    const asset = readyAsset({
      label: 'Música',
      kind: 'audio',
      source: { type: 'local', path: 'media/musica.wav' },
      media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
    });
    project = addClipFromAsset(addAsset(music.project, asset), asset, {
      trackId: music.trackId,
      atFrame: 0,
      durationFrames: 90,
    }).project;
    project = addTrack(project, 'narration', 'Voz').project;
  }
  const service = createFakeService();
  const onNavigate = vi.fn();
  const result = render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'mezcla.editoria.json',
          path: 'C:\\tester\\mezcla.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <MixerView onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { ...result, onNavigate, service };
}

describe('vista de mezcla', () => {
  it('muestra un canal por pista de audio y el master', () => {
    renderMixer();
    expect(screen.getByRole('heading', { name: /Mezcla de audio/i })).toBeTruthy();
    expect(screen.getAllByText('Música').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Voz').length).toBeGreaterThan(0);
    expect(screen.getByRole('slider', { name: /Ganancia de Música/i })).toBeTruthy();
    expect(screen.getByRole('slider', { name: /Paneo de Música/i })).toBeTruthy();
    expect(screen.getByRole('slider', { name: /Bajos de Música/i })).toBeTruthy();
    expect(screen.getByRole('slider', { name: /Medios de Música/i })).toBeTruthy();
    expect(screen.getByRole('slider', { name: /Agudos de Música/i })).toBeTruthy();
    expect(screen.getByRole('slider', { name: /Ganancia master/i })).toBeTruthy();
  });

  it('cambia paneo y EQ de pista y los deja en el proyecto', () => {
    renderMixer();
    const pan = screen.getByRole('slider', { name: /Paneo de Música/i }) as HTMLInputElement;
    fireEvent.change(pan, { target: { value: '-0.5' } });
    expect(pan.value).toBe('-0.5');
    expect(screen.getByText('L 50')).toBeTruthy();

    const low = screen.getByRole('slider', { name: /Bajos de Música/i }) as HTMLInputElement;
    fireEvent.change(low, { target: { value: '-4' } });
    expect(low.value).toBe('-4');

    fireEvent.click(screen.getByRole('button', { name: /EQ plano de Música/i }));
    expect(low.value).toBe('0');
  });

  it('cambia la ganancia de pista y enciende el solo', () => {
    renderMixer();
    const gain = screen.getByRole('slider', { name: /Ganancia de Música/i }) as HTMLInputElement;
    fireEvent.change(gain, { target: { value: '-9' } });
    expect(gain.value).toBe('-9');

    const solo = screen.getByRole('button', { name: /Solo Música/i });
    fireEvent.click(solo);
    expect(solo.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/1 pista en solo/i)).toBeTruthy();
  });

  it('el master se ajusta aunque no haya pistas con audio', () => {
    renderMixer(false);
    expect(screen.getByText(/Todavía no hay pistas con audio/i)).toBeTruthy();
    const master = screen.getByRole('slider', { name: /Ganancia master/i }) as HTMLInputElement;
    fireEvent.change(master, { target: { value: '-4.5' } });
    expect(master.value).toBe('-4.5');
  });

  it('mide el pico con el backend y normaliza el fader a -6 dBFS', async () => {
    const { service } = renderMixer();
    vi.spyOn(service, 'audioPeaks').mockResolvedValue({
      assetId: 'asset',
      durationSeconds: 3,
      buckets: 3,
      peaks: [
        { min: -0.25, max: 0.1 },
        { min: -0.1, max: 0.25 },
        { min: -0.2, max: 0.2 },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /Medir picos/i }));
    expect(await screen.findByText(/Pico del material: -12.0 dBFS/i)).toBeTruthy();

    fireEvent.click(
      await screen.findByRole('button', { name: /Normalizar Música a -6 dB/i }),
    );
    const gain = screen.getByRole('slider', { name: /Ganancia de Música/i }) as HTMLInputElement;
    expect(Number(gain.value)).toBe(6);
    expect(screen.getByText(/Pico con fader: -6.0 dBFS/i)).toBeTruthy();
  });
});
