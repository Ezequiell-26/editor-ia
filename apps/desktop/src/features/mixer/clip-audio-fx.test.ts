import { describe, expect, it } from 'vitest';
import type { EffectInstance } from '@editor-ia/effect-kit';
import { clipAudioFxSpec, clipVoiceFxSpec, PREVIEW_AUDIO_FX } from './clip-audio-fx';

function instance(
  effectId: string,
  params: Record<string, number> = {},
  extra: Partial<EffectInstance> = {},
): EffectInstance {
  return { id: `i-${effectId}`, effectId, enabled: true, params, ...extra };
}

describe('clipAudioFxSpec', () => {
  it('devuelve vacío sin stack o con stack vacío', () => {
    expect(clipAudioFxSpec(undefined, 0)).toEqual([]);
    expect(clipAudioFxSpec([], 10)).toEqual([]);
  });

  it('resuelve defaults del manifiesto + overrides del usuario', () => {
    const specs = clipAudioFxSpec(
      [instance('audio.eq', { low: -6 })],
      0,
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]!.effectId).toBe('audio.eq');
    // low override -6; el resto salen de los defaults del manifiesto.
    expect(specs[0]!.params.low).toBe(-6);
    expect(specs[0]!.params.high).toBe(0);
    expect(specs[0]!.params.lowFreq).toBe(120);
    expect(specs[0]!.params.highFreq).toBe(8_000);
  });

  it('muestrea keyframes en el frame pedido', () => {
    const fx = instance('audio.eq', {}, {
      keyframes: {
        low: [
          { frame: 0, value: -12 },
          { frame: 10, value: 0 },
        ],
      },
    });
    const early = clipAudioFxSpec([fx], 0);
    const late = clipAudioFxSpec([fx], 10);
    expect(early[0]!.params.low).toBe(-12);
    expect(late[0]!.params.low).toBe(0);
    const mid = clipAudioFxSpec([fx], 5);
    expect(mid[0]!.params.low).toBeCloseTo(-6);
  });

  it('filtra efectos no soportados, deshabilitados y manifests ajenos', () => {
    const specs = clipAudioFxSpec(
      [
        instance('audio.legacy_normalizer', {}),
        instance('audio.eq', {}, { enabled: false }),
        instance('video.blur', {}),
        instance('audio.limiter', { limit: 0.8 }),
      ],
      0,
    );
    expect(specs.map((spec) => spec.effectId)).toEqual(['audio.limiter']);
    expect(specs[0]!.params.limit).toBe(0.8);
  });

  it('preserva el orden de la pila', () => {
    const specs = clipAudioFxSpec(
      [instance('audio.compressor'), instance('audio.eq'), instance('audio.limiter')],
      0,
    );
    expect(specs.map((spec) => spec.effectId)).toEqual([
      'audio.compressor',
      'audio.eq',
      'audio.limiter',
    ]);
  });

  it('el set de soportados sólo incluye efectos con equivalente Web Audio', () => {
    expect(PREVIEW_AUDIO_FX.has('audio.eq')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.compressor')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.limiter')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.echo')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.tremolo')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.chorus')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.flanger')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.phaser')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.autopan')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.widen')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.tape')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.telephone')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.gate')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.leveler')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.deesser')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.voice_robot')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.voice_wobble')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.voice_alien')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.voice_chipmunk')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.voice_deep')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.voice_vader')).toBe(true);
    expect(PREVIEW_AUDIO_FX.has('audio.dynaudnorm')).toBe(false);
    // Los 30 efectos del catálogo tienen equivalente en preview.
    expect(PREVIEW_AUDIO_FX.size).toBe(30);
  });
});

