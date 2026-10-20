import { z } from 'zod';
import { AssetSchema } from './assets.ts';
import { CaptionsSchema } from './captions.ts';
import { ExportVariantListSchema, RenderProfileListSchema } from './delivery.ts';
import { EntityIdSchema, IsoDateTimeSchema, JsonValueSchema, LanguageTagSchema } from './primitives.ts';
import { AudioMixSchema, MotionListSchema, SceneListSchema } from './production.ts';
import { ProvenanceRecordSchema } from './provenance.ts';
import { FrameRateSchema, TOTAL_DURATION_MAX_FRAMES } from './time.ts';
import { ClipEffectsSchema, TimelineSchema } from './timeline.ts';

/**
 * The canonical project document: the single source of truth an Editor IA
 * project file (`.editoria.json`) must satisfy before the app touches the
 * filesystem, and the same contract the Rust boundary and the render worker
 * validate independently.
 *
 * Two rules shape everything below. Nothing is loaded partially: a malformed
 * document is rejected with the path that broke. And nothing an agent produced
 * is trusted: references between entities are resolved here, so a project can
 * not point at an asset, clip, track, profile or scene that is not in the file.
 */

export const PROJECT_SCHEMA_VERSION = 1;

export const PROJECT_FILE_EXTENSION = 'editoria.json';

const KNOWN_ROOT_KEYS: readonly string[] = [
  'id',
  'name',
  'schemaVersion',
  'createdAt',
  'updatedAt',
  'revision',
  'language',
  'video',
  'look',
  'assets',
  'timeline',
  'captions',
  'scenes',
  'motion',
  'audio',
  'renderProfiles',
  'exportVariants',
  'provenance',
  'migrationHistory',
];

/**
 * Keys that must never appear in a project file, whatever their value. The
 * product keeps credentials in the operating system store, so a field shaped
 * like a secret means the file was written by something that ignored the
 * boundary.
 */
const FORBIDDEN_KEY =
  /^(?:x-)?(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization|auth[_-]?token|bearer[_-]?token|cookie|private[_-]?key)$/i;

const PixelsSchema = z.number().int().positive().lte(16_384);

const VideoSettingsSchema = z
  .object({
    width: PixelsSchema,
    height: PixelsSchema,
    frameRate: FrameRateSchema,
    backgroundColor: z
      .string()
      .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, 'background colour must be a hex triplet')
      .optional(),
    safeArea: z
      .object({
        top: z.number().int().gte(0).lte(4_096),
        right: z.number().int().gte(0).lte(4_096),
        bottom: z.number().int().gte(0).lte(4_096),
        left: z.number().int().gte(0).lte(4_096),
      })
      .strict()
      .optional(),
  })
  .strict();

const MigrationEntrySchema = z
  .object({
    fromVersion: z.number().int().gte(1),
    toVersion: z.number().int().gte(1),
    migratedAt: IsoDateTimeSchema,
    tool: z.string().min(1).max(80),
  })
  .strict();

function collectForbiddenKeys(value: unknown, trail: string[], out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenKeys(entry, [...trail, `[${index}]`], out));
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = [...trail, key];
    if (FORBIDDEN_KEY.test(key)) {
      out.push(path.join('.'));
    }
    collectForbiddenKeys(child, path, out);
  }
}

const ProjectSchemaBase = z.object({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  revision: z.number().int().gte(0),
  language: LanguageTagSchema,
  video: VideoSettingsSchema,
  look: ClipEffectsSchema.optional(),
  assets: z.array(AssetSchema),
  timeline: TimelineSchema,
  captions: CaptionsSchema,
  scenes: SceneListSchema,
  motion: MotionListSchema,
  audio: AudioMixSchema,
  renderProfiles: RenderProfileListSchema,
  exportVariants: ExportVariantListSchema,
  provenance: ProvenanceRecordSchema,
  migrationHistory: z.array(MigrationEntrySchema),
});

