import { describe, expect, it } from 'vitest';
import type { EffectInstance } from '@editor-ia/effect-kit';
import { clipAudioFxSpec, PREVIEW_AUDIO_FX } from './clip-audio-fx';

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
