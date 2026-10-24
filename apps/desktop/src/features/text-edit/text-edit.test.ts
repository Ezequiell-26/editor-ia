import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import type { TranscriptionSegment } from '../../services/project-service';
import { addAsset, ensureDelivery, newId } from '../../state/project-actions';
import { readyAsset } from '../../test/fake-service';
import {
  buildTextEditProject,
  clipLabelForText,
  selectedDurationSeconds,
  transcriptToRanges,
  videoDurationFrames,
} from './text-edit';

const NOW = '2026-10-24T00:00:00.000Z';

function segment(start: number, end: number, text: string): TranscriptionSegment {
  return { start, end, text, words: [] };
}

function baseProject() {
  const asset = readyAsset({
    id: newId(),
    label: 'Entrevista',
    media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
  });
  const project = addAsset(ensureDelivery(createEmptyProject('Texto', NOW)), asset);
  return { asset, project };
}

describe('edición por texto · rangos', () => {
  it('convierte la transcripción en frames y respeta los segmentos excluidos', () => {
    const segments = [
      segment(0, 1, '  Hola   mundo  '),
      segment(1, 2, 'Este sobra'),
      segment(2, 2.5, 'Chau'),
    ];
    const ranges = transcriptToRanges(segments, 30, 300, [1]);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({
      index: 0,
      startFrame: 0,
      endFrame: 30,
      text: 'Hola mundo',
    });
    expect(ranges[1]).toMatchObject({ index: 2, startFrame: 60, endFrame: 75 });
    expect(selectedDurationSeconds(ranges, 30)).toBeCloseTo(1.5);
  });

  it('recorta al material real y exige al menos un frame', () => {
    const ranges = transcriptToRanges([segment(20, 30, 'Fuera de rango')], 30, 300);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.startFrame).toBe(299);
    expect(ranges[0]?.endFrame).toBe(300);
    expect(transcriptToRanges([segment(0, 0, '')], 30, 300)).toEqual([]);
  });

  it('acepta sólo videos con duración medida', () => {
    const { asset } = baseProject();
    expect(videoDurationFrames(asset)).toBe(300);
    expect(clipLabelForText('Hola')).toBe('Texto · Hola');
    expect(
      clipLabelForText(
        'Una frase mucho más larga que el límite de cincuenta y cuatro caracteres para la etiqueta',
      ),
    ).toMatch(/^Texto · .+…$/);
  });
});

describe('edición por texto · proyecto', () => {
  it('agrega una pista secuencial nueva sin tocar el material original', () => {
    const { asset, project } = baseProject();
    const built = buildTextEditProject(
      project,
      asset,
      [segment(0, 1, 'Hola'), segment(1, 2, 'Chau'), segment(2, 3, 'Final')],
      [1],
    );
    const parsed = parseProject(built.project);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const track = parsed.project.timeline.tracks.find((item) => item.id === built.trackId);
    expect(track?.label).toBe('Texto');
    const clips = parsed.project.timeline.clips.filter((clip) => clip.trackId === built.trackId);
    expect(clips.map((clip) => clip.startFrame)).toEqual([0, 30]);
    expect(clips.map((clip) => clip.durationFrames)).toEqual([30, 30]);
    expect(clips.map((clip) => clip.label)).toEqual(['Texto · Hola', 'Texto · Final']);
    expect(built.clipCount).toBe(2);
    expect(built.durationFrames).toBe(60);
  });

  it('falla si no queda ningún segmento seleccionado', () => {
    const { asset, project } = baseProject();
    expect(() =>
      buildTextEditProject(project, asset, [segment(0, 1, 'Hola')], [0]),
    ).toThrow(/al menos un segmento/i);
  });
});
