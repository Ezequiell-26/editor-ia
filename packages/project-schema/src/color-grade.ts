import { z } from 'zod';
import { UnitIntervalSchema } from './primitives.ts';

/** Node/window ids are graph-local readable slugs, not project entity UUIDs. */
const GradeIdSchema = z.string().min(1).max(80);

/**
 * Color page grade, stored per clip inside `ClipEffects.colorGrade`.
 *
 * The model is a real processing graph, not a bag of UI values: each node owns
 * a full correction layer and the links define the order in which layers are
 * composited. `source`/`output` are identity terminals; `serial` nodes chain
 * and `parallel` nodes blend by their `mix` weight before reaching the next
 * stage. Everything is optional-friendly (no defaults in the document) so a
 * project written before this module existed still opens unchanged.
 */

export const COLOR_GRADE_VERSION = 1;
export const MAX_COLOR_NODES = 24;
export const MAX_COLOR_LINKS = 64;
export const MAX_GRADE_WINDOWS = 8;
export const MAX_GRADE_CURVE_POINTS = 16;

const SignedUnit = z.number().gte(-1).lte(1);

/** RGB triplet of a color wheel. 0 is neutral, ±1 is the full throw. */
export const ColorWheelValueSchema = z
  .object({ r: SignedUnit, g: SignedUnit, b: SignedUnit })
  .strict();
export type ColorWheelValue = z.infer<typeof ColorWheelValueSchema>;

/** A point on any grading curve. Both axes are normalized 0..1. */
export const GradeCurvePointSchema = z
  .object({ x: UnitIntervalSchema, y: UnitIntervalSchema })
  .strict();
export type GradeCurvePoint = z.infer<typeof GradeCurvePointSchema>;

const OrderedCurveSchema = z
  .array(GradeCurvePointSchema)
  .min(2)
  .max(MAX_GRADE_CURVE_POINTS)
  .superRefine((points, ctx) => {
    if (points[0]?.x !== 0 || points[points.length - 1]?.x !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a grade curve must anchor x=0 and x=1',
      });
      return;
    }
    for (let index = 1; index < points.length; index += 1) {
      if ((points[index]?.x ?? 0) <= (points[index - 1]?.x ?? 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'grade curve points must be strictly ordered by x',
        });
        break;
      }
    }
  });

/**
 * Primaries: the four DaVinci wheels plus the global master controls.
 * `pivot` is the contrast center in 0..1.
 */
export const PrimaryGradeSchema = z
  .object({
    lift: ColorWheelValueSchema,
    gamma: ColorWheelValueSchema,
    gain: ColorWheelValueSchema,
    offset: ColorWheelValueSchema,
    contrast: SignedUnit,
    pivot: UnitIntervalSchema,
    saturation: z.number().gte(0).lte(3),
    temperature: SignedUnit,
    tint: SignedUnit,
  })
  .strict();
export type PrimaryGrade = z.infer<typeof PrimaryGradeSchema>;

/** Six-zone HDR wheels. Each zone is a signed exposure offset. */
export const HdrGradeSchema = z
  .object({
    global: SignedUnit,
    shadows: SignedUnit,
    dark: SignedUnit,
    light: SignedUnit,
    highlights: SignedUnit,
    specular: SignedUnit,
  })
  .strict();
export type HdrGrade = z.infer<typeof HdrGradeSchema>;

/**
 * Custom/RGB tone curves and the four hue-selective curves. An omitted curve is
 * identity; an empty object is valid (no curve work at all).
 */
export const GradeCurvesSchema = z
  .object({
    master: OrderedCurveSchema.optional(),
    red: OrderedCurveSchema.optional(),
    green: OrderedCurveSchema.optional(),
    blue: OrderedCurveSchema.optional(),
    hueVsHue: OrderedCurveSchema.optional(),
    hueVsSat: OrderedCurveSchema.optional(),
    hueVsLum: OrderedCurveSchema.optional(),
    lumVsSat: OrderedCurveSchema.optional(),
  })
  .strict();
export type GradeCurves = z.infer<typeof GradeCurvesSchema>;

/** Hue/saturation/luminance key used by the Qualifier. */
export const GradeQualifierSchema = z
  .object({
    enabled: z.boolean(),
    hue: UnitIntervalSchema,
    hueWidth: UnitIntervalSchema,
    satMin: UnitIntervalSchema,
    satMax: UnitIntervalSchema,
    lumMin: UnitIntervalSchema,
    lumMax: UnitIntervalSchema,
    feather: UnitIntervalSchema,
    invert: z.boolean(),
  })
  .strict();
export type GradeQualifier = z.infer<typeof GradeQualifierSchema>;

export const PowerWindowKindSchema = z.enum(['circle', 'rect', 'polygon', 'gradient']);
export type PowerWindowKind = z.infer<typeof PowerWindowKindSchema>;

/**
 * Geometric mask, normalized to the frame. `tracking` enables centroid tracking
 * of the keyed region; `dx`/`dy` are the accumulated normalized offset.
 */
