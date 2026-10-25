import { z } from 'zod';
import { DecibelSchema, EntityIdSchema, UnitIntervalSchema } from './primitives.ts';
import { DurationSchema, FrameRateSchema, FrameSchema } from './time.ts';

/**
 * Tracks and clips: the editable timeline.
 *
 * Clips reference tracks and assets by id only. Timing is always integer
 * frames, and the relationship between a clip's source window, its speed and
 * its timeline duration is exact: `durationFrames x speed.num =
 * sourceFrames x speed.den`. A project that cannot state that equality is
 * malformed rather than approximated, because an approximated timeline drifts
 * once a renderer resamples it.
 */

export const TrackKindSchema = z.enum([
  'video',
  'image',
  'audio',
  'narration',
  'caption',
  'graphic',
  'adjustment',
]);

export const ClipKindSchema = z.enum([
  'video',
  'image',
  'audio',
  'graphic',
  'freeze',
  'adjustment',
  'compound',
]);

/** Hard caps keep the generated FFmpeg expressions inside a bounded argv. */
export const MAX_TRANSFORM_KEYFRAMES = 48;
export const MAX_GAIN_KEYFRAMES = 96;
export const TRANSFORM_KEYFRAME_SCALE_MIN = 0.5;
export const TRANSFORM_KEYFRAME_SCALE_MAX = 4;

/** Easing of the segment that starts at this keyframe. */
export const KeyframeEasingSchema = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
]);
export type KeyframeEasing = z.infer<typeof KeyframeEasingSchema>;

/** A type representing a cubic Bezier easing curve for custom interpolation. */
export const CubicBezierSchema = z.object({
  cp1X: z.number().gte(0).lte(1),
  cp1Y: z.number().gte(0).lte(1),
  cp2X: z.number().gte(0).lte(1),
  cp2Y: z.number().gte(0).lte(1),
});

export type CubicBezier = z.infer<typeof CubicBezierSchema>;

/**
 * Un keyframe de fader de pista. El frame es absoluto de la timeline (no
 * relativo a un clip, como las claves de audio de clip) y el valor replica el
 * fader estático de la pista.
 */
export const TrackGainKeyframeSchema = z
  .object({
    frame: FrameSchema,
    gainDb: DecibelSchema,
    easing: KeyframeEasingSchema.optional(),
    bezier: CubicBezierSchema.optional(),
  })
  .strict();
export type TrackGainKeyframe = z.infer<typeof TrackGainKeyframeSchema>;

/**
 * Un keyframe de paneo de pista. `value` usa la misma convención que `pan`
 * estático: -1 izquierda, 0 centro, 1 derecha (balance lineal).
 */
export const TrackPanKeyframeSchema = z
  .object({
    frame: FrameSchema,
    value: z.number().gte(-1).lte(1),
    easing: KeyframeEasingSchema.optional(),
    bezier: CubicBezierSchema.optional(),
  })
  .strict();
export type TrackPanKeyframe = z.infer<typeof TrackPanKeyframeSchema>;

