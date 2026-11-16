import type { Asset, AssetProxy, ProjectDocument } from '@editor-ia/project-schema';
import {
  MAX_ASSET_BIN_LENGTH,
  MAX_ASSET_TAG_LENGTH,
  MAX_ASSET_TAGS,
} from '@editor-ia/project-schema';
import { ProjectActionError, cloneProject, touch } from './project-actions-core';

/**
 * Asset mutations: library add/remove/rename, readiness and license
 * declaration, metadata (bin/tags/favorite), relink and proxy. Extracted
 * from `project-actions.ts`; `project-actions.ts` re-exports everything here.
 */

export function addAsset(project: ProjectDocument, asset: Asset): ProjectDocument {
  if (project.assets.some((item) => item.id === asset.id)) {
    throw new ProjectActionError('el material ya está en la biblioteca del proyecto');
  }
  const next = cloneProject(project);
  next.assets.push(asset);
  touch(next);
  return next;
}

export function markAssetReady(
  project: ProjectDocument,
  assetId: string,
  commercialUse: 'allowed' | 'requires-attribution',
): ProjectDocument {
  const next = cloneProject(project);
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new ProjectActionError('el material no está en el proyecto');
  }
  asset.status = 'ready';
  asset.rights.license = {
    id: 'user-declared',
    commercialUse,
    ...(commercialUse === 'requires-attribution'
      ? { attributionText: `Atribución requerida: ${asset.label}` }
      : {}),
    notes: 'Licencia declarada por el usuario en Olyvia.',
  };
  touch(next);
  return next;
}

/** Marca un asset derivado como listo conservando la licencia del original.
 * No inventa una licencia nueva: copia id, URL y atribución, y sólo completa
 * una nota si faltaba. */
export function markAssetReadyFrom(
  project: ProjectDocument,
  assetId: string,
  sourceAssetId: string,
): ProjectDocument {
  const next = cloneProject(project);
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset) throw new ProjectActionError('el material derivado no está en el proyecto');
  const source = next.assets.find((item) => item.id === sourceAssetId);
  if (!source) throw new ProjectActionError('el material original no está en el proyecto');
  asset.status = 'ready';
  asset.rights.license = {
    ...source.rights.license,
    notes:
      source.rights.license.notes ??
      'Licencia heredada del material original por Olyvia.',
  };
  touch(next);
  return next;
}

export function removeAsset(project: ProjectDocument, assetId: string): ProjectDocument {
  const inUse = project.timeline.clips.some((clip) => {
    const source = clip.source;
    return source.type === 'asset' && source.assetId === assetId;
  });
  if (inUse) {
    throw new ProjectActionError('el material está en uso en la timeline; quitá esos clips primero');
  }
  const next = cloneProject(project);
  next.assets = next.assets.filter((asset) => asset.id !== assetId);
  for (const scene of next.scenes) {
    if (scene.narration.assetId === assetId) {
      delete scene.narration.assetId;
      if (!scene.narration.text) {
        scene.narration.text = 'Narración pendiente.';
      }
    }
  }
  touch(next);
  return next;
}

export function updateAssetLabel(project: ProjectDocument, assetId: string, label: string): ProjectDocument {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new ProjectActionError('el material necesita un nombre');
  }
  const next = cloneProject(project);
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new ProjectActionError('el material no está en el proyecto');
  }
  asset.label = trimmed;
  touch(next);
  return next;
}

