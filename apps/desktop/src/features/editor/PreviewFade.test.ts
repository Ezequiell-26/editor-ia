// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Clip } from '@editor-ia/project-schema';
import {
  clipDenoiseBlurPx,
  clipFadeOpacity,
  clipPreviewStack,
} from './Preview';

function clip(partial: Partial<Clip> & { id: string }): Clip {
  return {
    trackId: 'v1',
    kind: 'video',
    label: partial.id,
    startFrame: 100,
    durationFrames: 100,
    source: { type: 'asset', assetId: 'a1', inFrame: 0, outFrame: 100 },
    ...partial,
  } as Clip;
}

describe('clipFadeOpacity · fundidos fadeIn/fadeOut', () => {
  it('sin efectos o sin frame de estilo devuelve 1', () => {
    const plain = clip({ id: 'c1' });
    expect(clipFadeOpacity(plain, 120)).toBe(1);
    const withFade = clip({
      id: 'c2',
      effects: { fadeInFrames: 20, fadeOutFrames: 20 },
    });
    expect(clipFadeOpacity(withFade, undefined)).toBe(1);
  });

  it('fadeIn sube lineal de 0 a 1 en los primeros fadeInFrames', () => {
    const c = clip({ id: 'c1', effects: { fadeInFrames: 20 } });
    expect(clipFadeOpacity(c, 100)).toBe(0);
    expect(clipFadeOpacity(c, 110)).toBeCloseTo(0.5);
    expect(clipFadeOpacity(c, 119)).toBeCloseTo(0.95);
    expect(clipFadeOpacity(c, 120)).toBe(1);
    expect(clipFadeOpacity(c, 150)).toBe(1);
  });

  it('fadeOut baja lineal a 0 en los últimos fadeOutFrames', () => {
    const c = clip({ id: 'c1', effects: { fadeOutFrames: 25 } });
    // durationFrames=100 → rampa entre local 75 y 100.
    expect(clipFadeOpacity(c, 175)).toBe(1);
    expect(clipFadeOpacity(c, 187)).toBeCloseTo(0.52);
    expect(clipFadeOpacity(c, 199)).toBeCloseTo(0.04);
    expect(clipFadeOpacity(c, 200)).toBe(0);
  });

  it('fadeIn y fadeOut se multiplican cuando se pisan', () => {
    const c = clip({
      id: 'c1',
      durationFrames: 40,
      effects: { fadeInFrames: 20, fadeOutFrames: 20 },
    });
    // local 20: entry factor 1, exit empieza en local 20 → factor 1.
    expect(clipFadeOpacity(c, 120)).toBe(1);
    // local 30: fadeIn=1, fadeOut=(40-30)/20=0.5.
    expect(clipFadeOpacity(c, 130)).toBeCloseTo(0.5);
    // local 10: fadeIn=0.5, fadeOut aún no empieza (40-20=20).
    expect(clipFadeOpacity(c, 110)).toBeCloseTo(0.5);
  });

  it('recorta fundidos más largos que el clip', () => {
    const c = clip({ id: 'c1', effects: { fadeInFrames: 500 } });
    // fadeIn efectivo = durationFrames (100): en local 50 va la mitad.
    expect(clipFadeOpacity(c, 150)).toBeCloseTo(0.5);
    expect(clipFadeOpacity(c, 200)).toBe(1);
  });

  it('el frame de estilo (playhead + lead) corre la rampa', () => {
    const c = clip({ id: 'c1', effects: { fadeInFrames: 20 } });
    // styleFrame 105 → local 5 → 0.25.
    expect(clipFadeOpacity(c, 105)).toBeCloseTo(0.25);
  });
});

describe('clipDenoiseBlurPx · denoise del monitor', () => {
  it('sin denoise o valor ~0 devuelve 0', () => {
    expect(clipDenoiseBlurPx(undefined)).toBe(0);
    expect(clipDenoiseBlurPx(0)).toBe(0);
    expect(clipDenoiseBlurPx(0.0005)).toBe(0);
  });

  it('denoise 1 da el tope de 1.4px y escala lineal', () => {
    expect(clipDenoiseBlurPx(1)).toBeCloseTo(1.4);
    expect(clipDenoiseBlurPx(0.5)).toBeCloseTo(0.7);
  });

  it('recorta valores por encima de 1', () => {
    expect(clipDenoiseBlurPx(1.5)).toBe(clipDenoiseBlurPx(1));
  });
});

