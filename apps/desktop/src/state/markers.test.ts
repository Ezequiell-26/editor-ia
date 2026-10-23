import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject, type ProjectDocument } from '@editor-ia/project-schema';
import {
  addMarker,
  chaptersFromMarkers,
  clearMarkers,
  deleteMarker,
  formatChapterTime,
  formatMarkerChapters,
  markerAtFrame,
  updateMarker,
  validateChapters,
} from './markers';
import { ProjectActionError } from './project-actions';

const NOW = '2026-01-01T00:00:00.000Z';

function validated(project: ProjectDocument): ProjectDocument {
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(`proyecto inválido: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.project;
}

function base(): ProjectDocument {
  return validated(createEmptyProject('Marcadores', NOW));
}

describe('marker actions', () => {
  it('adds markers with a default label and finds them by frame', () => {
    const first = addMarker(base(), 30);
    const project = validated(first.project);
    expect(project.markers).toHaveLength(1);
    expect(project.markers[0]?.label).toBe('Marcador 1');
    expect(project.markers[0]?.frame).toBe(30);
    expect(markerAtFrame(project, 30)?.id).toBe(first.markerId);

    const second = addMarker(project, 90, { label: '  Cierre  ', color: 'amber' });
    const both = validated(second.project);
    expect(both.markers[1]).toMatchObject({ frame: 90, label: 'Cierre', color: 'amber' });
  });

  it('adds, edits and clears a marker range', () => {
    const added = addMarker(base(), 30, { endFrame: 90 });
    const project = validated(added.project);
    expect(project.markers[0]?.endFrame).toBe(90);
    expect(() => addMarker(project, 120, { endFrame: 120 })).toThrow(ProjectActionError);
    const cleared = validated(
      updateMarker(project, added.markerId, { endFrame: undefined }),
    );
    expect(cleared.markers[0]?.endFrame).toBeUndefined();
    const ranged = validated(updateMarker(cleared, added.markerId, { endFrame: 150 }));
    expect(ranged.markers[0]?.endFrame).toBe(150);
    expect(() => updateMarker(ranged, added.markerId, { frame: 150 })).toThrow(
      ProjectActionError,
    );
  });

  it('rejects a second marker on the same frame', () => {
    const first = addMarker(base(), 30);
    expect(() => addMarker(first.project, 30)).toThrow(ProjectActionError);
  });

  it('moves, relabels, recolours and deletes markers', () => {
    const first = addMarker(base(), 30);
    const moved = validated(
      updateMarker(first.project, first.markerId, {
        frame: 45,
        label: 'Tema',
        color: 'rose',
      }),
    );
    expect(moved.markers[0]).toMatchObject({ frame: 45, label: 'Tema', color: 'rose' });

    const other = addMarker(moved, 90, { label: 'Otro' });
    expect(() =>
      updateMarker(other.project, first.markerId, { frame: 90 }),
    ).toThrow(ProjectActionError);

    const removed = validated(deleteMarker(other.project, first.markerId));
    expect(removed.markers.map((item) => item.label)).toEqual(['Otro']);
    expect(validated(clearMarkers(removed)).markers).toEqual([]);
  });

  it('rejects an empty or overlong label', () => {
    const first = addMarker(base(), 30);
    expect(() => updateMarker(first.project, first.markerId, { label: '   ' })).toThrow(
      ProjectActionError,
    );
    expect(() =>
      updateMarker(first.project, first.markerId, { label: 'x'.repeat(121) }),
    ).toThrow(ProjectActionError);
  });
});

describe('marker chapters', () => {
  const marker = (frame: number, label: string) => ({
    id: `m-${frame}`,
    frame,
    label,
  });

  it('formats timestamps and prepends Inicio when the first marker is not at zero', () => {
    const chapters = chaptersFromMarkers([marker(90, 'Uno'), marker(300, 'Dos')], 30);
    expect(chapters).toEqual([
      { startSeconds: 0, title: 'Inicio' },
      { startSeconds: 3, title: 'Uno' },
      { startSeconds: 10, title: 'Dos' },
    ]);
    expect(formatMarkerChapters([marker(0, 'Arranque'), marker(300, 'Dos')], 30)).toBe(
      '0:00 Arranque\n0:10 Dos',
    );
  });

  it('deduplicates rounded timestamps and formats hours', () => {
    const chapters = chaptersFromMarkers([marker(0, 'A'), marker(1, 'B')], 30);
    expect(chapters).toEqual([{ startSeconds: 0, title: 'A' }]);
    expect(formatChapterTime(3_661)).toBe('1:01:01');
  });

  it('returns an empty export when there are no markers', () => {
    expect(formatMarkerChapters([], 30)).toBe('');
  });

  it('validates the YouTube minimum of three chapters and ten seconds apart', () => {
    const valid = validateChapters([
      { startSeconds: 0, title: 'Inicio' },
      { startSeconds: 10, title: 'Uno' },
      { startSeconds: 22, title: 'Dos' },
    ]);
    expect(valid.ok).toBe(true);
    expect(valid.issues).toEqual([]);

    const tooFew = validateChapters([
      { startSeconds: 0, title: 'Inicio' },
      { startSeconds: 12, title: 'Uno' },
    ]);
    expect(tooFew.ok).toBe(false);
    expect(tooFew.issues.join(' ')).toMatch(/tres capítulos/i);

    const tooClose = validateChapters([
      { startSeconds: 0, title: 'Inicio' },
      { startSeconds: 9, title: 'Uno' },
      { startSeconds: 25, title: 'Dos' },
    ]);
    expect(tooClose.ok).toBe(false);
    expect(tooClose.issues.join(' ')).toMatch(/10 s/i);

    const lateStart = validateChapters([
      { startSeconds: 5, title: 'Inicio' },
      { startSeconds: 20, title: 'Uno' },
      { startSeconds: 35, title: 'Dos' },
    ]);
    expect(lateStart.ok).toBe(false);
    expect(lateStart.issues.join(' ')).toMatch(/0:00/i);
    expect(validateChapters([]).ok).toBe(false);
  });
});
