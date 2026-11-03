import {
  loadOrchestratorJobs,
  saveOrchestratorJobs,
  upsertOrchestratorJob,
  type JobStorage,
  type OrchestratorDeps,
  type OrchestratorJob,
  type OrchestratorResume,
  runOrchestratorJob,
} from './orchestrator';

export const MCP_ORCHESTRATOR_JOBS_UPDATED = 'olyvia:orchestrator:jobs-updated';
export const MCP_ORCHESTRATOR_MAX_CONCURRENT = 1;
export const MCP_ORCHESTRATOR_MAX_PENDING = 10;

type JobRunner = (
  job: OrchestratorJob,
  deps: OrchestratorDeps,
  resume?: OrchestratorResume,
) => Promise<OrchestratorJob>;

interface QueueEntry {
  job: OrchestratorJob;
  deps: OrchestratorDeps;
  resume?: OrchestratorResume;
  cancelRequested: boolean;
  queued: boolean;
}

export interface McpJobCancellation {
  readonly accepted: boolean;
  readonly jobId: string;
  readonly status: 'cancelled' | 'cancellation_requested' | 'not_found' | 'already_finished';
  readonly cooperative: boolean;
}

/**
 * Cola de fábrica compartida por MCP y la interfaz.
 * Una sola fábrica puede usar guion/voz/Flow/render a la vez para proteger RAM.
 * Los estados se escriben en el mismo registro persistente que usa Autopiloto.
 */
export class McpOrchestratorJobManager {
  private readonly storage: JobStorage | undefined;
  private readonly runner: JobRunner;
  private readonly maxConcurrent: number;
  private readonly queue: string[] = [];
  private readonly controls = new Map<string, QueueEntry>();
  private readonly memoryJobs = new Map<string, OrchestratorJob>();
  private pumping = false;
  private running = 0;

  constructor(options: {
    storage?: JobStorage;
    runner?: JobRunner;
    maxConcurrent?: number;
  } = {}) {
    this.storage = options.storage;
    this.runner = options.runner ?? runOrchestratorJob;
    this.maxConcurrent = Math.max(
      1,
      Math.min(MCP_ORCHESTRATOR_MAX_CONCURRENT, Math.floor(options.maxConcurrent ?? MCP_ORCHESTRATOR_MAX_CONCURRENT)),
    );
    this.recoverInterruptedJobs();
  }

