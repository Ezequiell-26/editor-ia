import type { ProductionPlan } from '@editor-ia/project-schema';
import type { CatalogEntry, CatalogQuery, ProductionRun } from '../studio';

/** Estudio autónomo: corridas de producción y catálogo del proyecto. */
export interface DesktopServiceStudio {
  /** Crea una corrida desde un `ProductionPlan` válido. */
  productionCreate(
    plan: ProductionPlan,
    options?: { runId?: string | undefined; maxCostCents?: number | undefined },
  ): Promise<ProductionRun>;
  productionStatus(runId: string): Promise<ProductionRun | null>;
  productionList(): Promise<readonly ProductionRun[]>;
  /** Reanuda una corrida pausada/fallida. */
  productionResume(runId: string): Promise<ProductionRun>;
  productionCancel(runId: string): Promise<ProductionRun>;
  /** Elimina una corrida terminal (done/cancelled). */
  productionRemove(runId: string): Promise<void>;
  /**
   * Avanza UNA etapa del pipeline. Requiere proyecto abierto; las etapas
   * async (render) quedan `running` y hay que volver a llamar para sondear.
   */
  productionAdvance(runId: string): Promise<ProductionRun>;

  catalogSearch(query: CatalogQuery): Promise<readonly CatalogEntry[]>;
  catalogGet(id: string): Promise<CatalogEntry | null>;
}
