// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip } from '@editor-ia/project-schema';
import {
  reversedAudioPlan,
  reversedBufferOffsetSeconds,
  reversedBufferRate,
  reversedClipSpeed,
  reversedWindowSampleRange,
  reverseSamples,
} from './reverse-window';
import {
  createReversedWindowBuffer,
  decodePreviewAudio,
  resetPreviewAudio,
  startPreviewReversedAudio,
  stopPreviewReversedAudio,
} from './usePreviewAudio';
import { clipSourceFrameAtLocal } from '../../state/clip-source-time';

/**
 * Audio de clips `reverse` en la preview: geometría pura de la ventana
 * invertida y el grafo Web Audio simulado (jsdom no trae AudioContext).
 * El fake registra nodos y conexiones para afirmar la topología real:
 * buffer source → ganancia de clip → entrada de pista → … → master.
 */

const FPS = 30;

function clip(partial: Record<string, unknown> = {}): Clip {
  return {
    id: 'c1',
    trackId: 'v1',
    kind: 'video',
    label: 'clip',
    startFrame: 0,
    durationFrames: 60,
    source: { type: 'asset', assetId: 'a1', inFrame: 10, outFrame: 70 },
    ...partial,
  } as Clip;
}

describe('reversedAudioPlan', () => {
  it('da la ventana de fuente que el clip consume al revés', () => {
    // src(0)=69 y src(59)=10 a 30 fps → [10/30, 69/30].
    const plan = reversedAudioPlan(clip({ reverse: true }), FPS);
    expect(plan).not.toBeNull();
    expect(plan!.windowStartSec).toBeCloseTo(10 / FPS, 6);
    expect(plan!.windowEndSec).toBeCloseTo(69 / FPS, 6);
    expect(plan!.speed).toBe(1);
  });

  it('respeta la velocidad constante del clip', () => {
    const c = clip({ reverse: true, speed: { num: 2, den: 1 } });
    const plan = reversedAudioPlan(c, FPS);
    expect(plan).not.toBeNull();
    const lastLocal = c.durationFrames - 1;
    expect(plan!.windowStartSec).toBeCloseTo(
      (clipSourceFrameAtLocal(c, lastLocal) as number) / FPS,
      6,
    );
    expect(plan!.windowEndSec).toBeCloseTo(
      (clipSourceFrameAtLocal(c, 0) as number) / FPS,
      6,
    );
    expect(plan!.speed).toBe(2);
    expect(reversedClipSpeed(c)).toBe(2);
  });

  it('devuelve null sin reverse, sin ventana de fuente o con speedCurve', () => {
    expect(reversedAudioPlan(clip(), FPS)).toBeNull();
    const audio = {
      id: 'a',
      trackId: 'a1',
      kind: 'audio',
      label: 'a',
      startFrame: 0,
      durationFrames: 60,
      reverse: true,
      source: { type: 'asset', assetId: 'a1', inFrame: 0, outFrame: 60 },
    } as Clip;
    expect(reversedAudioPlan(audio, FPS)).not.toBeNull();
    const curved = clip({
      reverse: true,
      speedCurve: { points: [{ t: 0, speed: 1 }, { t: 1, speed: 1 }] },
    });
    expect(reversedAudioPlan(curved, FPS)).toBeNull();
    const image = {
      id: 'i',
      trackId: 'v1',
      kind: 'image',
      label: 'i',
      startFrame: 0,
      durationFrames: 60,
      reverse: true,
      source: { type: 'asset', assetId: 'a1' },
    } as Clip;
    expect(reversedAudioPlan(image, FPS)).toBeNull();
  });
});

describe('reversedBufferOffsetSeconds / reversedBufferRate', () => {
  it('el offset crece lineal con el frame local', () => {
    expect(reversedBufferOffsetSeconds(0, 1, FPS)).toBe(0);
    expect(reversedBufferOffsetSeconds(15, 1, FPS)).toBeCloseTo(0.5, 6);
    expect(reversedBufferOffsetSeconds(10, 2, FPS)).toBeCloseTo(20 / FPS, 6);
    expect(reversedBufferOffsetSeconds(-4, 1, FPS)).toBe(0);
  });

  it('la rate del buffer es speed × playbackRate', () => {
    expect(reversedBufferRate(1, 1)).toBe(1);
    expect(reversedBufferRate(2, 0.5)).toBe(1);
    expect(reversedBufferRate(1, -1)).toBe(-1);
  });
});

