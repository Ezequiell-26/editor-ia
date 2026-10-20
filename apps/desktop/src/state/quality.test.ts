import { describe, expect, it } from 'vitest';
import type { Asset } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import { evaluateProjectQuality } from './quality';
import { addCaptionCue, addClipFromAsset, addAsset, ensureDelivery, newId } from './project-actions';

const NOW = '2025-01-01T00:00:00.000Z';

function video(): Extract<Asset, { kind: 'video' }> {
  return {
    id: newId(),
    label: 'Toma',
    kind: 'video',
    source: { type: 'local', path: 'media/toma.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 1000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
  } as Extract<Asset, { kind: 'video' }>;
}

describe('puerta de calidad del proyecto', () => {
  it('bloquea una timeline vacía', () => {
    const parsed = parseProject(ensureDelivery(createEmptyProject('Vacío', NOW)));
    if (!parsed.ok) throw new Error('proyecto inválido');
    const findings = evaluateProjectQuality(parsed.project);
    expect(findings.some((item) => item.severity === 'error')).toBe(true);
  });

  it('avisa por audio sin loudness y subtítulos demasiado rápidos', () => {
    const asset = video();
    let project = ensureDelivery(createEmptyProject('Calidad', NOW));
    project = addAsset(project, asset);
    project = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 90 }).project;
    project = addCaptionCue(project, {
      text: 'Este subtítulo es deliberadamente larguísimo para superar el CPS recomendado de lectura',
      startFrame: 0,
      durationFrames: 10,
    }).project;
    const findings = evaluateProjectQuality(project);
    expect(findings.some((item) => /loudness/i.test(item.message))).toBe(true);
    expect(findings.some((item) => /caracteres por segundo/i.test(item.message))).toBe(true);
  });
});
