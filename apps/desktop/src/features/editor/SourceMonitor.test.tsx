// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Asset } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { ensureDelivery, newId } from '../../state/project-actions';
import { SourceMonitor } from './SourceMonitor';

const NOW = '2026-10-19T00:00:00.000Z';

function videoAsset(): Asset {
  return {
    id: newId(),
    label: 'clip.mp4',
    kind: 'video',
    source: { type: 'local', path: 'media/clip.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 100_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: {
      width: 1920,
      height: 1080,
      durationFrames: 300,
      frameRate: { num: 30, den: 1 },
    },
  } as Asset;
}

function renderMonitor(asset: Asset) {
  const project = ensureDelivery(createEmptyProject('Lote', NOW));
  project.assets = [asset];
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
      <SourceMonitor asset={asset} />
      <StoreProbe />
    </ProjectProvider>,
  );
  return { service };
}

function StoreProbe() {
  const store = useProjectStore();
  return (
    <output data-testid="clip-count">{store.state.project?.timeline.clips.length ?? -1}</output>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SourceMonitor', () => {
  it('monta un asset de video/audio con transporte y monta el clip', async () => {
    const asset = videoAsset();
    renderMonitor(asset);

    const video = document.querySelector('video.source-monitor-media') as HTMLVideoElement;
    expect(video).toBeTruthy();
    // El fake-service devuelve una URL fija para cualquier medio.
    expect(video.getAttribute('src')).toBeTruthy();
    expect(screen.getByLabelText('Posición del material')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Montar en playhead' }));
    await waitFor(() => expect(screen.getByTestId('clip-count').textContent).toBe('1'));
  });

  it('marca IN/OUT y monta el segmento con inFrame/outFrame', async () => {
    const asset = videoAsset();
    renderMonitor(asset);
    const video = document.querySelector('video.source-monitor-media') as HTMLVideoElement;

    Object.defineProperty(video, 'currentTime', { value: 2, writable: true, configurable: true });
    fireEvent(video, new Event('timeupdate'));
    fireEvent.click(screen.getByRole('button', { name: 'IN' }));
    Object.defineProperty(video, 'currentTime', { value: 4, writable: true, configurable: true });
    fireEvent(video, new Event('timeupdate'));
    fireEvent.click(screen.getByRole('button', { name: 'OUT' }));

    expect(screen.getByText(/Segmento:/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Montar segmento' }));
    await waitFor(() => expect(screen.getByTestId('clip-count').textContent).toBe('1'));
  });
});
