import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { addAsset, addClipFromAsset, ensureDelivery } from './project-actions';
import { readyAsset } from '../test/fake-service';
import {
  applySpeechCuts,
  cuesForClip,
  planSpeechCutsFromCues,
  planSpeechCutsFromIntervals,
  planSpeechCutsFromTranscript,
} from './speech-cuts';

const FPS = 30;
const NOW = '2026-11-02T00:00:00.000Z';
const CLIP = { startFrame: 0, durationFrames: 150 };

function word(start: number, end: number) {
  return { startFrame: Math.round(start * FPS), endFrame: Math.round(end * FPS) };
}

describe('planSpeechCutsFromIntervals', () => {
  it('recorta la pausa entre dos frases y conserva el aire pedido', () => {
    const plan = planSpeechCutsFromIntervals(
      [word(0, 1), word(2, 3)],
      CLIP,
      FPS,
    );
    expect(plan).not.toBeNull();
    expect(plan!.pauses).toBe(1);
    // Pausa 1–2 s, padding 0,08 s por lado → 32–58 frames.
    expect(plan!.spans).toEqual([{ startFrame: 32, endFrame: 58 }]);
    expect(plan!.removedSeconds).toBeCloseTo(26 / FPS, 3);
    expect(plan!.cutFrames).toEqual([32, 58]);
    expect(plan!.excessive).toBe(false);
  });

  it('no corta una respiración corta dentro de la misma frase', () => {
    const plan = planSpeechCutsFromIntervals(
      [word(0, 0.5), word(0.6, 1.0), word(1.1, 1.5)],
      CLIP,
      FPS,
    );
    expect(plan).toBeNull();
  });

  it('fusiona palabras solapadas antes de medir la pausa', () => {
    const plan = planSpeechCutsFromIntervals(
      [word(0, 1.2), word(1.0, 2), word(3, 4)],
      CLIP,
      FPS,
    );
    expect(plan!.pauses).toBe(1);
    expect(plan!.spans[0]!.startFrame).toBe(Math.round(2 * FPS + 0.08 * FPS));
  });

  it('marca excesivo un plan que borraría casi todo el clip', () => {
    const plan = planSpeechCutsFromIntervals([word(0, 0.2), word(4.8, 5)], CLIP, FPS);
    expect(plan!.excessive).toBe(true);
  });

  it('ignora lo que cae fuera de la ventana del clip', () => {
    const plan = planSpeechCutsFromIntervals(
      [word(-2, -1), word(0.2, 1), word(2, 3), word(7, 8)],
      CLIP,
      FPS,
    );
    expect(plan!.cutFrames.every((frame) => frame > 0 && frame < 150)).toBe(true);
    expect(plan!.pauses).toBe(1);
  });

  it('sin pausa suficiente o sin habla no inventa un plan', () => {
    expect(planSpeechCutsFromIntervals([], CLIP, FPS)).toBeNull();
    expect(planSpeechCutsFromIntervals([word(0, 5)], CLIP, FPS)).toBeNull();
  });
});

describe('planSpeechCutsFromCues', () => {
  it('usa las palabras del subtítulo cuando existen', () => {
    const plan = planSpeechCutsFromCues(
      [
        { ...word(0, 1), words: [word(0, 0.5), word(0.5, 1)] },
        { ...word(2, 3), words: [word(2, 2.5), word(2.5, 3)] },
      ],
      CLIP,
      FPS,
    );
    expect(plan!.pauses).toBe(1);
    expect(plan!.spans[0]).toEqual({ startFrame: 32, endFrame: 58 });
  });

  it('cae al rango del cue cuando no hay palabras', () => {
    const plan = planSpeechCutsFromCues(
      [word(0, 1), word(2, 3)],
      CLIP,
      FPS,
    );
    expect(plan!.pauses).toBe(1);
  });
});

describe('planSpeechCutsFromTranscript', () => {
  it('mapea los segundos de la transcripción a frames del clip', () => {
    const plan = planSpeechCutsFromTranscript(
      [
        { start: 0, end: 1, words: [{ start: 0, end: 0.5 }, { start: 0.5, end: 1 }] },
        { start: 2, end: 3, words: [{ start: 2, end: 2.5 }, { start: 2.5, end: 3 }] },
      ],
      CLIP,
      FPS,
    );
    expect(plan!.spans[0]).toEqual({ startFrame: 32, endFrame: 58 });
  });
});

function projectWithVoice(): {
  project: ReturnType<typeof createEmptyProject>;
  clipId: string;
} {
  const asset = readyAsset({
    kind: 'audio',
    label: 'Narración',
    source: { type: 'local', path: 'media/narracion.wav' },
    media: { sampleRate: 48_000, channels: 1, durationFrames: 300 },
  });
  let project = addAsset(ensureDelivery(createEmptyProject('Pausas', NOW)), asset);
  const added = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 150 });
  project = added.project;
  return { project, clipId: added.clipId };
}

describe('applySpeechCuts', () => {
  it('divide el clip, elimina la pausa con ripple y corre los subtítulos', () => {
    const { project, clipId } = projectWithVoice();
    const withCues = {
      ...project,
      captions: {
        styles: [],
        cues: [
          {
            id: 'c1',
            trackId: 't',
            text: 'Después de la pausa',
            language: 'es',
            startFrame: 90,
            endFrame: 120,
          },
        ],
      },
    } as typeof project;
    const plan = planSpeechCutsFromCues([word(0, 1), word(2, 3)], CLIP, FPS);
    expect(plan).not.toBeNull();
    const next = applySpeechCuts(withCues, clipId, plan!);
    expect(next).not.toBe(project);
    const clips = next.timeline.clips.filter((clip) => clip.kind === 'audio');
    expect(clips).toHaveLength(2);
    expect(clips[0]!.durationFrames).toBe(32);
    // El segundo arranca donde terminó el primero: la pausa desapareció.
    expect(clips[1]!.startFrame).toBe(32);
    // El subtítulo posterior se corrió los mismos 26 frames que el corte.
    expect(next.captions.cues[0]!.startFrame).toBe(64);
    expect(next.captions.cues[0]!.endFrame).toBe(94);
  });

  it('un plan excesivo no toca el proyecto', () => {
    const { project, clipId } = projectWithVoice();
    const plan = planSpeechCutsFromCues([word(0, 0.2), word(4.8, 5)], CLIP, FPS);
    expect(plan!.excessive).toBe(true);
    expect(applySpeechCuts(project, clipId, plan!)).toBe(project);
  });
});

describe('cuesForClip', () => {
  it('devuelve sólo los subtítulos que tocan la ventana del clip', () => {
    const { project, clipId } = projectWithVoice();
    const withCues = {
      ...project,
      captions: {
        styles: [],
        cues: [
          { id: 'a', trackId: 't', text: 'antes', language: 'es', startFrame: 200, endFrame: 230 },
          { id: 'b', trackId: 't', text: 'dentro', language: 'es', startFrame: 10, endFrame: 40 },
          { id: 'c', trackId: 't', text: 'después', language: 'es', startFrame: 300, endFrame: 330 },
        ],
      },
    } as typeof project;
    const cues = cuesForClip(withCues, clipId);
    expect(cues.map((cue) => cue.startFrame)).toEqual([10]);
  });
});
