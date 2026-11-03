import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import type { DesktopService } from '../services/project-service';
import {
  createOrchestratorJob,
  saveOrchestratorJobs,
  type JobStorage,
  type OrchestratorDeps,
  type OrchestratorJob,
  type OrchestratorOptions,
} from './orchestrator';
import { McpOrchestratorJobManager } from './mcp-orchestrator-jobs';

class MemoryStorage implements JobStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function options(): OrchestratorOptions {
  return {
    brief: 'Un vídeo de prueba sobre un faro y un bosque.',
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
    flowModel: '',
    flowRatio: '',
    flowDuration: '',
    approveCredits: false,
    confirmRights: true,
  };
}

function makeJob(name: string): OrchestratorJob {
  return createOrchestratorJob({ name, options: options() });
}

function deps(shouldCancel?: () => boolean): OrchestratorDeps {
  return {
    service: {} as DesktopService,
    baseProject: createEmptyProject('base'),
    onUpdate: () => {},
    ...(shouldCancel ? { shouldCancel } : {}),
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('cola de trabajos MCP', () => {
  it('ejecuta FIFO con una sola fábrica y permite cancelar un trabajo pendiente', async () => {
    const storage = new MemoryStorage();
    const gate = deferred();
    const started: string[] = [];
    const runner = vi.fn(async (job: OrchestratorJob, runtime: OrchestratorDeps) => {
      started.push(job.id);
      await gate.promise;
      return {
        ...job,
        status: runtime.shouldCancel?.() ? 'cancelled' as const : 'done' as const,
        stage: 'done' as const,
        progress: 1,
        updatedAt: new Date().toISOString(),
      };
    });
    const manager = new McpOrchestratorJobManager({ storage, runner, maxConcurrent: 4 });
    const first = manager.start(makeJob('Primero'), deps(), undefined, 'ui');
    const second = manager.start(makeJob('Segundo'), deps());

    expect(manager.status(first.id)?.source).toBe('ui');
    expect(manager.status(second.id)?.source).toBe('mcp');

    expect(manager.status(first.id)?.status).toBe('running');
    expect(manager.status(second.id)?.status).toBe('queued');
    expect(started).toEqual([first.id]);
    expect(runner).toHaveBeenCalledTimes(1);

    expect(manager.cancel(second.id)).toMatchObject({
      accepted: true,
      jobId: second.id,
      status: 'cancelled',
      cooperative: true,
    });
    expect(manager.status(second.id)?.status).toBe('cancelled');

    gate.resolve();
    await vi.waitFor(() => {
      expect(manager.status(first.id)?.status).toBe('done');
    });
    expect(started).toEqual([first.id]);
  });

  it('solicita cancelación cooperativa del trabajo que está ejecutándose', async () => {
    const storage = new MemoryStorage();
    const gate = deferred();
    const runner = vi.fn(async (job: OrchestratorJob, runtime: OrchestratorDeps) => {
      await gate.promise;
      return {
        ...job,
        status: runtime.shouldCancel?.() ? 'cancelled' as const : 'done' as const,
        stage: 'done' as const,
        progress: 1,
        updatedAt: new Date().toISOString(),
      };
    });
    const manager = new McpOrchestratorJobManager({ storage, runner });
    const job = manager.start(makeJob('Cancelación'), deps(), undefined, 'ui');

    expect(manager.cancel(job.id)).toMatchObject({
      accepted: true,
      status: 'cancellation_requested',
      cooperative: true,
    });
    gate.resolve();
    await vi.waitFor(() => {
      expect(manager.status(job.id)?.status).toBe('cancelled');
    });
  });

  it('permite reintentar un trabajo terminal conservando el mismo ID', async () => {
    const storage = new MemoryStorage();
    const runner = vi.fn(async (job: OrchestratorJob) => ({
      ...job,
      status: 'done' as const,
      stage: 'done' as const,
      progress: 1,
      updatedAt: new Date().toISOString(),
    }));
    const manager = new McpOrchestratorJobManager({ storage, runner });
    const job = makeJob('Reintento');

    manager.start(job, deps(), undefined, 'ui');
    await vi.waitFor(() => expect(manager.status(job.id)?.status).toBe('done'));

    manager.start(job, deps(), undefined, 'mcp');
    await vi.waitFor(() => {
      expect(manager.status(job.id)?.status).toBe('done');
      expect(manager.status(job.id)?.source).toBe('mcp');
    });

    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('marca como interrumpidos los trabajos queued/running que quedaron guardados al reiniciar', () => {
    const storage = new MemoryStorage();
    const queued = { ...makeJob('Pendiente'), source: 'mcp' as const };
    const running = {
      ...makeJob('En ejecución'),
      source: 'mcp' as const,
      status: 'running' as const,
    };
    saveOrchestratorJobs([queued, running], storage);

    const manager = new McpOrchestratorJobManager({ storage });

    expect(manager.status(queued.id)).toMatchObject({ status: 'error' });
    expect(manager.status(running.id)).toMatchObject({
      status: 'error',
      error: expect.stringContaining('se cerró'),
    });
    expect(manager.list(50)).toHaveLength(2);
  });
});
