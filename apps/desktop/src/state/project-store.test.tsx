// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createEmptyProject } from '@editor-ia/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeService } from '../test/fake-service';
import { addCaptionCue, addClipFromAsset, addAsset, addTrack, ensureDelivery } from './project-actions';
import { readyAsset } from '../test/fake-service';
import { projectWithIoRange } from './io-range';
import {
  ProjectProvider,
  usePlayheadFrame,
  useProjectPlaybackDirection,
  useProjectPlaybackRate,
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

  it('setPlaybackRate actualiza el contexto sin tocar el store ni el playhead', async () => {
    const service = createFakeService();
    const project = ensureDelivery(createEmptyProject('Velocidad', '2025-01-01T00:00:00Z'));
    const opened = {
      project,
      label: 'velocidad.editoria.json',
      path: 'C:\\tmp\\velocidad.editoria.json',
      root: 'C:\\tmp',
    };
    let storeProbeRenders = 0;
    function StoreProbe() {
      useProjectStore();
      storeProbeRenders += 1;
      return null;
    }
    function RateProbe() {
      const rate = useProjectPlaybackRate();
      const store = useProjectStore();
      return (
        <div>
          <span data-testid="rate">{String(rate)}</span>
          <button type="button" onClick={() => store.setPlaybackRate(2)}>
            velocidad 2x
          </button>
          <button type="button" onClick={() => store.setPlaybackRate(99)}>
            velocidad fuera de rango
          </button>
        </div>
      );
    }
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <RateProbe />
        <StoreProbe />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('rate').textContent).toBe('1');
    const before = storeProbeRenders;
    fireEvent.click(screen.getByRole('button', { name: 'velocidad 2x' }));
    await waitFor(() => {
      expect(screen.getByTestId('rate').textContent).toBe('2');
    });
    // La velocidad vive en su propio contexto: el store no se re-renderiza.
    expect(storeProbeRenders).toBe(before);
    // El clamp es 0.1–8: un valor fuera de rango se rechaza por el tope.
    fireEvent.click(screen.getByRole('button', { name: 'velocidad fuera de rango' }));
    await waitFor(() => {
      expect(screen.getByTestId('rate').textContent).toBe('8');
    });
  });

  it('setPlaybackDirection actualiza el contexto sin tocar el store', async () => {
    const service = createFakeService();
    const project = ensureDelivery(createEmptyProject('Sentido', '2025-01-01T00:00:00Z'));
    const opened = {
      project,
      label: 'sentido.editoria.json',
      path: 'C:\\tmp\\sentido.editoria.json',
      root: 'C:\\tmp',
    };
    let storeProbeRenders = 0;
    function StoreProbe() {
      useProjectStore();
      storeProbeRenders += 1;
      return null;
    }
    function DirectionProbe() {
      const direction = useProjectPlaybackDirection();
      const store = useProjectStore();
      return (
        <div>
          <span data-testid="direction">{String(direction)}</span>
          <button type="button" onClick={() => store.setPlaybackDirection(-1)}>
            sentido atras
          </button>
          <button type="button" onClick={() => store.setPlaybackDirection(1)}>
            sentido adelante
          </button>
        </div>
      );
    }
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <DirectionProbe />
        <StoreProbe />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('direction').textContent).toBe('1');
    const before = storeProbeRenders;
    fireEvent.click(screen.getByRole('button', { name: 'sentido atras' }));
    await waitFor(() => {
      expect(screen.getByTestId('direction').textContent).toBe('-1');
    });
    // La dirección vive en su propio contexto: el store no se re-renderiza.
    expect(storeProbeRenders).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'sentido adelante' }));
    await waitFor(() => {
      expect(screen.getByTestId('direction').textContent).toBe('1');
    });
  });
});

function SyncHarness() {
  const store = useProjectStore();
  const [saved, setSaved] = useState('none');
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          // Dos ediciones en el mismo tick, sin render entre medio: la
          // segunda debe encadenar sobre el resultado de la primera.
          store.update((project) => addTrack(project, 'video').project);
          store.update((project) => addTrack(project, 'video').project);
        }}
      >
        doble edición
      </button>
      <button
        type="button"
        onClick={() => {
          // `saveNow` inmediato tras `update`: debe guardar el documento
          // editado, no la instantánea anterior al render.
          store.update((project) =>
            addCaptionCue(project, { text: 'sync', startFrame: 0, durationFrames: 30 }).project,
          );
          void store.saveNow().then((ok) => setSaved(String(ok)));
        }}
      >
        editar y guardar
      </button>
      <span data-testid="tracks">{String(store.state.project?.timeline.tracks.length ?? -1)}</span>
      <span data-testid="cues">{String(store.state.project?.captions.cues.length ?? -1)}</span>
      <span data-testid="saved">{saved}</span>
    </div>
  );
}

