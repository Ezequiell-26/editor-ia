// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type Asset } from '@editor-ia/project-schema';
import { AssetsPanel } from './AssetsPanel';
import { ProjectProvider } from '../../state/project-store';
import { ensureDelivery, newId } from '../../state/project-actions';
import { createFakeService } from '../../test/fake-service';

const NOW = '2026-10-19T00:00:00.000Z';

function image(label: string): Asset {
  return {
    id: newId(),
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label}` },
    status: 'ready',
    integrity: { sha256: 'e'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1024, height: 1024 },
  } as Asset;
}

function audio(durationFrames: number): Asset {
  return {
    id: newId(),
    label: 'narracion.wav',
    kind: 'audio',
    source: { type: 'local', path: 'media/narracion.wav' },
    status: 'ready',
    integrity: { sha256: 'f'.repeat(64), bytes: 40_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { sampleRate: 48_000, channels: 1, durationFrames },
  } as Asset;
}

function renderPanel() {
  const project = ensureDelivery(createEmptyProject('Lote', NOW));
  const service = createFakeService();
  const onNavigate = vi.fn();
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
      <AssetsPanel onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { service, onNavigate };
}

afterEach(() => cleanup());

describe('AssetsPanel · auto-montar lote', () => {
  it('importa imágenes y narración, monta el storyboard y navega al editor', async () => {
    const { service, onNavigate } = renderPanel();
    expect(screen.getByLabelText(/Movimiento automático/i)).toBeTruthy();
    expect(screen.getByLabelText(/Segundos por imagen/i)).toBeTruthy();
    expect(screen.getByLabelText(/Transición \(frames\)/i)).toBeTruthy();
    service.setImportOutcome({
      assets: [image('001.png'), image('002.png'), audio(300)],
      warnings: [],
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /derechos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Auto-montar lote/i }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('editor'));
    await waitFor(() => expect(screen.getByText('001.png')).toBeTruthy());
    expect(screen.getByText('002.png')).toBeTruthy();
    expect(screen.getByText('narracion.wav')).toBeTruthy();
    expect(screen.getByText(/3 clips en la timeline/i)).toBeTruthy();
  });

  it('exige confirmar derechos antes de abrir el selector', () => {
    const { service } = renderPanel();
    const importSpy = vi.spyOn(service, 'importAssets');

    fireEvent.click(screen.getByRole('button', { name: /Auto-montar lote/i }));

    expect(importSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirmá que tenés derechos/i)).toBeTruthy();
  });

  it('avisa cuando el lote no trae imágenes y no monta nada', async () => {
    const { service, onNavigate } = renderPanel();
    service.setImportOutcome({ assets: [audio(300)], warnings: [] });

    fireEvent.click(screen.getByRole('checkbox', { name: /derechos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Auto-montar lote/i }));

    await waitFor(() => expect(screen.getByText(/Elegí al menos una imagen/i)).toBeTruthy());
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
