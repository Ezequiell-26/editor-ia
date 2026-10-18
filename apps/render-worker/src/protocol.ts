import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  ProjectRelativePathSchema,
} from '@editor-ia/project-schema';

/**
 * The render worker's wire contract.
 *
 * The worker speaks to the desktop app, never to a shell: a request names a
 * project and an output relative to a root the caller controls, and a result
 * reports what actually happened to that file. Two rules hold this whole module
 * together. A `completed` status is only reachable through a post-render
 * verification of a real file, so a render that never ran cannot be reported as
 * one. And every rejection carries a safe code instead of an echoed value, so a
 * diagnostic never leaks an absolute path or a credential-shaped string.
 */

export const RENDER_PROTOCOL_VERSION = 'editor-ia.render/1';

/** Profiles the worker knows how to satisfy. Anything else is refused: a
 * profile is a promise about the output file, not a bag of encoder flags. */
export const RENDER_PROFILES = [
  'mp4-h264-1080p-16x9',
  'mp4-h264-vertical-9x16',
  'webm-vp9-1080p-16x9',
] as const;

export type RenderProfileName = (typeof RENDER_PROFILES)[number];

export const RenderStatusSchema = z.enum(['completed', 'failed', 'cancelled', 'unsupported']);
export type RenderStatus = z.infer<typeof RenderStatusSchema>;

export const SAFE_RENDER_CODES = [
  'UNSUPPORTED_PROTOCOL_VERSION',
  'INVALID_REQUEST',
  'PROJECT_FILE_MISSING',
  'OUTPUT_MISSING',
  'OUTPUT_TOO_SMALL',
  'VERIFICATION_REQUIRED',
  'INVALID_RESULT',
  'RENDERER_UNAVAILABLE',
  'RENDERER_UNIMPLEMENTED',
  'RENDERER_LICENSE_UNVERIFIED',
  'OUTPUT_WRITE_FAILED',
] as const;

export type SafeRenderCode = (typeof SAFE_RENDER_CODES)[number];

const RenderRequestShape = z
  .object({
    requestId: EntityIdSchema,
    protocolVersion: z.string().min(1).max(40),
    projectPath: ProjectRelativePathSchema,
    outputPath: ProjectRelativePathSchema,
    profile: z.enum(RENDER_PROFILES),
    requestedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.protocolVersion !== RENDER_PROTOCOL_VERSION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['protocolVersion'],
        message: 'the worker only speaks its own protocol version',
      });
    }
  });

export type RenderRequest = z.infer<typeof RenderRequestShape>;

export const RenderVerificationSchema = z
  .object({
    passed: z.literal(true),
    outputPath: ProjectRelativePathSchema,
    outputBytes: z.number().int().positive(),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export type RenderVerification = z.infer<typeof RenderVerificationSchema>;

export const RenderResultSchema = z
  .object({
    requestId: EntityIdSchema,
    protocolVersion: z.string().min(1).max(40),
    status: RenderStatusSchema,
    code: z.enum(SAFE_RENDER_CODES).optional(),
    message: z.string().min(1).max(200).optional(),
    outputPath: ProjectRelativePathSchema.optional(),
    verification: RenderVerificationSchema.optional(),
    durationMs: z.number().int().gte(0),
    finishedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.status === 'completed') {
      if (!result.verification) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['verification'],
          message: 'a completed render needs the post-render file check',
        });
      }
      if (!result.outputPath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['outputPath'],
          message: 'a completed render must name the file that was verified',
        });
      }
      if (result.verification && result.outputPath && result.verification.outputPath !== result.outputPath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['outputPath'],
          message: 'the reported output is not the output that was verified',
        });
      }
      if (result.code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['code'],
          message: 'a completed render carries no error code',
        });
      }
      return;
    }

    if (result.outputPath !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outputPath'],
        message: `${result.status} cannot hand back an output file`,
      });
    }
    if (result.verification !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verification'],
        message: `${result.status} cannot carry a passed verification`,
      });
    }
    if (!result.code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: 'every result that is not completed names why',
      });
    }
  });

export type RenderResult = z.infer<typeof RenderResultSchema>;

export type RenderRequestIssue = { path: string; message: string };

export type RenderRequestParseResult =
  | { ok: true; request: RenderRequest }
  | { ok: false; code: SafeRenderCode; message: string; issues: RenderRequestIssue[] };

