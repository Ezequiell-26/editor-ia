import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  type Clip,
  type ProjectDocument,
  type Track,
} from '@editor-ia/project-schema';
import { activeAt, buildPreviewClipIndex } from './preview-index';

function track(
  id: string,
  kind: Track['kind'],
  order: number,
  extra: Partial<Track> = {},
): Track {
  return {
    id,
    kind,
    label: `Pista ${id}`,
    order,
    muted: false,
    hidden: false,
    locked: false,
    ...extra,
  } as Track;
}

function clip(partial: Partial<Clip> & { id: string }): Clip {
  return {
    trackId: 'v1',
    kind: 'video',
    label: partial.id,
    startFrame: 0,
    durationFrames: 30,
    source: { type: 'asset', assetId: 'a1', inFrame: 0, outFrame: 30 },
    ...partial,
  } as Clip;
}

function projectWith(clips: Clip[], tracks: Track[]): ProjectDocument {
  const base = createEmptyProject('Ventanas', '2026-01-01T00:00:00.000Z');
  return { ...base, timeline: { tracks, clips } } as ProjectDocument;
}

const idsAt = (
  entries: ReturnType<typeof buildPreviewClipIndex>['visual'],
  frame: number,
): string[] => activeAt(entries, frame).map((entry) => entry.clip.id);

describe('buildPreviewClipIndex', () => {
  it('visual: ventana sin lead, con lead por transición y orden de composición', () => {
    const project = projectWith(
      [
        clip({ id: 'entrada', trackId: 'v1', startFrame: 160, durationFrames: 60, transitionIn: { type: 'dissolve', frames: 30 } }),
        clip({ id: 'plano', trackId: 'v2', startFrame: 0, durationFrames: 300 }),
      ],
      [track('v1', 'video', 0), track('v2', 'video', 1)],
    );
    const index = buildPreviewClipIndex(project);
    // Mismo orden que comparePreviewClips: (pista, inicio) — v1 va debajo de v2.
    expect(index.visual.map((entry) => entry.clip.id)).toEqual(['entrada', 'plano']);
    const entrada = index.visual.find((entry) => entry.clip.id === 'entrada');
    expect(entrada?.start).toBe(160 - 30);
    expect(entrada?.end).toBe(220);
    expect(idsAt(index.visual, 129)).toEqual(['plano']);
    expect(idsAt(index.visual, 130)).toEqual(['entrada', 'plano']);
    expect(idsAt(index.visual, 219)).toEqual(['entrada', 'plano']);
    expect(idsAt(index.visual, 220)).toEqual(['plano']);
  });

  it('excluye pistas ocultas, clips deshabilitados y pistas de kinds ajenos', () => {
    const project = projectWith(
      [
        clip({ id: 'ok', trackId: 'v1' }),
        clip({ id: 'off', trackId: 'v1', enabled: false }),
        clip({ id: 'hidden', trackId: 'v2' }),
        clip({ id: 'caption', trackId: 'cap', kind: 'video' } as never),
        clip({ id: 'orphan', trackId: 'no-existe' }),
      ],
      [
        track('v1', 'video', 0),
        track('v2', 'video', 1, { hidden: true }),
        track('cap', 'caption', 2),
      ],
    );
    const index = buildPreviewClipIndex(project);
    expect(index.visual.map((entry) => entry.clip.id)).toEqual(['ok']);
  });

  it('acepta pistas image y graphic como visuales', () => {
    const project = projectWith(
      [
        clip({ id: 'img', trackId: 'img', kind: 'image', source: { type: 'still', assetId: 'a1' } } as never),
        clip({ id: 'gfx', trackId: 'gfx', kind: 'graphic', source: { type: 'graphic', motionId: 'm' } } as never),
      ],
      [track('img', 'image', 0), track('gfx', 'graphic', 1)],
    );
    const index = buildPreviewClipIndex(project);
    expect(index.visual.map((entry) => entry.clip.id)).toEqual(['img', 'gfx']);
  });

  it('audio: kinds audio/narration, respeta mute y solo, sin lead', () => {
    const project = projectWith(
      [
        clip({ id: 'au', trackId: 'a1', kind: 'audio' }),
        clip({ id: 'nar', trackId: 'a2', kind: 'audio' }),
        clip({ id: 'muted', trackId: 'a3', kind: 'audio' }),
        clip({ id: 'soloed', trackId: 'a4', kind: 'audio', startFrame: 50 }),
        clip({ id: 'on-video-track', trackId: 'v1', kind: 'audio' }),
      ],
      [
        track('a1', 'audio', 0),
        track('a2', 'narration', 1),
        track('a3', 'audio', 2, { muted: true }),
        track('a4', 'audio', 3, { solo: true }),
        track('v1', 'video', 4),
      ],
    );
    const index = buildPreviewClipIndex(project);
    // Con solo activo sólo suena la pista en solo; orden = array del proyecto.
    expect(index.audio.map((entry) => entry.clip.id)).toEqual(['soloed']);
    expect(index.audio[0]?.start).toBe(50);
  });

  it('adjustments: sólo kind adjustment en pista no oculta, orden de composición', () => {
    const project = projectWith(
      [
        clip({ id: 'adj2', trackId: 'adj', kind: 'adjustment', source: { type: 'adjustment' }, startFrame: 200 } as never),
        clip({ id: 'adj1', trackId: 'adj', kind: 'adjustment', source: { type: 'adjustment' }, startFrame: 10, durationFrames: 300 } as never),
        clip({ id: 'adj-hidden', trackId: 'adj2', kind: 'adjustment', source: { type: 'adjustment' } } as never),
        clip({ id: 'notadj', trackId: 'adj', kind: 'video' }),
      ],
      [track('adj', 'adjustment', 0), track('adj2', 'adjustment', 1, { hidden: true })],
    );
    const index = buildPreviewClipIndex(project);
    expect(index.adjustment.map((entry) => entry.clip.id)).toEqual(['adj1', 'adj2']);
    const idsAdj = (frame: number) =>
      activeAt(index.adjustment, frame).map((entry) => entry.clip.id);
    expect(idsAdj(15)).toEqual(['adj1']);
    expect(idsAdj(205)).toEqual(['adj1', 'adj2']);
  });
});
