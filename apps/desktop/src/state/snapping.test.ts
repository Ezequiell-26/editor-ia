import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import {
  collectSnapTargets,
  snapFrame,
  snapSpan,
  snapThreshold,
} from './snapping';

function project(): ProjectDocument {
  const base = createEmptyProject('Snap', '2026-01-01T00:00:00.000Z');
  return {
    ...base,
    markers: [
      { id: 'marker-1', frame: 60, label: 'Coro' },
    ],
    timeline: {
      tracks: [
        { id: 'v1', kind: 'video', label: 'Video 1', order: 0, muted: false, hidden: false, locked: false },
        { id: 'a1', kind: 'narration', label: 'Voz', order: 1, muted: false, hidden: false, locked: false },
      ],
      clips: [
        {
          id: 'clip-v',
          trackId: 'v1',
          kind: 'video',
          label: 'Toma',
          startFrame: 0,
          durationFrames: 30,
          source: {
            type: 'asset',
            assetId: 'asset-1',
            inFrame: 0,
            outFrame: 30,
          },
        },
        {
          id: 'clip-a',
          trackId: 'a1',
          kind: 'audio',
          label: 'Voz',
          startFrame: 100,
          durationFrames: 30,
          source: {
            type: 'asset',
            assetId: 'asset-2',
            inFrame: 0,
            outFrame: 30,
          },
        },
      ],
    },
  } as ProjectDocument;
}

describe('collectSnapTargets', () => {
  it('collects origin, playhead, markers and edges from every track', () => {
    const targets = collectSnapTargets(project(), {
      excludeClipId: 'clip-v',
      playhead: 45,
    });
    expect(targets.map((target) => target.frame)).toEqual([0, 45, 60, 100, 130]);
    expect(targets.find((target) => target.frame === 60)?.kind).toBe('marker');
    expect(targets.find((target) => target.frame === 100)?.label).toBe('Voz');
  });

  it('excludes the dragged clip edges', () => {
    const targets = collectSnapTargets(project(), {
      excludeClipId: 'clip-v',
      playhead: 45,
    });
    expect(targets.some((target) => target.frame === 30)).toBe(false);
  });
});

describe('snapFrame', () => {
  const targets = collectSnapTargets(project(), { playhead: 45 });

  it('snaps to the closest target inside the threshold', () => {
    const result = snapFrame(62, targets, 5);
    expect(result.frame).toBe(60);
    expect(result.target?.kind).toBe('marker');
  });

  it('leaves the frame alone when no target is close enough', () => {
    expect(snapFrame(75, targets, 5)).toEqual({ frame: 75 });
  });
});

describe('snapSpan', () => {
  const targets = collectSnapTargets(project(), { playhead: 45 });

  it('snaps the end edge when it is closer than the start', () => {
    const result = snapSpan(72, 30, targets, 5);
    expect(result.start).toBe(70);
    expect(result.target?.frame).toBe(100);
  });

  it('snaps the start edge when it is closer', () => {
    const result = snapSpan(58, 30, targets, 5);
    expect(result.start).toBe(60);
    expect(result.target?.kind).toBe('marker');
  });

  it('does not move a span without a nearby target', () => {
    expect(snapSpan(75, 30, targets, 3)).toEqual({ start: 75 });
  });
});

describe('snapThreshold', () => {
  it('scales with zoom and stays bounded', () => {
    expect(snapThreshold(10)).toBe(1);
    expect(snapThreshold(1)).toBe(10);
    expect(snapThreshold(2)).toBe(5);
    expect(snapThreshold(0.1)).toBe(12);
  });
});