export const TrackSchema = z
  .object({
    id: EntityIdSchema,
    kind: TrackKindSchema,
    label: z.string().min(1).max(120),
    order: z.number().int().min(0).max(63),
    muted: z.boolean().default(false),
    hidden: z.boolean().default(false),
    locked: z.boolean().default(false),
    /** Ganancia de pista en dB; se suma a la ganancia de cada clip. */
    gainDb: DecibelSchema.optional(),
    /** Paneo de pista: -1 izquierda, 0 centro, 1 derecha (balance lineal). */
    pan: z.number().gte(-1).lte(1).optional(),
    /** EQ de pista en tres bandas; se aplica antes del fader de pista. */
    eqLowDb: z.number().gte(-12).lte(12).optional(),
    eqMidDb: z.number().gte(-12).lte(12).optional(),
    eqHighDb: z.number().gte(-12).lte(12).optional(),
    /** Si hay alguna pista en solo, las demás pistas de audio se silencian. */
    solo: z.boolean().optional(),
    /**
     * Automatización de fader de pista. Cada clave muestrea el fader en un
     * frame absoluto de la timeline; entre claves rige el easing/bezier de la
     * clave donde empieza el segmento. El render Rust aún no las aplica.
     */
    gainKeyframes: z.array(TrackGainKeyframeSchema).min(1).max(MAX_GAIN_KEYFRAMES).optional(),
    /** Automatización de paneo de pista, con las mismas reglas que el fader. */
    panKeyframes: z.array(TrackPanKeyframeSchema).min(1).max(MAX_GAIN_KEYFRAMES).optional(),
  })
  .strict()
  .superRefine((track, ctx) => {
    const lists = [
      ['gainKeyframes', track.gainKeyframes],
      ['panKeyframes', track.panKeyframes],
    ] as const;
    for (const [key, keyframes] of lists) {
      if (keyframes === undefined) continue;
      let previous = -1;
      for (const [index, keyframe] of keyframes.entries()) {
        if (keyframe.frame < 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key, index, 'frame'],
            message: 'a track keyframe frame cannot be negative',
          });
        }
        if (keyframe.frame <= previous) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key, index, 'frame'],
            message: 'track keyframes must be strictly increasing and unique',
          });
        }
        previous = keyframe.frame;
      }
    }
  });

/**
 * A transform keyframe is an absolute sample at `frame` frames from the clip
 * start. Properties absent from a keyframe fall back to the nearest keyframe
 * that defines them, then to the clip's static transform. `scale` is uniform:
 * the renderer animates it with zoompan, which cannot express a per-axis zoom.
 */
export const ClipTransformKeyframeSchema = z
  .object({
    frame: FrameSchema,
    offsetX: z.number().int().gte(-100_000).lte(100_000).optional(),
    offsetY: z.number().int().gte(-100_000).lte(100_000).optional(),
    scale: z
      .number()
      .gte(TRANSFORM_KEYFRAME_SCALE_MIN)
      .lte(TRANSFORM_KEYFRAME_SCALE_MAX)
      .optional(),
    rotationDeg: z.number().gte(-360).lte(360).optional(),
    opacity: UnitIntervalSchema.optional(),
    easing: KeyframeEasingSchema.optional(),
    bezier: CubicBezierSchema.optional(),
  })
  .strict()
  .superRefine((keyframe, ctx) => {
    if (
      keyframe.offsetX === undefined &&
      keyframe.offsetY === undefined &&
      keyframe.scale === undefined &&
      keyframe.rotationDeg === undefined &&
      keyframe.opacity === undefined &&
      keyframe.bezier === undefined &&
      keyframe.easing === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a transform keyframe must animate at least one property or specify easing',
      });
    }
  });

export const ClipGainKeyframeSchema = z
  .object({
    frame: FrameSchema,
    gainDb: DecibelSchema,
    easing: KeyframeEasingSchema.optional(),
  })
  .strict();

export const ClipTransformSchema = z
  .object({
    offsetX: z.number().int().gte(-100_000).lte(100_000).optional(),
    offsetY: z.number().int().gte(-100_000).lte(100_000).optional(),
    scaleX: z.number().gt(0).lte(100).optional(),
    scaleY: z.number().gt(0).lte(100).optional(),
    rotationDeg: z.number().gte(-360).lte(360).optional(),
    opacity: UnitIntervalSchema.optional(),
    flipH: z.boolean().optional(),
    flipV: z.boolean().optional(),
    keyframes: z.array(ClipTransformKeyframeSchema).min(1).max(MAX_TRANSFORM_KEYFRAMES).optional(),
  })
  .strict();

