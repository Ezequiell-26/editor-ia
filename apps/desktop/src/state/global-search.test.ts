import { describe, expect, it } from 'vitest';
import type { Asset } from '@editor-ia/project-schema';
import { createEmptyProject } from '@editor-ia/project-schema';
import {
  collectSearchDocuments,
  createGlobalSearch,
  destinationOfHit,
  normalizeSearchText,
  searchGlobal,
  type GlobalSearchDocument,
  type GlobalSearchHit,
} from './global-search';
import { addMarker } from './markers';
import {
  addAsset,
  addCaptionCue,
  addClipFromAsset,
  addScene,
  newId,
} from './project-actions';

const NOW = '2026-10-21T12:00:00.000Z';

function videoAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: newId(),
    label: 'Entrevista en la playa',
    kind: 'video',
    source: { type: 'local', path: 'media/entrevista.mp4' },
    status: 'ready',
    integrity: { sha256: 'a'.repeat(64), bytes: 10_000 },
    rights: {
      license: { id: 'owned', commercialUse: 'allowed' },
      provenance: { origin: 'user-imported', acquiredAt: NOW },
    },
    media: { width: 1920, height: 1080, durationFrames: 300, frameRate: { num: 30, den: 1 } },
    tags: ['exterior', 'verano'],
    bin: 'Tomas',
    ...overrides,
  } as Asset;
}

function fixture(): {
  project: ReturnType<typeof createEmptyProject>;
  assetId: string;
  clipId: string;
  markerId: string;
  cueId: string;
  sceneId: string;
  trackId: string;
} {
  const asset = videoAsset();
  let project = createEmptyProject('Búsqueda global', NOW);
  project = addAsset(project, asset);
  const clip = addClipFromAsset(project, asset);
  project = clip.project;
  const marker = addMarker(project, 90, { label: 'Capítulo: introducción' });
  project = marker.project;
  const cue = addCaptionCue(project, {
    text: 'Hola y bienvenidos al canal',
    startFrame: 0,
    durationFrames: 60,
  });
  project = cue.project;
  const scene = addScene(project, {
    title: 'Gancho inicial',
    intent: 'hook',
    narration: '¿Sabías que el mar esconde ciudades enteras?',
    notes: 'Grabar en exterior',
  });
  project = scene.project;
  return {
    project,
    assetId: asset.id,
    clipId: clip.clipId,
    markerId: marker.markerId,
    cueId: cue.cueId,
    sceneId: scene.sceneId,
    trackId: clip.trackId,
  };
}

async function search(project: ReturnType<typeof createEmptyProject>, query: string, limit = 8) {
  const documents = collectSearchDocuments(project);
  return searchGlobal(await createGlobalSearch(documents), documents, query, limit);
}

