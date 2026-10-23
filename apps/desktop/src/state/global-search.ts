import type MiniSearchType from 'minisearch';
import type { ProjectDocument } from '@editor-ia/project-schema';

/**
 * Global project search.
 *
 * One index covers every entity a person can name: media, clips, markers,
 * caption cues, scenes and tracks. The palette used to search only commands,
 * which meant finding a clip by its label required knowing in which view it
 * lived. This module keeps the ranking rules in one pure place so the UI only
 * has to render results and route them.
 *
 * MiniSearch se carga con `import()` dinámico: el motor de búsqueda no entra en
 * el chunk inicial, sólo cuando se abre la paleta. La recolección de documentos
 * y el destino de cada resultado siguen siendo síncronos y puros.
 */

export type GlobalSearchIndex = MiniSearchType<GlobalSearchDocument>;

export type GlobalHitKind = 'asset' | 'clip' | 'marker' | 'cue' | 'scene' | 'track';

export interface GlobalSearchDocument {
  /** Unique index key: the same entity id can exist in two collections. */
  readonly id: string;
  readonly entityId: string;
  readonly kind: GlobalHitKind;
  readonly title: string;
  readonly subtitle: string;
  readonly keywords: string;
  /** Frame the result points at, when the entity lives on the timeline. */
  readonly frame: number | null;
}

export interface GlobalSearchHit extends GlobalSearchDocument {
  readonly score: number;
}

export const GLOBAL_HIT_LABEL: Record<GlobalHitKind, string> = {
  asset: 'Medio',
  clip: 'Clip',
  marker: 'Marcador',
  cue: 'Subtítulo',
  scene: 'Escena',
  track: 'Pista',
};

export type HitSelection =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'asset' | 'clip' | 'cue' | 'scene' | 'track';
      readonly id: string;
    };

export interface HitDestination {
  readonly view: 'assets' | 'editor' | 'script';
  readonly selection: HitSelection;
  readonly frame: number | null;
}

/**
 * Where a result should take the person. Keeping this mapping out of the shell
 * makes the routing testable and stops two views from disagreeing about which
 * entity a marker or a cue selects.
 */
export function destinationOfHit(hit: GlobalSearchHit): HitDestination {
  switch (hit.kind) {
    case 'asset':
      return { view: 'assets', selection: { kind: 'asset', id: hit.entityId }, frame: null };
    case 'clip':
      return {
        view: 'editor',
        selection: { kind: 'clip', id: hit.entityId },
        frame: hit.frame,
      };
    case 'cue':
      return { view: 'editor', selection: { kind: 'cue', id: hit.entityId }, frame: hit.frame };
    case 'track':
      return { view: 'editor', selection: { kind: 'track', id: hit.entityId }, frame: null };
    case 'marker':
      return { view: 'editor', selection: { kind: 'none' }, frame: hit.frame };
    case 'scene':
      return { view: 'script', selection: { kind: 'scene', id: hit.entityId }, frame: null };
  }
}

const KIND_LABEL: Record<string, string> = {
  video: 'Video',
  image: 'Imagen',
  audio: 'Audio',
  font: 'Fuente',
  text: 'Texto',
  graphic: 'Gráfico',
  freeze: 'Congelado',
  adjustment: 'Ajuste',
  narration: 'Narración',
};

/** Accent-insensitive so "capitulo" finds "Capítulo" in a Spanish project. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

function tokenize(value: string): string[] {
  return normalizeSearchText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

function timecodeOf(project: ProjectDocument, frame: number): string {
  const { num, den } = project.video.frameRate;
  const fps = num / den;
  const safeFrame = Math.max(0, Math.round(frame));
  const totalSeconds = Math.floor(safeFrame / fps);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const frames = Math.min(
    Math.round(safeFrame - totalSeconds * fps),
    Math.max(0, Math.ceil(fps) - 1),
  );
  return [minutes, seconds, frames].map((part) => String(part).padStart(2, '0')).join(':');
}

function clipSourceAssetId(source: unknown): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const candidate = (source as { assetId?: unknown }).assetId;
  return typeof candidate === 'string' ? candidate : null;
}

/**
 * Turn a project into the flat list the index consumes. Pure: no store, no
 * filesystem, no formatting that depends on the current view.
 */