export const ClipAudioSchema = z
  .object({
    gainDb: DecibelSchema.optional(),
    muted: z.boolean().optional(),
    fadeInFrames: DurationSchema.optional(),
    fadeOutFrames: DurationSchema.optional(),
    highPassHz: z.number().gte(20).lte(2_000).optional(),
    lowPassHz: z.number().gte(1_000).lte(20_000).optional(),
    eqLowDb: z.number().gte(-12).lte(12).optional(),
    eqMidDb: z.number().gte(-12).lte(12).optional(),
    eqHighDb: z.number().gte(-12).lte(12).optional(),
    compressor: z.boolean().optional(),
    deesser: z.boolean().optional(),
    gateDb: z.number().gte(-60).lte(-10).optional(),
    denoise: z.number().gte(0).lte(1).optional(),
    voiceEffect: z
      .enum(['deep', 'chipmunk', 'robot', 'echo', 'cave', 'radio'])
      .optional(),
    gainKeyframes: z.array(ClipGainKeyframeSchema).min(1).max(MAX_GAIN_KEYFRAMES).optional(),
    // Pan stereo: −1 (left), 0 (center), +1 (right)
    pan: z.number().gte(-1).lte(1).optional(),
    // Metering targets (for metadata and UI display, not enforced in render)
    targetLevelDbfs: z.number().gte(-24).lte(0).optional(),
    peakLevelDbfs: z.number().gte(-60).lte(0).optional(),
    rmsLevelDbfs: z.number().gte(-60).lte(0).optional(),
  })
  .strict();

const WindowedAssetSourceSchema = z
  .object({
    type: z.literal('asset'),
    assetId: EntityIdSchema,
    inFrame: FrameSchema,
    outFrame: FrameSchema,
  })
  .strict();

const StillAssetSourceSchema = z
  .object({
    type: z.literal('asset'),
    assetId: EntityIdSchema,
  })
  .strict();

const GraphicSourceSchema = z.object({
  type: z.literal('graphic'),
  motionId: EntityIdSchema,
});

/**
 * A source-less timeline element that grades the final composite inside its own
 * time window. It owns no media: the renderer emits its effect chain with
 * `enable='between(t,start,end)'`, so the grade only exists while the clip is
 * under the playhead.
 */
const AdjustmentSourceSchema = z.object({ type: z.literal('adjustment') }).strict();

export const MAX_CURVE_POINTS = 16;
export const CURVE_CHANNELS = ['master', 'red', 'green', 'blue'] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];

/**
 * A point of a color curve. `x` is the input level and `y` the output level,
 * both in [0,1]. The first point anchors black (x=0) and the last anchors white
 * (x=1); the renderer's `curves` filter expects an ordered set.
 */
export const CurvePointSchema = z
  .object({
    x: UnitIntervalSchema,
    y: UnitIntervalSchema,
  })
  .strict();
export type CurvePoint = z.infer<typeof CurvePointSchema>;

const CurveChannelPointsSchema = z
  .array(CurvePointSchema)
  .min(2)
  .max(MAX_CURVE_POINTS)
  .superRefine((points, ctx) => {
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || first.x !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'the first curve point must anchor black at x=0',
      });
    }
    if (!last || last.x !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'the last curve point must anchor white at x=1',
      });
    }
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      if (previous && point && point.x <= previous.x) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'curve points must be strictly ordered by x',
        });
        break;
      }
    }
  });

export const ClipCurvesSchema = z
  .object({
    master: CurveChannelPointsSchema.optional(),
    red: CurveChannelPointsSchema.optional(),
    green: CurveChannelPointsSchema.optional(),
    blue: CurveChannelPointsSchema.optional(),
  })
  .strict()
  .superRefine((curves, ctx) => {
    if (!curves.master && !curves.red && !curves.green && !curves.blue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a custom curve needs at least one channel',
      });
    }
  });
export type ClipCurves = z.infer<typeof ClipCurvesSchema>;

