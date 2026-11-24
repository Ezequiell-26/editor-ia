import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject, type ProjectDocument } from '@editor-ia/project-schema';
import {
  addMarker,
  chaptersFromMarkers,
  clearMarkers,
  chapterSpansFromMarkers,
  deleteMarker,
  formatChapterTime,
  formatMarkerChapters,
  formatMarkersCsv,
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

  it('keeps a single cover marker per project', () => {
    const first = addMarker(base(), 30, { label: 'A' });
    const second = addMarker(first.project, 90, { label: 'B' });
    const covered = validated(
      updateMarker(second.project, first.markerId, { role: 'cover' }),
    );
    expect(covered.markers[0]?.role).toBe('cover');
    // Marcar otro como portada le quita el rol al anterior.
    const moved = validated(
      updateMarker(covered, second.markerId, { role: 'cover' }),
    );
    expect(moved.markers.find((item) => item.id === first.markerId)?.role).toBeUndefined();
    expect(moved.markers.find((item) => item.id === second.markerId)?.role).toBe('cover');
    // Y se puede quitar.
    const cleared = validated(
      updateMarker(moved, second.markerId, { role: undefined }),
    );
    expect(cleared.markers.every((item) => item.role === undefined)).toBe(true);
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

describe('formatMarkersCsv', () => {
  const marker = (frame: number, label: string, extra = {}) => ({
    id: `m-${frame}`,
    frame,
    label,
    ...extra,
  });

  it('emits a header and one sorted row per marker with timecodes', () => {
    const csv = formatMarkersCsv(
      [
        marker(300, 'Dos', { color: 'amber', note: 'revisar' }),
        marker(0, 'Arranque', { endFrame: 45, role: 'cover' }),
      ],
      30,
    );
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('start_tc,end_tc,start_frame,end_frame,label,color,role,note');
    expect(lines[1]).toBe('0:00:00:00,0:00:01:15,0,45,Arranque,,cover,');
    expect(lines[2]).toBe('0:00:10:00,,300,,Dos,amber,,revisar');
  });

  it('escapes commas, quotes and newlines inside cells', () => {
    const csv = formatMarkersCsv(
      [marker(0, 'Corte, "final"', { note: 'línea1\nlínea2' })],
      30,
    );
    const row = csv.split('\r\n')[1]!;
    expect(row).toContain('"Corte, ""final"""');
    expect(row).toContain('"línea1\nlínea2"');
  });

  it('returns only the header when there are no markers', () => {
    expect(formatMarkersCsv([], 30)).toBe(
      'start_tc,end_tc,start_frame,end_frame,label,color,role,note',
    );
  });
});

describe('chapterSpansFromMarkers', () => {
  const marker = (frame: number, label: string) => ({
    id: `m-${frame}`,
    frame,
    label,
  });

  it('spans each marker until the next one and the last until the total', () => {
    const spans = chapterSpansFromMarkers(
      [marker(90, 'Uno'), marker(300, 'Dos')],
      30,
      20,
    );
    expect(spans).toEqual([
      { startSeconds: 3, endSeconds: 10, title: 'Uno' },
      { startSeconds: 10, endSeconds: 20, title: 'Dos' },
    ]);
  });

  it('drops markers that would produce empty spans', () => {
    const spans = chapterSpansFromMarkers(
      [marker(0, 'A'), marker(600, 'Fuera')],
      30,
      10,
    );
    expect(spans).toEqual([{ startSeconds: 0, endSeconds: 10, title: 'A' }]);
  });
});