export function collectSearchDocuments(project: ProjectDocument): GlobalSearchDocument[] {
  const documents: GlobalSearchDocument[] = [];
  const assetLabel = new Map(project.assets.map((asset) => [asset.id, asset.label]));
  const trackLabel = new Map(project.timeline.tracks.map((track) => [track.id, track.label]));

  for (const asset of project.assets) {
    const media = 'media' in asset ? asset.media : undefined;
    const detail =
      media && 'width' in media && 'height' in media
        ? `${media.width}×${media.height}`
        : asset.status;
    documents.push({
      id: `asset:${asset.id}`,
      entityId: asset.id,
      kind: 'asset',
      title: asset.label,
      subtitle: [KIND_LABEL[asset.kind] ?? asset.kind, asset.bin, detail]
        .filter((part): part is string => Boolean(part))
        .join(' · '),
      keywords: [
        asset.bin ?? '',
        ...(asset.tags ?? []),
        asset.source.path,
        asset.rights.license.id,
      ]
        .filter(Boolean)
        .join(' '),
      frame: null,
    });
  }

  for (const clip of project.timeline.clips) {
    const sourceId = clipSourceAssetId(clip.source);
    const fallback = sourceId ? assetLabel.get(sourceId) : undefined;
    const title = clip.label ?? fallback ?? `${KIND_LABEL[clip.kind] ?? clip.kind}`;
    documents.push({
      id: `clip:${clip.id}`,
      entityId: clip.id,
      kind: 'clip',
      title,
      subtitle: [
        KIND_LABEL[clip.kind] ?? clip.kind,
        trackLabel.get(clip.trackId) ?? 'pista',
        timecodeOf(project, clip.startFrame),
      ].join(' · '),
      keywords: [clip.colorTag ?? '', clip.kind].filter(Boolean).join(' '),
      frame: clip.startFrame,
    });
  }

  for (const marker of project.markers) {
    documents.push({
      id: `marker:${marker.id}`,
      entityId: marker.id,
      kind: 'marker',
      title: marker.label,
      subtitle: `Marcador · ${timecodeOf(project, marker.frame)}`,
      keywords: marker.color ?? '',
      frame: marker.frame,
    });
  }

  for (const cue of project.captions.cues) {
    const text = cue.text.trim();
    documents.push({
      id: `cue:${cue.id}`,
      entityId: cue.id,
      kind: 'cue',
      title: text.length > 90 ? `${text.slice(0, 89)}…` : text,
      subtitle: `Subtítulo · ${timecodeOf(project, cue.startFrame)}`,
      keywords: '',
      frame: cue.startFrame,
    });
  }

  for (const scene of project.scenes) {
    documents.push({
      id: `scene:${scene.id}`,
      entityId: scene.id,
      kind: 'scene',
      title: scene.title,
      subtitle: `Escena ${scene.order + 1} · ${scene.status}`,
      keywords: [scene.narration.text ?? '', scene.notes ?? '', scene.intent].join(' '),
      frame: null,
    });
  }

  for (const track of project.timeline.tracks) {
    documents.push({
      id: `track:${track.id}`,
      entityId: track.id,
      kind: 'track',
      title: track.label,
      subtitle: `Pista · ${KIND_LABEL[track.kind] ?? track.kind}`,
      keywords: track.kind,
      frame: null,
    });
  }

  return documents;
}

export async function createGlobalSearch(
  documents: readonly GlobalSearchDocument[],
): Promise<GlobalSearchIndex> {
  const module = await import('minisearch');
  const MiniSearch = module.default as unknown as typeof MiniSearchType;
  const index = new MiniSearch<GlobalSearchDocument>({
    idField: 'id',
    fields: ['title', 'subtitle', 'keywords'],
    tokenize,
    searchOptions: {
      boost: { title: 4, subtitle: 1.5 },
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'OR',
    },
  });
  index.addAll([...documents]);
  return index;
}

export async function searchGlobal(
  index: GlobalSearchIndex,
  documents: readonly GlobalSearchDocument[],
  query: string,
  limit = 8,
): Promise<GlobalSearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0 || limit <= 0) {
    return [];
  }
  const byId = new Map(documents.map((document) => [document.id, document]));
  const hits: GlobalSearchHit[] = [];
  for (const result of index.search(trimmed).slice(0, limit)) {
    const document = byId.get(String(result.id));
    if (document) {
      hits.push({ ...document, score: result.score });
    }
  }
  return hits;
}
