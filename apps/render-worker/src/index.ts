import { delimiter } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getRendererCapabilities,
  requestRender,
  type ResolveExecutable,
  type RendererName,
} from './capabilities.ts';
import { parseRenderRequest, type RenderResult } from './protocol.ts';

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
  const result = requestRender(parsed.request, {
    capabilities: getRendererCapabilities(createPathResolver()),
    projectFileExists: existsSync(join(root, parsed.request.projectPath)),
  });

  write(result);
  return exitCodeFor(result);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
