import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RENDER_PROTOCOL_VERSION,
  RENDER_PROFILES,
  RenderResultSchema,
  buildRenderResult,
  parseRenderRequest,
  verifyRenderedOutput,
  type RenderRequest,
} from './protocol.ts';
import { getRendererCapabilities, requestRender } from './capabilities.ts';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const VALID_REQUEST: RenderRequest = {
  requestId: '3f0c1a97-2f64-4d31-9a1c-7e5f2c1b0a4d',
  protocolVersion: RENDER_PROTOCOL_VERSION,
  projectPath: 'proyecto.editoria.json',
  outputPath: 'out/vertical.mp4',
  profile: 'mp4-h264-vertical-9x16',
  requestedAt: '2026-10-18T20:00:00.000Z',
};

function requestWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...VALID_REQUEST, ...overrides };
}

function codeOf(result: ReturnType<typeof parseRenderRequest>): string {
  expect(result.ok, 'se esperaba un rechazo').toBe(false);
  if (result.ok) {
    throw new Error('unreachable');
  }
  return result.code;
}

const MISSING_FILE = { exists: () => false, size: () => 0 };
const EMPTY_FILE = { exists: () => true, size: () => 0 };
const REAL_FILE = { exists: () => true, size: () => 4_000_000 };

const VERIFIED = verifyRenderedOutput({
  outputPath: VALID_REQUEST.outputPath,
  minOutputBytes: 1_000_000,
  verifiedAt: '2026-10-18T20:03:12.000Z',
  ...REAL_FILE,
});

function usableRenderer(available: boolean): (name: string) => string | null {
  return (name: string) => (available ? `C:\\tools\\${name}.exe` : null);
}

describe('RenderRequest', () => {
  it('acepta un pedido bien formado', () => {
    expect(RENDER_PROFILES).toContain(VALID_REQUEST.profile);
    const parsed = parseRenderRequest(VALID_REQUEST);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.request.outputPath).toBe('out/vertical.mp4');
    }
  });

  it('rechaza una version de protocolo desconocida con su propio codigo', () => {
    const parsed = parseRenderRequest(requestWith({ protocolVersion: 'editor-ia.render/2' }));
    expect(codeOf(parsed)).toBe('UNSUPPORTED_PROTOCOL_VERSION');
  });

  it('rechaza un perfil que no esta en la lista permitida', () => {
    const parsed = parseRenderRequest(requestWith({ profile: 'ultra-4k-no-existe' }));
    expect(codeOf(parsed)).toBe('INVALID_REQUEST');
    if (!parsed.ok) {
      expect(parsed.issues.map((issue) => issue.path)).toContain('profile');
    }
  });

  it('rechaza rutas absolutas, con escape, con backslash o de home', () => {
    for (const bad of ['../escape.editoria.json', '/abs/p.mp4', 'C:\\x\\p.mp4', 'a\\b.mp4', '~/home.mp4']) {
      expect(
        codeOf(parseRenderRequest(requestWith({ outputPath: bad }))),
        `la ruta ${bad} deberia rechazarse`,
      ).toBe('INVALID_REQUEST');
    }
  });

  it('rechaza claves de mas, incluso si parecen una credencial, sin reproducir el valor', () => {
    const parsed = parseRenderRequest(requestWith({ apiKey: 'sk-SECRET-no-debe-salir' }));
    expect(codeOf(parsed)).toBe('INVALID_REQUEST');
    if (!parsed.ok) {
      expect(JSON.stringify(parsed)).not.toContain('sk-SECRET-no-debe-salir');
    }
  });

  it('rechaza un requestId que no es uuid v4', () => {
    expect(codeOf(parseRenderRequest(requestWith({ requestId: 'pedido-1' })))).toBe('INVALID_REQUEST');
  });
});

describe('RenderResult', () => {
  it('no permite completed sin verificacion post-render', () => {
    expect(
      RenderResultSchema.safeParse({
        requestId: VALID_REQUEST.requestId,
        protocolVersion: RENDER_PROTOCOL_VERSION,
        status: 'completed',
        outputPath: 'out/vertical.mp4',
        durationMs: 1200,
        finishedAt: '2026-10-18T20:03:12.000Z',
      }).success,
    ).toBe(false);
  });

  it('no permite completed si la verificacion apunta a otra ruta', () => {
    expect(
      RenderResultSchema.safeParse({
        requestId: VALID_REQUEST.requestId,
        protocolVersion: RENDER_PROTOCOL_VERSION,
        status: 'completed',
        outputPath: 'out/otro.mp4',
        durationMs: 1200,
        finishedAt: '2026-10-18T20:03:12.000Z',
        verification: {
          passed: true,
          outputPath: 'out/vertical.mp4',
          outputBytes: 4_000_000,
          verifiedAt: '2026-10-18T20:03:12.000Z',
        },
      }).success,
    ).toBe(false);
  });

  it('no permite un estado terminal falso con ruta de salida', () => {
    for (const status of ['failed', 'cancelled', 'unsupported']) {
      expect(
        RenderResultSchema.safeParse({
          requestId: VALID_REQUEST.requestId,
          protocolVersion: RENDER_PROTOCOL_VERSION,
          status,
          code: 'RENDERER_UNAVAILABLE',
          outputPath: 'out/vertical.mp4',
          durationMs: 12,
          finishedAt: '2026-10-18T20:03:12.000Z',
        }).success,
        `${status} no puede llevar outputPath`,
      ).toBe(false);
    }
  });

  it('exige un codigo seguro en todo estado que no es completed', () => {
    expect(
      RenderResultSchema.safeParse({
        requestId: VALID_REQUEST.requestId,
        protocolVersion: RENDER_PROTOCOL_VERSION,
        status: 'unsupported',
        durationMs: 12,
        finishedAt: '2026-10-18T20:03:12.000Z',
      }).success,
    ).toBe(false);
  });

  it('acepta completed solo con verificacion coherente y bytes reales', () => {
    expect(VERIFIED.ok).toBe(true);
    const built = buildRenderResult({
      request: VALID_REQUEST,
      status: 'completed',
      verification: VERIFIED.ok ? VERIFIED.verification : null,
      durationMs: 1200,
    });
    expect(built.ok, built.ok ? '' : built.message).toBe(true);
  });

  it('buildRenderResult se niega a fabricar un completed', () => {
    const built = buildRenderResult({
      request: VALID_REQUEST,
      status: 'completed',
      verification: null,
      durationMs: 1200,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.code).toBe('VERIFICATION_REQUIRED');
    }
  });

  it('verifyRenderedOutput distingue archivo ausente, vacio y real', () => {
    const missing = verifyRenderedOutput({
      outputPath: 'out/vertical.mp4',
      minOutputBytes: 1,
      verifiedAt: '2026-10-18T20:03:12.000Z',
      ...MISSING_FILE,
    });
    expect(!missing.ok && missing.code).toBe('OUTPUT_MISSING');

    const empty = verifyRenderedOutput({
      outputPath: 'out/vertical.mp4',
      minOutputBytes: 1_000_000,
      verifiedAt: '2026-10-18T20:03:12.000Z',
      ...EMPTY_FILE,
    });
    expect(!empty.ok && empty.code).toBe('OUTPUT_TOO_SMALL');
  });
});

