import { describe, expect, it } from 'vitest';
import type { AudioPeaks } from '../services/project-service';
import type { Clip } from '@editor-ia/project-schema';
import {
  applySilenceCuts,
  detectSilences,
  planSilenceCuts,
} from './silence-cuts';

const FPS = 30;

function peaksWithPattern(
  pattern: readonly ('voz' | 'silencio')[],
  secondsPerBucket = 0.1,
): AudioPeaks {
  return {
    assetId: 'asset-1',
    durationSeconds: pattern.length * secondsPerBucket,
    buckets: pattern.length,
    peaks: pattern.map((kind) =>
      kind === 'voz' ? { min: -0.6, max: 0.6 } : { min: -0.001, max: 0.001 },
    ),
  };
}

const NARRATION: readonly ('voz' | 'silencio')[] = [
  ...Array.from({ length: 30 }, () => 'voz' as const), // 0.0–3.0 s
  ...Array.from({ length: 20 }, () => 'silencio' as const), // 3.0–5.0 s
  ...Array.from({ length: 30 }, () => 'voz' as const), // 5.0–8.0 s
  ...Array.from({ length: 20 }, () => 'silencio' as const), // 8.0–10.0 s
];

const FULL_CLIP = {
  id: 'clip-1',
  trackId: 'track-1',
  kind: 'video',
  label: 'Narración',
  startFrame: 100,
  durationFrames: 10 * FPS,
  inFrame: 0,
  outFrame: 10 * FPS,
} as unknown as Clip;

describe('detectSilences', () => {
  it('detecta los dos silencios largos de una narración típica', () => {
    const spans = detectSilences(peaksWithPattern(NARRATION), FPS);
    expect(spans).toHaveLength(2);
    // 3.0–5.0 s con padding de 0.15 s por lado → 3.15–4.85 s
    expect(spans[0]!.startFrame).toBeCloseTo(3.15 * FPS, 0);
    expect(spans[0]!.endFrame).toBeCloseTo(4.85 * FPS, 0);
    expect(spans[1]!.startFrame).toBeCloseTo(8.15 * FPS, 0);
  });

  it('ignora silencios más cortos que el mínimo', () => {
    const pattern: readonly ('voz' | 'silencio')[] = [
      ...Array.from({ length: 30 }, () => 'voz' as const),
      ...Array.from({ length: 2 }, () => 'silencio' as const), // 0.2 s < 0.35 s
      ...Array.from({ length: 30 }, () => 'voz' as const),
    ];
    expect(detectSilences(peaksWithPattern(pattern), FPS)).toHaveLength(0);
  });

  it('un pico respirando dentro del silencio lo divide, no lo elimina', () => {
    const pattern: readonly ('voz' | 'silencio')[] = [
      ...Array.from({ length: 20 }, () => 'silencio' as const),
      ...Array.from({ length: 1 }, () => 'voz' as const),
      ...Array.from({ length: 20 }, () => 'silencio' as const),
    ];
    // Cada tramo de 2.0 s supera el mínimo → dos silencios, no uno.
    expect(detectSilences(peaksWithPattern(pattern), FPS)).toHaveLength(2);
  });

  it('sin picos no hay silencios', () => {
    expect(
      detectSilences({ assetId: 'a', durationSeconds: 5, buckets: 0, peaks: [] }, FPS),
    ).toHaveLength(0);
  });
});

describe('planSilenceCuts', () => {
  it('mapea los silencios del asset a frames absolutos del timeline', () => {
    const plan = planSilenceCuts(FULL_CLIP, peaksWithPattern(NARRATION), FPS);
    expect(plan).not.toBeNull();
    // Los cortes se redondean a frames enteros: 194.5 → 195.
    expect(plan!.cutFrames[0]).toBe(195);
    expect(plan!.removedSeconds).toBeGreaterThan(3);
    expect(plan!.removedSeconds).toBeLessThan(4);
    expect(plan!.excessive).toBe(false);
  });

  it('respeta el inFrame del clip (el silencio previo al in no cuenta)', () => {
    const clip = { ...FULL_CLIP, inFrame: 6 * FPS, outFrame: 10 * FPS, durationFrames: 4 * FPS };
    const plan = planSilenceCuts(clip, peaksWithPattern(NARRATION), FPS);
    // Dentro de 6–10 s solo está el silencio 8.15–9.85 s → un solo rango.
    expect(plan).not.toBeNull();
    expect(plan!.spans).toHaveLength(1);
    expect(plan!.cutFrames.every((frame) => frame > clip.startFrame && frame < clip.startFrame + 4 * FPS)).toBe(true);
  });

  it('sin silencios devuelve null', () => {
    const allVoz = peaksWithPattern(Array.from({ length: 100 }, () => 'voz' as const));
    expect(planSilenceCuts(FULL_CLIP, allVoz, FPS)).toBeNull();
  });

  it('marca como excesivo un plan que eliminaría más del 80% del clip', () => {
    const mostlySilent = peaksWithPattern([
      ...Array.from({ length: 5 }, () => 'voz' as const),
      ...Array.from({ length: 95 }, () => 'silencio' as const),
    ]);
    const plan = planSilenceCuts(FULL_CLIP, mostlySilent, FPS);
    expect(plan!.excessive).toBe(true);
  });
});

describe('applySilenceCuts', () => {
  it('rechaza planes excesivos sin tocar el proyecto', () => {
    const proyecto = { timeline: { clips: [] } } as unknown as Parameters<
      typeof applySilenceCuts
    >[0];
    const excessive: Parameters<typeof applySilenceCuts>[2] = {
      cutFrames: [130],
      spans: [{ startFrame: 100, endFrame: 380 }],
      removedSeconds: 9,
      excessive: true,
    };
    // Devuelve la MISMA referencia: nada fue modificado.
    expect(applySilenceCuts(proyecto, 'clip-1', excessive)).toBe(proyecto);
  });
});
