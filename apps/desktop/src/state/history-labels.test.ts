import { describe, expect, it } from 'vitest';
import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import { describeHistoryStep, historyStepLabels } from './history-labels';
import { createEmptyProject } from '@editor-ia/project-schema';

function clip(id: string, overrides: Record<string, unknown> = {}): Clip {
  return {
    id,
    kind: 'video',
    trackId: 'track-v1',
    startFrame: 0,
    durationFrames: 100,
    label: `Clip ${id}`,
    source: { type: 'asset', assetId: 'asset-v1', inFrame: 0, outFrame: 100 },
    ...overrides,
  } as unknown as Clip;
}

function projectWith(clips: Clip[], assets: { id: string; label: string }[] = []): ProjectDocument {
  const project = createEmptyProject('Test');
  return {
    ...project,
    assets: assets as ProjectDocument['assets'],
    timeline: {
      ...project.timeline,
      tracks: [{ id: 'track-v1', kind: 'video', label: 'V1', order: 0, locked: false, muted: false, hidden: false }],
      clips,
    },
  } as unknown as ProjectDocument;
}

describe('describeHistoryStep', () => {
  it('etiqueta un clip añadido con su nombre', () => {
    const before = projectWith([]);
    const after = projectWith([clip('c1')]);
    expect(describeHistoryStep(before, after)).toBe('Añadió video «Clip c1»');
  });

  it('etiqueta varios clips añadidos', () => {
    const before = projectWith([]);
    const after = projectWith([clip('c1'), clip('c2', { kind: 'audio' })]);
    expect(describeHistoryStep(before, after)).toBe('Añadió 2 elementos');
  });

  it('etiqueta un clip eliminado', () => {
    const before = projectWith([clip('c1')]);
    const after = projectWith([]);
    expect(describeHistoryStep(before, after)).toBe('Eliminó video «Clip c1»');
  });

  it('etiqueta el campo que cambió', () => {
    const before = projectWith([clip('c1')]);
    const after = projectWith([clip('c1', { transform: { x: 0.5 } })]);
    expect(describeHistoryStep(before, after)).toBe('Ajustó la transformación «Clip c1»');
  });

  it('cae a "Editó" cuando el cambio no tiene campo propio', () => {
    const before = projectWith([clip('c1')]);
    const after = projectWith([clip('c1', { colorTag: 'red' })]);
    expect(describeHistoryStep(before, after)).toBe('Editó «Clip c1»');
  });

  it('etiqueta la importación de medios', () => {
    const before = projectWith([]);
    const after = projectWith([], [{ id: 'a1', label: 'entrevista.mp4' }]);
    expect(describeHistoryStep(before, after)).toBe('Importó «entrevista.mp4»');
  });

  it('sin cambios de clips ni medios reporta cambio genérico', () => {
    const before = projectWith([]);
    const after = projectWith([]);
    after.name = 'Otro nombre';
    expect(describeHistoryStep(before, after)).toBe('Cambio en el proyecto');
  });
});

describe('historyStepLabels', () => {
  it('genera una etiqueta por estado intermedio más el actual', () => {
    const s0 = projectWith([]);
    const s1 = projectWith([clip('c1')]);
    const project = projectWith([clip('c1'), clip('c2')]);
    expect(historyStepLabels([s0, s1], project)).toEqual([
      'Añadió video «Clip c1»',
      'Añadió video «Clip c2»',
    ]);
  });

  it('devuelve lista vacía sin estados', () => {
    const project = projectWith([]);
    expect(historyStepLabels([], project)).toEqual([]);
  });
});
