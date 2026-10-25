// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  addTrack,
  ensureDelivery,
  updateAudioMix,
  updateTrack,
} from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { LiveMeters } from './LiveMeters';
import {
  attachPreviewAudio,
  detachPreviewAudio,
  readPreviewAudioLevels,
  resetPreviewAudio,
  syncPreviewAudioFromProject,
} from './usePreviewAudio';

/**
 * Los medidores en vivo dependen de Web Audio, que jsdom no implementa. Estos
 * pruebas cubren los dos caminos: la degradación silenciosa (sin
 * AudioContext, todo queda en reposo y la preview no se rompe) y el grafo
 * simulado, con un AudioContext falso que registra los nodos creados para
 * afirmar la topología (EQ de 3 bandas, fader, paneo de balance lineal,
 * master) y los niveles leídos por `getByteTimeDomainData`.
 */

const NOW = '2026-10-24T00:00:00.000Z';

// jsdom puede no traer requestAnimationFrame según su configuración: un
// polyfill mínimo mantiene el bucle de los medidores funcionando.
if (typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(window.performance.now()), 16)) as typeof requestAnimationFrame;
  window.cancelAnimationFrame = ((handle: number) =>
    window.clearTimeout(handle)) as typeof cancelAnimationFrame;
}

class FakeAudioParam {
  constructor(public value = 1) {}
}

class FakeNodeBase {
  readonly connections: FakeNodeBase[] = [];
  // Como en Web Audio: conectar dos veces la misma salida a la misma entrada
  // no duplica la conexión.
  connect(destination: FakeNodeBase): FakeNodeBase {
    if (!this.connections.includes(destination)) {
      this.connections.push(destination);
    }
    return destination;
  }
  disconnect(): void {
    this.connections.length = 0;
  }
}

class FakeGain extends FakeNodeBase {
  readonly gain = new FakeAudioParam(1);
}

class FakeBiquad extends FakeGain {
  type: BiquadFilterType = 'peaking';
  readonly frequency = new FakeAudioParam();
}

class FakeAnalyser extends FakeNodeBase {
  fftSize = 1024;
  data = new Float32Array(1024);
  getByteTimeDomainData(buffer: Uint8Array): void {
    for (let index = 0; index < buffer.length; index += 1) {
      const sample = this.data[index] ?? 0;
      buffer[index] = Math.max(0, Math.min(255, Math.round(128 + sample * 128)));
    }
  }
}

class FakeMediaSource extends FakeNodeBase {}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
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
  createMediaElementSource(): FakeMediaSource {
    return this.record(new FakeMediaSource());
  }
}

function installFakeAudioContext(): void {
  (window as unknown as { AudioContext?: unknown }).AudioContext =
    FakeAudioContext as unknown as typeof AudioContext;
}

function lastFakeContext(): FakeAudioContext {
  const instance = FakeAudioContext.instances.at(-1);
  if (!instance) throw new Error('no se creó un AudioContext simulado');
  return instance;
}

function gainsOf(ctx: FakeAudioContext): FakeGain[] {
  return ctx.created.filter(
    (node): node is FakeGain => node instanceof FakeGain && !(node instanceof FakeBiquad),
  );
}

function biquadsOf(ctx: FakeAudioContext): FakeBiquad[] {
  return ctx.created.filter((node): node is FakeBiquad => node instanceof FakeBiquad);
}

function analysersOf(ctx: FakeAudioContext): FakeAnalyser[] {
  return ctx.created.filter((node): node is FakeAnalyser => node instanceof FakeAnalyser);
}

function mediaSourcesOf(ctx: FakeAudioContext): FakeMediaSource[] {
  return ctx.created.filter((node): node is FakeMediaSource => node instanceof FakeMediaSource);
}

/** Proyecto con una pista «Música» (con clip y parámetros de mezcla) y una «Voz». */
function buildProject(): { project: ProjectDocument; musicTrackId: string } {
  let project = ensureDelivery(createEmptyProject('Medidores E2E', NOW));
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
  project = updateTrack(project, music.trackId, {
    gainDb: -6,
    pan: 0.5,
    eqLowDb: -3,
    eqMidDb: 2,
    eqHighDb: 1.5,
  });
  project = updateAudioMix(project, { masterGainDb: -10 });
  return { project, musicTrackId: music.trackId };
}

function audioTracksOf(project: ProjectDocument): ProjectDocument['timeline']['tracks'] {
  return project.timeline.tracks.filter((track) => track.kind !== 'caption');
}