export const PowerWindowSchema = z
  .object({
    id: GradeIdSchema,
    kind: PowerWindowKindSchema,
    enabled: z.boolean(),
    x: UnitIntervalSchema,
    y: UnitIntervalSchema,
    width: UnitIntervalSchema,
    height: UnitIntervalSchema,
    rotation: z.number().gte(-180).lte(180),
    feather: UnitIntervalSchema,
    points: z.array(z.object({ x: UnitIntervalSchema, y: UnitIntervalSchema }).strict()).max(16).optional(),
    tracking: z.boolean(),
    dx: z.number().gte(-1).lte(1),
    dy: z.number().gte(-1).lte(1),
  })
  .strict();
export type PowerWindow = z.infer<typeof PowerWindowSchema>;

/** 3x3 channel mixer. Rows are output R/G/B, columns input R/G/B. */
export const RgbMixerSchema = z
  .object({
    red: z.tuple([SignedUnit, SignedUnit, SignedUnit]),
    green: z.tuple([SignedUnit, SignedUnit, SignedUnit]),
    blue: z.tuple([SignedUnit, SignedUnit, SignedUnit]),
  })
  .strict();
export type RgbMixer = z.infer<typeof RgbMixerSchema>;

/** Color Warper: two-dimensional hue/saturation offset in 0..1 space. */
export const ColorWarperSchema = z
  .object({ hue: SignedUnit, saturation: SignedUnit })
  .strict();
export type ColorWarper = z.infer<typeof ColorWarperSchema>;

/**
 * Filmora-style colour wheel position. `x`/`y` are the chromatic offset in the
 * wheel plane and `luma` is the exposure of that tonal zone. Kept as geometry
 * (not RGB) because the UI shows X/Y fields, and converted to the existing RGB
 * wheel model by the single compiler in `color-engine.ts`.
 */
export const WheelXYSchema = z
  .object({ x: SignedUnit, y: SignedUnit, luma: SignedUnit })
  .strict();
export type WheelXY = z.infer<typeof WheelXYSchema>;

/** Four HDR zones of the reference captures: Negro / Oscuro / Sombra / Claro. */
export const HdrWheelsSchema = z
  .object({
    black: WheelXYSchema,
    dark: WheelXYSchema,
    shadow: WheelXYSchema,
    light: WheelXYSchema,
  })
  .strict();
export type HdrWheels = z.infer<typeof HdrWheelsSchema>;

/**
 * UI state of the properties panel that must survive a project reload. It is
 * stored next to the correction it describes so there is no second, local copy
 * of a toggle in React state. Every field has a real effect on the controls.
 */
export const GradePanelStateSchema = z
  .object({
    autoColor: z.boolean(),
    lut: z.boolean(),
    color: z.boolean(),
    light: z.boolean(),
    whiteBalance: z.enum(['auto', 'manual']),
    interference: z.number().gte(0).lte(100),
    styleTab: z.enum(['default', 'custom']),
    hslSwatch: z.number().int().gte(0).lte(7),
  })
  .strict();
export type GradePanelState = z.infer<typeof GradePanelStateSchema>;

/** All corrections that a single node can apply. */
export const ColorGradeLayerSchema = z
  .object({
    primaries: PrimaryGradeSchema,
    hdr: HdrGradeSchema,
    curves: GradeCurvesSchema,
    qualifier: GradeQualifierSchema,
    windows: z.array(PowerWindowSchema).max(MAX_GRADE_WINDOWS),
    mixer: RgbMixerSchema,
    warper: ColorWarperSchema,
    blur: z.number().gte(0).lte(50),
    sharpen: z.number().gte(0).lte(5),
    /** Relative path of an imported .cube LUT (existing FFmpeg `lut3d` path). */
    lutFile: z.string().min(1).max(500).optional(),
    lutIntensity: UnitIntervalSchema,
    /** Built-in / custom look applied from the properties panel. */
    lookId: z.string().min(1).max(80).optional(),
    /** Four-zone HDR wheels; optional so older documents stay valid. */
    hdrWheels: HdrWheelsSchema.optional(),
    /** Parameters the editor marked with a keyframe (marks, not a time curve). */
    keyed: z.array(z.string().min(1).max(40)).max(32).optional(),
    /** Persisted state of the properties panel controls. */
    panel: GradePanelStateSchema.optional(),
    /** 0..1 wet/dry of this whole node. */
    mix: UnitIntervalSchema,
  })
  .strict();
export type ColorGradeLayer = z.infer<typeof ColorGradeLayerSchema>;

export const ColorNodeKindSchema = z.enum(['source', 'serial', 'parallel', 'output']);
export type ColorNodeKind = z.infer<typeof ColorNodeKindSchema>;

export const ColorNodeSchema = z
  .object({
    id: GradeIdSchema,
    label: z.string().min(1).max(60),
    kind: ColorNodeKindSchema,
    enabled: z.boolean(),
    layer: ColorGradeLayerSchema,
    /** Position in the node canvas, normalized 0..1 (resolution independent). */
    x: UnitIntervalSchema,
    y: UnitIntervalSchema,
  })
  .strict();
