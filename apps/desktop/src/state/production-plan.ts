import {
  createEmptyProductionPlan,
  type Asset,
  type PlanScene,
  type ProductionPlan,
  type ProjectDocument,
  type ResourceRequirement,
  type StudioResourceKind,
} from '@editor-ia/project-schema';
import { fpsOf } from './project-actions';

/**
 * Construye un `ProductionPlan` a partir del proyecto abierto: cada asset
 * usado por las escenas se convierte en un `ResourceRequirement` local
 * (query = id del asset, que el catálogo matchea contra `entry.id`) y cada
 * escena del proyecto en una `PlanScene`. Nada se inventa: si el catálogo no
 * resuelve un requisito, la etapa `edit` falla con error explícito.
 */
export interface BuildPlanOptions {
  /** Voz del generador local (p.ej. nombre SAPI) para narrar las escenas
   *  que tienen `narrationText`. Sin opción no se generan requisitos de voz. */
  voice?: string;
  /** Cama musical ambiental generada localmente (ffmpeg). Emite un
   *  requisito `music` con la convención `music:` y habilita
   *  `plan.music` para que `edit` la monte en "Producción Música". */
  music?: boolean;
}

export function buildProductionPlanFromProject(
  project: ProjectDocument,
  objective: string,
  now: string = new Date().toISOString(),
  options: BuildPlanOptions = {},
): ProductionPlan {
  const clipsById = new Map(project.timeline.clips.map((clip) => [clip.id, clip]));
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));

  const kindOf = (asset: Asset): StudioResourceKind => {
    switch (asset.kind) {
      case 'video':
        return 'video';
      case 'image':
        return 'image';
      case 'audio':
        return 'audio';
      case 'font':
      case 'text':
        return 'graphic';
    }
  };

  // Requisitos: un asset por requisito, deduplicado, sólo medios montados.
  const requirements = new Map<string, ResourceRequirement>();
  const assetIdOf = (clip: ProjectDocument['timeline']['clips'][number]): string | null =>
    clip.source.type === 'asset' ? clip.source.assetId : null;

  const sceneAssetIds = project.scenes.map((scene) =>
    scene.clipIds
      .map((clipId) => clipsById.get(clipId))
      .filter((clip): clip is NonNullable<typeof clip> => Boolean(clip))
      .map(assetIdOf)
      .filter((id): id is string => Boolean(id)),
  );
  for (const assetIds of sceneAssetIds) {
    for (const assetId of assetIds) {
      const asset = assetsById.get(assetId);
      if (!asset || requirements.has(assetId)) continue;
      requirements.set(assetId, {
        id: `req-${assetId}`,
        kind: kindOf(asset),
        query: assetId,
        maxCount: 1,
        minCommercialUse: 'unknown',
        preferLocal: true,
        optional: false,
      });
    }
  }

  const baseScenes: PlanScene[] = project.scenes.map((scene, index) => {
    const requirementIds = [
      ...new Set(
        scene.clipIds
          .map((clipId) => clipsById.get(clipId))
          .filter((clip): clip is NonNullable<typeof clip> => Boolean(clip))
          .map(assetIdOf)
          .filter((id): id is string => id !== null && requirements.has(id))
          .map((id) => `req-${id}`),
      ),
    ];
    return {
      id: scene.id,
      order: index,
      title: scene.title,
      intent: scene.intent,
      narrationText: scene.narration.text,
      requirementIds,
    };
  });

  // Con voz elegida, cada escena narrada genera su propio requisito `voice`
  // (el texto a sintetizar es su narración) y una escena de audio adicional
  // que lo monta: una escena del plan resuelve UN solo asset, así que la
  // narración viaja como escena propia, igual que en el E2E verificado.
  const planScenes: PlanScene[] = [];
  if (options.voice) {
    for (const scene of baseScenes) {
      planScenes.push({ ...scene, order: planScenes.length });
      if (!scene.narrationText) continue;
      const reqId = `req-voz-${scene.id}`;
      requirements.set(reqId, {
        id: reqId,
        kind: 'voice',
        query: scene.narrationText,
        maxCount: 1,
        minCommercialUse: 'unknown',
        preferLocal: true,
        optional: false,
        voice: options.voice,
      });
      planScenes.push({
        id: `voz-${scene.id}`,
        order: planScenes.length,
        title: `${scene.title} (voz)`,
        intent: 'explainer',
        requirementIds: [reqId],
        ...(scene.targetDurationFrames !== undefined
          ? { targetDurationFrames: scene.targetDurationFrames }
          : {}),
      });
    }
  } else {
    planScenes.push(...baseScenes);
  }

  // Cama musical ambiental: un requisito `music` con la convención
  // `music:` (lo satisface el generador local ffmpeg) y `plan.music`
  // habilitado con la misma query para que `edit` lo resuelva por tags.
  const MUSIC_QUERY = 'music:ambient';
  if (options.music) {
    requirements.set('req-musica', {
      id: 'req-musica',
      kind: 'music',
      query: MUSIC_QUERY,
      maxCount: 1,
      minCommercialUse: 'unknown',
      preferLocal: true,
      optional: false,
    });
  }

  const hasNarration = planScenes.some((scene) => scene.narrationText);
  const profile = project.renderProfiles[0];
  const fps = fpsOf(project);
  const durationFrames = project.timeline.clips.reduce(
    (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
    fps * 60,
  );

  const plan = createEmptyProductionPlan(
    `plan-${project.id}-${Date.now()}`,
    now,
    objective.trim() || project.name,
  );
  return {
    ...plan,
    createdAt: now,
    updatedAt: now,
    requirements: [...requirements.values()],
    scenes: planScenes,
    subtitles: hasNarration ? { enabled: true, language: 'es' } : { enabled: false },
    music: options.music
      ? { enabled: true, query: MUSIC_QUERY }
      : { enabled: false },
    target: {
      platform: 'youtube',
      aspectRatio: profile?.aspectRatio ?? '16:9',
      targetDurationFrames: durationFrames,
      renderProfileId: profile?.id,
    },
  };
}
