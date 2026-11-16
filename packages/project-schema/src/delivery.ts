import { z } from 'zod';
import { EntityIdSchema } from './primitives.ts';
import { FrameRateSchema } from './time.ts';

/**
 * Export layer: render profiles and per-platform variants.
 *
 * A profile is a promise about the output file, not a shell command. It carries
 * the container, codec matrix and quality gate the worker must satisfy before
 * it may report a render as completed.
 */

export const ContainerSchema = z.enum(['mp4', 'mov', 'webm']);
export const VideoCodecSchema = z.enum(['h264', 'h265', 'vp9', 'av1', 'prores']);
export const AudioCodecSchema = z.enum(['aac', 'opus']);
export const PixelFormatSchema = z.enum([
  'yuv420p',
  'yuv444p',
  'yuv422p10le',
  'yuva444p10le',
  'rgb24',
]);
/** Any simplified integer ratio: 16:9, 9:16, 4:3, 21:9, 683:384… */
export const AspectRatioSchema = z
  .string()
  .regex(/^\d{1,5}:\d{1,5}$/, 'aspect ratio must look like 16:9');
export const TargetPlatformSchema = z.enum(['youtube', 'shorts', 'reels', 'tiktok', 'other']);
export const VideoPresetSchema = z.enum([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
]);
export const FitModeSchema = z.enum(['contain', 'cover', 'blur']);

const CONTAINER_MATRIX: Record<z.infer<typeof ContainerSchema>, {
  video: readonly string[];
  audio: readonly string[];
}> = {
  mp4: { video: ['h264', 'h265'], audio: ['aac'] },
  // ProRes sólo viaja en MOV (paridad `exportar_prores.js` de AlaukCut, que usa
  // un ffmpeg dedicado a .mov); en MP4 queda fuera de la matriz.
  mov: { video: ['h264', 'h265', 'prores'], audio: ['aac'] },
  webm: { video: ['vp9', 'av1'], audio: ['opus'] },
};

const BitrateSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('crf'),
      crf: z.number().int().gte(0).lte(51),
    })
    .strict(),
  z
    .object({
      mode: z.literal('target'),
      videoBitsPerSecond: z.number().int().positive().lte(200_000_000),
    })
    .strict(),
]);

const QualityGateSchema = z
  .object({
    minOutputBytes: z.number().int().positive(),
    durationToleranceFrames: z.number().int().gte(0).lte(600),
    requireAllAssetsReady: z.boolean().default(true),
  })
  .strict();

export const RenderProfileSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().min(1).max(80),
    container: ContainerSchema,
    videoCodec: VideoCodecSchema,
    audioCodec: AudioCodecSchema,
    resolution: z
      .object({
        width: z.number().int().positive().lte(16_384),
        height: z.number().int().positive().lte(16_384),
      })
      .strict(),
    frameRate: FrameRateSchema,
    bitrate: BitrateSchema,
    /** x264/x265 speed preset. `veryfast` keeps exports responsive. */
    videoPreset: VideoPresetSchema.default('veryfast'),
    /** `contain` shows the whole canvas (bars); `cover` fills and center-crops;
     * `blur` fills with a blurred copy of the clip and centers it on top
     * (fondo desenfocado, paridad `rastreamento.js` de AlaukCut). */
    fit: FitModeSchema.default('contain'),
    pixelFormat: PixelFormatSchema,
    audioSampleRate: z.number().int().gte(8_000).lte(192_000),
    audioChannels: z.number().int().gte(1).lte(8),
    audioBitsPerSecond: z.number().int().gte(16_000).lte(512_000).default(128_000),
    aspectRatio: AspectRatioSchema,
    qualityGate: QualityGateSchema,
  })
  .strict()
  .superRefine((item, ctx) => {
    const [ratioWidth, ratioHeight] = item.aspectRatio.split(':').map(Number);
    if (
      !ratioWidth ||
      !ratioHeight ||
      item.resolution.width * ratioHeight !== item.resolution.height * ratioWidth
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolution'],
        message: `the resolution does not match the declared ${item.aspectRatio} aspect ratio`,
      });
    }

    const allowed = CONTAINER_MATRIX[item.container];
    if (!allowed.video.includes(item.videoCodec)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['videoCodec'],
        message: `${item.videoCodec} cannot be carried in a ${item.container} container`,
      });
    }
    if (!allowed.audio.includes(item.audioCodec)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audioCodec'],
        message: `${item.audioCodec} cannot be carried in a ${item.container} container`,
      });
    }
    // 4:2:2/4:4:4 10-bit son los formatos nativos de ProRes; con cualquier
    // otro códec el pipeline no los emitiría y el perfil mentiría.
    if (
      (item.pixelFormat === 'yuv422p10le' || item.pixelFormat === 'yuva444p10le') &&
      item.videoCodec !== 'prores'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pixelFormat'],
        message: '10-bit 4:2:2/4:4:4 is only emitted by the ProRes encoder',
      });
    }
    // Y ProRes no acepta los formatos de entrega 8-bit: prores_ks sólo emite
    // 4:2:2 10-bit o 4:4:4 10-bit con alfa (paridad `exp-alfa` de
    // `exportar_prores.js` de AlaukCut).
    if (
      item.videoCodec === 'prores' &&
      item.pixelFormat !== 'yuv422p10le' &&
      item.pixelFormat !== 'yuva444p10le'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pixelFormat'],
        message: 'prores requires pixelFormat yuv422p10le or yuva444p10le',
      });
    }
  });

export const RenderProfileListSchema = z
  .array(RenderProfileSchema)
  .superRefine((profiles, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();

    for (const [index, profile] of profiles.entries()) {
      if (ids.has(profile.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: 'render profile ids must be unique inside a project',
        });
      }
      ids.add(profile.id);

      if (names.has(profile.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'name'],
          message: `a render profile named "${profile.name}" already exists`,
        });
      }
      names.add(profile.name);
    }
  });

export const ExportVariantSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().min(1).max(80),
    renderProfileId: EntityIdSchema,
    platform: TargetPlatformSchema,
    note: z.string().max(500).optional(),
  })
  .strict();

export const ExportVariantListSchema = z
  .array(ExportVariantSchema)
  .superRefine((variants, ctx) => {
    const ids = new Set<string>();
    for (const [index, variant] of variants.entries()) {
      if (ids.has(variant.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: 'export variant ids must be unique inside a project',
        });
      }
      ids.add(variant.id);
    }
  });

export type RenderProfile = z.infer<typeof RenderProfileSchema>;
