// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadLearningState,
  normalizeLearningState,
  recordViewVisit,
  setSectionCompleted,
} from './learning-progress';

afterEach(() => {
  window.localStorage.clear();
});

describe('progreso inteligente del tutorial', () => {
  it('registra visitas y completa los temas que cubre cada herramienta', () => {
    const first = recordViewVisit('editor', '2026-10-20T10:00:00.000Z');
    expect(first.lastView).toBe('editor');
    expect(first.seen).toContain('editor');
    expect(first.visits.editor).toBe(1);
    expect(first.completed).toEqual(expect.arrayContaining(['editor', 'export']));

    const second = recordViewVisit('editor', '2026-10-20T10:05:00.000Z');
    expect(second.visits.editor).toBe(2);
    expect(loadLearningState().completed).toContain('export');
  });

  it('permite desmarcar un tema sin perder las visitas', () => {
    recordViewVisit('assets', '2026-10-20T10:00:00.000Z');
    const unchecked = setSectionCompleted('assets', false, '2026-10-20T10:01:00.000Z');
    expect(unchecked.completed).not.toContain('assets');
    expect(unchecked.seen).toContain('assets');
    const checked = setSectionCompleted('assets', true);
    expect(checked.completed).toContain('assets');
  });

  it('migra el progreso viejo y conserva los contadores válidos', () => {
    window.localStorage.setItem('editor-ia.learn-progress.v1', JSON.stringify(['export']));
    const migrated = loadLearningState();
    expect(migrated.completed).toContain('export');

    recordViewVisit('projects', '2026-10-20T10:00:00.000Z');
    expect(window.localStorage.getItem('editor-ia.learn-progress.v1')).toBeNull();
    expect(window.localStorage.getItem('editor-ia.learning-progress.v2')).toContain('projects');
  });

  it('descarta visitas y textos inválidos del almacenamiento', () => {
    const normalized = normalizeLearningState({
      seen: ['projects', 'no-existe'],
      visits: { projects: 4.6, intruso: 9, script: 'muchas' },
      completed: ['assets', 42, 'assets'],
      lastView: 'nope',
    });
    expect(normalized.seen).toEqual(['projects']);
    expect(normalized.visits.projects).toBe(5);
    expect(normalized.visits).not.toHaveProperty('intruso');
    expect(normalized.completed).toEqual(['assets']);
    expect(normalized.lastView).toBeNull();
  });
});
