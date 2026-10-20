import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyProject,
  parseProject,
  type Asset,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import type { DesktopService, ScriptPlan } from '../services/project-service';
import { addAsset, newId } from './project-actions';
import {
  ORCHESTRATOR_STORAGE_KEY,
  createOrchestratorJob,
  loadOrchestratorJobs,
  runOrchestratorJob,
  saveOrchestratorJobs,
  type JobStorage,
  type OrchestratorJob,
  type OrchestratorOptions,
} from './orchestrator';

const NOW = '2026-10-20T00:00:00.000Z';

function image(label: string, id = newId()): Asset {
  return {
    id,
    label,
    kind: 'image',
    source: { type: 'local', path: `media/${label}.png` },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080 },
  } as Asset;
}

function video(label: string, id = newId()): Asset {
  return {
    id,
    label,
    kind: 'video',
    source: { type: 'local', path: `media/${label}.mp4` },
    status: 'ready',
    integrity: { sha256: 'c'.repeat(64), bytes: 30_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames: 150, frameRate: { num: 30, den: 1 } },
  } as Asset;
}

function audio(index: number): Asset {
  return {
    id: newId(),
    label: `voz-${index}.wav`,
    kind: 'audio',
    source: { type: 'local', path: `media/voz-${index}.wav` },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 40_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'generated-locally', acquiredAt: NOW, provider: 'windows-sapi' },
    },
    media: { sampleRate: 48_000, channels: 1, durationFrames: 60 },
  } as Asset;
}

function baseProject(assets: readonly Asset[]): ProjectDocument {
  let project = createEmptyProject('Base', NOW);
  for (const asset of assets) project = addAsset(project, asset);
  return project;
}

function script(scenes: readonly { title: string; narration: string; visual: string }[]): ScriptPlan {
  return {
    title: 'Video automático',
    scenes: scenes.map((scene, index) => ({
      id: `plan-${index}`,
      order: index,
      title: scene.title,
      intent: 'explainer' as const,
      narration: scene.narration,
      visual: scene.visual,
      estimatedSeconds: 2,
    })),
    providerId: 'fake',
    model: 'fake-model',
    simulated: true,
    costDisclosed: true,
    costApproved: true,
  };
}

function options(overrides: Partial<OrchestratorOptions> = {}): OrchestratorOptions {
  return {
    brief: 'Un video de prueba sobre faros y bosques.',
    scenes: 2,
    language: 'es',
    width: 1920,
    height: 1080,
    fpsNum: 30,
    fpsDen: 1,
    outputDir: 'C:/salida',
    mediaIds: [],
    voiceProvider: 'windows-sapi',
    photoMotion: 'none',
    transitionFrames: 0,
    includeCaptions: true,
    renderVideo: false,
    generateMedia: false,
    flowKind: 'image',
    flowModel: 'Nano Banana 2',
    flowRatio: '16:9',
    flowDuration: '6s',
    approveCredits: false,
    confirmRights: true,
    ...overrides,
  };
}

interface Harness {
  readonly service: DesktopService;
  readonly calls: {
    readonly generateScript: ReturnType<typeof vi.fn>;
    readonly synthesize: ReturnType<typeof vi.fn>;
    readonly write: ReturnType<typeof vi.fn>;
    readonly render: ReturnType<typeof vi.fn>;
    readonly mcp: ReturnType<typeof vi.fn>;
    readonly importPaths: ReturnType<typeof vi.fn>;
  };
  readonly written: { project?: ProjectDocument };
}

