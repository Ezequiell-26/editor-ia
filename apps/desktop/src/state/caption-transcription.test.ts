import { describe, expect, it } from 'vitest';
import type { Asset, Clip, ProjectDocument, Track } from '@editor-ia/project-schema';
import { createEmptyProject, parseProject } from '@editor-ia/project-schema';
import {
  addAsset,
  addClipFromAsset,
  listTranscribableTimelineClips,
  newId,
  transcriptionSegmentsForClip,
} from './project-actions';

const NOW = '2025-01-01T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.project;
}

function base(): ProjectDocument {
  return validated(createEmptyProject('Subtitular', NOW));
}

function audioAsset(durationFrames = 300): Asset {
  return {
    id: newId(),
    label: 'Voz',
    kind: 'audio',
    source: { type: 'local', path: 'media/voz.wav' },
    status: 'ready',
    integrity: { sha256: 'b'.repeat(64), bytes: 5_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { sampleRate: 48_000, channels: 1, durationFrames },
  } as Asset;
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

function imageAsset(): Asset {
  return {
    id: newId(),
    label: 'Imagen',
    kind: 'image',
    source: { type: 'local', path: 'media/imagen.png' },
    status: 'ready',
    integrity: { sha256: 'e'.repeat(64), bytes: 8_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1024, height: 1024 },
  } as Asset;
}

function clipOf(project: ProjectDocument, clipId: string): Clip {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) throw new Error('clip no encontrado');
  return clip;
}

/** Audio clip con ventana propia sobre el asset (inFrame/outFrame en frames de proyecto). */
function windowedAudioClip(
  project: ProjectDocument,
  asset: Asset,
  window: { inFrame: number; outFrame: number; atFrame?: number },
): { project: ProjectDocument; clip: Clip } {
  const withAsset = addAsset(project, asset);
  const added = addClipFromAsset(withAsset, asset, {
    atFrame: window.atFrame ?? 0,
    inFrame: window.inFrame,
    outFrame: window.outFrame,
  });
  const next = validated(added.project);
  return { project: next, clip: clipOf(next, added.clipId) };
}

describe('listTranscribableTimelineClips', () => {
  it('incluye clips de video y audio con asset, excluye imagen y fuentes sin ventana', () => {
    const project = base();
    const audio = audioAsset(300);
    const video = videoAsset(300);
    const image = imageAsset();
    const withAssets = [audio, video, image].reduce(
      (acc, asset) => addAsset(acc, asset),
      project,
    );
    const a = addClipFromAsset(withAssets, audio, { atFrame: 0 });
    const v = addClipFromAsset(a.project, video, { atFrame: 300 });
    const i = addClipFromAsset(v.project, image, { atFrame: 600 });
    const next = validated(i.project);

    const clips = listTranscribableTimelineClips(next);
    expect(clips.map((clip) => clip.kind).sort()).toEqual(['audio', 'video']);
  });

  it('excluye clips cuyo asset ya no está en el proyecto y ordena por startFrame', () => {
    const project = base();
    const audio = audioAsset(300);
    const withAsset = addAsset(project, audio);
    const late = addClipFromAsset(withAsset, audio, {
      atFrame: 200,
      inFrame: 0,
      outFrame: 90,
    });
    const early = addClipFromAsset(late.project, audio, {
      atFrame: 0,
      inFrame: 90,
      outFrame: 180,
    });
    const next = validated(early.project);
    // Clip que referencia un asset inexistente: el schema lo rechazaría, así
    // que se inyecta post-validación sólo para probar el filtro del helper.
    const track = next.timeline.tracks.find((item) => item.kind === 'audio');
    if (!track) throw new Error('sin pista de audio');
    next.timeline.clips.push({
      id: newId(),
      trackId: track.id,
      kind: 'audio',
      startFrame: 400,
      durationFrames: 30,
      source: { type: 'asset', assetId: newId(), inFrame: 0, outFrame: 30 },
    } as Clip);
    const clips = listTranscribableTimelineClips(next);
    expect(clips).toHaveLength(2);
    expect(clips.map((clip) => clip.startFrame)).toEqual([0, 200]);
  });
});

describe('transcriptionSegmentsForClip', () => {
  it('corre los segmentos asset-absolute a segundos relativos al clip con inFrame > 0', () => {
    const project = base();
    const audio = audioAsset(300); // 10 s a 30 fps
    // Ventana 90..210 frames = 3 s..7 s del asset.
    const { clip } = windowedAudioClip(project, audio, { inFrame: 90, outFrame: 210 });
    const plan = transcriptionSegmentsForClip(
      [
        { start: 0, end: 2, text: 'antes de la ventana' },
        { start: 3, end: 4, text: 'dentro' },
        { start: 6.5, end: 9, text: 'cruza el final' },
      ],
      clip,
      30,
    );
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0]).toMatchObject({ start: 0, end: 1, text: 'dentro' });
    // 6.5 s -> (6.5 - 3) = 3.5 s; 7 s (outFrame) -> 4 s, recortado.
    expect(plan.segments[1]).toMatchObject({ start: 3.5, end: 4, text: 'cruza el final' });
  });

  it('conserva y remapea las palabras dentro de la ventana', () => {
    const project = base();
    const audio = audioAsset(300);
    const { clip } = windowedAudioClip(project, audio, { inFrame: 90, outFrame: 210 });
    const plan = transcriptionSegmentsForClip(
      [
        {
          start: 3,
          end: 5,
          text: 'hola mundo',
          words: [
            { start: 3, end: 3.5, word: 'hola' },
            { start: 3.5, end: 4, word: 'mundo' },
            { start: 1, end: 1.5, word: 'fuera' },
          ],
        },
      ],
      clip,
      30,
    );
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.segments[0]?.words).toEqual([
      { word: 'hola', start: 0, end: 0.5 },
      { word: 'mundo', start: 0.5, end: 1 },
    ]);
  });

  it('divide los tiempos por la velocidad constante del clip', () => {
    const project = base();
    const audio = audioAsset(300);
    const { project: withClip, clip } = windowedAudioClip(project, audio, {
      inFrame: 0,
      outFrame: 120,
    });
    // Clip de 2x: 120 frames de fuente -> 60 frames de salida (2 s a 30 fps).
    const assetId = 'assetId' in clip.source ? clip.source.assetId : '';
    const sped = validated({
      ...withClip,
      timeline: {
        ...withClip.timeline,
        clips: withClip.timeline.clips.map((item) =>
          item.id === clip.id
            ? ({
                ...item,
                durationFrames: 60,
                source: { type: 'asset' as const, assetId, inFrame: 0, outFrame: 120 },
                speed: { num: 2, den: 1 },
              } as Clip)
            : item,
        ),
      },
    });
    const spedClip = clipOf(sped, clip.id);
    const plan = transcriptionSegmentsForClip(
      [{ start: 1, end: 3, text: 'rápido' }],
      spedClip,
      30,
    );
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    // 4 s de fuente a 2x -> 2 s de salida.
    expect(plan.segments[0]).toMatchObject({ start: 0.5, end: 1.5 });
  });

  it('reporta unsupported en clips con reverse o speedCurve', () => {
    const project = base();
    const video = videoAsset(300);
    const withAsset = addAsset(project, video);
    const track: Track = {
      id: newId(),
      kind: 'video',
      label: 'V1',
      order: 0,
      muted: false,
      hidden: false,
      locked: false,
    };
    withAsset.timeline.tracks.push(track);
    withAsset.timeline.clips.push({
      id: newId(),
      trackId: track.id,
      kind: 'video',
      startFrame: 0,
      durationFrames: 100,
      reverse: true,
      source: { type: 'asset', assetId: video.id, inFrame: 0, outFrame: 100 },
    } as Clip);
    const reversed = validated(withAsset);
    const reversedClip = reversed.timeline.clips[0];
    expect(reversedClip).toBeDefined();
    const planReverse = transcriptionSegmentsForClip(
      [{ start: 0, end: 1, text: 'x' }],
      reversedClip!,
      30,
    );
    expect(planReverse.status).toBe('unsupported');

    const first = withAsset.timeline.clips[0] as Clip & { reverse?: boolean };
    const { reverse: _reverse, ...withoutReverse } = first;
    withAsset.timeline.clips[0] = {
      ...withoutReverse,
      speedCurve: { points: [{ t: 0, speed: 1 }, { t: 1, speed: 1 }] },
    } as Clip;
    const curved = validated(withAsset);
    const planCurve = transcriptionSegmentsForClip(
      [{ start: 0, end: 1, text: 'x' }],
      curved.timeline.clips[0]!,
      30,
    );
    expect(planCurve.status).toBe('unsupported');
  });

  it('devuelve empty cuando ningún segmento cae dentro de la ventana', () => {
    const project = base();
    const audio = audioAsset(300);
    const { clip } = windowedAudioClip(project, audio, { inFrame: 200, outFrame: 280 });
    const plan = transcriptionSegmentsForClip(
      [{ start: 0, end: 1, text: 'muy al principio' }],
      clip,
      30,
    );
    expect(plan.status).toBe('empty');
  });
});