describe('clipVoiceFxSpec', () => {
  it('devuelve vacío sin audio o con audio neutro', () => {
    expect(clipVoiceFxSpec(undefined)).toEqual([]);
    expect(clipVoiceFxSpec({})).toEqual([]);
    expect(clipVoiceFxSpec({ highPassHz: 20, lowPassHz: 1_000 })).toEqual([]);
    expect(clipVoiceFxSpec({ eqLowDb: 0, eqMidDb: 0, eqHighDb: 0 })).toEqual([]);
  });

  it('mapea high-pass, low-pass y EQ en el orden del export', () => {
    const specs = clipVoiceFxSpec({
      highPassHz: 80,
      lowPassHz: 16_000,
      eqLowDb: -2,
      eqMidDb: 3,
      eqHighDb: 2,
    });
    expect(specs.map((spec) => spec.effectId)).toEqual([
      'clip.hpf',
      'clip.lpf',
      'clip.eq3',
    ]);
    expect(specs[0]!.params.freq).toBe(80);
    expect(specs[1]!.params.freq).toBe(16_000);
    expect(specs[2]!.params).toEqual({ low: -2, mid: 3, high: 2 });
  });

  it('emite EQ si una sola banda tiene ganancia', () => {
    const specs = clipVoiceFxSpec({ eqMidDb: 1.5 });
    expect(specs).toHaveLength(1);
    expect(specs[0]!.effectId).toBe('clip.eq3');
    expect(specs[0]!.params).toEqual({ low: 0, mid: 1.5, high: 0 });
  });

  it('mapea de-esser, puerta y compresor con los parámetros del export', () => {
    const specs = clipVoiceFxSpec({
      deesser: true,
      gateDb: -40,
      compressor: true,
    });
    expect(specs.map((spec) => spec.effectId)).toEqual([
      'audio.deesser',
      'audio.gate',
      'audio.compressor',
    ]);
    expect(specs[0]!.params).toEqual({ intensity: 0.4, max: 0.5, freq: 0.5 });
    // agate=-40dB → umbral lineal 10^(-40/20) = 0.01.
    expect(specs[1]!.params.threshold).toBeCloseTo(0.01);
    expect(specs[1]!.params.attack).toBe(5);
    expect(specs[1]!.params.release).toBe(120);
    expect(specs[2]!.params).toEqual({
      threshold: -18,
      ratio: 3,
      attack: 5,
      release: 100,
      makeup: 2,
    });
  });

  it('la puerta ausente o no finita no emite spec', () => {
    expect(clipVoiceFxSpec({ gateDb: Number.NaN })).toEqual([]);
    expect(clipVoiceFxSpec({})).toEqual([]);
  });

  it('mapea los efectos de voz a presets de la cadena de pila', () => {
    expect(clipVoiceFxSpec({ voiceEffect: 'deep' })).toEqual([
      { effectId: 'audio.voice_deep', params: { pitch: 0.86 } },
    ]);
    expect(clipVoiceFxSpec({ voiceEffect: 'chipmunk' })).toEqual([
      { effectId: 'audio.voice_chipmunk', params: { pitch: 1.22 } },
    ]);
    expect(clipVoiceFxSpec({ voiceEffect: 'robot' })).toEqual([
      { effectId: 'audio.voice_robot', params: { rate: 32, depth: 0.45 } },
    ]);
    expect(clipVoiceFxSpec({ voiceEffect: 'echo' })).toEqual([
      { effectId: 'audio.echo', params: { delay: 500, decay: 0.4 } },
    ]);
    expect(clipVoiceFxSpec({ voiceEffect: 'cave' })).toEqual([
      { effectId: 'audio.echo', params: { delay: 1_200, decay: 0.35 } },
    ]);
  });

  it('radio emite su propia cadena HP/LP/compresor detrás de los filtros', () => {
    const specs = clipVoiceFxSpec({
      highPassHz: 80,
      voiceEffect: 'radio',
    });
    expect(specs.map((spec) => spec.effectId)).toEqual([
      'clip.hpf',
      'clip.hpf',
      'clip.lpf',
      'audio.compressor',
    ]);
    expect(specs[0]!.params.freq).toBe(80);
    expect(specs[1]!.params.freq).toBe(350);
    expect(specs[2]!.params.freq).toBe(3_200);
    expect(specs[3]!.params.ratio).toBe(4);
  });

  it('denoise emite clip.denoise con nr en dB entre el EQ y el de-esser', () => {
    const specs = clipVoiceFxSpec({
      eqMidDb: 2,
      denoise: 0.5,
      deesser: true,
    });
    expect(specs.map((spec) => spec.effectId)).toEqual([
      'clip.eq3',
      'clip.denoise',
      'audio.deesser',
    ]);
    // afftdn=nr={denoise*30} → 0.5·30 = 15 dB.
    expect(specs[1]!.params).toEqual({ nr: 15 });
  });

  it('denoise ausente, cero o no finito no emite spec', () => {
    expect(clipVoiceFxSpec({})).toEqual([]);
    expect(clipVoiceFxSpec({ denoise: 0 })).toEqual([]);
    expect(clipVoiceFxSpec({ denoise: Number.NaN })).toEqual([]);
  });

  it('denoise se acota a [0,1] antes de convertir a dB', () => {
    expect(clipVoiceFxSpec({ denoise: 2 })[0]!.params.nr).toBe(30);
    expect(clipVoiceFxSpec({ denoise: -1 })).toEqual([]);
  });
});
