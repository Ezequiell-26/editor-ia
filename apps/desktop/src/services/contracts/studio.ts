// Estudio autónomo: contratos TS de las corridas de producción y del
// catálogo del proyecto. Espejo de `studio/run.rs`, `ports/studio.rs` y los
// comandos `production_*`/`catalog_*` (camelCase por serde).

import type { ProductionPlan, StudioStage } from '@editor-ia/project-schema';

export type ProductionRunStatus =
  | 'planned'
  | 'running'
  | 'paused'
  | 'cancelled'
  | 'done'
  | 'failed';

export type StageRecordStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface StageRecord {
  readonly stage: StudioStage;
  readonly status: StageRecordStatus;
  readonly attempts?: number;
  readonly costCents?: number;
  readonly error?: string;
  readonly finishedAt?: string;
  /** Último output del ejecutor (jobId, rutas, reportes). */
  readonly output?: unknown;
}

export interface ProductionRun {
  readonly id: string;
  readonly planId: string;
  readonly plan: ProductionPlan;
  readonly status: ProductionRunStatus;
  readonly currentStage: StudioStage;
  readonly stages: readonly StageRecord[];
  readonly maxCostCents?: number;
  readonly spentCents: number;
  readonly maxStageAttempts: number;
  readonly resumes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastError?: string;
}

// ─────────────── Catálogo del proyecto ───────────────

export type StudioResourceKind =
  | 'video'
  | 'image'
  | 'audio'
  | 'music'
  | 'sfx'
  | 'voice'
  | 'animation'
  | 'graphic';

export interface CatalogQuery {
  readonly kind?: StudioResourceKind;
  readonly text?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
}

export interface ResourceLicense {
  readonly id: string;
  readonly commercialUse: 'allowed' | 'requires-attribution' | 'not-for-redistribution' | 'unknown';
  readonly url?: string;
}

export interface CatalogEntry {
  readonly id: string;
  readonly kind: StudioResourceKind;
  /** Ruta relativa al root del proyecto. */
  readonly reference: string;
  readonly durationFrames?: number;
  readonly width?: number;
  readonly height?: number;
  readonly tags: readonly string[];
  readonly transcript?: string;
  readonly analysis?: unknown;
  readonly thumbnail?: string;
  readonly source: {
    readonly provider: string;
    readonly author?: string;
    readonly license: ResourceLicense;
    readonly sourceUrl?: string;
    readonly attribution?: string;
    readonly sha256?: string;
  };
}
