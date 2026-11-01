import { describe, expect, it } from 'vitest';
import type { Asset, ProjectDocument, SpeedCurve } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import {
  ProjectActionError,
  addAsset,
  addClipFromAsset,
  applySpeedCurvePoints,
  newId,
  removeSpeedCurve,
  updateClip,
} from './project-actions';

const NOW = '2025-01-01T00:00:00.000Z';

const ramp: SpeedCurve = {
  points: [
    { t: 0, speed: 0.5 },
    { t: 1, speed: 2 },
  ],
};

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.project;
}

function base(): ProjectDocument {
  return validated(createEmptyProject('Curvas', NOW));
}

function videoAsset(durationFrames = 300): Asset {
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
    media: { width: 1920, height: 1080, durationFrames, frameRate: { num: 30, den: 1 } },
  } as Asset;
}

function withClip(durationFrames = 300) {
  const asset = videoAsset(durationFrames);
  const project = addAsset(base(), asset);
  return addClipFromAsset(project, asset, { atFrame: 0 });
}

describe('curva de velocidad continua', () => {
  it('ajusta la duración a la media y persiste la curva', () => {
    const { project, clipId } = withClip(300);
    const result = applySpeedCurvePoints(project, clipId, ramp);
    const clip = result.timeline.clips.find((item) => item.id === clipId)!;
    expect(clip.durationFrames).toBe(240);
    expect(clip.kind === 'video' && clip.speedCurve?.points).toHaveLength(2);
    expect(clip.kind === 'video' && clip.speed).toBeUndefined();
    expect(() => validated(result)).not.toThrow();
  });

  it('desplaza los clips siguientes de la pista', () => {
    const { project, clipId } = withClip(300);
    const source = project.timeline.clips[0]!;
    const withNext: ProjectDocument = {
      ...project,
      timeline: {
        ...project.timeline,
        clips: [...project.timeline.clips, { ...source, id: newId(), startFrame: 300 }],
      },
    };
    const result = applySpeedCurvePoints(withNext, clipId, ramp);
    const next = result.timeline.clips.find((item) => item.id !== clipId)!;
    expect(next.startFrame).toBe(240);
  });

  it('rechaza clips con Ken Burns', () => {
    const { project, clipId } = withClip();
    const withMotion = updateClip(project, clipId, {
      motion: { type: 'zoom-in', intensity: 0.12 },
    });
    expect(() => applySpeedCurvePoints(withMotion, clipId, ramp)).toThrow(ProjectActionError);
  });

  it('rechaza puntos fuera de rango', () => {
    const { project, clipId } = withClip();
    const invalid: SpeedCurve = {
      points: [
        { t: 0, speed: 6 },
        { t: 1, speed: 1 },
      ],
    };
    expect(() => applySpeedCurvePoints(project, clipId, invalid)).toThrow(ProjectActionError);
  });

  it('quitar la curva devuelve la duración de origen', () => {
    const { project, clipId } = withClip(300);
    const curved = applySpeedCurvePoints(project, clipId, ramp);
    const restored = removeSpeedCurve(curved, clipId);
    const clip = restored.timeline.clips.find((item) => item.id === clipId)!;
    expect(clip.durationFrames).toBe(300);
    expect(clip.kind === 'video' && clip.speedCurve).toBeUndefined();
    expect(() => validated(restored)).not.toThrow();
  });
});