export const ClipEffectsSchema = z
  .object({
    brightness: z.number().gte(-1).lte(1).optional(),
    contrast: z.number().gte(0).lte(3).optional(),
    saturation: z.number().gte(0).lte(3).optional(),
    temperature: z.number().gte(-1).lte(1).optional(),
    shadows: z.number().gte(-1).lte(1).optional(),
    highlights: z.number().gte(-1).lte(1).optional(),
    fade: UnitIntervalSchema.optional(),
    lift: z
      .object({
        r: z.number().gte(-1).lte(1),
        g: z.number().gte(-1).lte(1),
        b: z.number().gte(-1).lte(1),
      })
      .strict()
      .optional(),
    gamma: z
      .object({
        r: z.number().gte(-1).lte(1),
        g: z.number().gte(-1).lte(1),
        b: z.number().gte(-1).lte(1),
      })
      .strict()
      .optional(),
    gain: z
      .object({
        r: z.number().gte(-1).lte(1),
        g: z.number().gte(-1).lte(1),
        b: z.number().gte(-1).lte(1),
      })
      .strict()
      .optional(),
    /**
     * Cuarta rueda de Primaries (DaVinci): balance de medios tonos. En FFmpeg se
     * mapea a `colorbalance=rm/gm/bm`, el mismo espacio que usan Lift (sombras)
     * y Gain (altas luces).
     */
    offset: z
      .object({
        r: z.number().gte(-1).lte(1),
        g: z.number().gte(-1).lte(1),
        b: z.number().gte(-1).lte(1),
      })
      .strict()
      .optional(),
    hsl: z
      .object({
        hue: z.number().gte(-180).lte(180),
        saturation: z.number().gte(-1).lte(1),
        intensity: z.number().gte(-1).lte(1),
        colors: z
          .array(z.enum(['r', 'y', 'g', 'c', 'b', 'm']))
          .min(1)
          .max(6)
          .optional(),
      })
      .strict()
      .optional(),
    colorMatch: z
      .object({
        r: z.number().gte(0.25).lte(4),
        g: z.number().gte(0.25).lte(4),
        b: z.number().gte(0.25).lte(4),
        strength: z.number().gte(0).lte(1),
      })
      .strict()
      .optional(),
    vignette: z.number().gte(0).lte(1).optional(),
    /**
     * Corrección de lente (ResolveFX Lens Correction). k1/k2 son los factores
     * cuadráticos de FFmpeg `lenscorrection`; el centro es relativo (0..1).
     */
    lensCorrection: z
      .object({
        k1: z.number().gte(-1).lte(1),
        k2: z.number().gte(-1).lte(1),
        cx: z.number().gte(0).lte(1).optional(),
        cy: z.number().gte(0).lte(1).optional(),
      })
      .strict()
      .optional(),
    /**
     * Relight local por máscara radial (no es un modelo generativo). El centro
     * y el radio están normalizados al frame; la fuerza y la calidez van de
     * -1 (oscurecer/enfriar) a 1 (aclarar/calentar).
     */
    relight: z
      .object({
        x: z.number().gte(-1).lte(1),
        y: z.number().gte(-1).lte(1),
        radius: z.number().gt(0).lte(1),
        strength: z.number().gte(-1).lte(1),
        warmth: z.number().gte(-1).lte(1),
        feather: z.number().gte(0).lte(1).optional(),
      })
      .strict()
      .optional(),
    sharpen: z.number().gte(0).lte(5).optional(),
    blur: z.number().gte(0).lte(50).optional(),
    /** Halo alrededor de las zonas claras (estilo MrBeast / glow). */
    glow: z
      .object({
        intensity: z.number().gte(0).lte(1),
        radius: z.number().gte(1).lte(80),
        threshold: z.number().gte(0).lte(0.95),
      })
      .strict()
      .optional(),
    /** Desenfoque temporal de movimiento por mezcla de frames. */
    motionBlur: z
      .object({
        frames: z.number().int().gte(2).lte(12),
        intensity: z.number().gte(0).lte(1),
      })
      .strict()
      .optional(),
    grayscale: z.boolean().optional(),
    sepia: z.boolean().optional(),
    hueRotateDeg: z.number().gte(-180).lte(180).optional(),
    curvePreset: z
      .enum([
        'contrast-soft',
        'contrast-medium',
        'contrast-strong',
        'vintage',
        'cross-process',
        'darker',
        'lighter',
      ])
      .optional(),
    curves: ClipCurvesSchema.optional(),
    lutFile: z.string().min(1).max(500).optional(),
    lutIntensity: z.number().gte(0).lte(1).optional(),
    fadeInFrames: DurationSchema.optional(),
    fadeOutFrames: DurationSchema.optional(),
  })
  .strict();

export const ClipMotionSchema = z
  .object({
    type: z.enum(['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down']),
    intensity: z.number().gte(0.02).lte(0.5).optional(),
  })
  .strict();

export const ChromaKeySchema = z
  .object({
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    similarity: z.number().gte(0.01).lte(1),
    blend: z.number().gte(0).lte(1),
  })
  .strict();