type Issue = { path: (string | number)[]; message: string };

function addIssue(ctx: z.RefinementCtx, issue: Issue): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
}

function integrityIssues(project: z.infer<typeof ProjectSchemaBase>): Issue[] {
  const issues: Issue[] = [];

  const assetIds = new Set<string>();
  project.assets.forEach((asset, index) => {
    if (assetIds.has(asset.id)) {
      issues.push({
        path: ['assets', index, 'id'],
        message: 'asset ids must be unique inside a project',
      });
    }
    assetIds.add(asset.id);
  });

  const trackIds = new Set<string>();
  const captionTrackIds = new Set<string>();
  for (const track of project.timeline.tracks) {
    trackIds.add(track.id);
    if (track.kind === 'caption') {
      captionTrackIds.add(track.id);
    }
  }

  const clipIds = new Set<string>();
  project.timeline.clips.forEach((clip, index) => {
    clipIds.add(clip.id);
    if (clip.source.type === 'asset' && !assetIds.has(clip.source.assetId)) {
      issues.push({
        path: ['timeline', 'clips', index, 'source', 'assetId'],
        message: 'the clip references an asset that is not present in the project',
      });
    }
  });

  const motionIds = new Set(project.motion.map((item) => item.id));
  project.timeline.clips.forEach((clip, index) => {
    if (clip.source.type === 'graphic' && !motionIds.has(clip.source.motionId)) {
      issues.push({
        path: ['timeline', 'clips', index, 'source', 'motionId'],
        message: 'the clip references a motion item that is not present in the project',
      });
    }
  });

  project.motion.forEach((item, index) => {
    if (item.targetTrackId !== undefined && !trackIds.has(item.targetTrackId)) {
      issues.push({
        path: ['motion', index, 'targetTrackId'],
        message: 'the motion item targets a track that is not present in the project',
      });
    }
  });

  project.captions.cues.forEach((cue, index) => {
    if (!captionTrackIds.has(cue.trackId)) {
      issues.push({
        path: ['captions', 'cues', index, 'trackId'],
        message: 'a caption cue must live on a track of kind caption',
      });
    }
  });

  project.scenes.forEach((scene, index) => {
    scene.clipIds.forEach((clipId, position) => {
      if (!clipIds.has(clipId)) {
        issues.push({
          path: ['scenes', index, 'clipIds', position],
          message: `the scene references clip ${clipId} which is not present in the project`,
        });
      }
    });
  });

  const profileIds = new Set(project.renderProfiles.map((profile) => profile.id));
  project.exportVariants.forEach((variant, index) => {
    if (!profileIds.has(variant.renderProfileId)) {
      issues.push({
        path: ['exportVariants', index, 'renderProfileId'],
        message: 'the export variant references a render profile that is not present in the project',
      });
    }
  });

  if (project.audio.music && !assetIds.has(project.audio.music.assetId)) {
    issues.push({
      path: ['audio', 'music', 'assetId'],
      message: 'the music bed references an asset that is not present in the project',
    });
  }

  for (const [field, ids] of [
    ['sourceTrackIds', project.audio.ducking.sourceTrackIds],
    ['targetTrackIds', project.audio.ducking.targetTrackIds],
  ] as const) {
    ids.forEach((trackId, index) => {
      if (!trackIds.has(trackId)) {
        issues.push({
          path: ['audio', 'ducking', field, index],
          message: 'ducking references a track that is not present in the project',
        });
      }
    });
  }

  const sceneIds = new Set(project.scenes.map((scene) => scene.id));
  project.provenance.claims.forEach((claim, index) => {
    if (claim.sceneId !== undefined && !sceneIds.has(claim.sceneId)) {
      issues.push({
        path: ['provenance', 'claims', index, 'sceneId'],
        message: 'the claim cites a scene that is not present in the project',
      });
    }
  });

  return issues;
}