/** Edits the organisational metadata without touching paths, hashes or rights. */
export function updateAssetMetadata(
  project: ProjectDocument,
  assetId: string,
  patch: {
    label?: string;
    bin?: string | null;
    tags?: readonly string[];
    favorite?: boolean;
  },
): ProjectDocument {
  const next = cloneProject(project);
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new ProjectActionError('el material no está en el proyecto');
  }
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) {
      throw new ProjectActionError('el material necesita un nombre');
    }
    asset.label = label;
  }
  if (patch.bin !== undefined) {
    const bin = (patch.bin ?? '').trim();
    if (!bin) {
      delete asset.bin;
    } else {
      if (bin.length > MAX_ASSET_BIN_LENGTH) {
        throw new ProjectActionError(
          `el bin admite hasta ${MAX_ASSET_BIN_LENGTH} caracteres`,
        );
      }
      asset.bin = bin;
    }
  }
  if (patch.tags !== undefined) {
    const tags: string[] = [];
    const seen = new Set<string>();
    for (const raw of patch.tags) {
      const tag = raw.trim();
      if (!tag) continue;
      if (tag.length > MAX_ASSET_TAG_LENGTH) {
        throw new ProjectActionError(
          `cada etiqueta admite hasta ${MAX_ASSET_TAG_LENGTH} caracteres`,
        );
      }
      const key = tag.toLocaleLowerCase('es');
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
    if (tags.length > MAX_ASSET_TAGS) {
      throw new ProjectActionError(`un material admite hasta ${MAX_ASSET_TAGS} etiquetas`);
    }
    if (tags.length === 0) {
      delete asset.tags;
    } else {
      asset.tags = tags;
    }
  }
  if (patch.favorite !== undefined) {
    if (patch.favorite) asset.favorite = true;
    else delete asset.favorite;
  }
  touch(next);
  return next;
}

/**
 * Reconecta un material con un archivo nuevo ya importado. Conserva identidad,
 * nombre, licencia, etiquetas y bin; reemplaza ruta, medición, hash y estado.
 * Rechaza un cambio de tipo o un archivo más corto que los clips que lo usan:
 * un relink no puede dejar la timeline apuntando fuera del medio.
 */
export function relinkAsset(
  project: ProjectDocument,
  assetId: string,
  replacement: Asset,
): ProjectDocument {
  const current = project.assets.find((item) => item.id === assetId);
  if (!current) throw new ProjectActionError('el material no está en el proyecto');
  if (current.kind !== replacement.kind) {
    throw new ProjectActionError(
      `el archivo elegido es ${replacement.kind} y el material es ${current.kind}`,
    );
  }
  const durationFrames =
    replacement.kind === 'video' || replacement.kind === 'audio'
      ? replacement.media?.durationFrames
      : undefined;
  if (durationFrames !== undefined) {
    const clips = [
      ...project.timeline.clips,
      ...(project.compounds ?? []).flatMap((compound) => compound.clips),
    ];
    let requiredFrames = 0;
    for (const clip of clips) {
      if (clip.source.type !== 'asset' || clip.source.assetId !== assetId) continue;
      if (!('outFrame' in clip.source)) continue;
      requiredFrames = Math.max(requiredFrames, clip.source.outFrame);
    }
    if (requiredFrames > durationFrames) {
      throw new ProjectActionError(
        `el archivo nuevo dura ${durationFrames} frames y un clip necesita ${requiredFrames}; elegí uno más largo`,
      );
    }
  }
  const next = cloneProject(project);
  const asset = next.assets.find((item) => item.id === assetId)!;
  asset.status = replacement.status;
  asset.source = replacement.source;
  if (replacement.integrity) asset.integrity = replacement.integrity;
  else delete asset.integrity;
  if ('media' in replacement && replacement.media) {
    (asset as typeof replacement).media = replacement.media;
  } else if ('media' in asset) {
    delete (asset as { media?: unknown }).media;
  }
  // El proxy anterior mide el archivo viejo: ya no representa a este material.
  if ('proxy' in asset) delete (asset as { proxy?: unknown }).proxy;
  touch(next);
  return next;
}

export function toggleAssetFavorite(
  project: ProjectDocument,
  assetId: string,
): ProjectDocument {
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new ProjectActionError('el material no está en el proyecto');
  }
  return updateAssetMetadata(project, assetId, { favorite: !asset.favorite });
}

export function setAssetProxy(
  project: ProjectDocument,
  assetId: string,
  proxy: AssetProxy | undefined,
): ProjectDocument {
  const next = cloneProject(project);
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new ProjectActionError('el material no está en el proyecto');
  }
  if (asset.kind !== 'video') {
    throw new ProjectActionError('solo los videos aceptan un proxy');
  }
  const target = asset as Asset & { proxy?: AssetProxy };
  if (proxy) target.proxy = proxy;
  else delete target.proxy;
  touch(next);
  return next;
}
