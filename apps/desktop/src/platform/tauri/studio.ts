import type { NativeCall } from './shared';
import { STUDIO_COMMANDS } from './shared';
import type { CatalogEntry, CatalogQuery, ProductionRun } from '../../services/contracts/studio';
import type { DesktopServiceStudio } from '../../services/contracts/services/studio';
import type { ProductionPlan } from '@editor-ia/project-schema';

export function createStudioService(call: NativeCall): DesktopServiceStudio {
  return {
    async productionCreate(plan, options) {
      return (await call(STUDIO_COMMANDS.productionCreate, {
        plan,
        runId: options?.runId ?? null,
        maxCostCents: options?.maxCostCents ?? null,
      })) as ProductionRun;
    },
    async productionStatus(runId) {
      return (await call(STUDIO_COMMANDS.productionStatus, { runId })) as ProductionRun | null;
    },
    async productionList() {
      return (await call(STUDIO_COMMANDS.productionList)) as readonly ProductionRun[];
    },
    async productionResume(runId) {
      return (await call(STUDIO_COMMANDS.productionResume, { runId })) as ProductionRun;
    },
    async productionCancel(runId) {
      return (await call(STUDIO_COMMANDS.productionCancel, { runId })) as ProductionRun;
    },
    async productionRemove(runId) {
      await call(STUDIO_COMMANDS.productionRemove, { runId });
    },
    async productionAdvance(runId) {
      return (await call(STUDIO_COMMANDS.productionAdvance, { runId })) as ProductionRun;
    },
    async catalogSearch(query) {
      return (await call(STUDIO_COMMANDS.catalogSearch, { query })) as readonly CatalogEntry[];
    },
    async catalogGet(id) {
      return (await call(STUDIO_COMMANDS.catalogGet, { id })) as CatalogEntry | null;
    },
  };
}
