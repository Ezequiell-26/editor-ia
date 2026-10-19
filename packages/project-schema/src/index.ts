export {
  PROJECT_SCHEMA_VERSION,
  PROJECT_FILE_EXTENSION,
  ProjectDocumentSchema,
  createEmptyProject,
  parseProject,
  totalProjectDuration,
} from './project.ts';
export type { ProjectDocument, ProjectParseResult } from './project.ts';

export { AssetSchema, AssetKindSchema, AssetStatusSchema, AssetRightsSchema } from './assets.ts';
export type { Asset } from './assets.ts';

export {
  CaptionCueSchema,
  CaptionStyleSchema,
  CaptionsSchema,
  CaptionPositionSchema,
} from './captions.ts';
export type { CaptionCue, CaptionStyle } from './captions.ts';

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

export { TrackSchema, ClipSchema, TimelineSchema, TrackKindSchema, ClipKindSchema } from './timeline.ts';
export type { Track, Clip } from './timeline.ts';

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
