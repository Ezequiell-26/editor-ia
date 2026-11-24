// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { VoiceoverRecorder } from './VoiceoverRecorder';

// Compuerta para demorar `blobToWavPcm` sólo en el test de cambio de
// proyecto; el resto de la suite usa la implementación real.
const wavGate = vi.hoisted(() => ({
  pending: null as Promise<null> | null,
}));
vi.mock('./voiceover', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./voiceover')>();
  return {
    ...actual,
    blobToWavPcm: (_blob: Blob) =>
      wavGate.pending ?? actual.blobToWavPcm(_blob),
  };
});

const NOW = '2026-10-20T00:00:00.000Z';

let latestState: ReturnType<typeof useProjectStore>['state'] | null = null;
let latestStore: ReturnType<typeof useProjectStore> | null = null;

function StoreProbe(): null {
  const store = useProjectStore();
  useEffect(() => {
    latestState = store.state;
    latestStore = store;
  }, [store.state]);
  return null;
}

/** MediaRecorder fake: `stop()` entrega un chunk y dispara `onstop`. */
class FakeMediaRecorder {
  static isTypeSupported = (mime: string) => mime === 'audio/webm;codecs=opus';
  mimeType: string;
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob(['fake-audio-bytes'], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}

function fakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: () => {} }],
  } as unknown as MediaStream;
}

function renderRecorder() {
  const project = createEmptyProject('Voz', NOW);
  const service = createFakeService();
  const opened = {
    project,
    label: 'voz.editoria.json',
    path: 'C:\\tester\\voz.editoria.json',
    root: 'C:\\tester',
  };
  latestState = null;
  const view = render(
    <ProjectProvider service={service} initial={{ project, opened }}>
      <VoiceoverRecorder />
      <StoreProbe />
    </ProjectProvider>,
  );
  return { service, unmount: view.unmount };
}

