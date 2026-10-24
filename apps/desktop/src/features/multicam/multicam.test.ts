import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import { addAsset, ensureDelivery } from '../../state/project-actions';
import { readyAsset } from '../../test/fake-service';
import {
  activeCameraAt,
  assetDurationFrames,
  buildMulticamProject,
  normalizeCuts,
  programDurationFrames,
  envelopeFromPeaks,
  recordCut,
  syncOffsetsFromEnvelopes,
  type AudioEnvelope,
  type MulticamCamera,
} from './multicam';

const NOW = '2026-10-24T00:00:00.000Z';

function fixture() {
  const first = readyAsset({
    label: 'Cámara A',
    media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
  });
  const second = readyAsset({
    label: 'Cámara B',
    media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
  });
  const project = addAsset(addAsset(ensureDelivery(createEmptyProject('Multi', NOW)), first), second);
  const cameras: MulticamCamera[] = [
    { asset: first, offsetFrames: 0 },
    { asset: second, offsetFrames: 30 },
  ];
  return { first, second, project, cameras };
}

describe('multicámara · sincronización y cortes', () => {
  it('limita la duración a la cámara con menos material desde su entrada', () => {
    const { cameras, second } = fixture();
    expect(programDurationFrames(cameras)).toBe(270);
    expect(assetDurationFrames(second)).toBe(300);
    expect(programDurationFrames([])).toBe(0);
  });

  it('ordena, deduplica y fuerza un corte al inicio', () => {
    const cuts = normalizeCuts(
      [
        { frame: 120, cameraIndex: 1 },
        { frame: 60, cameraIndex: 99 },
        { frame: 120, cameraIndex: 0 },
        { frame: 999, cameraIndex: 1 },
      ],
      270,
      2,
    );
    expect(cuts).toEqual([
      { frame: 0, cameraIndex: 0 },
      { frame: 120, cameraIndex: 0 },
    ]);
    expect(recordCut(cuts, 60, 1, 270, 2)).toEqual([
      { frame: 0, cameraIndex: 0 },
      { frame: 60, cameraIndex: 1 },
      { frame: 120, cameraIndex: 0 },
    ]);
    expect(activeCameraAt(cuts, 0)).toBe(0);
    expect(activeCameraAt(cuts, 130)).toBe(0);
  });

  it('monta una pista nueva con los tramos y offsets correctos', () => {
    const { project, cameras } = fixture();
    const built = buildMulticamProject(project, cameras, [
      { frame: 0, cameraIndex: 0 },
      { frame: 90, cameraIndex: 1 },
    ]);
    const parsed = parseProject(built.project);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const clips = parsed.project.timeline.clips
      .filter((clip) => clip.trackId === built.trackId)
      .sort((a, b) => a.startFrame - b.startFrame);
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ startFrame: 0, durationFrames: 90 });
    expect(clips[0]?.source).toMatchObject({ inFrame: 0, outFrame: 90 });
    expect(clips[1]).toMatchObject({ startFrame: 90, durationFrames: 180 });
    expect(clips[1]?.source).toMatchObject({ inFrame: 120, outFrame: 300 });
    expect(built.clipCount).toBe(2);
    expect(built.durationFrames).toBe(270);
  });

  it('exige al menos dos cámaras', () => {
    const { project, cameras } = fixture();
    expect(() => buildMulticamProject(project, cameras.slice(0, 1), [{ frame: 0, cameraIndex: 0 }])).toThrow(
      /al menos dos/i,
    );
  });
});
describe('multicámara · sincronización por audio', () => {
  function envelope(values: readonly number[], stepSeconds = 0.04): AudioEnvelope {
    return {
      durationSeconds: values.length * stepSeconds,
      stepSeconds,
      values,
    };
  }

  function pulses(shift = 0): number[] {
    const values = new Array<number>(600).fill(0.01);
    for (const index of [80, 180, 300, 420, 520]) {
      const target = index + shift;
      if (target >= 0 && target < values.length) values[target] = 1;
    }
    return values;
  }

  it('detecta un desfase positivo y lo convierte en entrada de cámara', () => {
    const reference = envelope(pulses(0));
    const delayed = envelope(pulses(30));
    const result = syncOffsetsFromEnvelopes([reference, delayed]);
    expect(result).not.toBeNull();
    expect(result?.offsetsSeconds[0]).toBeCloseTo(0, 2);
    expect(result?.offsetsSeconds[1]).toBeCloseTo(1.2, 2);
    expect(result?.scores[1]).toBeGreaterThan(0.5);
  });

  it('normaliza desfases negativos para que ninguna entrada sea negativa', () => {
    const reference = envelope(pulses(20));
    const earlier = envelope(pulses(0));
    const result = syncOffsetsFromEnvelopes([reference, earlier]);
    expect(result).not.toBeNull();
    expect(result?.offsetsSeconds[0]).toBeCloseTo(0.8, 2);
    expect(result?.offsetsSeconds[1]).toBeCloseTo(0, 2);
  });

  it('rechaza silencio o falta de correlación', () => {
    expect(
      syncOffsetsFromEnvelopes([envelope(new Array(600).fill(0.2)), envelope(pulses())]),
    ).toBeNull();
  });

  it('convierte los picos del backend en una envolvente coherente', () => {
    const peaks = {
      assetId: 'a',
      durationSeconds: 2,
      buckets: 50,
      peaks: Array.from({ length: 50 }, (_, index) => ({
        min: -(index / 100),
        max: index / 100,
      })),
    };
    const result = envelopeFromPeaks(peaks);
    expect(result.durationSeconds).toBe(2);
    expect(result.stepSeconds).toBeCloseTo(0.04);
    expect(result.values[25]).toBeCloseTo(0.25);
  });
});
