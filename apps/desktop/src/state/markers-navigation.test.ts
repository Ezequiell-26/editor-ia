import { describe, expect, it } from 'vitest';
import { createEmptyProject, parseProject, type ProjectDocument } from '@editor-ia/project-schema';
import {
  addMarker,
  nextMarker,
  previousMarker,
  sortedMarkers,
  updateMarker,
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
  return validated(createEmptyProject('Navegación de marcadores', NOW));
}

function projectWithMarkers(): ProjectDocument {
  const first = addMarker(base(), 90, { label: 'Intro' });
  const second = addMarker(first.project, 300, { label: 'Entrevista' });
  const third = addMarker(second.project, 600, { label: 'Cierre' });
  return validated(third.project);
}

describe('navegación entre marcadores', () => {
  it('ordena los marcadores por frame aunque se hayan creado desordenados', () => {
    const first = addMarker(base(), 300, { label: 'Tarde' });
    const second = addMarker(first.project, 30, { label: 'Temprano' });
    const project = validated(second.project);
    expect(sortedMarkers(project).map((marker) => marker.label)).toEqual([
      'Temprano',
      'Tarde',
    ]);
  });

  it('encuentra el marcador anterior más cercano al playhead', () => {
    const project = projectWithMarkers();
    expect(previousMarker(project, 400)?.label).toBe('Entrevista');
    expect(previousMarker(project, 301)?.frame).toBe(300);
  });

  it('encuentra el marcador siguiente más cercano al playhead', () => {
    const project = projectWithMarkers();
    expect(nextMarker(project, 400)?.label).toBe('Cierre');
    expect(nextMarker(project, 299)?.frame).toBe(300);
  });

  it('con el playhead sobre un marcador, anterior y siguiente lo saltan', () => {
    const project = projectWithMarkers();
    expect(previousMarker(project, 300)?.label).toBe('Intro');
    expect(nextMarker(project, 300)?.label).toBe('Cierre');
  });

  it('devuelve undefined en los extremos de la lista', () => {
    const project = projectWithMarkers();
    expect(previousMarker(project, 90)).toBeUndefined();
    expect(nextMarker(project, 600)).toBeUndefined();
  });

  it('devuelve undefined cuando no hay marcadores', () => {
    const empty = base();
    expect(previousMarker(empty, 10)).toBeUndefined();
    expect(nextMarker(empty, 10)).toBeUndefined();
  });
});

describe('nota del marcador en el estado', () => {
  it('crea un marcador con nota recortada y la valida en el esquema', () => {
    const created = addMarker(base(), 30, {
      label: 'Revisar',
      note: '  El audio se corta un poco antes  ',
    });
    const project = validated(created.project);
    expect(project.markers[0]?.note).toBe('El audio se corta un poco antes');
  });

  it('crea un marcador sin nota cuando no se pide una', () => {
    const created = addMarker(base(), 30);
    const project = validated(created.project);
    expect(project.markers[0]?.note).toBeUndefined();
  });

  it('actualiza la nota conservando los saltos de línea', () => {
    const created = addMarker(base(), 30, { label: 'Revisar' });
    const updated = updateMarker(created.project, created.markerId, {
      note: 'primera idea\nsegunda idea',
    });
    const project = validated(updated);
    expect(project.markers[0]?.note).toBe('primera idea\nsegunda idea');
  });

  it('borra la nota cuando el parche llega vacío', () => {
    const created = addMarker(base(), 30, { label: 'Revisar', note: 'algo' });
    const updated = updateMarker(created.project, created.markerId, { note: '' });
    const project = validated(updated);
    expect(project.markers[0]?.note).toBeUndefined();
  });

  it('borra la nota cuando el parche llega sin texto', () => {
    const created = addMarker(base(), 30, { label: 'Revisar', note: 'algo' });
    const updated = updateMarker(created.project, created.markerId, { note: undefined });
    const project = validated(updated);
    expect(project.markers[0]?.note).toBeUndefined();
  });

  it('rechaza una nota que supera el máximo de caracteres', () => {
    const created = addMarker(base(), 30, { label: 'Revisar' });
    expect(() =>
      updateMarker(created.project, created.markerId, { note: 'a'.repeat(501) }),
    ).toThrow(ProjectActionError);
  });
});
