import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { readyAsset } from '../test/fake-service';
import { addAsset, addCaptionCue, addClipFromAsset, ensureDelivery } from './project-actions';
import { applySpeakerSegments, speakerLabel } from './speakers';

const NOW = '2026-11-02T00:00:00.000Z';

function projectWithCues(): { project: ProjectDocument; clipId: string } {
  const asset = readyAsset({
    kind: 'audio',
    label: 'Entrevista',
    source: { type: 'local', path: 'media/entrevista.wav' },
    media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
  });
  let project = addAsset(ensureDelivery(createEmptyProject('Habla', NOW)), asset);
  const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 150 });
  project = added.project;
  const seeded = addCaptionCue(project, { text: 'base', startFrame: 0, durationFrames: 1 });
  project = {
    ...seeded.project,
    captions: {
      ...seeded.project.captions,
      cues: [
        {
          id: '00000000-0000-4000-8000-00000000000c',
          trackId: seeded.trackId,
          text: 'Hola, ¿cómo estás?',
          language: 'es',
          startFrame: 0,
          endFrame: 30,
        },
        {
          id: '00000000-0000-4000-8000-00000000000d',
          trackId: seeded.trackId,
          text: 'Muy bien, gracias.',
          language: 'es',
          startFrame: 60,
          endFrame: 90,
        },
      ],
    },
  } as ProjectDocument;
  return { project, clipId: added.clipId };
}

describe('speakerLabel', () => {
  it('traduce identificadores numéricos y de letra', () => {
    expect(speakerLabel('0')).toBe('Hablante 1');
    expect(speakerLabel('1')).toBe('Hablante 2');
    expect(speakerLabel('B')).toBe('Hablante B');
    expect(speakerLabel('locutor')).toBe('locutor');
  });

  it('respeta los nombres configurados', () => {
    expect(speakerLabel('0', { '0': 'Ana' })).toBe('Ana');
  });
});

describe('applySpeakerSegments', () => {
  const segments = [
    { start: 0, end: 1.5, text: 'Hola, ¿cómo estás?', speaker: '0' },
    { start: 1.5, end: 3, text: 'Muy bien, gracias.', speaker: '1' },
  ];

  it('asigna el hablante por solapamiento mayor', () => {
    const { project, clipId } = projectWithCues();
    const result = applySpeakerSegments(project, clipId, segments);
    expect(result.labelled).toBe(2);
    const [first, second] = result.project.captions.cues;
    expect(first?.speaker).toBe('Hablante 1');
    expect(second?.speaker).toBe('Hablante 2');
  });

  it('antepone la etiqueta sólo si se pide', () => {
    const { project, clipId } = projectWithCues();
    const prefixed = applySpeakerSegments(project, clipId, segments, { prefix: true });
    expect(prefixed.project.captions.cues[0]?.text).toBe('Hablante 1: Hola, ¿cómo estás?');
    const plain = applySpeakerSegments(project, clipId, segments);
    expect(plain.project.captions.cues[0]?.text).toBe('Hola, ¿cómo estás?');
  });

  it('usa los nombres configurados', () => {
    const { project, clipId } = projectWithCues();
    const result = applySpeakerSegments(project, clipId, segments, {
      labels: { '0': 'Ana', '1': 'Beto' },
    });
    expect(result.project.captions.cues.map((cue) => cue.speaker)).toEqual(['Ana', 'Beto']);
  });

  it('sin tramos no toca nada', () => {
    const { project, clipId } = projectWithCues();
    const result = applySpeakerSegments(project, clipId, []);
    expect(result.project).toBe(project);
    expect(result.labelled).toBe(0);
  });

  it('no etiqueta cues fuera de la ventana del clip', () => {
    const { project, clipId } = projectWithCues();
    const result = applySpeakerSegments(project, clipId, segments);
    const outside = result.project.captions.cues.filter(
      (cue) => cue.startFrame >= 150 || cue.endFrame <= 0,
    );
    expect(outside.every((cue) => cue.speaker === undefined)).toBe(true);
  });
});