describe('búsqueda global del proyecto', async () => {
  it('indexa medios, clips, marcadores, subtítulos, escenas y pistas', async () => {
    const { project } = fixture();
    const documents = collectSearchDocuments(project);
    const kinds = new Set(documents.map((document) => document.kind));
    expect(kinds).toEqual(new Set(['asset', 'clip', 'marker', 'cue', 'scene', 'track']));
  });

  it('usa ids únicos aunque dos colecciones compartan el id de entidad', async () => {
    const { project } = fixture();
    const documents = collectSearchDocuments(project);
    const ids = documents.map((document) => document.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(`asset:${project.assets[0]?.id}`);
    expect(ids).toContain(`clip:${project.timeline.clips[0]?.id}`);
  });

  it('encuentra un medio por su etiqueta y conserva el frame de los clips', async () => {
    const { project, clipId } = fixture();
    const hits = await search(project, 'entrevista');
    expect(hits.some((hit) => hit.kind === 'asset')).toBe(true);
    const clip = hits.find((hit) => hit.kind === 'clip');
    expect(clip?.entityId).toBe(clipId);
    expect(clip?.frame).toBe(0);
  });

  it('ignora acentos en la consulta', async () => {
    const { project, markerId } = fixture();
    const hits = await search(project, 'capitulo');
    const marker = hits.find((hit) => hit.kind === 'marker');
    expect(marker?.entityId).toBe(markerId);
    expect(normalizeSearchText('Capítulo')).toBe('capitulo');
  });

  it('tolera un error de tipeo en la etiqueta', async () => {
    const { project } = fixture();
    const hits = await search(project, 'entrevsta');
    expect(hits.some((hit) => hit.kind === 'asset')).toBe(true);
  });

  it('busca dentro del texto de los subtítulos y de la narración de una escena', async () => {
    const { project, cueId, sceneId } = fixture();
    const cueHits = await search(project, 'bienvenidos');
    expect(cueHits.find((hit) => hit.kind === 'cue')?.entityId).toBe(cueId);
    const sceneHits = await search(project, 'ciudades');
    expect(sceneHits.find((hit) => hit.kind === 'scene')?.entityId).toBe(sceneId);
  });

  it('busca por bin y etiqueta del medio', async () => {
    const { project } = fixture();
    expect((await search(project, 'tomas')).some((hit) => hit.kind === 'asset')).toBe(true);
    expect((await search(project, 'verano')).some((hit) => hit.kind === 'asset')).toBe(true);
  });

  it('respeta el límite y devuelve vacío para una consulta en blanco', async () => {
    const { project } = fixture();
    expect(await search(project, 'la', 2)).toHaveLength(2);
    expect(await search(project, 'la', 1)).toHaveLength(1);
    expect(await search(project, '   ')).toEqual([]);
  });

  it('ordena primero el título exacto frente a una coincidencia parcial', async () => {
    const { project, assetId } = fixture();
    const extra = addAsset(project, videoAsset({ label: 'Playa vacía al amanecer' }));
    const documents = collectSearchDocuments(extra);
    const hits = await searchGlobal(await createGlobalSearch(documents), documents, 'entrevista en la playa');
    expect(hits[0]?.kind).toBe('asset');
    expect(hits[0]?.entityId).toBe(assetId);
  });

  it('reconstruye el índice con la etiqueta nueva después de una edición', async () => {
    const { project } = fixture();
    const renamed = {
      ...project,
      assets: project.assets.map((asset) => ({ ...asset, label: 'Toma de apertura' })),
    };
    expect((await search(renamed, 'apertura')).some((hit) => hit.kind === 'asset')).toBe(true);
    expect(await search(project, 'apertura')).toEqual([]);
  });

  it('no expone documentos sin título útil', async () => {
    const { project } = fixture();
    const documents: readonly GlobalSearchDocument[] = collectSearchDocuments(project);
    expect(documents.every((document) => document.title.trim().length > 0)).toBe(true);
  });
});

describe('destino de un resultado', async () => {
  const base = {
    id: 'kind:entity',
    entityId: 'entity',
    title: 'Título',
    subtitle: 'Detalle',
    keywords: '',
    score: 1,
  } as const;

  function hit(overrides: Partial<GlobalSearchHit>): GlobalSearchHit {
    return { ...base, kind: 'clip', frame: 42, ...overrides } as GlobalSearchHit;
  }

  it('un medio abre la biblioteca y lo selecciona', async () => {
    expect(destinationOfHit(hit({ kind: 'asset', frame: null }))).toEqual({
      view: 'assets',
      selection: { kind: 'asset', id: 'entity' },
      frame: null,
    });
  });

  it('un clip abre el editor en su frame y lo selecciona', async () => {
    expect(destinationOfHit(hit({ kind: 'clip' }))).toEqual({
      view: 'editor',
      selection: { kind: 'clip', id: 'entity' },
      frame: 42,
    });
  });

  it('un marcador mueve el playhead sin seleccionar un clip', async () => {
    expect(destinationOfHit(hit({ kind: 'marker' }))).toEqual({
      view: 'editor',
      selection: { kind: 'none' },
      frame: 42,
    });
  });

  it('un subtítulo abre el editor en su inicio', async () => {
    expect(destinationOfHit(hit({ kind: 'cue' }))).toEqual({
      view: 'editor',
      selection: { kind: 'cue', id: 'entity' },
      frame: 42,
    });
  });

  it('una escena abre Guion y una pista el editor', async () => {
    expect(destinationOfHit(hit({ kind: 'scene', frame: null })).view).toBe('script');
    expect(destinationOfHit(hit({ kind: 'track', frame: null }))).toEqual({
      view: 'editor',
      selection: { kind: 'track', id: 'entity' },
      frame: null,
    });
  });
});
