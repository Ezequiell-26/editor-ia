import {
  RENDER_PROTOCOL_VERSION,
  buildRenderResult,
  type RenderRequest,
  type RenderResult,
  type SafeRenderCode,
} from './protocol.ts';

/**
 * Capability discovery for the render worker.
 *
 * Nothing here imports FFmpeg or Remotion: the caller injects the executable
 * lookup, so the registry is testable on a machine that has neither tool. The
 * point of the indirection is honesty. A missing tool is `RENDERER_UNAVAILABLE`,
 * an unlicensed one is `RENDERER_LICENSE_UNVERIFIED`, and a tool that exists but
 * has no pipeline behind it is `RENDERER_UNIMPLEMENTED`. None of those is ever
 * reported as a finished MP4.
 */

export type RendererName = 'ffmpeg' | 'remotion';

export type ResolveExecutable = (name: RendererName) => string | null;

export interface RendererCapability {
  readonly name: RendererName;
  readonly available: boolean;
  readonly executablePath: string | null;
  readonly reason: SafeRenderCode | null;
}

export interface RenderCapabilities {
  readonly protocolVersion: string;
  readonly renderers: readonly RendererCapability[];
  readonly usableRenderer: RendererName | null;
  readonly canRender: boolean;
}

/** Remotion stays an optional adapter until its commercial-use terms are
 * checked by a human. Until then a found binary is not a usable renderer. */
export const REMOTION_LICENSE_VERIFIED = false;

/** Turning a validated project into frames is later plan work. */
export const RENDERING_IMPLEMENTED = false;

export function getRendererCapabilities(
  resolveExecutable: ResolveExecutable,
): RenderCapabilities {
  const ffmpegPath = resolveExecutable('ffmpeg');
  const remotionPath = resolveExecutable('remotion');

  const ffmpeg: RendererCapability = {
    name: 'ffmpeg',
    available: ffmpegPath !== null,
    executablePath: ffmpegPath,
    reason: ffmpegPath === null ? 'RENDERER_UNAVAILABLE' : null,
  };

  const remotion: RendererCapability = {
    name: 'remotion',
    available: remotionPath !== null && REMOTION_LICENSE_VERIFIED,
    executablePath: remotionPath,
    reason:
      remotionPath === null
        ? 'RENDERER_UNAVAILABLE'
        : REMOTION_LICENSE_VERIFIED
          ? null
          : 'RENDERER_LICENSE_UNVERIFIED',
  };

  const renderers: readonly RendererCapability[] = [ffmpeg, remotion];
  const usable = renderers.find((renderer) => renderer.available) ?? null;

  return {
    protocolVersion: RENDER_PROTOCOL_VERSION,
    renderers,
    usableRenderer: usable?.name ?? null,
    canRender: usable !== null && RENDERING_IMPLEMENTED,
  };
}

export interface RequestRenderDeps {
  readonly capabilities: RenderCapabilities;
  readonly projectFileExists: boolean;
}

function terminal(
  request: RenderRequest,
  status: 'failed' | 'unsupported',
  code: SafeRenderCode,
  message: string,
): RenderResult {
  const built = buildRenderResult({ request, status, code, durationMs: 0, message });
  if (!built.ok) {
    throw new Error(`the worker built an invalid result: ${built.message}`);
  }
  return built.result;
}

/**
 * Answer a valid request without pretending to render. This is the whole of
 * task 5: the boundary that lets task 6 wire a UI and a later plan wire a real
 * pipeline without either one inventing a success value.
 */
export function requestRender(request: RenderRequest, deps: RequestRenderDeps): RenderResult {
  if (!deps.projectFileExists) {
    return terminal(
      request,
      'failed',
      'PROJECT_FILE_MISSING',
      'no project file was found at the requested project-relative path',
    );
  }

  if (deps.capabilities.usableRenderer === null) {
    return terminal(
      request,
      'unsupported',
      'RENDERER_UNAVAILABLE',
      'no usable renderer was discovered on this machine',
    );
  }

  return terminal(
    request,
    'unsupported',
    'RENDERER_UNIMPLEMENTED',
    'a renderer is installed but the render pipeline is not implemented yet',
  );
}
