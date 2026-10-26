export {
  PROJECT_SCHEMA_VERSION,
  PROJECT_FILE_EXTENSION,
  ProjectDocumentSchema,
  createEmptyProject,
  parseProject,
  totalProjectDuration,
} from './project.ts';
export type { ProjectDocument, ProjectParseResult } from './project.ts';

export {
  AssetSchema,
  AssetKindSchema,
  AssetStatusSchema,
  AssetRightsSchema,
  AssetProxySchema,
  MAX_ASSET_TAGS,
  MAX_ASSET_TAG_LENGTH,
  MAX_ASSET_BIN_LENGTH,
} from './assets.ts';
export type { Asset, AssetProxy } from './assets.ts';
export {
  MarkerSchema,
  MarkerListSchema,
  MarkerColorSchema,
  MARKER_COLORS,
  MAX_MARKERS,
} from './markers.ts';
export type { Marker, MarkerColor } from './markers.ts';
export {
  CAPTION_MOTION_PRESETS,
  CaptionMotionKeyframeSchema,
  CaptionMotionPresetSchema,
  CaptionMotionSchema,
} from './captions.ts';
export type {
  CaptionMotion,
  CaptionMotionKeyframe,
  CaptionMotionPreset,
} from './captions.ts';

export {
  CaptionCueSchema,
  CaptionStyleSchema,
  CaptionsSchema,
  CaptionPositionSchema,
  CaptionAnimationSchema,
} from './captions.ts';
export type { CaptionCue, CaptionWord, CaptionStyle, CaptionAnimation } from './captions.ts';

export {
  RenderProfileSchema,
  RenderProfileListSchema,
  ExportVariantSchema,
  ExportVariantListSchema,
  AspectRatioSchema,
} from './delivery.ts';
export type { RenderProfile } from './delivery.ts';

export {
  AudioMixSchema,
  MotionItemSchema,
  MotionListSchema,
  SceneSchema,
  SceneListSchema,
  SceneIntentSchema,
  LoudnessPlatformSchema,
} from './production.ts';
export type { Scene, MotionItem, AudioMix } from './production.ts';

export {
  AgentOperationSchema,
  ClaimSchema,
  JsonPatchOperationSchema,
  ProvenanceRecordSchema,
  SourceSchema,
  AgentRoleSchema,
  OperationStatusSchema,
} from './provenance.ts';
export type { Source, Claim, AgentOperation } from './provenance.ts';

export {
  MAX_GAIN_KEYFRAMES,
  MAX_TRANSFORM_KEYFRAMES,
  TRANSFORM_KEYFRAME_SCALE_MAX,
  TRANSFORM_KEYFRAME_SCALE_MIN,
  TrackSchema,
  ClipSchema,
  TimelineSchema,
  TrackKindSchema,
  ClipKindSchema,
  ClipEffectsSchema,
  CurvePointSchema,
  ClipCurvesSchema,
  CURVE_CHANNELS,
  MAX_CURVE_POINTS,
  ClipMotionSchema,
  ClipTransformKeyframeSchema,
  ClipGainKeyframeSchema,
  CubicBezierSchema,
  ChromaKeySchema,
  ClipTransitionSchema,
  KeyframeEasingSchema,
  ClipMaskSchema,
  MaskPointSchema,
  ClipStabilizationSchema,
  BlendModeSchema,
  ClipColorTagSchema,
  ClipAnimationTypeSchema,
  ClipAnimationSchema,
  MAX_ANIMATION_FRAMES,
  ClipMaskKeyframeSchema,
  MAX_MASK_KEYFRAMES,
  CompoundSchema,
  CompoundInnerClipSchema,
  CompoundClipSchema,
  clipFitsTrack,
} from './timeline.ts';
export type {
  Track,
  Clip,
  ClipEffects,
  CurvePoint,
  CurveChannel,
  ClipCurves,
  ClipMotion,
  ClipTransformKeyframe,
  ClipGainKeyframe,
  CubicBezier,
  ChromaKey,
  ClipTransition,
  KeyframeEasing,
  ClipMask,
  MaskPoint,
  ClipStabilization,
  BlendMode,
  ClipColorTag,
  ClipAnimationType,
  ClipAnimation,
  ClipMaskKeyframe,
  Compound,
  CompoundInnerClip,
} from './timeline.ts';

export {
  hasGainKeyframes,
  hasGeometryKeyframes,
  hasTransformKeyframes,
  keyframeFrameAt,
  sampleGainKeyframes,
  sampleMaskKeyframes,
  sampleTransformKeyframes,
  cubicBezierProgress,
  getBezierFromEasing,
} from './keyframes.ts';
export type { SampledMask } from './keyframes.ts';
export type { SampledTransform } from './keyframes.ts';

export {
  CURVE_IDENTITY,
  curvePointsFor,
  curveTableValues,
  hasCustomCurves,
  sampleCurvePoints,
} from './curves.ts';

export {
  EntityIdSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  LanguageTagSchema,
  Sha256Schema,
} from './primitives.ts';
export type { EntityId, JsonValue } from './primitives.ts';

export {
  DurationSchema,
  FrameRateSchema,
  FrameSchema,
  TOTAL_DURATION_MAX_FRAMES,
} from './time.ts';
export type { Duration, Frame, FrameRate } from './time.ts';

export { ProjectRelativePathSchema } from './paths.ts';
export type { ProjectRelativePath } from './paths.ts';
