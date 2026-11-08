import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { readyAsset } from '../test/fake-service';
import {
  addAsset,
  addClipFromAsset,
  addScene,
  ensureDelivery,
} from './project-actions';
import { buildProductionPlanFromProject } from './production-plan';

const NOW = '2026-11-08T00:00:00.000Z';

function projectWithClip(): { project: ProjectDocument; assetId: string; clipId: string } {
  const asset = readyAsset({
    kind: 'video',
    label: 'Toma',
    source: { type: 'local', path: 'media/toma.mp4' },
    media: {
      width: 1920,
      height: 1080,
      durationFrames: 300,
      frameRate: { num: 30, den: 1 },
    },
  });
  let project = addAsset(ensureDelivery(createEmptyProject('Piloto', NOW)), asset);
  const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 150 });
  project = added.project;
  const scene = addScene(project, {
    title: 'Apertura',
    intent: 'hook',
    narration: 'Texto de narración.',
  });
  project = scene.project;
  // La escena referencia el clip montado.
  project = {
    ...project,
    scenes: project.scenes.map((item) =>
      item.id === scene.sceneId ? { ...item, clipIds: [added.clipId] } : item,
    ),
  };
  return { project, assetId: asset.id, clipId: added.clipId };
}

describe('buildProductionPlanFromProject', () => {
  it('mapea assets de escena a requisitos y escenas del plan', () => {
    const { project, assetId } = projectWithClip();
    const plan = buildProductionPlanFromProject(project, 'Video de prueba', NOW);

    expect(plan.brief.objective).toBe('Video de prueba');
    expect(plan.schemaVersion).toBe(1);
    expect(plan.requirements).toHaveLength(1);
    expect(plan.requirements[0]).toMatchObject({
      id: `req-${assetId}`,
      kind: 'video',
      query: assetId,
      preferLocal: true,
    });
    expect(plan.scenes).toHaveLength(1);
    expect(plan.scenes[0]?.requirementIds).toEqual([`req-${assetId}`]);
    expect(plan.scenes[0]?.narrationText).toBe('Texto de narración.');
    expect(plan.subtitles.enabled).toBe(true);
    expect(plan.target.renderProfileId).toBeDefined();
  });

  it('sin clips en escenas no inventa requisitos', () => {
    let project = ensureDelivery(createEmptyProject('Vacío', NOW));
    project = addScene(project, {
      title: 'Solo guion',
      intent: 'context',
      narration: 'Sin material.',
    }).project;
    const plan = buildProductionPlanFromProject(project, '', NOW);

    expect(plan.requirements).toHaveLength(0);
    expect(plan.scenes[0]?.requirementIds).toEqual([]);
    expect(plan.brief.objective).toBe('Vacío');
  });

  it('deduplica assets compartidos entre escenas', () => {
    const { project, assetId, clipId } = projectWithClip();
    const second = addScene(project, {
      title: 'Cierre',
      intent: 'outro',
      narration: 'Fin.',
    });
    const withSecond = {
      ...second.project,
      scenes: second.project.scenes.map((item) =>
        item.id === second.sceneId ? { ...item, clipIds: [clipId] } : item,
      ),
    };
    const plan = buildProductionPlanFromProject(withSecond, 'Dos escenas', NOW);

    expect(plan.requirements).toHaveLength(1);
    expect(plan.scenes).toHaveLength(2);
    expect(plan.scenes[1]?.requirementIds).toEqual([`req-${assetId}`]);
  });

  it('con voz agrega un requisito voice y una escena de narración por escena narrada', () => {
    const { project } = projectWithClip();
    const plan = buildProductionPlanFromProject(project, 'Con voz', NOW, {
      voice: 'Microsoft Sabina Desktop',
    });

    const voiceReq = plan.requirements.find((req) => req.kind === 'voice');
    expect(voiceReq).toMatchObject({
      id: `req-voz-${plan.scenes[0]?.id}`,
      query: 'Texto de narración.',
      voice: 'Microsoft Sabina Desktop',
    });
    expect(plan.scenes).toHaveLength(2);
    expect(plan.scenes[0]?.id).toBe(project.scenes[0]?.id);
    expect(plan.scenes[1]).toMatchObject({
      id: `voz-${project.scenes[0]?.id}`,
      requirementIds: [voiceReq?.id],
    });
    expect(plan.scenes[1]?.narrationText).toBeUndefined();
    expect(plan.scenes.map((scene) => scene.order)).toEqual([0, 1]);
  });

  it('sin opción de voz no genera requisitos voice', () => {
    const { project } = projectWithClip();
    const plan = buildProductionPlanFromProject(project, 'Sin voz', NOW);
    expect(plan.requirements.every((req) => req.kind !== 'voice')).toBe(true);
    expect(plan.scenes).toHaveLength(1);
  });
});
