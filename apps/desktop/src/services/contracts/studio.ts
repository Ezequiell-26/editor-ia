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

/**
 * Brief estructurado para `production_plan_from_brief`: espejo de
 * `PlanRequest` en `application/studio_planner.rs` (camelCase por serde).
 * El backend normaliza plataforma desconocida a `youtube` y aspect ratio
 * inválido es error; acá se tipa `string` para no duplicar esa política.
 */
export interface ProductionPlanBrief {
  /** Objetivo del video (requerido, máx. 2000 chars en backend). */
  readonly objective: string;
  readonly audience?: string;
  readonly tone?: string;
  /** Puntos narrativos; cada uno vira una escena (máx. 8 en backend). */
  readonly keyPoints?: readonly string[];
  /** Escenas deseadas como pista; `undefined` = una por key point. */
  readonly sceneCount?: number;
  /** Duración objetivo total en segundos (default 30, clamp 3–3600). */
  readonly durationSeconds?: number;
  /** `youtube` (default), `shorts`, `reels`, `tiktok`. */
  readonly platform?: string;
  /** `16:9` (default youtube) u `9:16`/`1:1`/`4:5`. */
  readonly aspectRatio?: string;
  /** Voz del generador local para narrar (p.ej. nombre SAPI). */
  readonly voice?: string;
  /** Cama musical ambiental generada localmente. */
  readonly music?: boolean;
  /** Tarjeta de título inicial generada localmente. */
  readonly titleCard?: boolean;
  /** Query explícita para el B-roll; default = objective recortado. */
  readonly brollQuery?: string;
  readonly maxCostCents?: number;
}

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