export const BlendModeSchema = z.enum([
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
]);
export type BlendMode = z.infer<typeof BlendModeSchema>;

export const MAX_MASK_KEYFRAMES = 32;
export const ClipMaskKeyframeSchema = z
  .object({
    frame: FrameSchema,
    x: z.number().gte(-1).lte(1).optional(),
    y: z.number().gte(-1).lte(1).optional(),
    width: z.number().gt(0).lte(2).optional(),
    height: z.number().gt(0).lte(2).optional(),
    rotationDeg: z.number().gte(-180).lte(180).optional(),
    feather: z.number().gte(0).lte(1).optional(),
    easing: KeyframeEasingSchema.optional(),
  })
  .strict()
  .superRefine((keyframe, ctx) => {
    if (
      keyframe.x === undefined &&
      keyframe.y === undefined &&
      keyframe.width === undefined &&
      keyframe.height === undefined &&
      keyframe.rotationDeg === undefined &&
      keyframe.feather === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a mask keyframe must animate at least one property',
      });
    }
  });
export type ClipMaskKeyframe = z.infer<typeof ClipMaskKeyframeSchema>;

export const MaskPointSchema = z
  .object({
    x: z.number().gte(0).lte(1),
    y: z.number().gte(0).lte(1),
  })
  .strict();
export type MaskPoint = z.infer<typeof MaskPointSchema>;

export const ClipMaskSchema = z
  .object({
    shape: z.enum([
      'rectangle',
      'ellipse',
      'diamond',
      'triangle',
      'rounded',
      'polygon',
      'text',
    ]),
    x: z.number().gte(-1).lte(1),
    y: z.number().gte(-1).lte(1),
    width: z.number().gt(0).lte(2),
    height: z.number().gt(0).lte(2),
    rotationDeg: z.number().gte(-180).lte(180).optional(),
    feather: z.number().gte(0).lte(1).default(0.08),
    invert: z.boolean().default(false),
    /** Texto de la máscara tipográfica; sólo se usa con `shape: 'text'`. */
    text: z.string().trim().min(1).max(200).optional(),
    /** Tamaño del texto como fracción de la altura del fotograma. */
    fontScale: z.number().gte(0.02).lte(0.5).optional(),
    /** Puntos normalizados 0..1 del fotograma para una máscara poligonal. */
    points: z.array(MaskPointSchema).min(3).max(16).optional(),
    keyframes: z.array(ClipMaskKeyframeSchema).min(1).max(MAX_MASK_KEYFRAMES).optional(),
  })
  .strict()
  .superRefine((mask, ctx) => {
    if (mask.shape === 'text' && !mask.text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'a text mask needs the text to draw',
      });
    }
    if (mask.shape === 'polygon' && !mask.points) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['points'],
        message: 'a polygon mask needs at least three points',
      });
    }
    if (mask.shape !== 'polygon' && mask.points) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['points'],
        message: 'only a polygon mask accepts points',
      });
    }
  });
export type ClipMask = z.infer<typeof ClipMaskSchema>;

/**
 * A stabilization transform analyzed on the clip's own source window. The
 * renderer refuses to apply it if the clip is later trimmed, retimed, reversed
 * or given an entrance transition, because the transform rows would no longer
 * line up with the frames it feeds.
 */
export const ClipStabilizationSchema = z
  .object({
    smoothing: z.number().int().min(1).max(60),
    transformFile: z.string().min(1).max(500),
    inFrame: FrameSchema,
    outFrame: FrameSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outFrame <= value.inFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outFrame'],
        message: 'the analyzed window must end after it starts',
      });
    }
  });
export type ClipStabilization = z.infer<typeof ClipStabilizationSchema>;

/** Visual transition into a clip. Dissolve overlaps the previous clip. */
export const MAX_TRANSITION_FRAMES = 120;
export const ClipTransitionSchema = z
  .object({
    type: z.enum([
      'dissolve',
      'fade-black',
      'fade-white',
      'slide-left',
      'slide-right',
      'slide-up',
      'slide-down',
    ]),
    frames: z.number().int().min(1).max(MAX_TRANSITION_FRAMES),
  })
  .strict();

