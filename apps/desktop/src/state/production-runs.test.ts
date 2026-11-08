import { describe, expect, it } from 'vitest';
import type { ProductionRun, StageRecord } from '../services/contracts/studio';
import type { StudioStage } from '@editor-ia/project-schema';
import { advanceProductionRun } from './production-runs';

const STAGES: readonly StudioStage[] = [
  'plan',
  'acquire',
  'analyze',
  'scenes',
  'edit',
  'render',
  'review',
  'deliver',
];

function makeRun(overrides: Partial<ProductionRun> = {}): ProductionRun {
  return {
    id: 'run-1',
    planId: 'plan-1',
    plan: {} as ProductionRun['plan'],
    status: 'running',
    currentStage: 'plan',
    stages: STAGES.map(
      (stage): StageRecord => ({ stage, status: 'pending' }),
    ),
    spentCents: 0,
    maxStageAttempts: 3,
    resumes: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Avanza una etapa por llamada hasta `done`. */
function sequentialService() {
  let step = 0;
  const run = makeRun({ status: 'planned' });
  const status = async () => run;
  const advance = async () => {
    step += 1;
    if (step >= STAGES.length) {
      return makeRun({ ...run, status: 'done', currentStage: 'deliver' });
    }
    const stage = STAGES[step] ?? 'deliver';
    return makeRun({
      ...run,
      status: 'running',
      currentStage: stage,
      stages: STAGES.map((item, index) => ({
        stage: item,
        status: index < step ? 'done' : index === step ? 'running' : 'pending',
      })),
    });
  };
  return { status, advance, steps: () => step };
}

describe('advanceProductionRun', () => {
  it('avanza etapa por etapa hasta done', async () => {
    const svc = sequentialService();
    const updates: ProductionRun[] = [];
    const final = await advanceProductionRun(
      { productionStatus: svc.status, productionAdvance: svc.advance },
      'run-1',
      { pollMs: 1, onUpdate: (run) => updates.push(run) },
    );
    expect(final.status).toBe('done');
    expect(svc.steps()).toBe(STAGES.length);
    expect(updates.length).toBeGreaterThan(0);
  });

  it('sondea una etapa running sin gastar advances', async () => {
    let polls = 0;
    const svc = sequentialService();
    const status = async () => {
      polls += 1;
      // Primer sondeo devuelve running; segundo devuelve done.
      if (polls === 1) {
        return makeRun({
          status: 'running',
          currentStage: 'render',
          stages: STAGES.map((stage) => ({
            stage,
            status: stage === 'render' ? 'running' : stage < 'render' ? 'done' : 'pending',
          })),
        });
      }
      return makeRun({ status: 'done', currentStage: 'deliver' });
    };
    const before = svc.steps();
    const final = await advanceProductionRun(
      { productionStatus: status, productionAdvance: svc.advance },
      'run-1',
      { pollMs: 1 },
    );
    expect(final.status).toBe('done');
    expect(svc.steps()).toBe(before);
  });

  it('se detiene con shouldStop', async () => {
    const svc = sequentialService();
    let calls = 0;
    const status = async () => {
      calls += 1;
      return makeRun({ status: calls > 3 ? 'running' : 'planned' });
    };
    const final = await advanceProductionRun(
      { productionStatus: status, productionAdvance: svc.advance },
      'run-1',
      { pollMs: 1, shouldStop: () => calls > 4 },
    );
    expect(final.status).not.toBe('done');
  });

  it('devuelve la corrida si ya está en estado terminal', async () => {
    const svc = sequentialService();
    const final = await advanceProductionRun(
      {
        productionStatus: async () => makeRun({ status: 'failed', lastError: 'x' }),
        productionAdvance: svc.advance,
      },
      'run-1',
      { pollMs: 1 },
    );
    expect(final.status).toBe('failed');
    expect(svc.steps()).toBe(0);
  });
});
