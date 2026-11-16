import type { ProjectDocument, Scene } from '@editor-ia/project-schema';
import {
  ProjectActionError,
  cloneProject,
  fpsOf,
  newId,
  secondsToFrames,
  touch,
} from './project-actions-core';

/**
 * Scene (guion) mutations: applying a generated plan and manual CRUD,
 * ordering and narration attachment. Extracted from `project-actions.ts`;
 * `project-actions.ts` re-exports everything here.
 */

export interface AppliedScenePlan {
  readonly title: string;
  readonly scenes: readonly {
    id: string;
    title: string;
    intent: Scene['intent'];
    narration: string;
    visual: string;
    estimatedSeconds: number;
  }[];
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
  readonly costApproved: boolean;
}

export function applyScenePlan(
  project: ProjectDocument,
  plan: AppliedScenePlan,
  options: { replace?: boolean } = {},
): ProjectDocument {
  const next = cloneProject(project);
  if (options.replace) {
    const citedSceneIds = new Set(
      next.provenance.claims
        .map((claim) => claim.sceneId)
        .filter((value): value is string => typeof value === 'string'),
    );
    if (next.scenes.some((scene) => citedSceneIds.has(scene.id))) {
      throw new ProjectActionError(
        'una fuente cita una escena existente; no se puede reemplazar el guion sin perder esa referencia',
      );
    }
    next.scenes = [];
  }
  const fps = fpsOf(next);
  const baseOrder = Math.max(-1, ...next.scenes.map((scene) => scene.order)) + 1;
  const added: Scene[] = plan.scenes.map((scene, index) => ({
    id: newId(),
    order: baseOrder + index,
    title: scene.title.trim().slice(0, 200) || `Escena ${index + 1}`,
    intent: scene.intent,
    status: 'draft',
    narration: {
      text: scene.narration.trim().slice(0, 4_000),
      estimatedDurationFrames: secondsToFrames(scene.estimatedSeconds, fps),
    },
    clipIds: [],
    ...(scene.visual.trim() ? { notes: scene.visual.trim().slice(0, 2_000) } : {}),
  }));
  next.scenes.push(...added);
  next.provenance.operations.push({
    id: newId(),
    role: 'scriptwriter',
    summary: `${plan.simulated ? 'Guion simulado' : 'Guion generado'}: ${plan.title}`.slice(0, 300),
    createdAt: new Date().toISOString(),
    provider: { id: plan.providerId, model: plan.model },
    cost: { items: [], disclosed: true, approved: plan.costApproved },
    patch: added.map((scene) => ({
      op: 'add' as const,
      path: '/scenes/-',
      value: scene as unknown as Parameters<typeof JSON.stringify>[0],
    })),
    expectedRevision: project.revision,
    appliedStatus: 'applied',
  });
  touch(next);
  return next;
}

export function addScene(
  project: ProjectDocument,
  input: { title: string; intent: Scene['intent']; narration: string; notes?: string },
): { project: ProjectDocument; sceneId: string } {
  const title = input.title.trim();
  const narration = input.narration.trim();
  if (!title) throw new ProjectActionError('la escena necesita un título');
  if (!narration) throw new ProjectActionError('la escena necesita narración');
  const next = cloneProject(project);
  const fps = fpsOf(next);
  const scene: Scene = {
    id: newId(),
    order: Math.max(-1, ...next.scenes.map((item) => item.order)) + 1,
    title: title.slice(0, 200),
    intent: input.intent,
    status: 'draft',
    narration: {
      text: narration.slice(0, 4_000),
      estimatedDurationFrames: secondsToFrames(Math.max(2, narration.length / 15), fps),
    },
    clipIds: [],
    ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 2_000) } : {}),
  };
  next.scenes.push(scene);
  touch(next);
  return { project: next, sceneId: scene.id };
}

export function moveScene(
  project: ProjectDocument,
  sceneId: string,
  direction: -1 | 1,
): ProjectDocument | null {
  const next = cloneProject(project);
  const ordered = [...next.scenes].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((scene) => scene.id === sceneId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) {
    return null;
  }
  const current = ordered[index];
  const other = ordered[target];
  if (!current || !other) return null;
  const order = current.order;
  current.order = other.order;
  other.order = order;
  touch(next);
  return next;
}

/**
 * Reordena las escenas según una lista explícita de ids.
 *
 * A diferencia de `moveScene` (un paso a la vez), recibe la permutación
 * completa y la verifica: si la lista no cubre exactamente las escenas del
 * proyecto, rechaza en vez de adivinar. La usa el cerebro cuando el orden
 * del guion quedó viejo respecto al corte.
 */
export function reorderScenes(
  project: ProjectDocument,
  orderedSceneIds: readonly string[],
): ProjectDocument {
  const next = cloneProject(project);
  const byId = new Map(next.scenes.map((scene) => [scene.id, scene]));
  if (
    orderedSceneIds.length !== next.scenes.length ||
    !orderedSceneIds.every((id) => byId.has(id))
  ) {
    throw new ProjectActionError('el orden de escenas no coincide con el proyecto');
  }
  next.scenes = orderedSceneIds.map((id, index) => ({
    ...(byId.get(id) as Scene),
    order: index,
  }));
  touch(next);
  return next;
}

export function updateScene(
  project: ProjectDocument,
  sceneId: string,
  patch: Partial<Pick<Scene, 'title' | 'intent' | 'status' | 'notes'>> & { narration?: string },
): ProjectDocument {
  const next = cloneProject(project);
  const scene = next.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    throw new ProjectActionError('la escena no existe');
  }
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new ProjectActionError('la escena necesita un título');
    scene.title = title.slice(0, 200);
  }
  if (patch.intent !== undefined) scene.intent = patch.intent;
  if (patch.status !== undefined) scene.status = patch.status;
  if (patch.notes !== undefined) scene.notes = patch.notes.slice(0, 2_000);
  if (patch.narration !== undefined) {
    const text = patch.narration.trim();
    if (!text) throw new ProjectActionError('la narración no puede quedar vacía');
    scene.narration.text = text.slice(0, 4_000);
    const fps = fpsOf(next);
    scene.narration.estimatedDurationFrames = secondsToFrames(
      Math.max(2, text.length / 15),
      fps,
    );
  }
  touch(next);
  return next;
}

export function removeScene(project: ProjectDocument, sceneId: string): ProjectDocument {
  if (project.provenance.claims.some((claim) => claim.sceneId === sceneId)) {
    throw new ProjectActionError('una fuente cita esta escena; quitá la cita antes de borrarla');
  }
  const next = cloneProject(project);
  next.scenes = next.scenes
    .filter((scene) => scene.id !== sceneId)
    .sort((a, b) => a.order - b.order)
    .map((scene, index) => ({ ...scene, order: index }));
  touch(next);
  return next;
}

export function attachNarrationAsset(
  project: ProjectDocument,
  sceneId: string,
  assetId: string,
): ProjectDocument {
  const next = cloneProject(project);
  const scene = next.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    throw new ProjectActionError('la escena no existe');
  }
  scene.narration.assetId = assetId;
  touch(next);
  return next;
}