/**
 * Entrance or exit animation owned by the clip itself. Unlike a transition,
 * it does not overlap a neighbour: the animation plays inside the clip.
 * `slide-*` describes the direction the layer travels, `zoom-in` grows,
 * `zoom-out` shrinks and `spin` rotates clockwise.
 */
export const MAX_ANIMATION_FRAMES = 240;
export const ClipAnimationTypeSchema = z.enum([
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
]);
export type ClipAnimationType = z.infer<typeof ClipAnimationTypeSchema>;
export const ClipAnimationSchema = z
  .object({
    type: ClipAnimationTypeSchema,
    durationFrames: z.number().int().min(1).max(MAX_ANIMATION_FRAMES),
  })
  .strict();
export type ClipAnimation = z.infer<typeof ClipAnimationSchema>;

export const ClipColorTagSchema = z.enum([
  'rose',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'slate',
]);
export type ClipColorTag = z.infer<typeof ClipColorTagSchema>;

const clipCommon = {
  id: EntityIdSchema,
  trackId: EntityIdSchema,
  label: z.string().min(1).max(200).optional(),
  startFrame: FrameSchema,
  durationFrames: DurationSchema,
  enabled: z.boolean().optional(),
  colorTag: ClipColorTagSchema.optional(),
  transform: ClipTransformSchema.optional(),
  audio: ClipAudioSchema.optional(),
};

const VideoClipSchema = z
  .object({
    ...clipCommon,
    kind: z.literal('video'),
    source: WindowedAssetSourceSchema,
    speed: FrameRateSchema.optional(),
    /** Interpola fotogramas al exportar una cámara lenta (< 1×). */
    slowMotionSmoothing: z.boolean().optional(),
    reverse: z.boolean().optional(),
    effects: ClipEffectsSchema.optional(),
    motion: ClipMotionSchema.optional(),
    chromaKey: ChromaKeySchema.optional(),
    mask: ClipMaskSchema.optional(),
    blendMode: BlendModeSchema.optional(),
    stabilization: ClipStabilizationSchema.optional(),
    transitionIn: ClipTransitionSchema.optional(),
    animationIn: ClipAnimationSchema.optional(),
    animationOut: ClipAnimationSchema.optional(),
  })
  .strict();

const AudioClipSchema = z
  .object({
    ...clipCommon,
    kind: z.literal('audio'),
    source: WindowedAssetSourceSchema,
    speed: FrameRateSchema.optional(),
    reverse: z.boolean().optional(),
  })
  .strict();

const ImageIconSchema = z
  .object({
    ...clipCommon,
    kind: z.literal('image'),
    source: StillAssetSourceSchema,
    effects: ClipEffectsSchema.optional(),
    motion: ClipMotionSchema.optional(),
    chromaKey: ChromaKeySchema.optional(),
    mask: ClipMaskSchema.optional(),
    blendMode: BlendModeSchema.optional(),
    transitionIn: ClipTransitionSchema.optional(),
    animationIn: ClipAnimationSchema.optional(),
    animationOut: ClipAnimationSchema.optional(),
  })
  .strict();

const GraphicClipSchema = z
  .object({ ...clipCommon, kind: z.literal('graphic'), source: GraphicSourceSchema })
  .strict();

/**
 * A still image placed on a video track by the freeze command. It is rendered
 * exactly like an image clip; the separate kind lets the editor explain that
 * the frame belongs to the surrounding video instead of the image track.
 */
const FreezeClipSchema = z
  .object({
    ...clipCommon,
    kind: z.literal('freeze'),
    source: StillAssetSourceSchema,
    effects: ClipEffectsSchema.optional(),
    motion: ClipMotionSchema.optional(),
    chromaKey: ChromaKeySchema.optional(),
    mask: ClipMaskSchema.optional(),
    blendMode: BlendModeSchema.optional(),
    transitionIn: ClipTransitionSchema.optional(),
    animationIn: ClipAnimationSchema.optional(),
    animationOut: ClipAnimationSchema.optional(),
  })
  .strict();

