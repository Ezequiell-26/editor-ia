import type { ProjectDocument, Scene } from '@editor-ia/project-schema';
import type { DesktopService, GenerateScriptRequest } from '../services/project-service';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import {
  addAsset,
  applyScenePlan,
  ensureDelivery,
  markAssetReady,
  newId,
} from './project-actions';
import { prepareAutoEdit, type AutoEditOptions, type NarrationCandidate } from './auto-edit';

/**
 * Batch factory: generate N project variants from one brief.
 *
 * Each variant gets its own `.editoria.json` in a subfolder, its own guion,
 * narration and timeline. The caller drives the loop in the UI so it can show
 * progress and cancel; this module provides the per-variant pipeline.
 */

export interface FactoryBrief {
  readonly topic: string;
  readonly variants: number;
  readonly scenes: number;
  readonly language: string;
  readonly width: number;
  readonly height: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
}

export interface FactoryVariantPlan {
  readonly index: number;
  readonly name: string;
  readonly brief: string;
}

export interface FactoryVariantResult {
  readonly index: number;
  readonly name: string;
  readonly projectPath: string | null;
  readonly videoPath?: string;
  readonly videoBytes?: number;
  readonly renderError?: string;
  readonly status: 'ok' | 'error';
  readonly message: string;
  readonly durationFrames: number;
  readonly clipCount: number;
  readonly captionCount: number;
}

function variantBrief(topic: string, index: number, total: number): string {
  if (total <= 1) return topic;
  const angle = [
    'desde la perspectiva del problema que resuelve',
    'contando un caso real o hipotético',
    'explicando paso a paso cómo funciona',
    'con un enfoque de lista o ranking',
    'comparando con la alternativa más conocida',
    'en tono de pregunta y respuesta',
    'resumiendo los 3 puntos clave',
    'con una historia corta que ilustre el tema',
  ];
  const selected = angle[index % angle.length] ?? angle[0];
  return `${topic} — variante ${index + 1}/${total}: ${selected}`;
}

export function planVariants(brief: FactoryBrief): FactoryVariantPlan[] {
  const plans: FactoryVariantPlan[] = [];
  for (let index = 0; index < brief.variants; index += 1) {
    plans.push({
      index,
      name: `${brief.topic.slice(0, 40).trim()} v${index + 1}`,
      brief: variantBrief(brief.topic, index, brief.variants),
    });
  }
  return plans;
}

export async function generateVariant(
  service: DesktopService,
  brief: FactoryBrief,
  plan: FactoryVariantPlan,
  images: readonly { id: string; label: string; path: string; hash: string; bytes: number; width: number; height: number }[],
  options: {
    readonly voiceId?: string;
    readonly photoMotion: 'auto' | 'none';
    readonly transitionFrames: number;
    readonly confirmRights: boolean;
    /** Autorización explícita para proveedores que consumen créditos. */
    readonly approveCost: boolean;
  },
): Promise<{ project: ProjectDocument; narrations: NarrationCandidate[] }> {
  const now = new Date().toISOString();
  let project = createEmptyProject(plan.name, now);
  project = {
    ...project,
    language: brief.language as 'es' | 'en',
    video: {
      ...project.video,
      width: brief.width,
      height: brief.height,
      frameRate: { num: brief.fpsNum, den: brief.fpsDen },
    },
  };
  project = ensureDelivery(project);
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(`variante ${plan.index + 1}: el proyecto base no es válido`);
  }
  project = parsed.project;

  for (const image of images) {
    project = addAsset(project, {
      id: newId(),
      label: image.label,
      kind: 'image',
      source: { type: 'local', path: image.path },
      status: 'unverified',
      integrity: { sha256: image.hash, bytes: image.bytes },
      rights: {
        license: { id: 'user-declared', commercialUse: 'allowed' },
        provenance: { origin: 'user-imported', acquiredAt: now },
      },
      media: { width: image.width, height: image.height },
    } as Parameters<typeof addAsset>[1]);
    const added = project.assets[project.assets.length - 1];
    if (added) {
      project = markAssetReady(project, added.id, 'allowed');
    }
  }

  const request: GenerateScriptRequest = {
    brief: plan.brief,
    sceneCount: brief.scenes,
    language: brief.language,
    approvedCost: options.approveCost,
  };
  const scriptPlan = await service.generateScript(request);
  project = applyScenePlan(project, scriptPlan);

  const narrations: NarrationCandidate[] = [];
  for (const scene of project.scenes) {
    if (!scene.narration.text?.trim()) continue;
    const result = await service.synthesizeNarration({
      text: scene.narration.text,
      ...(options.voiceId ? { voice: options.voiceId } : {}),
      fpsNum: brief.fpsNum,
      fpsDen: brief.fpsDen,
      provider: 'windows-sapi',
    });
    if (!result.asset) continue;
    narrations.push({ sceneId: scene.id, asset: result.asset });
  }

  return { project, narrations };
}

export function assembleVariant(
  project: ProjectDocument,
  narrations: readonly NarrationCandidate[],
  options: {
    readonly photoMotion: 'auto' | 'none';
    readonly transitionFrames: number;
    readonly confirmRights: boolean;
  },
): ProjectDocument {
  const autoOptions: AutoEditOptions = {
    assignment: 'match',
    includeCaptions: true,
    replaceTimeline: true,
    photoMotion: options.photoMotion,
    transitionFrames: options.transitionFrames,
  };
  const result = prepareAutoEdit(
    project,
    narrations,
    autoOptions,
    options.confirmRights,
  );
  return result.project;
}