  private allJobs(): OrchestratorJob[] {
    const merged = new Map<string, OrchestratorJob>();
    for (const job of loadOrchestratorJobs(this.storage)) merged.set(job.id, job);
    for (const job of this.memoryJobs.values()) {
      const previous = merged.get(job.id);
      if (!previous || job.updatedAt >= previous.updatedAt) merged.set(job.id, job);
    }
    return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private persist(job: OrchestratorJob): void {
    this.memoryJobs.set(job.id, job);
    const next = upsertOrchestratorJob(this.allJobs(), job)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(-50);
    saveOrchestratorJobs(next, this.storage);
    const retained = new Set(next.map((item) => item.id));
    for (const id of this.memoryJobs.keys()) {
      if (!retained.has(id)) this.memoryJobs.delete(id);
    }
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(MCP_ORCHESTRATOR_JOBS_UPDATED));
      }
    } catch {
      // La cola sigue funcionando en memoria si no hay un runtime DOM.
    }
  }

  private recoverInterruptedJobs(): void {
    const jobs = loadOrchestratorJobs(this.storage);
    let changed = false;
    const recovered = jobs.map((job) => {
      if (job.status !== 'queued' && job.status !== 'running') return job;
      changed = true;
      return {
        ...job,
        status: 'error' as const,
        error: 'La aplicación se cerró antes de completar este trabajo. Inícialo de nuevo o reintenta el render si ya existe el proyecto.',
        updatedAt: new Date().toISOString(),
        log: [
          ...job.log,
          {
            at: new Date().toISOString(),
            level: 'error' as const,
            message: 'Trabajo interrumpido al cerrar o reiniciar Olyvia.',
          },
        ].slice(-200),
      };
    });
    if (changed) {
      saveOrchestratorJobs(recovered, this.storage);
    }
    for (const job of recovered) this.memoryJobs.set(job.id, job);
  }

  start(
    job: OrchestratorJob,
    deps: OrchestratorDeps,
    resume?: OrchestratorResume,
    source: 'mcp' | 'ui' = 'mcp',
  ): OrchestratorJob {
    const existing = this.allJobs();
    const externalActive = existing.find(
      (item) =>
        (item.status === 'queued' || item.status === 'running') &&
        !this.controls.has(item.id),
    );
    if (externalActive) {
      throw new Error('ya hay otro trabajo de fábrica activo; esperá a que termine');
    }
    const activeCount = existing.filter(
      (item) => item.status === 'queued' || item.status === 'running',
    ).length;
    if (activeCount >= MCP_ORCHESTRATOR_MAX_PENDING) {
      throw new Error('la cola de fábrica alcanzó el límite de 10 trabajos pendientes');
    }
    const previous = existing.find((item) => item.id === job.id);
    if (
      this.controls.has(job.id) ||
      previous?.status === 'queued' ||
      previous?.status === 'running'
    ) {
      throw new Error('ya existe un trabajo activo con ese identificador');
    }

    const queued: OrchestratorJob = {
      ...job,
      source,
      status: 'queued',
      updatedAt: new Date().toISOString(),
    };
    this.controls.set(job.id, {
      job: queued,
      deps,
      ...(resume ? { resume } : {}),
      cancelRequested: false,
      queued: true,
    });
    this.queue.push(job.id);
    this.persist(queued);
    void this.pump();
    return queued;
  }

  status(jobId: string): OrchestratorJob | null {
    return this.allJobs().find((job) => job.id === jobId) ?? null;
  }

  list(limit = 20): OrchestratorJob[] {
    const bounded = Math.max(1, Math.min(50, Math.floor(Number.isFinite(limit) ? limit : 20)));
    return this.allJobs().slice(0, bounded);
  }

  cancel(jobId: string): McpJobCancellation {
    const entry = this.controls.get(jobId);
    if (!entry) {
      const saved = this.status(jobId);
      return {
        accepted: false,
        jobId,
        status: saved ? 'already_finished' : 'not_found',
        cooperative: true,
      };
    }

    entry.cancelRequested = true;
    if (!entry.queued) {
      entry.job = {
        ...entry.job,
        cancelRequested: true,
        updatedAt: new Date().toISOString(),
      };
      this.persist(entry.job);
    }
    if (entry.queued) {
      const index = this.queue.indexOf(jobId);
      if (index >= 0) this.queue.splice(index, 1);
      entry.queued = false;
      const cancelled: OrchestratorJob = {
        ...entry.job,
        status: 'cancelled',
        stage: 'done',
        progress: 1,
        cancelRequested: true,
        updatedAt: new Date().toISOString(),
        log: [
          ...entry.job.log,
          {
            at: new Date().toISOString(),
            level: 'warn' as const,
            message: 'Trabajo cancelado antes de comenzar.',
          },
        ].slice(-200),
      };
      entry.job = cancelled;
      this.persist(cancelled);
      this.controls.delete(jobId);
      return { accepted: true, jobId, status: 'cancelled', cooperative: true };
    }

    return {
      accepted: true,
      jobId,
      status: 'cancellation_requested',
      cooperative: true,
    };
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.running < this.maxConcurrent && this.queue.length > 0) {
        const id = this.queue.shift();
        if (!id) continue;
        const entry = this.controls.get(id);
        if (!entry || entry.cancelRequested) continue;

        entry.queued = false;
        this.running += 1;
        const running: OrchestratorJob = {
          ...entry.job,
          status: 'running',
          updatedAt: new Date().toISOString(),
        };
        entry.job = running;
        this.persist(running);

        try {
          const final = await this.runner(
            running,
            {
              ...entry.deps,
              onUpdate: (updated) => {
                const snapshot = entry.cancelRequested
                  ? { ...updated, cancelRequested: true }
                  : updated;
                entry.job = snapshot;
                this.persist(snapshot);
                entry.deps.onUpdate(snapshot);
              },
              shouldCancel: () =>
                entry.cancelRequested || Boolean(entry.deps.shouldCancel?.()),
            },
            entry.resume,
          );
          const snapshot = entry.cancelRequested
            ? { ...final, cancelRequested: true }
            : final;
          entry.job = snapshot;
          this.persist(snapshot);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'el trabajo falló';
          const failed: OrchestratorJob = {
            ...entry.job,
            status: 'error',
            error: message,
            updatedAt: new Date().toISOString(),
            log: [
              ...entry.job.log,
              { at: new Date().toISOString(), level: 'error' as const, message: message.slice(0, 500) },
            ].slice(-200),
          };
          entry.job = failed;
          this.persist(failed);
        } finally {
          this.controls.delete(id);
          this.running = Math.max(0, this.running - 1);
        }
      }
    } finally {
      this.pumping = false;
      if (this.running < this.maxConcurrent && this.queue.length > 0) {
        void this.pump();
      }
    }
  }
}


/** Gestor único compartido por el panel de Autopiloto y los clientes MCP. */
export const FACTORY_JOB_MANAGER = new McpOrchestratorJobManager();