export const ProjectDocumentSchema = ProjectSchemaBase.catchall(JsonValueSchema)
  .superRefine((project, ctx) => {
    for (const key of Object.keys(project)) {
      if (!KNOWN_ROOT_KEYS.includes(key) && !key.startsWith('x-')) {
        addIssue(ctx, {
          path: [key],
          message: `unexpected root key "${key}"; forward-compatible fields must use the x- namespace`,
        });
      }
    }

    const forbidden: string[] = [];
    collectForbiddenKeys(project, [], forbidden);
    for (const path of forbidden) {
      addIssue(ctx, {
        path: path.split('.'),
        message: 'a project file must never store a credential-shaped field',
      });
    }

    if (Date.parse(project.updatedAt) < Date.parse(project.createdAt)) {
      addIssue(ctx, {
        path: ['updatedAt'],
        message: 'updatedAt cannot be earlier than createdAt',
      });
    }

    const lastFrame = totalProjectDuration(project);
    if (lastFrame > TOTAL_DURATION_MAX_FRAMES) {
      addIssue(ctx, {
        path: ['timeline'],
        message: 'the timeline is longer than the format supports',
      });
    }

    for (const issue of integrityIssues(project)) {
      addIssue(ctx, issue);
    }
  });

export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;

export type ProjectParseFailure = {
  ok: false;
  code: 'UNSUPPORTED_SCHEMA_VERSION' | 'INVALID_PROJECT';
  message: string;
  issues: { path: string; message: string }[];
};

export type ProjectParseSuccess = { ok: true; project: ProjectDocument };

export type ProjectParseResult = ProjectParseSuccess | ProjectParseFailure;

/**
 * Validate a value read from disk. A document from a newer schema version gets
 * its own error code so the app can say "open this with a newer Editor IA"
 * instead of reporting a hundred unrelated shape problems.
 */
export function parseProject(value: unknown): ProjectParseResult {
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    typeof (value as { schemaVersion: unknown }).schemaVersion === 'number' &&
    (value as { schemaVersion: number }).schemaVersion !== PROJECT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: `this project was written with schema version ${
        (value as { schemaVersion: number }).schemaVersion
      }; Editor IA reads version ${PROJECT_SCHEMA_VERSION}`,
      issues: [{ path: 'schemaVersion', message: 'unsupported schema version' }],
    };
  }

  const result = ProjectDocumentSchema.safeParse(value);
  if (result.success) {
    return { ok: true, project: result.data };
  }

  return {
    ok: false,
    code: 'INVALID_PROJECT',
    message: 'the project file does not match the Editor IA format',
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

/**
 * The smallest document the format accepts: a named project with no media, no
 * tracks and no clips, at 1080p30. It deliberately does not create placeholder
 * tracks, profiles or scenes; those arrive with the features that need them.
 */
export function createEmptyProject(
  name: string,
  now: string = new Date().toISOString(),
): ProjectDocument {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new RangeError('a project needs a name');
  }

  const candidate = {
    id: crypto.randomUUID(),
    name: trimmed,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    language: 'es',
    video: { width: 1920, height: 1080, frameRate: { num: 30, den: 1 } },
    assets: [],
    timeline: { tracks: [], clips: [] },
    captions: { styles: [], cues: [] },
    scenes: [],
    motion: [],
    audio: {},
    renderProfiles: [],
    exportVariants: [],
    provenance: { sources: [], claims: [], operations: [] },
    migrationHistory: [],
  };

  return ProjectDocumentSchema.parse(candidate);
}

/** Last frame touched by any clip or caption cue. Zero for an empty timeline. */
export function totalProjectDuration(project: {
  timeline: { clips: { startFrame: number; durationFrames: number }[] };
  captions: { cues: { endFrame: number }[] };
}): number {
  const clipEnds = project.timeline.clips.map((clip) => clip.startFrame + clip.durationFrames);
  const cueEnds = project.captions.cues.map((cue) => cue.endFrame);
  return Math.max(0, ...clipEnds, ...cueEnds);
}