const AdjustmentClipSchema = z
  .object({
    ...clipCommon,
    kind: z.literal('adjustment'),
    source: AdjustmentSourceSchema,
    effects: ClipEffectsSchema.optional(),
  })
  .strict();

/**
 * Inner clips of a compound. They keep their original track and relative
 * start; a compound is a named group that renders by flattening these clips
 * back onto their tracks. Nested compounds are deliberately not allowed.
 */
export const CompoundInnerClipSchema = z.discriminatedUnion('kind', [
  VideoClipSchema,
  AudioClipSchema,
  ImageIconSchema,
  GraphicClipSchema,
  FreezeClipSchema,
  AdjustmentClipSchema,
]);

export const CompoundSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(200),
    durationFrames: DurationSchema,
    clips: z.array(CompoundInnerClipSchema).min(1).max(200),
  })
  .strict()
  .superRefine((compound, ctx) => {
    const ids = new Set<string>();
    compound.clips.forEach((clip, index) => {
      if (ids.has(clip.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clips', index, 'id'],
          message: 'compound clip ids must be unique',
        });
      }
      ids.add(clip.id);
      if (clip.startFrame + clip.durationFrames > compound.durationFrames) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clips', index, 'durationFrames'],
          message: 'a compound clip cannot end after the compound duration',
        });
      }
    });
  });

export const CompoundClipSchema = z
  .object({
    ...clipCommon,
    kind: z.literal('compound'),
    source: z
      .object({
        type: z.literal('compound'),
        compoundId: EntityIdSchema,
      })
      .strict(),
  })
  .strict();
export type Compound = z.infer<typeof CompoundSchema>;
export type CompoundInnerClip = z.infer<typeof CompoundInnerClipSchema>;

/** Which track kinds are allowed to host each clip kind. */
const TRACK_KINDS_FOR_CLIP: Record<z.infer<typeof ClipKindSchema>, readonly string[]> = {
  video: ['video'],
  image: ['image'],
  audio: ['audio', 'narration'],
  graphic: ['graphic'],
  freeze: ['video'],
  adjustment: ['adjustment'],
  compound: ['video', 'image', 'graphic', 'adjustment'],
};

export function clipFitsTrack(
  clipKind: z.infer<typeof ClipKindSchema>,
  trackKind: string,
): boolean {
  return (TRACK_KINDS_FOR_CLIP[clipKind] ?? []).includes(trackKind);
}

export const ClipSchema = z
  .discriminatedUnion('kind', [
    VideoClipSchema,
    AudioClipSchema,
    ImageIconSchema,
    GraphicClipSchema,
    FreezeClipSchema,
    AdjustmentClipSchema,
    CompoundClipSchema,
  ])
  .superRefine((clip, ctx) => {
    if (clip.kind === 'video' || clip.kind === 'audio') {
      const sourceFrames = clip.source.outFrame - clip.source.inFrame;
      if (sourceFrames <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['source', 'outFrame'],
          message: 'a clip source window must end after it starts',
        });
      } else {
        const speed = clip.speed ?? { num: 1, den: 1 };
        if (clip.durationFrames * speed.num !== sourceFrames * speed.den) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['durationFrames'],
            message:
              'the clip duration must match its source window divided by its speed, in whole frames',
          });
        }
      }
    }

    const transformKeyframes = clip.transform?.keyframes;
    if (transformKeyframes !== undefined) {
      if (clip.kind !== 'video' && clip.kind !== 'image') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['transform', 'keyframes'],
          message: 'only video and image clips can animate their transform',
        });
      }
      let previous = -1;
      for (const [index, keyframe] of transformKeyframes.entries()) {
        if (keyframe.frame >= clip.durationFrames) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['transform', 'keyframes', index, 'frame'],
            message: 'a keyframe must fall inside the clip duration',
          });
        }
        if (keyframe.frame <= previous) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['transform', 'keyframes', index, 'frame'],
            message: 'keyframes must be strictly increasing and unique',
          });
        }
        previous = keyframe.frame;
      }
    }

    const maskKeyframes =
      clip.kind === 'video' || clip.kind === 'image'
        ? clip.mask?.keyframes
        : undefined;
    if (maskKeyframes !== undefined) {
      let previous = -1;
      for (const [index, keyframe] of maskKeyframes.entries()) {
        if (keyframe.frame >= clip.durationFrames) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['mask', 'keyframes', index, 'frame'],
            message: 'a keyframe must fall inside the clip duration',
          });
        }
        if (keyframe.frame <= previous) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['mask', 'keyframes', index, 'frame'],
            message: 'keyframes must be strictly increasing and unique',
          });
        }
        previous = keyframe.frame;
      }
    }

    const gainKeyframes = clip.audio?.gainKeyframes;
    if (gainKeyframes !== undefined) {
      if (clip.kind !== 'video' && clip.kind !== 'audio') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['audio', 'gainKeyframes'],
          message: 'only clips with audio can automate their gain',
        });
      }
      let previous = -1;
      for (const [index, keyframe] of gainKeyframes.entries()) {
        if (keyframe.frame >= clip.durationFrames) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['audio', 'gainKeyframes', index, 'frame'],
            message: 'a keyframe must fall inside the clip duration',
          });
        }
        if (keyframe.frame <= previous) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['audio', 'gainKeyframes', index, 'frame'],
            message: 'keyframes must be strictly increasing and unique',
          });
        }
        previous = keyframe.frame;
      }
    }

    if ('transitionIn' in clip && clip.transitionIn !== undefined) {
      if (clip.transitionIn.frames > clip.durationFrames) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['transitionIn', 'frames'],
          message: 'a transition cannot be longer than the clip it enters',
        });
      }
    }
  });