describe('reverseSamples / reversedWindowSampleRange', () => {
  it('invierte el rango pedido', () => {
    expect([...reverseSamples(new Float32Array([1, 2, 3, 4]), 1, 3)]).toEqual([3, 2]);
    expect([...reverseSamples(new Float32Array([1, 2]), 0, 9)]).toEqual([2, 1]);
  });

  it('mapea la ventana a muestras del buffer decodificado', () => {
    const plan = reversedAudioPlan(clip({ reverse: true }), FPS)!;
    const range = reversedWindowSampleRange(plan, 300);
    expect(range).not.toBeNull();
    expect(range!.from).toBe(Math.floor((10 / FPS) * 300));
    expect(range!.to).toBe(Math.floor((69 / FPS) * 300));
    expect(reversedWindowSampleRange(plan, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Grafo Web Audio simulado.
// ---------------------------------------------------------------------------

class FakeParam {
  constructor(public value = 1) {}
  setTargetAtTime(value: number): void {
    this.value = value;
  }
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeNode {
  readonly connections: FakeNode[] = [];
  connect(destination: FakeNode): FakeNode {
    if (!this.connections.includes(destination)) this.connections.push(destination);
    return destination;
  }
  disconnect(): void {
    this.connections.length = 0;
  }
}

class FakeGainNode extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeBiquadNode extends FakeGainNode {
  type = 'peaking';
  readonly frequency = new FakeParam(0);
  readonly Q = new FakeParam(1);
}

class FakeAnalyserNode extends FakeNode {
  fftSize = 1024;
  getByteTimeDomainData(buffer: Uint8Array): void {
    buffer.fill(128);
  }
  getFloatFrequencyData(buffer: Float32Array): void {
    buffer.fill(-100);
  }
  getFloatTimeDomainData(buffer: Float32Array): void {
    buffer.fill(0);
  }
}

class FakeBufferSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => {
    this.onended?.();
  });
}

class FakeAudioBuffer {
  readonly channels: Float32Array[];
  constructor(
    channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  get numberOfChannels(): number {
    return this.channels.length;
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(channel: number): Float32Array {
    return this.channels[channel]!;
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  readonly destination = new FakeNode();
  currentTime = 0;
  state = 'running';
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  readonly created: FakeNode[] = [];
  readonly sources: FakeBufferSource[] = [];
  decoded: AudioBuffer | null = null;
  decodeAudioData = vi.fn(async () => this.decoded);

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  private record<T extends FakeNode>(node: T): T {
    this.created.push(node);
    return node;
  }

  createGain(): FakeGainNode {
    return this.record(new FakeGainNode());
  }
  createBiquadFilter(): FakeBiquadNode {
    return this.record(new FakeBiquadNode());
  }
  createDynamicsCompressor(): FakeNode {
    return this.record(new FakeNode());
  }
  createStereoPanner(): FakeNode {
    return this.record(new FakeNode());
  }
  createWaveShaper(): FakeNode {
    return this.record(new FakeNode());
  }
  createDelay(): FakeNode {
    return this.record(new FakeNode());
  }
  createOscillator(): FakeNode {
    return this.record(new FakeNode());
  }
  createChannelSplitter(): FakeNode {
    return this.record(new FakeNode());
  }
  createChannelMerger(): FakeNode {
    return this.record(new FakeNode());
  }
  createAnalyser(): FakeAnalyserNode {
    return this.record(new FakeAnalyserNode());
  }
  createMediaElementSource(): FakeNode {
    return this.record(new FakeNode());
  }
  createBufferSource(): FakeBufferSource {
    const node = this.record(new FakeBufferSource());
    this.sources.push(node);
    return node;
  }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    return new FakeAudioBuffer(channels, length, sampleRate) as unknown as AudioBuffer;
  }
}

function installFakeAudioContext(): void {
  (window as unknown as { AudioContext: unknown }).AudioContext =
    FakeAudioContext as unknown as typeof AudioContext;
}

function lastContext(): FakeAudioContext {
  const ctx = FakeAudioContext.instances.at(-1);
  if (!ctx) throw new Error('no se creó AudioContext');
  return ctx;
}

/** ¿`from` alcanza `to` por las conexiones registradas? */
function reaches(from: FakeNode, to: FakeNode): boolean {
  const seen = new Set<FakeNode>();
  const queue = [from];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === to) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    queue.push(...node.connections);
  }
  return false;
}

const TEST_BUFFER = {
  numberOfChannels: 1,
  sampleRate: 10,
  duration: 1,
  length: 10,
  getChannelData: (channel: number) => {
    void channel;
    return new Float32Array(10);
  },
} as unknown as AudioBuffer;

beforeEach(() => {
  FakeAudioContext.instances.length = 0;
  installFakeAudioContext();
});

afterEach(() => {
  resetPreviewAudio();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createReversedWindowBuffer', () => {
  it('invierte las muestras de la ventana de fuente', () => {
    // Fuente de 100 samples a 100 Hz; ventana [0.2, 0.6) → índices [20, 60).
    const src = new FakeAudioBuffer(1, 100, 100);
    for (let index = 0; index < 100; index += 1) src.getChannelData(0)[index] = index;
    const plan = { windowStartSec: 0.2, windowEndSec: 0.6, speed: 1 };
    const ctx = new FakeAudioContext();
    const out = createReversedWindowBuffer(
      ctx as unknown as AudioContext,
      src as unknown as AudioBuffer,
      plan,
    );
    expect(out).not.toBeNull();
    expect(out!.length).toBe(40);
    expect(out!.sampleRate).toBe(100);
    // dst[0] = src[59] (final de la ventana), dst[39] = src[20].
    expect(out!.getChannelData(0)[0]).toBe(59);
    expect(out!.getChannelData(0)[39]).toBe(20);
    expect(out!.getChannelData(0)[20]).toBe(39);
  });

  it('devuelve null si la ventana no llega a 8 muestras', () => {
    const src = new FakeAudioBuffer(1, 8, 10);
    const ctx = new FakeAudioContext();
    expect(
      createReversedWindowBuffer(
        ctx as unknown as AudioContext,
        src as unknown as AudioBuffer,
        { windowStartSec: 0.2, windowEndSec: 0.21, speed: 1 },
      ),
    ).toBeNull();
  });
});

describe('startPreviewReversedAudio', () => {
  it('crea un buffer source conectado a la entrada de la pista', () => {
    const voice = startPreviewReversedAudio({
      key: 'c1',
      trackId: 'v1',
      buffer: TEST_BUFFER,
      offsetSec: 0.2,
      rate: 1,
      gainDb: 0,
      pan: 0,
      fx: [],
    });
    expect(voice).not.toBeNull();
    const fake = lastContext();
    expect(fake.sources).toHaveLength(1);
    const source = fake.sources[0]!;
    expect(source.buffer).toBe(TEST_BUFFER);
    expect(source.playbackRate.value).toBe(1);
    expect(source.start).toHaveBeenCalledTimes(1);
    const [when, offset, duration] = source.start.mock.calls[0] as unknown as [
      number,
      number,
      number,
    ];
    expect(when).toBeCloseTo(0.03, 5);
    expect(offset).toBeCloseTo(0.2, 5);
    expect(duration).toBeCloseTo(TEST_BUFFER.duration - 0.2, 5);
    // El buffer source alimenta la ganancia de clip, que llega al destination
    // del contexto a través de la cadena de pista (EQ → fader → paneo → master).
    const gains = fake.created.filter((n): n is FakeGainNode => n instanceof FakeGainNode);
    const clipGain = gains.at(-1)!;
    expect(reaches(clipGain, fake.destination)).toBe(true);
  });

  it('sync re-posiciona el buffer source cuando el playhead derivó', () => {
    const voice = startPreviewReversedAudio({
      key: 'c1',
      trackId: 'v1',
      buffer: TEST_BUFFER,
      offsetSec: 0,
      rate: 1,
      gainDb: 0,
      pan: 0,
      fx: [],
    })!;
    const fake = lastContext();
    expect(fake.sources).toHaveLength(1);
    // Sin deriva (0.05 s de buffer transcurridos) no hay re-seek.
    fake.currentTime += 0.05;
    voice.sync({ offsetSec: 0.05, rate: 1, gainDb: 0, pan: 0, fx: [] });
    expect(fake.sources).toHaveLength(1);
    // Seek del usuario: deriva > umbral → nuevo buffer source en el offset.
    fake.currentTime += 0.01;
    voice.sync({ offsetSec: 0.5, rate: 1, gainDb: 0, pan: 0, fx: [] });
    expect(fake.sources).toHaveLength(2);
    const [, offset] = fake.sources[1]!.start.mock.calls[0] as unknown as [
      number,
      number,
      number,
    ];
    expect(offset).toBeCloseTo(0.5, 5);
  });

  it('rate ≤ 0 (shuttle inverso) silencia la voz sin romper el grafo', () => {
    const voice = startPreviewReversedAudio({
      key: 'c1',
      trackId: 'v1',
      buffer: TEST_BUFFER,
      offsetSec: 0,
      rate: 1,
      gainDb: 0,
      pan: 0,
      fx: [],
    })!;
    const fake = lastContext();
    voice.sync({ offsetSec: 0.1, rate: -1, gainDb: 0, pan: 0, fx: [] });
    expect(fake.sources[0]!.stop).toHaveBeenCalled();
    // Volver a rate positiva rearma el buffer source en el offset actual.
    fake.currentTime += 0.02;
    voice.sync({ offsetSec: 0.1, rate: 1, gainDb: 0, pan: 0, fx: [] });
    expect(fake.sources.length).toBeGreaterThanOrEqual(2);
  });

  it('stop cierra la sesión y una segunda voz reemplaza a la primera', () => {
    const first = startPreviewReversedAudio({
      key: 'c1',
      trackId: 'v1',
      buffer: TEST_BUFFER,
      offsetSec: 0,
      rate: 1,
      gainDb: 0,
      pan: 0,
      fx: [],
    })!;
    const fake = lastContext();
    const sourcesBefore = fake.sources.length;
    first.stop();
    expect(fake.sources[0]!.stop).toHaveBeenCalled();
    stopPreviewReversedAudio('c1'); // idempotente
    const second = startPreviewReversedAudio({
      key: 'c1',
      trackId: 'v1',
      buffer: TEST_BUFFER,
      offsetSec: 0.3,
      rate: 1,
      gainDb: 0,
      pan: 0,
      fx: [],
    })!;
    expect(second).not.toBeNull();
    expect(fake.sources.length).toBe(sourcesBefore + 1);
  });
});

describe('decodePreviewAudio', () => {
  function stubFetch(bytes: ArrayBuffer, ok = true): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok, arrayBuffer: async () => bytes })),
    );
  }

  it('decodifica el archivo con el contexto del motor', async () => {
    const decoded = new FakeAudioBuffer(2, 1000, 44100) as unknown as AudioBuffer;
    // Fuerza la creación del contexto antes de stub-ear decodeAudioData.
    startPreviewReversedAudio({
      key: 'warm',
      trackId: 'v1',
      buffer: TEST_BUFFER,
      offsetSec: 0,
      rate: 1,
      gainDb: 0,
      pan: 0,
      fx: [],
    })?.stop();
    lastContext().decoded = decoded;
    stopPreviewReversedAudio('warm');
    stubFetch(new ArrayBuffer(16));
    const buffer = await decodePreviewAudio('asset://media/a.mp3');
    expect(buffer).toBe(decoded);
    expect(lastContext().decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it('devuelve null si el archivo supera el tope de bytes', async () => {
    stubFetch(new ArrayBuffer(96 * 1024 * 1024 + 1));
    expect(await decodePreviewAudio('asset://media/big.mp3')).toBeNull();
    expect(lastContext().decodeAudioData).not.toHaveBeenCalled();
  });

  it('devuelve null si la duración decodificada supera el tope', async () => {
    const long = {
      ...TEST_BUFFER,
      duration: 200,
    } as AudioBuffer;
    startPreviewReversedAudio({
      key: 'warm2',
      trackId: 'v1',
      buffer: TEST_BUFFER,
      offsetSec: 0,
      rate: 1,
      gainDb: 0,
      pan: 0,
      fx: [],
    })?.stop();
    lastContext().decoded = long;
    stopPreviewReversedAudio('warm2');
    stubFetch(new ArrayBuffer(8));
    expect(await decodePreviewAudio('asset://media/long.mp3')).toBeNull();
  });

  it('devuelve null si fetch o la decodificación fallan', async () => {
    stubFetch(new ArrayBuffer(8), false);
    expect(await decodePreviewAudio('asset://media/missing.mp3')).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    expect(await decodePreviewAudio('asset://media/err.mp3')).toBeNull();
  });
});
