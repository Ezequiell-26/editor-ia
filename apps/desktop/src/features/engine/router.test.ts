import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject, SceneEngineSchema } from '@editor-ia/project-schema';
import {
  ENGINES,
  engineCatalog,
  resolveClip,
  resolveScene,
} from './router';
import {
  addAsset,
  addClipFromAsset,
  addMotionGraphic,
  ensureDelivery,
  newId,
} from '../../state/project-actions';

const NOW = '2025-01-01T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

function imageAsset(): Asset {
  return {
    id: newId(),
    label: 'Foto',
    kind: 'image',
    source: { type: 'local', path: 'media/foto.png' },
    status: 'ready',
    integrity: { sha256: 'e'.repeat(64), bytes: 8_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1024, height: 1024 },
  } as Asset;
}

function videoAsset(): Asset {
  return {
    id: newId(),
    label: 'Toma',
    kind: 'video',
    source: { type: 'local', path: 'media/toma.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
  } as Asset;
}

function projectWith(kind: 'image' | 'video'): {
  project: ProjectDocument;
  clipId: string;
} {
  const asset = kind === 'image' ? imageAsset() : videoAsset();
  const base = addAsset(ensureDelivery(createEmptyProject('Router', NOW)), asset);
  const added = addClipFromAsset(base, asset, { atFrame: 0 });
  return { project: validated(added.project), clipId: added.clipId };
}

describe('smart engine router', () => {
  it('todos los motores del router son válidos como motor de escena', () => {
    for (const engine of ENGINES) {
      expect(SceneEngineSchema.safeParse(engine.id).success).toBe(true);
    }
    expect(SceneEngineSchema.safeParse('inventado').success).toBe(false);
  });

  it('registra los motores con su estado real sin vender los parciales como completos', () => {
    const catalog = engineCatalog();
    expect(catalog.map((engine) => engine.id)).toContain('ken-burns');
    expect(catalog.find((engine) => engine.id === 'parallax')?.status).toBe('partial');
    expect(catalog.find((engine) => engine.id === 'rig')?.status).toBe('partial');
    expect(catalog.find((engine) => engine.id === 'three')?.status).toBe('partial');
    expect(catalog.find((engine) => engine.id === 'object-tracking')?.status).toBe('partial');
    expect(ENGINES.every((engine) => engine.supports.length > 0)).toBe(true);
  });

  it('elige Ken Burns para una imagen fija', () => {
    const { project, clipId } = projectWith('image');
    const resolution = resolveClip(project, clipId);
    expect(resolution.status).toBe('ready');
    expect(resolution.engine).toBe('ken-burns');
    expect(resolution.rationale).toMatch(/imagen fija/);
  });

  it('elige efectos para video y motion graphics para gráficos', () => {
    const video = projectWith('video');
    expect(resolveClip(video.project, video.clipId).engine).toBe('effects');

    const added = addMotionGraphic(video.project, {
      templateId: 'title-card',
      templateVersion: '1.0.0',
      props: { title: 'Hola', background: '#000000', accent: '#35d6ff' },
      durationFrames: 60,
      atFrame: 0,
      label: 'Título',
    });
    const project = validated(added.project);
    expect(resolveClip(project, added.clipId).engine).toBe('motion-graphics');
  });

  it('reporta parallax, 3D horneado y rig como parciales', () => {
    const { project, clipId } = projectWith('image');
    const parallax = resolveClip(project, clipId, { request: 'parallax' });
    expect(parallax.status).toBe('partial');
    expect(parallax.engine).toBe('parallax');
    expect(parallax.rationale).toMatch(/parcial/);

    const three = resolveClip(project, clipId, { request: 'three' });
    expect(three.status).toBe('partial');
    expect(three.engine).toBe('three');
    expect(three.rationale).toMatch(/parcial/);

    const video = projectWith('video');
    const rig = resolveClip(video.project, video.clipId, { request: 'rig' });
    expect(rig.status).toBe('partial');
    expect(rig.engine).toBe('rig');
    const tracking = resolveClip(video.project, video.clipId, { request: 'object-tracking' });
    expect(tracking.status).toBe('partial');
    expect(tracking.rationale).toMatch(/NCC/);
  });

  it('bloquea un motor inexistente con una razón explícita', () => {
    const { project, clipId } = projectWith('image');
    const unknown = resolveClip(project, clipId, { request: 'hologram' as never });
    expect(unknown.status).toBe('blocked');
    expect(unknown.engine).toBeNull();
    expect(unknown.blocked[0]?.reason).toMatch(/motor desconocido/);
  });

  it('rechaza un motor que no soporta el tipo de clip', () => {
    const { project, clipId } = projectWith('image');
    const blocked = resolveClip(project, clipId, { request: 'face-tracking' });
    expect(blocked.status).toBe('blocked');
    expect(blocked.blocked[0]?.reason).toMatch(/no soporta/);
  });

  it('marca el tracking facial como parcial en video y no lo inventa como completo', () => {
    const { project, clipId } = projectWith('video');
    const face = resolveClip(project, clipId, { request: 'face-tracking' });
    expect(face.status).toBe('partial');
    expect(face.engine).toBe('face-tracking');
    expect(face.rationale).toMatch(/parcial/);
  });

  it('resuelve una escena a partir de sus clipIds', () => {
    const { project, clipId } = projectWith('image');
    const scene = {
      id: newId(),
      order: 0,
      title: 'Escena foto',
      intent: 'demo' as const,
      status: 'draft' as const,
      narration: { text: 'Una foto con movimiento' },
      clipIds: [clipId],
    };
    const withScene = validated({ ...project, scenes: [scene] });
    const resolution = resolveScene(withScene, scene.id);
    expect(resolution.target.kind).toBe('scene');
    expect(resolution.target.title).toBe('Escena foto');
    expect(resolution.engine).toBe('ken-burns');
    expect(resolution.clips).toHaveLength(1);
  });

  it('pide entrada cuando la escena no tiene clips y falla con ids inexistentes', () => {
    const { project, clipId } = projectWith('image');
    const scene = {
      id: newId(),
      order: 0,
      title: 'Vacía',
      intent: 'hook' as const,
      status: 'draft' as const,
      narration: { text: 'Sólo texto' },
      clipIds: [],
    };
    const withScene = validated({ ...project, scenes: [scene] });
    expect(resolveScene(withScene, scene.id).status).toBe('needs-input');
    expect(() => resolveScene(withScene, 'no-existe')).toThrow(/no existe la escena/);
    expect(() => resolveClip(withScene, 'no-existe')).toThrow(/no existe el clip/);
    expect(clipId).toBeTruthy();
  });
});
