import type { ProductionPlan } from '@editor-ia/project-schema';
import type {
  CatalogEntry,
  CatalogQuery,
  ProductionPlanBrief,
  ProductionRun,
} from '../studio';

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
  /**
   * Pausa la corrida entre etapas (`production_pause`). Si el driver
   * backend está activo lo detecta en su próxima iteración y se detiene.
   */
  productionPause(runId: string): Promise<ProductionRun>;
  /**
   * Arranca el driver backend que conduce la corrida hasta un estado
   * terminal/pausado/fallido (`production_start`). Idempotente; reanuda
   * si estaba pausada o fallida. Devuelve `true` si quedó driver activo.
   */
  productionStart(runId: string): Promise<boolean>;
  /**
   * Interpreta texto libre con el provider de chat configurado (BYOK) y
   * devuelve el `ProductionPlan` resultante (`production_plan_from_text`).
   * No crea ni ejecuta la corrida. `approvedCost` autoriza gasto del
   * provider remoto: local no lo exige, remoto sí. Provider `mock` o sin
   * configurar ⇒ error honesto del backend.
   */
  productionPlanFromText(
    text: string,
    options?: { approvedCost?: boolean | undefined },
  ): Promise<ProductionPlan>;
  /**
   * Construye un `ProductionPlan` válido desde un brief estructurado
   * (`production_plan_from_brief`). Sin provider ni costo: el cliente
   * revisa el plan y luego llama `productionCreate`.
   */
  productionPlanFromBrief(brief: ProductionPlanBrief): Promise<ProductionPlan>;

  catalogSearch(query: CatalogQuery): Promise<readonly CatalogEntry[]>;
  catalogGet(id: string): Promise<CatalogEntry | null>;
}
