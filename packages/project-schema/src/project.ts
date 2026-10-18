import { z } from "zod";

export const PROJECT_SCHEMA_VERSION = 1 as const;

const IdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const RelativeUriSchema = z.string().min(1).max(2048).refine(
  (value) => !value.startsWith("/") && !value.startsWith("\\") &&
    !/^[a-zA-Z]:[\\/]/.test(value) &&
    !value.split(/[\\/]/).some((segment) => segment === ".."),
  "Asset URI must be relative and stay inside the project root",
);

export const AssetSchema = z.object({
  id: IdSchema,
  kind: z.enum(["video", "image", "audio", "font", "other"]),
  uri: RelativeUriSchema,
  sourceUrl: z.string().url().optional(),
  license: z.string().max(500).optional(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  durationFrames: z.number().int().positive().optional(),
}).strict();

export const TrackSchema = z.object({
  id: IdSchema,
  type: z.enum(["video", "audio", "captions", "graphics"]),
  name: z.string().min(1).max(120),
  order: z.number().int().nonnegative(),
}).strict();

export const ClipSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  trackId: IdSchema,
  startFrame: z.number().int().nonnegative(),
  inFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  volume: z.number().min(0).max(2).optional(),
}).strict();

export const SceneSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional(),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  clipIds: z.array(IdSchema).default([]),
}).strict();

export const ProjectDocumentSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: IdSchema,
  name: z.string().trim().min(1).max(160),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  settings: z.object({
    width: z.number().int().min(16).max(7680),
    height: z.number().int().min(16).max(4320),
    fps: z.number().int().min(1).max(120),
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#101319"),
  }).strict(),
  assets: z.array(AssetSchema),
  tracks: z.array(TrackSchema).min(1),
  clips: z.array(ClipSchema),
  scenes: z.array(SceneSchema),
}).strict().superRefine((project, ctx) => {
  const allIds = [
    ...project.assets.map((item) => item.id),
    ...project.tracks.map((item) => item.id),
    ...project.clips.map((item) => item.id),
    ...project.scenes.map((item) => item.id),
  ];
  const seen = new Set<string>();
  for (const id of allIds) {
    if (seen.has(id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate project entity id: ${id}` });
    }
    seen.add(id);
  }

  const assetIds = new Set(project.assets.map((asset) => asset.id));
  const trackIds = new Set(project.tracks.map((track) => track.id));
  const clipIds = new Set(project.clips.map((clip) => clip.id));
  project.clips.forEach((clip, index) => {
    if (!assetIds.has(clip.assetId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index, "assetId"], message: "Clip references a missing asset" });
    }
    if (!trackIds.has(clip.trackId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index, "trackId"], message: "Clip references a missing track" });
    }
  });
  project.scenes.forEach((scene, index) => {
    scene.clipIds.forEach((clipId) => {
      if (!clipIds.has(clipId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scenes", index, "clipIds"], message: `Scene references missing clip: ${clipId}` });
      }
    });
  });
});

export type Asset = z.infer<typeof AssetSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;

export function validateProjectDocument(input: unknown): ProjectDocument {
  return ProjectDocumentSchema.parse(input);
}

export function createEmptyProject(name: string, now: string = new Date().toISOString()): ProjectDocument {
  return validateProjectDocument({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: `project-${crypto.randomUUID()}`,
    name,
    createdAt: now,
    updatedAt: now,
    settings: { width: 1920, height: 1080, fps: 30, backgroundColor: "#101319" },
    assets: [],
    tracks: [{ id: "track-video-main", type: "video", name: "Video 1", order: 0 }],
    clips: [],
    scenes: [],
  });
}