function harness(): Harness {
  const calls = {
    generateScript: vi.fn(async () =>
      script([
        { title: 'El faro', narration: 'Un faro resiste.', visual: 'Un faro azul en el acantilado.' },
        { title: 'El bosque', narration: 'El bosque despierta.', visual: 'Abedules al amanecer.' },
      ]),
    ),
    synthesize: vi.fn(async ({ text }: { text: string }) => ({
      asset: audio(text.length),
      voice: 'fake-voice',
      provider: 'windows-sapi',
    })),
    write: vi.fn(async ({ project }: { project: ProjectDocument }) => {
      written.project = project;
      return { path: 'C:/salida/video.editoria.json', bytes: 1234, copiedAssets: 2 };
    }),
    render: vi.fn(async () => ({
      path: 'C:/salida/video.mp4',
      bytes: 98765,
      durationSeconds: 4,
      width: 1920,
      height: 1080,
    })),
    mcp: vi.fn(async (_id: string, tool: string, args: Record<string, unknown>) => {
      if (tool === 'flow_connect') return { isError: false, result: {} };
      if (tool === 'flow_generate_image') {
        const prompt = String(args.prompt ?? '');
        return {
          isError: false,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ artifacts: [{ path: `C:/flow/${prompt.slice(0, 8)}.png` }] }) }],
          },
        };
      }
      return { isError: true, result: {} };
    }),
    importPaths: vi.fn(async ({ paths }: { paths: string[] }) => ({
      assets: [image(`flow-${paths[0]?.split('/').pop() ?? 'x'}`.replace(/\.png$/, ''), newId())],
      warnings: [],
    })),
  };
  const written: { project?: ProjectDocument } = {};
  const service = {
    generateScript: calls.generateScript,
    synthesizeNarration: calls.synthesize,
    writeProjectVariant: calls.write,
    renderProjectVariant: calls.render,
    callMcpTool: calls.mcp,
    importMediaPaths: calls.importPaths,
  } as unknown as DesktopService;
  return { service, calls, written };
}

function jobWith(input: ReturnType<typeof options>, name = 'Autopiloto'): OrchestratorJob {
  return createOrchestratorJob({ name, options: input });
}

function updates(): { readonly onUpdate: (job: OrchestratorJob) => void; readonly seen: OrchestratorJob[] } {
  const seen: OrchestratorJob[] = [];
  return { onUpdate: (job) => seen.push(job), seen };
}

