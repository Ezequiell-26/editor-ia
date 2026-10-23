import { describe, expect, it } from 'vitest';
import { ClipSchema } from './timeline.js';

const ID = '11111111-1111-4111-8111-111111111111';
const TRACK = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';

function imageClip(effects: unknown) {
  return {
    id: ID,
    trackId: TRACK,
    kind: 'image',
    source: { type: 'asset', assetId: ASSET },
    startFrame: 0,
    durationFrames: 90,
    effects,
  };
}

describe('efectos de clip', () => {
  it('acepta ajustes de color y efectos dentro de rango', () => {
    const parsed = ClipSchema.safeParse(
      imageClip({
        brightness: 0.2,
        contrast: 1.2,
        saturation: 1.1,
        temperature: -0.3,
        vignette: 0.4,
        sharpen: 1.5,
        blur: 2,
        grayscale: false,
        sepia: true,
        hueRotateDeg: 24,
        curvePreset: 'vintage',
        shadows: -0.2,
        highlights: 0.3,
        fade: 0.1,
        fadeInFrames: 10,
        fadeOutFrames: 15,
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('acepta sombras, altas luces y fade tonal en rango', () => {
    expect(
      ClipSchema.safeParse(
        imageClip({ shadows: 0.4, highlights: -0.5, fade: 0.25 }),
      ).success,
    ).toBe(true);
  });

  it('rechaza tono fino fuera de rango', () => {
    expect(ClipSchema.safeParse(imageClip({ shadows: 2 })).success).toBe(false);
    expect(ClipSchema.safeParse(imageClip({ highlights: -2 })).success).toBe(false);
    expect(ClipSchema.safeParse(imageClip({ fade: 1.2 })).success).toBe(false);
  });

  it('rechaza valores fuera de rango y claves desconocidas', () => {
    expect(ClipSchema.safeParse(imageClip({ brightness: 2 }))).toMatchObject({ success: false });
    expect(ClipSchema.safeParse(imageClip({ contrast: -1 }))).toMatchObject({ success: false });
    expect(ClipSchema.safeParse(imageClip({ blur: -3 }))).toMatchObject({ success: false });
    expect(ClipSchema.safeParse(imageClip({ glow: 4 }))).toMatchObject({ success: false });
    expect(ClipSchema.safeParse(imageClip({ hueRotateDeg: 300 }))).toMatchObject({ success: false });
    expect(ClipSchema.safeParse(imageClip({ curvePreset: 'sepia' }))).toMatchObject({ success: false });
  });

  it('no permite efectos en un clip de audio', () => {
    const audio = {
      id: ID,
      trackId: TRACK,
      kind: 'audio',
      source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
      startFrame: 0,
      durationFrames: 90,
      effects: { brightness: 0.1 },
    };
    expect(ClipSchema.safeParse(audio).success).toBe(false);
  });

  it('acepta una disolvencia de entrada acotada al clip', () => {
    const ok = ClipSchema.safeParse({
      ...imageClip(undefined),
      transitionIn: { type: 'dissolve', frames: 12 },
    });
    expect(ok.success).toBe(true);

    const tooLong = ClipSchema.safeParse({
      ...imageClip(undefined),
      transitionIn: { type: 'dissolve', frames: 200 },
    });
    expect(tooLong.success).toBe(false);

    const unknown = ClipSchema.safeParse({
      ...imageClip(undefined),
      transitionIn: { type: 'wipe', frames: 12 },
    });
    expect(unknown.success).toBe(false);
  });

  it('acepta animaciones de entrada y salida válidas y rechaza las inválidas', () => {
    const ok = ClipSchema.safeParse({
      ...imageClip(undefined),
      animationIn: { type: 'slide-left', durationFrames: 15 },
      animationOut: { type: 'slide-right', durationFrames: 30 },
    });
    expect(ok.success).toBe(true);

    const unknown = ClipSchema.safeParse({
      ...imageClip(undefined),
      animationIn: { type: 'wipe', durationFrames: 15 },
    });
    expect(unknown.success).toBe(false);

    const zero = ClipSchema.safeParse({
      ...imageClip(undefined),
      animationIn: { type: 'fade', durationFrames: 0 },
    });
    expect(zero.success).toBe(false);

    const tooLong = ClipSchema.safeParse({
      ...imageClip(undefined),
      animationOut: { type: 'slide-up', durationFrames: 241 },
    });
    expect(tooLong.success).toBe(false);

    const audio = ClipSchema.safeParse({
      id: ID,
      trackId: TRACK,
      kind: 'audio',
      source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
      startFrame: 0,
      durationFrames: 90,
      animationIn: { type: 'fade', durationFrames: 12 },
    });
    expect(audio.success).toBe(false);
  });

  it('acepta ruedas de color dentro de rango', () => {
    const ok = ClipSchema.safeParse(
      imageClip({
        lift: { r: 0.1, g: 0, b: -0.1 },
        gamma: { r: 0.2, g: -0.1, b: 0 },
        gain: { r: -0.2, g: 0.1, b: 0.2 },
      }),
    );
    expect(ok.success).toBe(true);

    const invalid = ClipSchema.safeParse(
      imageClip({ lift: { r: 2, g: 0, b: 0 } }),
    );
    expect(invalid.success).toBe(false);
  });

  it('acepta modos de mezcla y rechaza nombres desconocidos', () => {
    const clip = (blendMode: string) => ({ ...imageClip(undefined), blendMode });
    expect(ClipSchema.safeParse(clip('screen')).success).toBe(true);
    expect(ClipSchema.safeParse(clip('multiply')).success).toBe(true);
    expect(ClipSchema.safeParse(clip('glow')).success).toBe(false);
  });

  it('acepta igualar color y acota las ganancias', () => {
    expect(
      ClipSchema.safeParse(
        imageClip({
          colorMatch: { r: 1.1, g: 0.95, b: 1.05, strength: 0.8 },
        }),
      ).success,
    ).toBe(true);
    expect(
      ClipSchema.safeParse(
        imageClip({ colorMatch: { r: 5, g: 1, b: 1, strength: 0.5 } }),
      ).success,
    ).toBe(false);
  });

  it('acepta HSL selectivo y valida los rangos', () => {    const ok = ClipSchema.safeParse(
      imageClip({
        hsl: { hue: 12, saturation: 0.2, intensity: -0.1, colors: ['r', 'y'] },
      }),
    );
    expect(ok.success).toBe(true);

    expect(
      ClipSchema.safeParse(imageClip({ hsl: { hue: 400, saturation: 0, intensity: 0 } }))
        .success,
    ).toBe(false);
    expect(
      ClipSchema.safeParse(
        imageClip({ hsl: { hue: 0, saturation: 0, intensity: 0, colors: [] } }),
      ).success,
    ).toBe(false);
  });

  it('acepta máscaras rectangulares, elípticas, diamante, triángulo y redondeadas', () => {
    const rectangle = ClipSchema.safeParse({
      ...imageClip(undefined),
      mask: { shape: 'rectangle', x: 0, y: 0, width: 0.6, height: 0.7, feather: 0.1 },
    });
    expect(rectangle.success).toBe(true);
    const ellipse = ClipSchema.safeParse({
      ...imageClip(undefined),
      mask: { shape: 'ellipse', x: 0.2, y: -0.1, width: 0.8, height: 0.5, invert: true },
    });
    expect(ellipse.success).toBe(true);
    const rotated = ClipSchema.safeParse({
      ...imageClip(undefined),
      mask: {
        shape: 'ellipse',
        x: 0,
        y: 0,
        width: 0.8,
        height: 0.6,
        rotationDeg: 45,
      },
    });
    expect(rotated.success).toBe(true);
    expect(
      ClipSchema.safeParse({
        ...imageClip(undefined),
        mask: {
          shape: 'ellipse',
          x: 0,
          y: 0,
          width: 0.8,
          height: 0.6,
          rotationDeg: 200,
        },
      }).success,
    ).toBe(false);
    for (const shape of ['diamond', 'triangle', 'rounded'] as const) {
      expect(
        ClipSchema.safeParse({
          ...imageClip(undefined),
          mask: { shape, x: 0, y: 0, width: 1, height: 1 },
        }).success,
      ).toBe(true);
    }
    expect(
      ClipSchema.safeParse({
        ...imageClip(undefined),
        mask: { shape: 'heart', x: 0, y: 0, width: 1, height: 1 },
      }).success,
    ).toBe(false);
    expect(
      ClipSchema.safeParse({
        ...imageClip(undefined),
        mask: {
          shape: 'ellipse',
          x: 0,
          y: 0,
          width: 0.8,
          height: 0.6,
          keyframes: [
            { frame: 0, x: -0.2 },
            { frame: 30, x: 0, rotationDeg: 45 },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      ClipSchema.safeParse({
        ...imageClip(undefined),
        mask: {
          shape: 'ellipse',
          x: 0,
          y: 0,
          width: 0.8,
          height: 0.6,
          keyframes: [{ frame: 30 }, { frame: 10 }],
        },
      }).success,
    ).toBe(false);
    expect(
      ClipSchema.safeParse({
        ...imageClip(undefined),
        mask: { shape: 'rectangle', x: 0, y: 0, width: 0, height: 1 },
      }).success,
    ).toBe(false);
    expect(
      ClipSchema.safeParse({
        ...imageClip(undefined),
        kind: 'audio',
        source: { type: 'asset', assetId: ASSET, inFrame: 0, outFrame: 90 },
        mask: { shape: 'ellipse', x: 0, y: 0, width: 1, height: 1 },
      }).success,
    ).toBe(false);
  });
});