export type ColorNode = z.infer<typeof ColorNodeSchema>;

export const ColorLinkSchema = z
  .object({ id: GradeIdSchema, from: GradeIdSchema, to: GradeIdSchema })
  .strict();
export type ColorLink = z.infer<typeof ColorLinkSchema>;

export const ColorGradeSchema = z
  .object({
    version: z.literal(COLOR_GRADE_VERSION),
    nodes: z.array(ColorNodeSchema).min(2).max(MAX_COLOR_NODES),
    links: z.array(ColorLinkSchema).max(MAX_COLOR_LINKS),
    /** Which node the panel is editing; informational, never affects rendering. */
    activeNodeId: GradeIdSchema.optional(),
  })
  .strict();
export type ColorGrade = z.infer<typeof ColorGradeSchema>;

// ---------------------------------------------------------------------------
// Factories. Kept next to the schema so the UI and the compiler agree on what
// "neutral" means; the document itself stores no defaults.
// ---------------------------------------------------------------------------

const NEUTRAL_WHEEL: ColorWheelValue = { r: 0, g: 0, b: 0 };

export function createNeutralWheel(): ColorWheelValue {
  return { ...NEUTRAL_WHEEL };
}

export function createNeutralPrimaries(): PrimaryGrade {
  return {
    lift: createNeutralWheel(),
    gamma: createNeutralWheel(),
    gain: createNeutralWheel(),
    offset: createNeutralWheel(),
    contrast: 0,
    pivot: 0.5,
    saturation: 1,
    temperature: 0,
    tint: 0,
  };
}

export function createNeutralHdr(): HdrGrade {
  return { global: 0, shadows: 0, dark: 0, light: 0, highlights: 0, specular: 0 };
}

export function createNeutralQualifier(): GradeQualifier {
  return {
    enabled: false,
    hue: 0,
    hueWidth: 0.08,
    satMin: 0.15,
    satMax: 1,
    lumMin: 0,
    lumMax: 1,
    feather: 0.25,
    invert: false,
  };
}

export function createNeutralMixer(): RgbMixer {
  return { red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1] };
}

export function createNeutralWheelXY(): WheelXY {
  return { x: 0, y: 0, luma: 0 };
}

export function createNeutralPanelState(): GradePanelState {
  return {
    autoColor: false,
    lut: true,
    color: true,
    light: true,
    whiteBalance: 'auto',
    interference: 80,
    styleTab: 'default',
    hslSwatch: 0,
  };
}

export function createNeutralHdrWheels(): HdrWheels {
  return {
    black: createNeutralWheelXY(),
    dark: createNeutralWheelXY(),
    shadow: createNeutralWheelXY(),
    light: createNeutralWheelXY(),
  };
}

export function createNeutralLayer(): ColorGradeLayer {
  return {
    primaries: createNeutralPrimaries(),
    hdr: createNeutralHdr(),
    curves: {},
    qualifier: createNeutralQualifier(),
    windows: [],
    mixer: createNeutralMixer(),
    warper: { hue: 0, saturation: 0 },
    blur: 0,
    sharpen: 0,
    lutIntensity: 1,
    mix: 1,
  };
}

export const COLOR_GRADE_SOURCE_ID = 'color-source';
export const COLOR_GRADE_OUTPUT_ID = 'color-output';

/** A minimal, valid serial chain: source -> one corrector -> output. */
export function createDefaultColorGrade(firstNodeId = 'color-node-1'): ColorGrade {
  return {
    version: COLOR_GRADE_VERSION,
    nodes: [
      {
        id: COLOR_GRADE_SOURCE_ID,
        label: 'Media',
        kind: 'source',
        enabled: true,
        layer: createNeutralLayer(),
        x: 0.06,
        y: 0.5,
      },
      {
        id: firstNodeId,
        label: 'Corrección 01',
        kind: 'serial',
        enabled: true,
        layer: createNeutralLayer(),
        x: 0.42,
        y: 0.5,
      },
      {
        id: COLOR_GRADE_OUTPUT_ID,
        label: 'Salida',
        kind: 'output',
        enabled: true,
        layer: createNeutralLayer(),
        x: 0.84,
        y: 0.5,
      },
    ],
    links: [
      { id: 'color-link-1', from: COLOR_GRADE_SOURCE_ID, to: firstNodeId },
      { id: 'color-link-2', from: firstNodeId, to: COLOR_GRADE_OUTPUT_ID },
    ],
    activeNodeId: firstNodeId,
  };
}

/** Identity curve, used whenever a tool starts being edited. */
export const GRADE_CURVE_IDENTITY: readonly GradeCurvePoint[] = Object.freeze([
  { x: 0, y: 0 },
  { x: 1, y: 1 },
]);

/** Midline curve for hue-selective tools (0.5 = no change). */
export const GRADE_CURVE_MIDLINE: readonly GradeCurvePoint[] = Object.freeze([
  { x: 0, y: 0.5 },
  { x: 1, y: 0.5 },
]);
