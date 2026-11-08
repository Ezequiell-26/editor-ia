import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  type Asset,
  type Clip,
  type ProjectDocument,
  type Track,
} from '@editor-ia/project-schema';
import { isTrackAudible } from '../../state/audio-mix';
import {
  activeAt,
  buildPreviewClipIndex,
  clipActiveAt,
  type PreviewClipEntry,
} from './preview-index';

function track(id: string, partial: Partial<Track> = {}): Track {
  return {
    id,
    kind: 'video',
    label: `Pista ${id}`,
    order: 0,
    muted: false,
    hidden: false,
    locked: false,
    ...partial,
  } as Track;
}

function clip(partial: { id: string } & Record<string, unknown>): Clip {
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

function asset(id: string): Asset {
  return { id, kind: 'video', label: id } as Asset;
}

function projectWith(
  clips: Clip[],
  tracks: Track[],
  assets: Asset[] = [asset('a1')],
): ProjectDocument {
  const base = createEmptyProject('Preview', '2026-01-01T00:00:00.000Z');
  return { ...base, assets, timeline: { tracks, clips } } as ProjectDocument;
}

// Referencia: la lógica que hacía el Preview antes del índice (filter + sort
// por frame con `find` de pista/asset). La paridad se verifica frame a frame.
function naiveVisual(project: ProjectDocument, frame: number): Clip[] {
  const trackById = (id: string) => project.timeline.tracks.find((t) => t.id === id);
  return project.timeline.clips
    .filter((c) => {
      const t = trackById(c.trackId);
      if (!t || t.hidden) return false;
      if (!['video', 'image', 'graphic'].includes(t.kind)) return false;
      if (c.enabled === false) return false;
      return frame >= c.startFrame && frame < c.startFrame + c.durationFrames;
    })
    .sort((a, b) => (trackById(a.trackId)?.order ?? 0) - (trackById(b.trackId)?.order ?? 0));
}

function naiveAudio(project: ProjectDocument, frame: number): Clip[] {
  const trackById = (id: string) => project.timeline.tracks.find((t) => t.id === id);
  return project.timeline.clips.filter((c) => {
    const t = trackById(c.trackId);
    if (!t || !isTrackAudible(t, project.timeline.tracks)) return false;
    if (!['audio', 'narration'].includes(t.kind)) return false;
    if (c.enabled === false) return false;
    return frame >= c.startFrame && frame < c.startFrame + c.durationFrames;
  });
}

function naiveAdjustment(project: ProjectDocument, frame: number): Clip[] {
  const trackById = (id: string) => project.timeline.tracks.find((t) => t.id === id);
  return project.timeline.clips
    .filter((c): c is Extract<Clip, { kind: 'adjustment' }> => {
      if (c.kind !== 'adjustment') return false;
      if (c.enabled === false) return false;
      const t = trackById(c.trackId);
      if (!t || t.hidden) return false;
      return frame >= c.startFrame && frame < c.startFrame + c.durationFrames;
    })
    .sort(
      (a, b) => (trackById(a.trackId)?.order ?? 0) - (trackById(b.trackId)?.order ?? 0),
    );
}

const ids = (entries: readonly PreviewClipEntry[]) => entries.map((e) => e.clip.id);

describe('buildPreviewClipIndex', () => {
  it('resuelve asset y track por clip y clasifica visual/audio/ajuste', () => {
    const project = projectWith(
      [
        clip({ id: 'v-on-v1' }),
        clip({ id: 'v-on-image', trackId: 'i1', kind: 'image', source: { type: 'asset', assetId: 'ghost', inFrame: 0, outFrame: 30 } }),
        clip({ id: 'a-on-audio', trackId: 'a1', kind: 'audio' }),
        clip({ id: 'adj', trackId: 'v1', kind: 'adjustment', source: { type: 'adjustment' } }),
        clip({ id: 'off', enabled: false }),
        clip({ id: 'hidden-track', trackId: 'h1' }),
        clip({ id: 'no-track', trackId: 'missing' }),
      ],
      [
        track('v1', { kind: 'video', order: 1 }),
        track('i1', { kind: 'image', order: 2 }),
        track('a1', { kind: 'audio', order: 3 }),
        track('h1', { kind: 'video', order: 4, hidden: true }),
      ],
    );
    const index = buildPreviewClipIndex(project);
    expect(ids(index.visual)).toEqual(['v-on-v1', 'adj', 'v-on-image']);
    expect(ids(index.audio)).toEqual(['a-on-audio']);
    expect(ids(index.adjustment)).toEqual(['adj']);
    const entry = index.visual.find((e) => e.clip.id === 'v-on-v1');
    expect(entry?.track?.id).toBe('v1');
    expect(entry?.asset?.id).toBe('a1');
    const graphic = index.visual.find((e) => e.clip.id === 'v-on-image');
    expect(graphic?.asset).toBeUndefined();
  });

  it('ordena lo visual y el ajuste por order de pista y respeta el orden de clips en audio', () => {
    const project = projectWith(
      [
        clip({ id: 'late-high', trackId: 'top', startFrame: 0 }),
        clip({ id: 'early-low', trackId: 'bottom', startFrame: 0 }),
        clip({ id: 'snd1', trackId: 'a1', kind: 'audio', startFrame: 0 }),
        clip({ id: 'snd2', trackId: 'a1', kind: 'audio', startFrame: 10 }),
        clip({ id: 'adj-low', trackId: 'bottom', kind: 'adjustment', source: { type: 'adjustment' } }),
        clip({ id: 'adj-top', trackId: 'top', kind: 'adjustment', source: { type: 'adjustment' } }),
      ],
      [
        track('bottom', { order: 0 }),
        track('top', { order: 5 }),
        track('a1', { kind: 'audio', order: 9 }),
      ],
    );
    const index = buildPreviewClipIndex(project);
    expect(ids(index.visual)).toEqual(['early-low', 'adj-low', 'late-high', 'adj-top']);
    expect(ids(index.adjustment)).toEqual(['adj-low', 'adj-top']);
    expect(ids(index.audio)).toEqual(['snd1', 'snd2']);
  });

  it('un solo de audio silencia las demás pistas auditables', () => {
    const project = projectWith(
      [
        clip({ id: 'a', trackId: 'a1', kind: 'audio' }),
        clip({ id: 'b', trackId: 'a2', kind: 'audio' }),
      ],
      [
        track('a1', { kind: 'audio', order: 0 }),
        track('a2', { kind: 'audio', order: 1, solo: true }),
      ],
    );
    expect(ids(buildPreviewClipIndex(project).audio)).toEqual(['b']);
  });
});

describe('activeAt / clipActiveAt', () => {
  it('incluye el frame inicial y excluye el final del clip', () => {
    const c = clip({ id: 'x', startFrame: 10, durationFrames: 5 });
    expect(clipActiveAt(c, 9)).toBe(false);
    expect(clipActiveAt(c, 10)).toBe(true);
    expect(clipActiveAt(c, 14)).toBe(true);
    expect(clipActiveAt(c, 15)).toBe(false);
  });
});

describe('paridad con la selección anterior del Preview', () => {
  it('devuelve los mismos clips que la lógica naive en cada frame', () => {
    const project = projectWith(
      [
        clip({ id: 'v1a', trackId: 'v1', startFrame: 0, durationFrames: 100 }),
        clip({ id: 'v1b', trackId: 'v1', startFrame: 50, durationFrames: 100 }),
        clip({ id: 'v2a', trackId: 'v2', kind: 'image', startFrame: 30, durationFrames: 60 }),
        clip({ id: 'v2hidden', trackId: 'h1', startFrame: 0, durationFrames: 200 }),
        clip({ id: 'a1', trackId: 'a1', kind: 'audio', startFrame: 10, durationFrames: 80 }),
        clip({ id: 'a2', trackId: 'a2', kind: 'audio', startFrame: 40, durationFrames: 50 }),
        clip({ id: 'adj1', trackId: 'adj', kind: 'adjustment', startFrame: 20, durationFrames: 90, source: { type: 'adjustment' } }),
        clip({ id: 'off', trackId: 'v1', startFrame: 0, durationFrames: 500, enabled: false }),
        clip({ id: 'orphan', trackId: 'ghost', startFrame: 0, durationFrames: 500 }),
      ],
      [
        track('v1', { order: 0 }),
        track('v2', { kind: 'image', order: 1 }),
        track('h1', { order: 2, hidden: true }),
        track('a1', { kind: 'audio', order: 3 }),
        track('a2', { kind: 'narration', order: 4, muted: true }),
        track('adj', { kind: 'adjustment', order: 5 }),
      ],
    );
    const index = buildPreviewClipIndex(project);
    for (let frame = 0; frame <= 160; frame += 1) {
      expect(ids(activeAt(index.visual, frame))).toEqual(
        naiveVisual(project, frame).map((c) => c.id),
      );
      expect(ids(activeAt(index.audio, frame))).toEqual(
        naiveAudio(project, frame).map((c) => c.id),
      );
      expect(ids(activeAt(index.adjustment, frame))).toEqual(
        naiveAdjustment(project, frame).map((c) => c.id),
      );
    }
  });
});

describe('costo por tick de reproducción', () => {
  // Timeline pesada: 240 clips repartidos en 6 pistas sobre 6000 frames
  // (200 s a 30 fps). Se miden 300 ticks consecutivos (~10 s de playback).
  function heavyProject(): ProjectDocument {
    const tracks = [
      track('v1', { order: 0 }),
      track('v2', { order: 1 }),
      track('v3', { order: 2 }),
      track('i1', { kind: 'image', order: 3 }),
      track('a1', { kind: 'audio', order: 4 }),
      track('a2', { kind: 'audio', order: 5 }),
    ];
    const clips: Clip[] = [];
    const kinds = ['video', 'video', 'video', 'image', 'audio', 'audio'] as const;
    for (let i = 0; i < 240; i += 1) {
      const trackIndex = i % tracks.length;
      const t = tracks[trackIndex]!;
      clips.push(
        clip({
          id: `c${i}`,
          trackId: t.id,
          kind: kinds[trackIndex] as Clip['kind'],
          startFrame: (i * 37) % 5700,
          durationFrames: 60 + (i % 5) * 30,
        }),
      );
    }
    return projectWith(clips, tracks);
  }

  it('la selección por frame escala mejor que el filter+sort naive', () => {
    const project = heavyProject();
    const index = buildPreviewClipIndex(project);
    const TICKS = 300;

    const t0 = performance.now();
    for (let frame = 0; frame < TICKS; frame += 1) {
      activeAt(index.visual, frame);
      activeAt(index.audio, frame);
      activeAt(index.adjustment, frame);
    }
    const indexedMs = performance.now() - t0;

    const t1 = performance.now();
    for (let frame = 0; frame < TICKS; frame += 1) {
      naiveVisual(project, frame);
      naiveAudio(project, frame);
      naiveAdjustment(project, frame);
    }
    const naiveMs = performance.now() - t1;

    // El índice debe ser claramente más barato; la cota es holgada para no
    // ser flaky en CI — el número real queda en el informe/memoria.
    expect(indexedMs).toBeLessThan(naiveMs);
    expect(indexedMs / TICKS).toBeLessThan(2);
    console.log(
      `[preview-index] ${TICKS} ticks · indexed ${(indexedMs / TICKS).toFixed(3)} ms/tick · naive ${(naiveMs / TICKS).toFixed(3)} ms/tick`,
    );
  });
});
