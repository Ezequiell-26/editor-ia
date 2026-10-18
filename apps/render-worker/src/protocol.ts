import { z } from "zod";
import path from "node:path";

export const RENDER_PROTOCOL_VERSION = 1 as const;
const RequestIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const AbsolutePathSchema = z.string().min(1).max(4096).refine(
  (value) => !value.includes("\0") && (path.win32.isAbsolute(value) || path.posix.isAbsolute(value)),
  "Path must be an absolute filesystem path",
);

const RenderProfileSchema = z.object({
  id: z.enum(["youtube-1080p", "shorts-1080p", "custom"]),
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(4320),
  fps: z.number().int().min(1).max(120),
  format: z.literal("mp4"),
}).strict();

export const RenderRequestSchema = z.object({
  requestId: RequestIdSchema,
  protocolVersion: z.literal(RENDER_PROTOCOL_VERSION),
  projectPath: AbsolutePathSchema,
  outputPath: AbsolutePathSchema,
  engine: z.enum(["ffmpeg", "remotion"]),
  profile: RenderProfileSchema,
}).strict().superRefine((request, ctx) => {
  if (path.normalize(request.projectPath).toLowerCase() === path.normalize(request.outputPath).toLowerCase()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["outputPath"], message: "Output path must not overwrite the project file" });
  }
  if (!request.projectPath.toLowerCase().endsWith(".editoria.json")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["projectPath"], message: "Project path must end with .editoria.json" });
  }
  if (!request.outputPath.toLowerCase().endsWith(".mp4")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["outputPath"], message: "Output path must end with .mp4" });
  }
  if (request.projectPath.toLowerCase().endsWith(".mp4")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["projectPath"], message: "Project path must not be an MP4 output" });
  }
});

export type RenderRequest = z.infer<typeof RenderRequestSchema>;
export type RenderStatus = "completed" | "failed" | "cancelled" | "unsupported";

export type RenderResult = {
  requestId: string;
  status: RenderStatus;
  outputPath?: string;
  outputVerified?: boolean;
  durationMs?: number;
  errorCode?: string;
  message?: string;
};

export function validateRenderRequest(input: unknown): RenderRequest {
  return RenderRequestSchema.parse(input);
}

export function createRenderResult(
  requestId: string,
  status: RenderStatus,
  details: Omit<RenderResult, "requestId" | "status"> = {},
): RenderResult {
  if (!requestId.trim()) throw new Error("A render result requires a request ID.");
  if (status === "completed" && (!details.outputPath || details.outputVerified !== true)) {
    throw new Error("A completed render requires a verified output file.");
  }
  if (status !== "completed" && (details.outputPath !== undefined || details.outputVerified === true)) {
    throw new Error("Unverified output cannot be attached to a non-completed render.");
  }
  return { requestId, status, ...details };
}
