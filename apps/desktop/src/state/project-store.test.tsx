// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createEmptyProject } from '@editor-ia/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeService } from '../test/fake-service';
import { addCaptionCue, addTrack, ensureDelivery } from './project-actions';
import {
  ProjectProvider,
  usePlayheadFrame,
  useProjectPlaying,
  useProjectStore,
} from './project-store';

function Harness() {
  const store = useProjectStore();
  const [result, setResult] = useState<boolean | null>(null);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          store.update((project) => addTrack(project, 'video').project);
        }}
      >
        editar
      </button>
      <button
        type="button"
        onClick={() => {
          void store.saveNow().then(setResult);
        }}
      >
        guardar
      </button>
      <span role="status">{store.state.phase}</span>
      <span data-testid="result">{String(result ?? 'none')}</span>
    </div>
  );
}

function deferred<T>() {
  let release: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

afterEach(cleanup);

describe('autoguardado', () => {
  it('no declara guardado si aparecen cambios nuevos durante el await', async () => {
    const service = createFakeService();
    const project = ensureDelivery(createEmptyProject('Carrera', '2025-01-01T00:00:00Z'));
    const opened = {
      project,
      label: 'carrera.editoria.json',
      path: 'C:\\tmp\\carrera.editoria.json',
      root: 'C:\\tmp',
    };
    service.current = opened;
    const pending = deferred<typeof opened>();
    service.saveProject = () => pending.promise;
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <Harness />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'editar' }));
    fireEvent.click(screen.getByRole('button', { name: 'guardar' }));
    fireEvent.click(screen.getByRole('button', { name: 'editar' }));
    pending.release(opened);
    await waitFor(() => {
      expect(screen.getByTestId('result').textContent).toBe('false');
    });
    expect(screen.getByRole('status').textContent).toBe('dirty');
  });
});

function ExportHarness() {
  const store = useProjectStore();
  return (
    <div>
      <button type="button" onClick={() => store.requestExport()}>
        pedir export
      </button>
      <button type="button" onClick={() => store.consumeExportRequest()}>
        consumir export
      </button>
      <span data-testid="export-requested">{String(store.state.exportRequested)}</span>
    </div>
  );
}

describe('playback fuera del store principal', () => {
  /**
   * Regresión del corte de contexto: el playhead cambia ~30-60 veces por
   * segundo durante la reproducción y no debe re-renderizar a los consumidores
   * de `useProjectStore` (cromo, vistas que no muestran el frame). Sólo se
   * re-renderizan los suscriptos a `usePlayheadFrame`/`useProjectPlaying`.
   */
  function PlaybackHarness() {
    const store = useProjectStore();
    const playheadFrame = usePlayheadFrame();
    const playing = useProjectPlaying();
    return (
      <div>
        <button type="button" onClick={() => store.setPlayhead(10)}>
          mover playhead
        </button>
        <button type="button" onClick={() => store.setPlaying(true)}>
          reproducir
        </button>
        <span data-testid="store-renders">{store.state.phase}</span>
        <span data-testid="playhead">{String(playheadFrame)}</span>
        <span data-testid="playing">{String(playing)}</span>
      </div>
    );
  }

  it('setPlayhead actualiza el frame sin tocar el estado del proyecto', async () => {
    const service = createFakeService();
    // Sin contenido la duración es 0 y setPlayhead clampea todo a 0.
    const project = addCaptionCue(
      ensureDelivery(createEmptyProject('Playback', '2025-01-01T00:00:00Z')),
      { text: 'demo', startFrame: 0, durationFrames: 900 },
    ).project;
    const opened = {
      project,
      label: 'playback.editoria.json',
      path: 'C:\\tmp\\playback.editoria.json',
      root: 'C:\\tmp',
    };
    let storeProbeRenders = 0;
    function StoreProbe() {
      useProjectStore();
      storeProbeRenders += 1;
      return null;
    }
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <PlaybackHarness />
        <StoreProbe />
      </ProjectProvider>,
    );
    const before = storeProbeRenders;
    fireEvent.click(screen.getByRole('button', { name: 'mover playhead' }));
    await waitFor(() => {
      expect(screen.getByTestId('playhead').textContent).toBe('10');
    });
    expect(storeProbeRenders).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'reproducir' }));
    await waitFor(() => {
      expect(screen.getByTestId('playing').textContent).toBe('true');
    });
    // `playing` tampoco forma parte del store: el probe sigue sin renders.
    expect(storeProbeRenders).toBe(before);
  });
});

describe('solicitud de exportación', () => {
  it('se solicita una vez y se consume al abrir el diálogo', () => {
    const service = createFakeService();
    const project = ensureDelivery(createEmptyProject('Export', '2025-01-01T00:00:00Z'));
    const opened = {
      project,
      label: 'export.editoria.json',
      path: 'C:\tmp\export.editoria.json',
      root: 'C:\tmp',
    };
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <ExportHarness />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('export-requested').textContent).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'pedir export' }));
    expect(screen.getByTestId('export-requested').textContent).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'consumir export' }));
    expect(screen.getByTestId('export-requested').textContent).toBe('false');
  });
});