describe('autopiloto de contenido', () => {
  it('encadena guion, voz, montaje y escritura sin generar medios externos', async () => {
    const imageAsset = image('001-faro');
    const videoAsset = video('002-bosque');
    const base = baseProject([imageAsset, videoAsset]);
    const run = harness();
    const tracker = updates();
    const job = jobWith(
      options({ mediaIds: [imageAsset.id, videoAsset.id], renderVideo: false }),
    );

    const final = await runOrchestratorJob(job, {
      service: run.service,
      baseProject: base,
      onUpdate: tracker.onUpdate,
    });

    expect(final.status).toBe('done');
    expect(final.stage).toBe('done');
    expect(final.progress).toBe(1);
    expect(final.error).toBeUndefined();
    expect(final.projectPath).toBe('C:/salida/video.editoria.json');
    expect(final.result?.clipCount).toBe(4);
    expect(final.result?.captionCount).toBeGreaterThanOrEqual(2);
    expect(run.calls.generateScript).toHaveBeenCalledTimes(1);
    expect(run.calls.synthesize).toHaveBeenCalledTimes(2);
    expect(run.calls.write).toHaveBeenCalledTimes(1);
    expect(run.written.project).toBeDefined();
    const parsed = parseProject(run.written.project!);
    expect(parsed.ok).toBe(true);
    expect(final.log.some((entry) => entry.level === 'error')).toBe(false);
    expect(tracker.seen.some((seen) => seen.stage === 'assemble')).toBe(true);
  });

  it('genera un medio por escena con Flow y lo asigna a su escena', async () => {
    const run = harness();
    const job = jobWith(
      options({
        mediaIds: [],
        generateMedia: true,
        approveCredits: true,
        flowServerId: 'flow-server',
        flowKind: 'image',
      }),
    );
    const tracker = updates();

    const final = await runOrchestratorJob(job, {
      service: run.service,
      baseProject: baseProject([]),
      onUpdate: tracker.onUpdate,
    });

    expect(final.status).toBe('done');
    expect(final.cost.generations).toBe(2);
    expect(final.cost.creditsApproved).toBe(true);
    expect(run.calls.mcp.mock.calls[0]?.[1]).toBe('flow_connect');
    expect(run.calls.mcp.mock.calls.filter((call) => call[1] === 'flow_generate_image')).toHaveLength(2);
    expect(run.calls.importPaths).toHaveBeenCalledTimes(2);
    const written = run.written.project!;
    expect(written.scenes).toHaveLength(2);
    for (const scene of written.scenes) {
      const clipId = scene.clipIds[0];
      const clip = written.timeline.clips.find((item) => item.id === clipId);
      expect(clip?.kind).toBe('image');
    }
    expect(parseProject(written).ok).toBe(true);
  });

  it('se niega a gastar créditos sin autorización explícita', async () => {
    const run = harness();
    const job = jobWith(
      options({ generateMedia: true, approveCredits: false, flowServerId: 'flow-server' }),
    );

    const final = await runOrchestratorJob(job, {
      service: run.service,
      baseProject: baseProject([]),
      onUpdate: () => {},
    });

    expect(final.status).toBe('error');
    expect(final.error).toMatch(/créditos/i);
    expect(final.cost.generations).toBe(0);
    expect(run.calls.generateScript).not.toHaveBeenCalled();
  });

  it('cancela entre etapas sin escribir nada', async () => {
    const run = harness();
    const job = jobWith(options({ mediaIds: [] }));

    const final = await runOrchestratorJob(job, {
      service: run.service,
      baseProject: baseProject([]),
      onUpdate: () => {},
      shouldCancel: () => true,
    });

    expect(final.status).toBe('cancelled');
    expect(run.calls.generateScript).not.toHaveBeenCalled();
    expect(run.calls.write).not.toHaveBeenCalled();
  });

  it('reanuda sólo el render de un proyecto ya escrito', async () => {
    const run = harness();
    const job: OrchestratorJob = {
      ...jobWith(options({ renderVideo: true }), 'Reanudable'),
      projectPath: 'C:/salida/ya-escrito.editoria.json',
      profileId: 'perfil-1',
      status: 'error',
      error: 'falló el render',
    };

    const final = await runOrchestratorJob(
      job,
      { service: run.service, baseProject: baseProject([]), onUpdate: () => {} },
      { stage: 'render' },
    );

    expect(final.status).toBe('done');
    expect(final.videoPath).toBe('C:/salida/video.mp4');
    expect(final.videoBytes).toBe(98765);
    expect(run.calls.generateScript).not.toHaveBeenCalled();
    expect(run.calls.render).toHaveBeenCalledTimes(1);
  });
});

describe('ledger persistente de trabajos', () => {
  function memoryStorage(): JobStorage & { value: string | null } {
    return {
      value: null,
      getItem(key: string) {
        return key === ORCHESTRATOR_STORAGE_KEY ? this.value : null;
      },
      setItem(key: string, value: string) {
        if (key === ORCHESTRATOR_STORAGE_KEY) this.value = value;
      },
    };
  }

  it('guarda, carga y descarta entradas inválidas', () => {
    const storage = memoryStorage();
    const first = jobWith(options());
    const second = { ...jobWith(options()), id: 'otro', status: 'done' as const };

    saveOrchestratorJobs([first, second], storage);
    expect(loadOrchestratorJobs(storage).map((job) => job.id)).toEqual([first.id, 'otro']);

    storage.setItem(ORCHESTRATOR_STORAGE_KEY, JSON.stringify([{ schema: 'malo' }, first]));
    expect(loadOrchestratorJobs(storage).map((job) => job.id)).toEqual([first.id]);
  });

  it('devuelve una lista vacía si el JSON está corrupto', () => {
    const storage = memoryStorage();
    storage.setItem(ORCHESTRATOR_STORAGE_KEY, '{no es json');
    expect(loadOrchestratorJobs(storage)).toEqual([]);
  });
});
