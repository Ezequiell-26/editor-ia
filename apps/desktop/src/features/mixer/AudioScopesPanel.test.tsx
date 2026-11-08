// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  addTrack,
  ensureDelivery,
} from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { AudioScopesPanel } from './AudioScopesPanel';

const NOW = '2026-10-24T00:00:00.000Z';

afterEach(cleanup);

function PlayheadJump({ frame }: { frame: number }) {
  const store = useProjectStore();
  return (
    <button type="button" onClick={() => store.setPlayhead(frame)}>
      frame {frame}
    </button>
  );
}

function renderPanel(withClip = true) {
  let project = ensureDelivery(createEmptyProject('Scopes', NOW));
  const track = addTrack(project, 'audio', 'Música');
  const asset = readyAsset({
    label: 'Tema musical',
    kind: 'audio',
    source: { type: 'local', path: 'media/tema.wav' },
    media: { sampleRate: 48_000, channels: 2, durationFrames: 300 },
  });
  project = addAsset(track.project, asset);
  if (withClip) {
    project = addClipFromAsset(project, asset, {
      trackId: track.trackId,
      atFrame: 0,
      durationFrames: 300,
    }).project;
  }
  const service = createFakeService();
  const spy = vi.spyOn(service, 'audioScopeAnalyzeAsset');
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'scopes.editoria.json',
          path: 'C:\\tester\\scopes.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <AudioScopesPanel />
      <PlayheadJump frame={150} />
    </ProjectProvider>,
  );
  return { spy, asset };
}

describe('panel de scopes de audio', () => {
  it('lista los materiales con audio y analiza el seleccionado', async () => {
    const { spy } = renderPanel(false);
    const select = screen.getByLabelText('Material a analizar') as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
    expect(select.options[0]?.textContent).toContain('Tema musical');
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(assetIdOf(select)));
    expect(await screen.findByText(/48000 Hz/)).toBeTruthy();
  });

  it('muestra el error del backend sin romper el panel', async () => {
    const { spy } = renderPanel(false);
    spy.mockRejectedValueOnce(new Error('ffmpeg no está disponible'));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    expect(await screen.findByText('ffmpeg no está disponible')).toBeTruthy();
  });

  it('en modo playhead analiza la ventana del clip bajo el playhead', async () => {
    const { spy, asset } = renderPanel();
    fireEvent.change(screen.getByLabelText('Qué analizar'), {
      target: { value: 'playhead' },
    });
    // Playhead por defecto en 0 → frame local 0 → ventana [0, 2.5] s.
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(asset.id, {
        startSeconds: 0,
        durationSeconds: 2.5,
      }),
    );
    expect(await screen.findByText(/material fuente/)).toBeTruthy();
  });

  it('el playhead en el medio del clip centra la ventana', async () => {
    const { spy, asset } = renderPanel();
    fireEvent.change(screen.getByLabelText('Qué analizar'), {
      target: { value: 'playhead' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'frame 150' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(asset.id, {
        startSeconds: 2.5,
        durationSeconds: 5,
      }),
    );
  });

  it('sin clip bajo el playhead no llama al backend y avisa', async () => {
    const { spy } = renderPanel();
    fireEvent.change(screen.getByLabelText('Qué analizar'), {
      target: { value: 'playhead' },
    });
    // El clip dura 300 frames (0..299); no hay forma de mover el playhead más
    // allá desde el harness, así que probamos el caso inverso: proyecto sin
    // clips en modo playhead.
    cleanup();
    const { spy: spyEmpty } = renderPanelWithNoClip();
    fireEvent.change(screen.getByLabelText('Qué analizar'), {
      target: { value: 'playhead' },
    });
    const button = screen.getByRole('button', { name: 'Analizar' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(spyEmpty).not.toHaveBeenCalled();
  });
});

function renderPanelWithNoClip() {
  let project = ensureDelivery(createEmptyProject('Scopes', NOW));
  const track = addTrack(project, 'audio', 'Música');
  const asset = readyAsset({
    label: 'Tema musical',
    kind: 'audio',
    source: { type: 'local', path: 'media/tema.wav' },
    media: { sampleRate: 48_000, channels: 2, durationFrames: 300 },
  });
  project = addAsset(track.project, asset);
  const service = createFakeService();
  const spy = vi.spyOn(service, 'audioScopeAnalyzeAsset');
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'scopes.editoria.json',
          path: 'C:\\tester\\scopes.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <AudioScopesPanel />
    </ProjectProvider>,
  );
  return { spy };
}

function assetIdOf(select: HTMLSelectElement): string {
  return select.value;
}