/**
 * Validate a request read from a socket or stdin. A wrong protocol version gets
 * its own code so the app can say "update the worker" instead of reporting a
 * dozen unrelated shape problems.
 */
export function parseRenderRequest(value: unknown): RenderRequestParseResult {
  if (
    typeof value === 'object' &&
    value !== null &&
    'protocolVersion' in value &&
    typeof (value as { protocolVersion: unknown }).protocolVersion === 'string' &&
    (value as { protocolVersion: string }).protocolVersion !== RENDER_PROTOCOL_VERSION
  ) {
    return {
      ok: false,
      code: 'UNSUPPORTED_PROTOCOL_VERSION',
      message: `the worker speaks ${RENDER_PROTOCOL_VERSION}`,
      issues: [{ path: 'protocolVersion', message: 'unsupported protocol version' }],
    };
  }

  const parsed = RenderRequestShape.safeParse(value);
  if (parsed.success) {
    return { ok: true, request: parsed.data };
  }

  return {
    ok: false,
    code: 'INVALID_REQUEST',
    message: 'the render request does not match the worker protocol',
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

export type OutputProbe = {
  outputPath: string;
  minOutputBytes: number;
  verifiedAt: string;
  exists: (path: string) => boolean;
  size: (path: string) => number;
};

export type OutputVerificationResult =
  | { ok: true; verification: RenderVerification }
  | { ok: false; code: SafeRenderCode; message: string };

/**
 * The only door to `completed`: the file has to be there, and big enough to be
 * the render the profile promised. The filesystem is injected so the rule is
 * testable without rendering anything.
 */
export function verifyRenderedOutput(probe: OutputProbe): OutputVerificationResult {
  const pathCheck = ProjectRelativePathSchema.safeParse(probe.outputPath);
  if (!pathCheck.success) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      message: 'the output path is not a project-relative file',
    };
  }

  if (!probe.exists(probe.outputPath)) {
    return { ok: false, code: 'OUTPUT_MISSING', message: 'the expected output file does not exist' };
  }

  const bytes = probe.size(probe.outputPath);
  if (!Number.isInteger(bytes) || bytes < probe.minOutputBytes) {
    return {
      ok: false,
      code: 'OUTPUT_TOO_SMALL',
      message: 'the output file is smaller than the profile quality gate',
    };
  }

  return {
    ok: true,
    verification: {
      passed: true,
      outputPath: probe.outputPath,
      outputBytes: bytes,
      verifiedAt: probe.verifiedAt,
    },
  };
}

export type BuildResultInput =
  | {
      request: RenderRequest;
      status: 'completed';
      verification: RenderVerification | null;
      durationMs: number;
      finishedAt?: string;
    }
  | {
      request: RenderRequest;
      status: Exclude<RenderStatus, 'completed'>;
      code: SafeRenderCode;
      durationMs: number;
      message?: string;
      finishedAt?: string;
    };

export type BuildResultOutput =
  | { ok: true; result: RenderResult }
  | { ok: false; code: SafeRenderCode; message: string };

/** Build a result the schema cannot misrepresent. */
export function buildRenderResult(input: BuildResultInput): BuildResultOutput {
  const fallback =
    input.status === 'completed' ? input.verification?.verifiedAt : input.request.requestedAt;
  const finishedAt = input.finishedAt ?? fallback ?? new Date().toISOString();

  const candidate: Record<string, unknown> = {
    requestId: input.request.requestId,
    protocolVersion: RENDER_PROTOCOL_VERSION,
    status: input.status,
    durationMs: input.durationMs,
    finishedAt,
  };

  if (input.status === 'completed') {
    if (!input.verification) {
      return {
        ok: false,
        code: 'VERIFICATION_REQUIRED',
        message: 'completed requires a verified output file',
      };
    }
    candidate.outputPath = input.verification.outputPath;
    candidate.verification = input.verification;
  } else {
    candidate.code = input.code;
    if (input.message !== undefined) {
      candidate.message = input.message;
    }
  }

  const parsed = RenderResultSchema.safeParse(candidate);
  if (parsed.success) {
    return { ok: true, result: parsed.data };
  }

  return {
    ok: false,
    code: 'INVALID_RESULT',
    message: parsed.error.issues[0]?.message ?? 'the worker produced an invalid result',
  };
}
