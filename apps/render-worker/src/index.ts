import { delimiter } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getRendererCapabilities,
  requestRender,
  type ResolveExecutable,
  type RendererName,
  type RunRenderer,
} from './capabilities.ts';
import { parseRenderRequest, verifyRenderedOutput, type RenderResult } from './protocol.ts';

/**
 * The worker command line.
 *
 * `--capabilities` prints what this machine can actually do. Anything else reads
 * one JSON request from stdin and prints one JSON result. A malformed request
 * exits non-zero without echoing it back, and no exit code other than 0 is ever
 * paired with a `completed` status: a caller that trusts the status and a caller
 * that trusts the exit code get the same answer.
 */

const WINDOWS_EXECUTABLE_SUFFIXES = ['.exe', '.cmd', '.bat'] as const;

export const EXIT_CODES = {
  completed: 0,
  malformedRequest: 2,
  unsupported: 3,
  failed: 4,
  cancelled: 5,
} as const;

/**
 * Look a renderer up on PATH with plain filesystem checks. No process is
 * spawned and no command string is ever built from request or model text.
 */
export function createPathResolver(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ResolveExecutable {
  const rawPath = env.PATH ?? env.Path ?? '';
  const directories = rawPath.split(delimiter).filter((entry) => entry.length > 0);
  const suffixes: readonly string[] =
    platform === 'win32' ? [...WINDOWS_EXECUTABLE_SUFFIXES, ''] : [''];

  return (name: RendererName) => {
    for (const directory of directories) {
      for (const suffix of suffixes) {
        const candidate = join(directory, `${name}${suffix}`);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  };
}

function exitCodeFor(result: RenderResult): number {
  if (result.status === 'completed') {
    return EXIT_CODES.completed;
  }
  if (result.status === 'cancelled') {
    return EXIT_CODES.cancelled;
  }
  return result.status === 'failed' ? EXIT_CODES.failed : EXIT_CODES.unsupported;
}

function readProjectRoot(argv: readonly string[]): string {
  const index = argv.indexOf('--project-root');
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value === undefined ? process.cwd() : resolve(value);
}

function readOption(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && value.length > 0 ? value : null;
}

const MIN_OUTPUT_BYTES: Record<string, number> = {
  'mp4-h264-1080p-16x9': 500_000,
  'mp4-h264-vertical-9x16': 500_000,
  'webm-vp9-1080p-16x9': 200_000,
};

function insideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolved = resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${sep}`);
}

export function runCli(
  argv: readonly string[],
  readStdin: () => string = () => readFileSync(0, 'utf8'),
): number {
  const write = (payload: unknown): void => {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  };

  if (argv.includes('--capabilities')) {
    write(getRendererCapabilities(createPathResolver()));
    return EXIT_CODES.completed;
  }

  let raw = '';
  try {
    raw = readStdin();
  } catch {
    raw = '';
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    write({
      ok: false,
      code: 'INVALID_REQUEST',
      message: 'stdin did not carry one JSON render request',
    });
    return EXIT_CODES.malformedRequest;
  }

  const parsed = parseRenderRequest(value);
  if (!parsed.ok) {
    write({
      ok: false,
      code: parsed.code,
      message: parsed.message,
      issues: parsed.issues,
    });
    return EXIT_CODES.malformedRequest;
  }

  const root = readProjectRoot(argv);
  const rendererPath = readOption(argv, '--renderer') ?? process.env.EDITOR_IA_RENDER_WORKER ?? '';
  const ffmpegPath = readOption(argv, '--ffmpeg');
  const ffprobePath = readOption(argv, '--ffprobe');
  const rendererReady = rendererPath.length > 0 && existsSync(rendererPath);
  const runRenderer: RunRenderer | undefined = rendererReady
    ? (invocation) => {
        const absoluteProject = resolve(root, invocation.request.projectPath);
        const absoluteOutput = resolve(root, invocation.request.outputPath);
        if (!insideRoot(root, absoluteProject) || !insideRoot(root, absoluteOutput)) {
          return { ok: false as const, code: 'INVALID_REQUEST' as const, message: 'project and output must stay inside --project-root' };
        }
        if (existsSync(absoluteOutput)) {
          return { ok: false as const, code: 'OUTPUT_WRITE_FAILED' as const, message: 'the output file already exists' };
        }
        const args = [
          '--project', absoluteProject,
          '--output', absoluteOutput,
          '--profile', invocation.request.profile,
        ];
        if (ffmpegPath) args.push('--ffmpeg', ffmpegPath);
        if (ffprobePath) args.push('--ffprobe', ffprobePath);
        const child = spawnSync(rendererPath, args, { encoding: 'utf8', windowsHide: true });
        let payload: { ok?: boolean; code?: string; message?: string; bytes?: number; durationSeconds?: number } = {};
        try {
          payload = JSON.parse(String(child.stdout ?? '').trim() || '{}');
        } catch {
          payload = {};
        }
        if (child.status === 0 && payload.ok === true && typeof payload.bytes === 'number') {
          return { ok: true as const, bytes: payload.bytes, durationSeconds: payload.durationSeconds ?? 0 };
        }
        const code =
          payload.code === 'PROJECT_FILE_MISSING' || payload.code === 'INVALID_REQUEST' || payload.code === 'RENDERER_UNAVAILABLE' || payload.code === 'OUTPUT_TOO_SMALL'
            ? payload.code
            : 'OUTPUT_WRITE_FAILED';
        return { ok: false as const, code, message: payload.message ?? 'the renderer did not produce an output' };
      }
    : undefined;
  const verifyOutput = (relativePath: string) =>
    verifyRenderedOutput({
      outputPath: relativePath,
      minOutputBytes: MIN_OUTPUT_BYTES[parsed.request.profile] ?? 500_000,
      verifiedAt: new Date().toISOString(),
      exists: (path) => insideRoot(root, resolve(root, path)) && existsSync(resolve(root, path)),
      size: (path) => {
        try {
          return statSync(resolve(root, path)).size;
        } catch {
          return 0;
        }
      },
    });
  const result = requestRender(parsed.request, {
    capabilities: getRendererCapabilities(createPathResolver()),
    projectFileExists: existsSync(join(root, parsed.request.projectPath)),
    ...(runRenderer ? { runRenderer } : {}),
    verifyOutput,
  });

  write(result);
  return exitCodeFor(result);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
