import type { DesktopService } from '../services/contracts/service';
import type { ProductionRun } from '../services/contracts/studio';

export interface AdvanceOptions {
  /** Espera entre sondeos de una etapa async (render). Default 1500 ms. */
  readonly pollMs?: number;
  /** Tope de llamadas a `advance`+sondeos. Default 60. */
  readonly maxSteps?: number;
  /** Permite cancelar el bucle desde la UI. */
  readonly shouldStop?: () => boolean;
  /** Hook por iteración para actualizar la UI. */
  readonly onUpdate?: (run: ProductionRun) => void;
}

const TERMINAL = new Set<ProductionRun['status']>(['done', 'cancelled', 'failed']);

/**
 * Ejecuta la corrida hasta estado terminal: cada iteración llama
 * `production_advance` (una etapa) y, si la etapa quedó `running` (render
 * async), sondea con `production_status` hasta que cierre. Nunca inventa
 * progreso: si el backend falla, la corrida queda `failed` y se devuelve.
 */
export async function advanceProductionRun(
  service: Pick<DesktopService, 'productionAdvance' | 'productionStatus'>,
  runId: string,
  options: AdvanceOptions = {},
): Promise<ProductionRun> {
  const pollMs = options.pollMs ?? 1_500;
  const maxSteps = options.maxSteps ?? 60;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const initial = await service.productionStatus(runId);
  if (!initial) throw new Error('la corrida ya no existe');
  let run: ProductionRun = initial;
  options.onUpdate?.(run);

  for (let step = 0; step < maxSteps; step += 1) {
    if (options.shouldStop?.()) return run;
    if (TERMINAL.has(run.status)) return run;

    const stage = run.stages.find((item) => item.stage === run.currentStage);
    if (stage?.status === 'running') {
      // Etapa async en curso: sondear sin consumir advance.
      await sleep(pollMs);
      const polled = await service.productionStatus(runId);
      if (polled) {
        run = polled;
        options.onUpdate?.(run);
      }
      continue;
    }

    run = await service.productionAdvance(runId);
    options.onUpdate?.(run);
  }
  return run;
}
