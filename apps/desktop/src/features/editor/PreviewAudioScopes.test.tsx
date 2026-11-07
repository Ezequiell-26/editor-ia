// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewAudioScopes } from './PreviewAudioScopes';
import {
  attachPreviewAudio,
  readPreviewAudioMasterScope,
  resetPreviewAudio,
} from '../mixer/usePreviewAudio';

/**
 * Scopes de audio del monitor: leen el AnalyserNode del bus master del grafo
 * Web Audio de la preview. jsdom no trae Web Audio ni canvas 2D, así que las
 * pruebas usan un AudioContext falso (misma técnica que LiveMeters.test) y un
 * contexto 2D que registra las llamadas de dibujo.
 */

if (typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(window.performance.now()), 16)) as typeof requestAnimationFrame;
  window.cancelAnimationFrame = ((handle: number) =>
    window.clearTimeout(handle)) as typeof cancelAnimationFrame;
}

class FakeNodeBase {
  readonly connections: FakeNodeBase[] = [];
  connect(destination: FakeNodeBase): FakeNodeBase {
    if (!this.connections.includes(destination)) this.connections.push(destination);
    return destination;
  }
  disconnect(): void {
    this.connections.length = 0;
  }
}

class FakeGain extends FakeNodeBase {
  readonly gain = { value: 1 };
}

class FakeBiquad extends FakeGain {
  type = 'peaking';
  readonly frequency = { value: 0 };
}

class FakeAnalyser extends FakeNodeBase {
  fftSize = 1024;
  frequencyBinCount = 512;
  readonly freqData = new Float32Array(512);
  readonly timeData = new Float32Array(1024);
  getFloatFrequencyData(buffer: Float32Array): void {
    buffer.set(this.freqData.subarray(0, buffer.length));
  }
  getFloatTimeDomainData(buffer: Float32Array): void {
    buffer.set(this.timeData.subarray(0, buffer.length));
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  readonly sampleRate = 48_000;
  readonly destination = new FakeNodeBase();
  state = 'running';
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  readonly created: FakeNodeBase[] = [];
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  private record<T extends FakeNodeBase>(node: T): T {
    this.created.push(node);
    return node;
  }
  createGain(): FakeGain {
    return this.record(new FakeGain());
  }
  createBiquadFilter(): FakeBiquad {
    return this.record(new FakeBiquad());
  }
  createChannelSplitter(): FakeNodeBase {
    return this.record(new FakeNodeBase());
  }
  createChannelMerger(): FakeNodeBase {
    return this.record(new FakeNodeBase());
  }
  createAnalyser(): FakeAnalyser {
    return this.record(new FakeAnalyser());
  }
  createMediaElementSource(): FakeNodeBase {
    return this.record(new FakeNodeBase());
  }
}

function installFakeAudioContext(): void {
  (window as unknown as { AudioContext?: unknown }).AudioContext =
    FakeAudioContext as unknown as typeof AudioContext;
}

function masterAnalyser(): FakeAnalyser {
  const instance = FakeAudioContext.instances.at(-1);
  const analyser = instance?.created.find(
    (node): node is FakeAnalyser => node instanceof FakeAnalyser,
  );
  if (!analyser) throw new Error('no se creó el analizador master');
  return analyser;
}

interface Fake2d {
  fillRect: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
}

function installFakeCanvas(): Fake2d {
  const ctx = {
    fillStyle: '',
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  return ctx as unknown as Fake2d;
}

async function flushFrames(count = 4): Promise<void> {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
}

afterEach(() => {
  cleanup();
  resetPreviewAudio();
  (window as unknown as { AudioContext?: unknown }).AudioContext = undefined;
  FakeAudioContext.instances.length = 0;
  vi.restoreAllMocks();
});

describe('PreviewAudioScopes sin Web Audio', () => {
  it('muestra el panel honesto, el aviso del entorno y cierra', () => {
    const ctx2d = installFakeCanvas();
    const onClose = vi.fn();
    render(<PreviewAudioScopes onClose={onClose} />);

    expect(
      screen.getByRole('region', { name: /scopes de audio del monitor/i }),
    ).toBeTruthy();
    expect(screen.getByText(/no expone Web Audio/i)).toBeTruthy();
    expect(screen.getByText('En pausa')).toBeTruthy();
    // El fondo se pinta aunque no haya señal.
    expect(ctx2d.fillRect).toHaveBeenCalled();

    screen.getByRole('button', { name: /cerrar scopes de audio/i }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PreviewAudioScopes con grafo simulado', () => {
  beforeEach(() => {
    resetPreviewAudio();
    installFakeAudioContext();
  });

  it('lee el bus master y dibuja oscilograma y espectro con señal', async () => {
    installFakeCanvas();
    const element = document.createElement('audio');
    expect(attachPreviewAudio('pista-1', element)).toBe(true);

    const analyser = masterAnalyser();
    analyser.timeData.fill(0.4);
    analyser.freqData.fill(-24);

    const scope = readPreviewAudioMasterScope();
    expect(scope).not.toBeNull();
    expect(scope!.waveform.length).toBe(1024);
    expect(scope!.spectrumDb.length).toBe(512);
    expect(scope!.sampleRate).toBe(48_000);

    render(<PreviewAudioScopes onClose={() => {}} />);
    await flushFrames();

    expect(await screen.findByText('Señal en vivo')).toBeTruthy();
  });

  it('sin material en el bus no hay lectura de scope', () => {
    // Sin attach no hay contexto: el lector devuelve null.
    expect(readPreviewAudioMasterScope()).toBeNull();
  });
});