function renderMeters(project: ProjectDocument, withPlayback = false) {
  return render(
    <ProjectProvider
      service={createFakeService()}
      initial={{
        project,
        opened: {
          project,
          label: 'medidores.editoria.json',
          path: 'C:\\tester\\medidores.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      {withPlayback ? <PlayTrigger /> : null}
      <LiveMeters tracks={audioTracksOf(project)} />
    </ProjectProvider>,
  );
}

/** Pone el store en reproducción para activar el bucle de los medidores. */
function PlayTrigger(): null {
  const store = useProjectStore();
  useEffect(() => {
    store.setPlaying(true);
  }, [store]);
  return null;
}

afterEach(() => {
  cleanup();
  resetPreviewAudio();
  (window as unknown as { AudioContext?: unknown }).AudioContext = undefined;
  FakeAudioContext.instances.length = 0;
  vi.restoreAllMocks();
});

describe('medidores en vivo sin Web Audio (degradación silenciosa)', () => {
  it('no enruta elementos ni crea grafo cuando falta AudioContext', () => {
    const element = document.createElement('audio');
    expect(attachPreviewAudio('pista-fantasma', element)).toBe(false);
    expect(readPreviewAudioLevels(['pista-fantasma'])).toBeNull();
    detachPreviewAudio('pista-fantasma', element); // no debe lanzar
  });

  it('muestra el panel en reposo con barras al piso y la pista del entorno', () => {
    const { project } = buildProject();
    renderMeters(project);
    expect(screen.getByRole('heading', { name: /Medidores en vivo/i })).toBeTruthy();
    const music = screen.getByRole('meter', { name: 'Nivel en vivo de Música' });
    expect(music.getAttribute('aria-valuenow')).toBe('-60');
    const master = screen.getByRole('meter', { name: 'Nivel en vivo de Master' });
    expect(master.getAttribute('aria-valuenow')).toBe('-60');
    expect(screen.getByText(/no expone Web Audio/i)).toBeTruthy();
  });
});

describe('medidores en vivo con AudioContext simulado', () => {
  beforeEach(() => {
    resetPreviewAudio();
    installFakeAudioContext();
  });

  it('arma el grafo por pista: EQ de 3 bandas, fader y paneo de balance lineal', () => {
    const { project, musicTrackId } = buildProject();
    syncPreviewAudioFromProject(project);

    const element = document.createElement('audio');
    expect(attachPreviewAudio(musicTrackId, element)).toBe(true);

    const ctx = lastFakeContext();
    const biquads = biquadsOf(ctx);
    expect(biquads.map((node) => node.type)).toEqual(['lowshelf', 'peaking', 'highshelf']);
    expect(biquads.map((node) => node.frequency.value)).toEqual([120, 1_000, 8_000]);
    expect(biquads.map((node) => node.gain.value)).toEqual([-3, 2, 1.5]);

    // Fader: -6 dB → 10^(-6/20) ≈ 0.5012. Master: -10 dB → ≈ 0.3162.
    const gains = gainsOf(ctx);
    expect(gains.some((node) => Math.abs(node.gain.value - 10 ** (-6 / 20)) < 1e-4)).toBe(true);
    expect(gains.some((node) => Math.abs(node.gain.value - 10 ** (-10 / 20)) < 1e-4)).toBe(true);

    // Topología: elemento → entrada → EQ → fader → splitter → ganancias de
    // paneo → merger → analizador → bus master → analizador master → destino.
    const sources = mediaSourcesOf(ctx);
    expect(sources).toHaveLength(1);
    const input = sources[0]!.connections[0]!;
    const eqLow = input.connections[0] as FakeBiquad;
    const eqMid = eqLow.connections[0] as FakeBiquad;
    const eqHigh = eqMid.connections[0] as FakeBiquad;
    expect(eqLow.type).toBe('lowshelf');
    expect(eqHigh.type).toBe('highshelf');
    const fader = eqHigh.connections[0] as FakeGain;
    expect(Math.abs(fader.gain.value - 10 ** (-6 / 20)) < 1e-4).toBe(true);
    const splitter = fader.connections[0]!;
    const panLeft = splitter.connections[0] as FakeGain;
    const panRight = splitter.connections[1] as FakeGain;
    // Paneo de balance lineal como el export: pan 0.5 → L 0.5, R 1 (6 dB).
    expect(panLeft.gain.value).toBe(0.5);
    expect(panRight.gain.value).toBe(1);
    const merger = panLeft.connections[0]!;
    const trackAnalyser = merger.connections[0] as FakeAnalyser;
    const analysers = analysersOf(ctx);
    expect(analysers).toHaveLength(2); // master + pista
    expect(trackAnalyser).toBe(analysers[1]!);
    const masterBus = trackAnalyser.connections[0] as FakeGain;
    expect(Math.abs(masterBus.gain.value - 10 ** (-10 / 20)) < 1e-4).toBe(true);
    const masterAnalyser = masterBus.connections[0] as FakeAnalyser;
    expect(masterAnalyser).toBe(analysers[0]!);
    expect(masterAnalyser.connections).toContain(ctx.destination);

    // Attach repetido (React StrictMode monta dos veces) reutiliza el nodo.
    expect(attachPreviewAudio(musicTrackId, element)).toBe(true);
    expect(mediaSourcesOf(ctx)).toHaveLength(1);
  });

  it('cambia fader, paneo y EQ cuando el proyecto se sincroniza de nuevo', () => {
    const { project, musicTrackId } = buildProject();
    syncPreviewAudioFromProject(project);
    const element = document.createElement('audio');
    expect(attachPreviewAudio(musicTrackId, element)).toBe(true);

    const retouched = updateTrack(project, musicTrackId, {
      gainDb: 0,
      pan: -1,
      eqLowDb: 6,
      eqMidDb: 0,
      eqHighDb: 0,
    });
    syncPreviewAudioFromProject(retouched);

    const ctx = lastFakeContext();
    const biquads = biquadsOf(ctx);
    expect(biquads[0]!.gain.value).toBe(6);
    expect(biquads[1]!.gain.value).toBe(0);
    // Paneo extremo a la izquierda: canal izquierdo 1.0, derecho mudo.
    const gains = gainsOf(ctx);
    expect(gains.filter((node) => Math.abs(node.gain.value - 1) < 1e-9).length).toBeGreaterThanOrEqual(2);
    expect(gains.some((node) => Math.abs(node.gain.value) < 1e-9)).toBe(true);
  });

  it('suelta las cadenas de pistas que ya no están en el proyecto', () => {
    const { project, musicTrackId } = buildProject();
    syncPreviewAudioFromProject(project);
    const element = document.createElement('audio');
    expect(attachPreviewAudio(musicTrackId, element)).toBe(true);

    const pruned = {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.filter((track) => track.id !== musicTrackId),
      },
    } as ProjectDocument;
    syncPreviewAudioFromProject(pruned);

    // La pista removida queda en silencio: su cadena se desconectó.
    const levels = readPreviewAudioLevels([musicTrackId]);
    expect(levels).not.toBeNull();
    expect(levels!.tracks[musicTrackId]!.rmsDb).toBe(Number.NEGATIVE_INFINITY);
  });

  it('levanta las barras mientras se reproduce y sostiene el pico', async () => {
    const { project, musicTrackId } = buildProject();
    syncPreviewAudioFromProject(project);
    const element = document.createElement('audio');
    expect(attachPreviewAudio(musicTrackId, element)).toBe(true);

    const ctx = lastFakeContext();
    const trackAnalyser = analysersOf(ctx)[1]!;
    trackAnalyser.data.fill(0.5); // RMS 0.5 → -6.0 dBFS

    const { unmount } = renderMeters(project, true);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    const music = screen.getByRole('meter', { name: 'Nivel en vivo de Música' });
    const fill = music.querySelector('.mixer-meter-fill') as HTMLElement;
    const loudWidth = ((20 * Math.log10(0.5) + 60) / 60) * 100;
    expect(Number.parseFloat(fill.style.width)).toBeCloseTo(loudWidth, 1);
    expect(music.getAttribute('aria-valuenow')).toBe('-6');
    expect(screen.getByText('-6.0 dB')).toBeTruthy();

    // Baja el material: la barra cae pero el pico sostenido queda en -6 dB.
    trackAnalyser.data.fill(0.25); // RMS 0.25 → -12.0 dBFS
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    const fallenFill = music.querySelector('.mixer-meter-fill') as HTMLElement;
    const quietWidth = ((20 * Math.log10(0.25) + 60) / 60) * 100;
    expect(Number.parseFloat(fallenFill.style.width)).toBeCloseTo(quietWidth, 1);
    const peakMarker = music.querySelector('.mixer-meter-peak-hold') as HTMLElement;
    expect(Number.parseFloat(peakMarker.style.left)).toBeCloseTo(loudWidth, 1);

    // Master sin material en su analizador: en silencio.
    const master = screen.getByRole('meter', { name: 'Nivel en vivo de Master' });
    expect(master.getAttribute('aria-valuenow')).toBe('-60');

    await act(async () => {
      unmount();
    });
  });
});
