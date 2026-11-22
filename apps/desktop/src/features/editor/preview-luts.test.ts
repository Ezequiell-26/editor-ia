// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Clip } from '@editor-ia/project-schema';
import { clipPreviewLuts, lookLutRequests } from './preview-luts';

function clip(effects: Record<string, unknown> | undefined, id = 'c1'): Clip {
  return {
    id,
    trackId: 'v1',
    kind: 'video',
    label: id,
    startFrame: 0,
    durationFrames: 100,
    source: { type: 'asset', assetId: 'a1', inFrame: 0, outFrame: 100 },
    ...(effects ? { effects } : {}),
  } as Clip;
}

describe('clipPreviewLuts', () => {
  it('sin effects o sin LUT devuelve []', () => {
    expect(clipPreviewLuts(clip(undefined), null)).toEqual([]);
    expect(clipPreviewLuts(clip({ contrast: 1.1 }), null)).toEqual([]);
  });

  it('cameraProfile válido genera request de perfil', () => {
    const requests = clipPreviewLuts(clip({ cameraProfile: 'slog3709' }), null);
    expect(requests).toEqual([{ kind: 'profile', id: 'slog3709' }]);
  });

  it('cameraProfile desconocido se ignora (igual que el export)', () => {
    expect(clipPreviewLuts(clip({ cameraProfile: 'nope' }), null)).toEqual([]);
  });

  it('lutFile genera request de archivo con intensidad default 1', () => {
    const requests = clipPreviewLuts(
      clip({ lutFile: 'media/luts/x.cube' }),
      null,
    );
    expect(requests).toEqual([
      { kind: 'file', path: 'media/luts/x.cube', intensity: 1 },
    ]);
  });

  it('lutIntensity ≤ 0.001 no aplica (mismo corte que effects_lut)', () => {
    expect(
      clipPreviewLuts(clip({ lutFile: 'media/luts/x.cube', lutIntensity: 0 }), null),
    ).toEqual([]);
    expect(
      clipPreviewLuts(clip({ lutFile: 'media/luts/x.cube', lutIntensity: 0.5 }), null),
    ).toEqual([{ kind: 'file', path: 'media/luts/x.cube', intensity: 0.5 }]);
  });

  it('cameraProfile + lutFile respetan el orden del export', () => {
    const requests = clipPreviewLuts(
      clip({ cameraProfile: 'vlog709', lutFile: 'media/luts/x.cube', lutIntensity: 0.4 }),
      null,
    );
    expect(requests).toEqual([
      { kind: 'profile', id: 'vlog709' },
      { kind: 'file', path: 'media/luts/x.cube', intensity: 0.4 },
    ]);
  });

  it('usa los effects de la audición cuando el clip está en audition', () => {
    const c = clip({ contrast: 1 });
    const audition = {
      clipId: c.id,
      effects: { lutFile: 'media/luts/look.cube' },
    };
    const requests = clipPreviewLuts(c, audition as never);
    expect(requests).toEqual([
      { kind: 'file', path: 'media/luts/look.cube', intensity: 1 },
    ]);
  });
});

describe('lookLutRequests · LUT global del project.look', () => {
  it('sin look o sin lutFile devuelve []', () => {
    expect(lookLutRequests(undefined)).toEqual([]);
    expect(lookLutRequests({ contrast: 1.1 } as never)).toEqual([]);
  });

  it('lutFile del look genera request con intensidad default 1', () => {
    expect(
      lookLutRequests({ lutFile: 'media/luts/master.cube' } as never),
    ).toEqual([{ kind: 'file', path: 'media/luts/master.cube', intensity: 1 }]);
  });

  it('lutIntensity ~0 no aplica (mismo corte que effects_lut)', () => {
    expect(
      lookLutRequests({ lutFile: 'media/luts/x.cube', lutIntensity: 0 } as never),
    ).toEqual([]);
    expect(
      lookLutRequests({ lutFile: 'media/luts/x.cube', lutIntensity: 0.35 } as never),
    ).toEqual([{ kind: 'file', path: 'media/luts/x.cube', intensity: 0.35 }]);
  });

  it('cameraProfile del look se ignora (el export tampoco lo lee)', () => {
    expect(
      lookLutRequests({ cameraProfile: 'slog3709' } as never),
    ).toEqual([]);
  });
});
