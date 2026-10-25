import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from './primitives.ts';
import { ProjectRelativePathSchema } from './paths.ts';
import { DurationSchema, FrameRateSchema } from './time.ts';

/**
 * Media assets: every file a project can place on a timeline, together with the
 * licence and provenance record that makes it safe to render and redistribute.
 *
 * An asset is the only place a filesystem path may appear. Rendering resolves
 * the path against the project root, so a bare remote URL is never a render
 * source: the bytes have to be local and hashed before a clip can be trusted.
 */

export const AssetKindSchema = z.enum(['video', 'image', 'audio', 'font', 'text']);

export const AssetStatusSchema = z.enum(['unverified', 'ready', 'missing', 'failed']);

export const CommercialUseSchema = z.enum([
  'allowed',
  'requires-attribution',
  'not-for-redistribution',
  'unknown',
]);

export const AssetOriginSchema = z.enum([
  'user-imported',
  'downloaded',
  'generated-by-provider',
  'generated-locally',
  'template-default',
]);

const PixelsSchema = z.number().int().positive().lte(16_384);
const SampleRateSchema = z.number().int().gte(8_000).lte(192_000);
const ChannelsSchema = z.number().int().gte(1).lte(8);

export const AssetSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('local'), path: ProjectRelativePathSchema }).strict(),
  z
    .object({
      type: z.literal('downloaded'),
      url: z.string().url(),
      path: ProjectRelativePathSchema,
      fetchedAt: IsoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('generated'),
      provider: z
        .object({ id: z.string().min(1).max(80), model: z.string().min(1).max(120) })
        .strict(),
      path: ProjectRelativePathSchema,
      generatedAt: IsoDateTimeSchema,
      operationId: EntityIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('template'),
      templateId: z.string().min(1).max(120),
      templateVersion: z.string().min(1).max(40),
      path: ProjectRelativePathSchema,
    })
    .strict(),
]);

export const AssetIntegritySchema = z
  .object({
    sha256: Sha256Schema,
    bytes: z.number().int().positive(),
  })
  .strict();

export const AssetProxySchema = z
  .object({
    path: ProjectRelativePathSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().positive(),
  })
  .strict();
export type AssetProxy = z.infer<typeof AssetProxySchema>;

const LicenseSchema = z
  .object({
    id: z.string().min(1).max(120),
    commercialUse: CommercialUseSchema,
    url: z.string().url().optional(),
    attributionText: z.string().min(1).max(500).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const ProvenanceSchema = z
  .object({
    origin: AssetOriginSchema,
    acquiredAt: IsoDateTimeSchema,
    sourceUrl: z.string().url().optional(),
    provider: z.string().min(1).max(120).optional(),
    termsSnapshot: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const AssetRightsSchema = z
  .object({
    license: LicenseSchema,
    provenance: ProvenanceSchema,
  })
  .strict();

export const MAX_ASSET_TAGS = 8;
export const MAX_ASSET_TAG_LENGTH = 24;
export const MAX_ASSET_BIN_LENGTH = 40;

const AssetTagSchema = z.string().trim().min(1).max(MAX_ASSET_TAG_LENGTH);

const baseShape = {
  id: EntityIdSchema,
  label: z.string().min(1).max(200),
  source: AssetSourceSchema,
  status: AssetStatusSchema,
  integrity: AssetIntegritySchema.optional(),
  rights: AssetRightsSchema,
  favorite: z.boolean().optional(),
  tags: z.array(AssetTagSchema).max(MAX_ASSET_TAGS).optional(),
  bin: z.string().trim().min(1).max(MAX_ASSET_BIN_LENGTH).optional(),
};

const VideoAssetSchema = z
  .object({
    ...baseShape,
    kind: z.literal('video'),
    proxy: AssetProxySchema.optional(),
    media: z
      .object({
        width: PixelsSchema,
        height: PixelsSchema,
        durationFrames: DurationSchema,
        frameRate: FrameRateSchema,
        /** El archivo lleva canal alfa (recortes VP9, ProRes 4444). */
        alpha: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const ImageAssetSchema = z
  .object({
    ...baseShape,
    kind: z.literal('image'),
    media: z
      .object({
        width: PixelsSchema,
        height: PixelsSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const AudioAssetSchema = z
  .object({
    ...baseShape,
    kind: z.literal('audio'),
    media: z
      .object({
        sampleRate: SampleRateSchema,
        channels: ChannelsSchema,
        durationFrames: DurationSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const FontAssetSchema = z.object({ ...baseShape, kind: z.literal('font') }).strict();

const TextAssetSchema = z.object({ ...baseShape, kind: z.literal('text') }).strict();

export const AssetSchema = z
  .discriminatedUnion('kind', [
    VideoAssetSchema,
    ImageAssetSchema,
    AudioAssetSchema,
    FontAssetSchema,
    TextAssetSchema,
  ])
  .superRefine((asset, ctx) => {
    const seenTags = new Set<string>();
    for (const [index, tag] of (asset.tags ?? []).entries()) {
      const key = tag.toLocaleLowerCase('es');
      if (seenTags.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tags', index],
          message: 'asset tags must be unique',
        });
      }
      seenTags.add(key);
    }

    if (
      asset.rights.provenance.origin === 'downloaded' &&
      !asset.rights.provenance.sourceUrl
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rights', 'provenance', 'sourceUrl'],
        message: 'a downloaded asset must record the url it was obtained from',
      });
    }

    if (asset.status !== 'ready') {
      return;
    }

    if (!asset.integrity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['integrity'],
        message: 'an asset cannot be reported ready before its bytes are hashed',
      });
    }

    if (
      (asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio') &&
      !asset.media
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['media'],
        message: `a ${asset.kind} asset cannot be reported ready without a measured media probe`,
      });
    }

    if (asset.rights.license.commercialUse === 'unknown') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rights', 'license', 'commercialUse'],
        message: 'resolve the licence of an asset before marking it ready',
      });
    }
  });

export const AssetListSchema = z.array(AssetSchema);

export type AssetKind = z.infer<typeof AssetKindSchema>;
export type Asset = z.infer<typeof AssetSchema>;
