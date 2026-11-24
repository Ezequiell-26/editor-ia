import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  parseProject,
  type Asset,
  type ProjectDocument,
} from '@editor-ia/project-schema';
import { addAsset, addClipFromAsset, ensureDelivery, newId } from './project-actions';
import { editPointFrames, nextEditPoint, previousEditPoint } from './edit-points';

const NOW = '2026-01-01T00:00:00.000Z';

function base(): ProjectDocument {
  const parsed = parseProject(ensureDelivery(createEmptyProject('Edits', NOW)));
  if (!parsed.ok) throw new Error('proyecto base inválido');
  return parsed.project;
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

function withTwoClips(): { project: ProjectDocument; gap: number } {
  const asset = videoAsset();
  let project = base();
  project = addAsset(project, asset);
  const first = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 90 });
  const second = addClipFromAsset(first.project, asset, {
    atFrame: 150,
    durationFrames: 60,
  });
  return { project: second.project, gap: 90 };
}

describe('edit points', () => {
  it('deduplica y ordena los bordes de todos los clips', () => {
    const { project } = withTwoClips();
    // clip1: 0-90 · clip2: 150-210 → puntos {0,90,150,210}
    expect(editPointFrames(project)).toEqual([0, 90, 150, 210]);
  });

  it('next/previous saltan al borde estricto más cercano', () => {
    const { project } = withTwoClips();
    expect(nextEditPoint(project, 0)).toBe(90);
    expect(nextEditPoint(project, 45)).toBe(90);
    expect(nextEditPoint(project, 90)).toBe(150);
    expect(nextEditPoint(project, 209)).toBe(210);
    expect(nextEditPoint(project, 210)).toBeNull();
    expect(previousEditPoint(project, 210)).toBe(150);
    expect(previousEditPoint(project, 150)).toBe(90);
    expect(previousEditPoint(project, 90)).toBe(0);
    expect(previousEditPoint(project, 0)).toBeNull();
    expect(previousEditPoint(project, 500)).toBe(210);
  });

  it('sin clips no hay puntos', () => {
    const project = base();
    expect(editPointFrames(project)).toEqual([]);
    expect(nextEditPoint(project, 10)).toBeNull();
    expect(previousEditPoint(project, 10)).toBeNull();
  });
});