describe('estado síncrono del store (stateRef)', () => {
  it('dos update en el mismo tick encadenan sobre el documento nuevo', async () => {
    const service = createFakeService();
    const project = ensureDelivery(createEmptyProject('Sync', '2025-01-01T00:00:00Z'));
    const opened = {
      project,
      label: 'sync.editoria.json',
      path: 'C:\\tmp\\sync.editoria.json',
      root: 'C:\\tmp',
    };
    service.current = opened;
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <SyncHarness />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('tracks').textContent).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'doble edición' }));
    await waitFor(() => {
      expect(screen.getByTestId('tracks').textContent).toBe('2');
    });
  });

  it('update + saveNow en el mismo tick guarda el documento editado', async () => {
    const service = createFakeService();
    const project = ensureDelivery(createEmptyProject('SyncSave', '2025-01-01T00:00:00Z'));
    const opened = {
      project,
      label: 'sync-save.editoria.json',
      path: 'C:\\tmp\\sync-save.editoria.json',
      root: 'C:\\tmp',
    };
    service.current = opened;
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <SyncHarness />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'editar y guardar' }));
    await waitFor(() => {
      expect(screen.getByTestId('saved').textContent).toBe('true');
    });
    // El documento que llegó al servicio tiene el cue recién agregado.
    expect(
      service.current?.project.captions.cues.some((cue) => cue.text === 'sync'),
    ).toBe(true);
    await waitFor(() => {
      expect(screen.getByTestId('cues').textContent).toBe('1');
    });
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

function IoHarness() {
  const store = useProjectStore();
  return (
    <div>
      <button type="button" onClick={() => store.setPlayhead(42)}>ir a 42</button>
      <button type="button" onClick={() => store.setIoPoint('in')}>in</button>
      <button type="button" onClick={() => store.setIoPoint('out')}>out</button>
      <button type="button" onClick={() => store.clearIoRange()}>limpiar</button>
      <span data-testid="io">
        {store.state.ioRange
          ? `${store.state.ioRange.inFrame ?? '-'}→${store.state.ioRange.outFrame ?? '-'}`
          : 'none'}
      </span>
      <span data-testid="io-doc">
        {JSON.stringify(store.state.project?.['x-ioRange'] ?? null)}
      </span>
    </div>
  );
}

describe('puntos in/out de la secuencia', () => {
  it('marca in/out en el playhead y limpia el rango', async () => {
    const service = createFakeService();
    let project = ensureDelivery(createEmptyProject('IO', '2025-01-01T00:00:00Z'));
    const track = addTrack(project, 'video', 'V1');
    const asset = readyAsset({
      label: 'Clip',
      kind: 'video',
      source: { type: 'local', path: 'media/clip.mp4' },
      media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
    });
    project = addClipFromAsset(addAsset(track.project, asset), asset, {
      trackId: track.trackId,
      atFrame: 0,
      durationFrames: 200,
    }).project;
    const opened = {
      project,
      label: 'io.editoria.json',
      path: 'C:\tmp\io.editoria.json',
      root: 'C:\tmp',
    };
    render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <IoHarness />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('io').textContent).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'ir a 42' }));
    fireEvent.click(screen.getByRole('button', { name: 'in' }));
    expect(screen.getByTestId('io').textContent).toBe('42→-');
    fireEvent.click(screen.getByRole('button', { name: 'out' }));
    expect(screen.getByTestId('io').textContent).toBe('42→42');
    fireEvent.click(screen.getByRole('button', { name:'limpiar' }));
    expect(screen.getByTestId('io').textContent).toBe('none');
  });

  it('persiste el rango en el documento como x-ioRange y lo restaura al abrir', async () => {
    const service = createFakeService();
    let project = ensureDelivery(createEmptyProject('IO doc', '2025-01-01T00:00:00Z'));
    const track = addTrack(project, 'video', 'V1');
    const asset = readyAsset({
      label: 'Clip',
      kind: 'video',
      source: { type: 'local', path: 'media/clip.mp4' },
      media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
    });
    project = addClipFromAsset(addAsset(track.project, asset), asset, {
      trackId: track.trackId,
      atFrame: 0,
      durationFrames: 200,
    }).project;
    const opened = {
      project,
      label: 'io-doc.editoria.json',
      path: 'C:\tmp\io-doc.editoria.json',
      root: 'C:\tmp',
    };
    const { unmount } = render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <IoHarness />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ir a 42' }));
    fireEvent.click(screen.getByRole('button', { name: 'in' }));
    fireEvent.click(screen.getByRole('button', { name: 'ir a 42' }));
    fireEvent.click(screen.getByRole('button', { name: 'out' }));
    await waitFor(() => {
      expect(screen.getByTestId('io-doc').textContent).toBe(
        '{"inFrame":42,"outFrame":42}',
      );
    });
    // El documento escrito debe pasar la validación del schema (x- es válido).
    const saved = screen.getByTestId('io-doc').textContent;
    expect(saved).not.toBe('null');
    unmount();

    // Al reabrir un documento con x-ioRange, el estado lo restaura.
    const persisted = JSON.parse(saved ?? 'null') as { inFrame: number; outFrame: number } | null;
    expect(persisted).not.toBeNull();
    const reopened = projectWithIoRange(project, {
      inFrame: persisted!.inFrame,
      outFrame: persisted!.outFrame,
    });
    const reopenedOpened = { ...opened, project: reopened };
    render(
      <ProjectProvider service={service} initial={{ project: reopened, opened: reopenedOpened }}>
        <IoHarness />
      </ProjectProvider>,
    );
    expect(screen.getByTestId('io').textContent).toBe('42→42');
  });
});