export const TimelineSchema = z
  .object({
    tracks: z.array(TrackSchema),
    clips: z.array(ClipSchema),
  })
  .strict()
  .superRefine((timeline, ctx) => {
    const trackById = new Map<string, z.infer<typeof TrackSchema>>();

    for (const [index, track] of timeline.tracks.entries()) {
      const existing = trackById.get(track.id);
      if (existing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tracks', index, 'id'],
          message: 'track ids must be unique inside a project',
        });
        continue;
      }
      trackById.set(track.id, track);
    }

    const orders = new Map<number, string>();
    for (const [index, track] of timeline.tracks.entries()) {
      const holder = orders.get(track.order);
      if (holder) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tracks', index, 'order'],
          message: `layer order ${track.order} is already used by track ${holder}`,
        });
      }
      orders.set(track.order, track.id);
    }

    const clipIds = new Set<string>();
    const intervalsByTrack = new Map<string, { start: number; end: number; id: string }[]>();

    for (const [index, clip] of timeline.clips.entries()) {
      if (clipIds.has(clip.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clips', index, 'id'],
          message: 'clip ids must be unique inside a project',
        });
      }
      clipIds.add(clip.id);

      const track = trackById.get(clip.trackId);
      if (!track) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clips', index, 'trackId'],
          message: 'the clip references a track that is not part of the project',
        });
        continue;
      }

      if (!TRACK_KINDS_FOR_CLIP[clip.kind].includes(track.kind)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clips', index, 'trackId'],
          message: `a ${clip.kind} clip cannot live on a ${track.kind} track`,
        });
      }

      const intervals = intervalsByTrack.get(clip.trackId) ?? [];
      intervals.push({ start: clip.startFrame, end: clip.startFrame + clip.durationFrames, id: clip.id });
      intervalsByTrack.set(clip.trackId, intervals);
    }

    for (const [trackId, intervals] of intervalsByTrack) {
      const sorted = [...intervals].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1];
        const current = sorted[i];
        if (previous && current && current.start < previous.end) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['clips'],
            message: `clips ${previous.id} and ${current.id} overlap on track ${trackId}`,
          });
        }
      }
    }
  });

export type Track = z.infer<typeof TrackSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type ClipEffects = z.infer<typeof ClipEffectsSchema>;
export type ClipMotion = z.infer<typeof ClipMotionSchema>;
export type ClipTransformKeyframe = z.infer<typeof ClipTransformKeyframeSchema>;
export type ClipGainKeyframe = z.infer<typeof ClipGainKeyframeSchema>;
export type ChromaKey = z.infer<typeof ChromaKeySchema>;
export type ClipTransition = z.infer<typeof ClipTransitionSchema>;