describe('descubrimiento honesto de capacidades', () => {
  it('ffmpeg ausente reporta unsupported, jamas completed ni ruta de salida', () => {
    const capabilities = getRendererCapabilities(usableRenderer(false));
    expect(capabilities.canRender).toBe(false);
    const ffmpeg = capabilities.renderers.find((renderer) => renderer.name === 'ffmpeg');
    expect(ffmpeg?.available).toBe(false);
    expect(ffmpeg?.reason).toBe('RENDERER_UNAVAILABLE');

    const result = requestRender(VALID_REQUEST, { capabilities, projectFileExists: true });
    expect(result.status).toBe('unsupported');
    expect(result.code).toBe('RENDERER_UNAVAILABLE');
    expect(result.outputPath).toBeUndefined();
  });

  it('con ffmpeg disponible sigue sin claimar un render que no esta implementado', () => {
    const capabilities = getRendererCapabilities(usableRenderer(true));
    expect(capabilities.usableRenderer).toBe('ffmpeg');
    expect(capabilities.canRender).toBe(false);
    const result = requestRender(VALID_REQUEST, { capabilities, projectFileExists: true });
    expect(result.status).toBe('unsupported');
    expect(result.code).toBe('RENDERER_UNIMPLEMENTED');
    expect(result.outputPath).toBeUndefined();
  });

  it('remotion sin licencia verificada no queda disponible aunque el binario exista', () => {
    const capabilities = getRendererCapabilities(usableRenderer(true));
    const remotion = capabilities.renderers.find((renderer) => renderer.name === 'remotion');
    expect(remotion?.available).toBe(false);
    expect(remotion?.reason).toBe('RENDERER_LICENSE_UNVERIFIED');
  });

  it('un pedido con el proyecto ausente es failed con codigo, no un exito', () => {
    const capabilities = getRendererCapabilities(usableRenderer(true));
    const result = requestRender(VALID_REQUEST, { capabilities, projectFileExists: false });
    expect(result.status).toBe('failed');
    expect(result.code).toBe('PROJECT_FILE_MISSING');
    expect(result.outputPath).toBeUndefined();
    expect(RenderResultSchema.safeParse(result).success).toBe(true);
  });
});

describe('CLI del worker', () => {
  function run(args: string[], input?: string): { status: number | null; stdout: string } {
    const probe = spawnSync(process.execPath, ['--experimental-strip-types', ...args], {
      cwd: workerRoot,
      encoding: 'utf8',
      input,
      timeout: 120_000,
    });
    return { status: probe.status, stdout: probe.stdout ?? '' };
  }

  it('--capabilities sale en cero y lista los dos renderes', () => {
    const out = run([join(workerRoot, 'src', 'index.ts'), '--capabilities']);
    expect(out.stdout).toContain('"renderers"');
    expect(out.stdout).toContain('ffmpeg');
    expect(out.stdout).toContain('remotion');
    expect(out.status).toBe(0);
  });

  it('un pedido malformado sale con codigo distinto de cero y no informa completed', () => {
    const out = run([join(workerRoot, 'src', 'index.ts')], '{"profile":"no-existe"}');
    expect(out.status).not.toBe(0);
    expect(out.stdout).not.toContain('completed');
  });

  it('un pedido valido contra un proyecto que no esta en disco es failed, nunca completed', () => {
    const out = run([join(workerRoot, 'src', 'index.ts')], JSON.stringify(VALID_REQUEST));
    expect(out.stdout).toContain('PROJECT_FILE_MISSING');
    expect(out.stdout).not.toContain('"completed"');
    expect(out.status).toBe(4);
  });

  it('un pedido valido contra un proyecto real responde unsupported por el renderizador', () => {
    const root = join(workerRoot, 'dist', 'cli-probe');
    mkdirSync(root, { recursive: true });
    try {
      writeFileSync(join(root, VALID_REQUEST.projectPath), '{}\n');
      const out = run(
        [join(workerRoot, 'src', 'index.ts'), '--project-root', root],
        JSON.stringify(VALID_REQUEST),
      );
      expect(out.stdout).toContain('unsupported');
      expect(out.stdout).not.toContain('"completed"');
      expect(out.status).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