describe('clipPreviewStack · stack WebGL en el monitor', () => {
  const instance = {
    id: 'fx-1',
    effectId: 'gaussian-blur',
    enabled: true,
    params: {},
  };

  it('sin effects o sin stack devuelve null', () => {
    expect(clipPreviewStack(clip({ id: 'c1' }), null)).toBeNull();
    expect(
      clipPreviewStack(clip({ id: 'c2', effects: {} }), null),
    ).toBeNull();
    expect(
      clipPreviewStack(clip({ id: 'c3', effects: { stack: [] } }), null),
    ).toBeNull();
  });

  it('devuelve el stack del clip tal cual (incluye instancias deshabilitadas: el renderer las filtra)', () => {
    const disabled = { ...instance, id: 'fx-2', enabled: false };
    const c = clip({
      id: 'c4',
      effects: { stack: [instance, disabled] },
    });
    const stack = clipPreviewStack(c, null);
    expect(stack).toHaveLength(2);
    expect(stack?.[0]?.id).toBe('fx-1');
    expect(stack?.[1]?.enabled).toBe(false);
  });

  it('durante la audición usa los effects de la tarjeta, no los del clip', () => {
    const c = clip({ id: 'c5', effects: { stack: [instance] } });
    const audition = {
      clipId: 'c5',
      effects: { stack: [] },
    } as never;
    expect(clipPreviewStack(c, audition)).toBeNull();
  });

  it('lensCorrection sin stack sintetiza la instancia lens.correct', () => {
    const c = clip({
      id: 'c6',
      effects: { lensCorrection: { k1: 0.12, k2: -0.03, cx: 0.5, cy: 0.5 } },
    });
    const stack = clipPreviewStack(c, null);
    expect(stack).toHaveLength(1);
    expect(stack?.[0]?.effectId).toBe('lens.correct');
    expect(stack?.[0]?.params.k1).toBe(0.12);
    expect(stack?.[0]?.params.k2).toBe(-0.03);
  });

  it('lensCorrection en cero no agrega nada', () => {
    const c = clip({
      id: 'c7',
      effects: { lensCorrection: { k1: 0, k2: 0 } },
    });
    expect(clipPreviewStack(c, null)).toBeNull();
  });

  it('conserva el stack del clip y agrega lens.correct al final', () => {
    const c = clip({
      id: 'c8',
      effects: {
        stack: [instance],
        lensCorrection: { k1: -0.08, k2: 0.01 },
      },
    });
    const stack = clipPreviewStack(c, null);
    expect(stack).toHaveLength(2);
    expect(stack?.[0]?.id).toBe('fx-1');
    expect(stack?.[1]?.effectId).toBe('lens.correct');
    expect(stack?.[1]?.params.cx).toBe(0.5);
  });

  it('motionBlur sintetiza blur.temporal al inicio del stack', () => {
    const c = clip({
      id: 'c9',
      effects: {
        stack: [instance],
        motionBlur: { frames: 6, intensity: 0.8 },
      },
    });
    const stack = clipPreviewStack(c, null);
    expect(stack).toHaveLength(2);
    expect(stack?.[0]?.effectId).toBe('blur.temporal');
    expect(stack?.[0]?.params.frames).toBe(6);
    expect(stack?.[0]?.params.intensity).toBe(0.8);
    expect(stack?.[1]?.id).toBe('fx-1');
  });

  it('motionBlur sin stack igual activa el canvas WebGL', () => {
    const c = clip({
      id: 'c10',
      effects: { motionBlur: { frames: 4, intensity: 0.5 } },
    });
    const stack = clipPreviewStack(c, null);
    expect(stack).toHaveLength(1);
    expect(stack?.[0]?.effectId).toBe('blur.temporal');
  });

  it('motionBlur y lensCorrection conviven: temporal primero, lens al final', () => {
    const c = clip({
      id: 'c11',
      effects: {
        motionBlur: { frames: 3, intensity: 0.4 },
        lensCorrection: { k1: 0.1, k2: 0 },
      },
    });
    const stack = clipPreviewStack(c, null);
    expect(stack).toHaveLength(2);
    expect(stack?.[0]?.effectId).toBe('blur.temporal');
    expect(stack?.[1]?.effectId).toBe('lens.correct');
  });

  it('denoise sintetiza denoise.temporal y activa el canvas WebGL', () => {
    const c = clip({ id: 'c12', effects: { denoise: 0.7 } });
    const stack = clipPreviewStack(c, null);
    expect(stack).toHaveLength(1);
    expect(stack?.[0]?.effectId).toBe('denoise.temporal');
    expect(stack?.[0]?.params.strength).toBe(0.7);
  });

  it('denoise ~0 no sintetiza nada y sin stack devuelve null', () => {
    const c = clip({ id: 'c13', effects: { denoise: 0.0005 } });
    expect(clipPreviewStack(c, null)).toBeNull();
  });

  it('denoise + motionBlur: denoise primero, blur.temporal después', () => {
    const c = clip({
      id: 'c14',
      effects: {
        denoise: 0.5,
        motionBlur: { frames: 4, intensity: 0.5 },
        stack: [instance],
      },
    });
    const stack = clipPreviewStack(c, null);
    expect(stack).toHaveLength(3);
    expect(stack?.[0]?.effectId).toBe('denoise.temporal');
    expect(stack?.[1]?.effectId).toBe('blur.temporal');
    expect(stack?.[2]?.id).toBe('fx-1');
  });
});