describe('VoiceoverRecorder', () => {
  beforeEach(() => {
    latestState = null;
    // jsdom no implementa `Blob.arrayBuffer`/`btoa` (WebView2 sí): polyfill
    // mínimo para ejercitar el camino real del componente.
    if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
      Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(this);
        });
      };
    }
    if (typeof globalThis.btoa !== 'function') {
      globalThis.btoa = (value: string) => Buffer.from(value, 'binary').toString('base64');
    }
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(async () => fakeStream()) },
      configurable: true,
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  });

  afterEach(() => {
    wavGate.pending = null;
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('graba, importa el audio y monta el clip en la pista de narración', async () => {
    const { service } = renderRecorder();
    const importMediaBytes = vi.spyOn(service, 'importMediaBytes');

    const button = screen.getByRole('button', { name: 'Grabar voz' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(button.getAttribute('aria-pressed')).toBe('true');
    });
    expect(window.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ audio: expect.anything() }),
    );

    fireEvent.click(button);

    await waitFor(() => {
      expect(importMediaBytes).toHaveBeenCalledTimes(1);
    });
    const input = importMediaBytes.mock.calls[0]?.[0];
    // Sin Web Audio en jsdom cae al contenedor: webm con su extensión.
    expect(input?.fileName).toMatch(/^voz-\d{8}-\d{6}\.webm$/);
    expect(input?.dataBase64.length).toBeGreaterThan(0);

    await waitFor(() => {
      const project = latestState?.project;
      const clip = project?.timeline.clips.find((item) => item.kind === 'audio');
      expect(clip).toBeTruthy();
      const track = project?.timeline.tracks.find((item) => item.id === clip?.trackId);
      expect(track?.kind).toBe('narration');
      const asset = project?.assets.find(
        (item) => item.id === (clip?.source.type === 'asset' ? clip.source.assetId : ''),
      );
      expect(asset?.kind).toBe('audio');
      expect(asset?.status).toBe('ready');
      expect(latestState?.notice).toContain('narración');
    });
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('ignora un segundo clic mientras se espera el permiso del micrófono', async () => {
    let resolveGum!: (stream: MediaStream) => void;
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveGum = resolve;
            }),
        ),
      },
      configurable: true,
    });
    const { unmount } = renderRecorder();
    const button = screen.getByRole('button', {
      name: 'Grabar voz',
    }) as HTMLButtonElement;

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(window.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.disabled).toBe(true);

    // Se concede el permiso: la grabación arranca normal y se puede cortar.
    resolveGum(fakeStream());
    await waitFor(() => {
      expect(button.getAttribute('aria-pressed')).toBe('true');
    });
    unmount();
  });

  it('no captura el micrófono si el componente se desmonta durante el permiso', async () => {
    let resolveGum!: (stream: MediaStream) => void;
    const stop = vi.fn();
    const lateStream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveGum = resolve;
            }),
        ),
      },
      configurable: true,
    });
    const { service, unmount } = renderRecorder();
    const importMediaBytes = vi.spyOn(service, 'importMediaBytes');

    fireEvent.click(screen.getByRole('button', { name: 'Grabar voz' }));
    unmount();
    // El permiso se concede DESPUÉS del desmontaje.
    resolveGum(lateStream);

    await waitFor(() => {
      expect(stop).toHaveBeenCalledTimes(1);
    });
    expect(importMediaBytes).not.toHaveBeenCalled();
  });

  it('no importa la voz si el proyecto cambió durante la grabación', async () => {
    const { service } = renderRecorder();
    const importMediaBytes = vi.spyOn(service, 'importMediaBytes');
    const originalId = latestState?.project?.id;
    expect(originalId).toBeTruthy();

    const button = screen.getByRole('button', { name: 'Grabar voz' });
    fireEvent.click(button);
    await waitFor(() => {
      expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    // La conversión a WAV queda en vuelo; se cambia de proyecto mientras.
    let releaseWav!: () => void;
    wavGate.pending = new Promise<null>((resolve) => {
      releaseWav = () => resolve(null);
    });
    fireEvent.click(button); // stop → finalizeRecording espera el WAV

    await waitFor(() => {
      expect(latestStore).toBeTruthy();
    });
    const switched = await latestStore!.openProjectAt('otro-proyecto.editoria.json');
    expect(switched).toBe(true);
    await waitFor(() => {
      expect(latestState?.project?.id).not.toBe(originalId);
    });

    releaseWav();
    await waitFor(() => {
      expect(latestState?.notice).toContain('cambió durante la grabación');
    });
    expect(importMediaBytes).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('no graba si el proyecto cambió mientras se pedía el permiso', async () => {
    let resolveGum!: (stream: MediaStream) => void;
    const stop = vi.fn();
    const lateStream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveGum = resolve;
            }),
        ),
      },
      configurable: true,
    });
    const { service } = renderRecorder();
    const importMediaBytes = vi.spyOn(service, 'importMediaBytes');
    const originalId = latestState?.project?.id;

    fireEvent.click(screen.getByRole('button', { name: 'Grabar voz' }));
    await waitFor(() => {
      expect(latestStore).toBeTruthy();
    });
    // Cambio de proyecto con el diálogo de permiso todavía abierto.
    const switched = await latestStore!.openProjectAt('otro-proyecto.editoria.json');
    expect(switched).toBe(true);
    await waitFor(() => {
      expect(latestState?.project?.id).not.toBe(originalId);
    });

    // El permiso se concede tarde: no debe arrancar la grabación.
    resolveGum(lateStream);
    await waitFor(() => {
      expect(stop).toHaveBeenCalledTimes(1);
    });
    expect(latestState?.notice).toContain('cambió mientras se pedía el permiso');
    expect(
      screen.getByRole('button', { name: 'Grabar voz' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(importMediaBytes).not.toHaveBeenCalled();
  });

  it('avisa cuando el permiso de micrófono se niega', async () => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException('denied', 'NotAllowedError');
        }),
      },
      configurable: true,
    });
    renderRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Grabar voz' }));
    await waitFor(() => {
      expect(latestState?.notice).toContain('Permiso de micrófono denegado');
    });
    expect(screen.getByRole('button', { name: 'Grabar voz' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('avisa cuando no hay micrófono disponible', async () => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException('none', 'NotFoundError');
        }),
      },
      configurable: true,
    });
    renderRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Grabar voz' }));
    await waitFor(() => {
      expect(latestState?.notice).toContain('No se encontró ningún micrófono');
    });
  });
});
