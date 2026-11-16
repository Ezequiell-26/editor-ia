import type { Clip, ProjectDocument } from '@editor-ia/project-schema';

/**
 * Etiquetas legibles para el historial de deshacer.
 *
 * El store guarda snapshots completos sin metadatos; igual que el panel de
 * historial de AlaukCut, la etiqueta se deriva comparando dos documentos
 * consecutivos: qué clips aparecieron, desaparecieron o cambiaron, y en qué
 * campo. Función pura para poder testearla sin store.
 */

const KIND_LABEL: Record<string, string> = {
  video: 'video',
  audio: 'audio',
  image: 'imagen',
  graphic: 'gráfico',
  freeze: 'congelado',
  adjustment: 'ajuste',
  compound: 'compuesto',
  text: 'texto',
};

function clipAssetId(clip: Clip): string | null {
  const source = clip.source as { assetId?: unknown } | undefined;
  return typeof source?.assetId === 'string' ? source.assetId : null;
}

function clipName(clip: Clip, assets: ReadonlyMap<string, string>): string {
  if (clip.label) return clip.label;
  const assetId = clipAssetId(clip);
  const assetLabel = assetId ? assets.get(assetId) : undefined;
  return assetLabel ?? KIND_LABEL[clip.kind] ?? 'clip';
}

function clipMap(project: ProjectDocument): Map<string, Clip> {
  const map = new Map<string, Clip>();
  for (const clip of project.timeline.clips) map.set(clip.id, clip);
  return map;
}

function assetLabels(project: ProjectDocument): Map<string, string> {
  const map = new Map<string, string>();
  for (const asset of project.assets) map.set(asset.id, asset.label);
  return map;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Campos que merecen etiqueta propia cuando son lo único que cambió. */
const FIELD_LABELS: readonly { keys: readonly string[]; label: string }[] = [
  { keys: ['audio'], label: 'Ajustó el audio' },
  { keys: ['transform'], label: 'Ajustó la transformación' },
  { keys: ['motion'], label: 'Ajustó el movimiento' },
  { keys: ['effects'], label: 'Ajustó los efectos' },
  { keys: ['speed', 'speedCurve'], label: 'Ajustó la velocidad' },
  { keys: ['transitionIn', 'transitionOut'], label: 'Ajustó la transición' },
  { keys: ['animationIn', 'animationOut'], label: 'Ajustó la animación' },
  { keys: ['mask'], label: 'Ajustó la máscara' },
  { keys: ['chromaKey'], label: 'Ajustó el chroma key' },
  { keys: ['monitorFrame'], label: 'Ajustó el marco' },
  { keys: ['startFrame', 'durationFrames', 'trackId'], label: 'Movió o recortó' },
  { keys: ['enabled'], label: 'Activó o desactivó' },
];

function fieldSnapshot(clip: Clip, keys: readonly string[]): unknown {
  const record = clip as unknown as Record<string, unknown>;
  return keys.map((key) => record[key]);
}

function describeChangedClip(before: Clip, after: Clip, name: string): string {
  for (const { keys, label } of FIELD_LABELS) {
    if (!same(fieldSnapshot(before, keys), fieldSnapshot(after, keys))) {
      return `${label} «${name}»`;
    }
  }
  return `Editó «${name}»`;
}

/**
 * Etiqueta corta en español para el paso que va de `before` a `after`.
 * `before` puede ser el estado previo; para el primer paso del historial se
 * compara contra un documento "vacío" sintético (sin clips ni assets nuevos).
 */
export function describeHistoryStep(before: ProjectDocument, after: ProjectDocument): string {
  const beforeClips = clipMap(before);
  const afterClips = clipMap(after);
  const names = assetLabels(after);

  const added = [...afterClips.keys()].filter((id) => !beforeClips.has(id));
  const removed = [...beforeClips.keys()].filter((id) => !afterClips.has(id));
  const changed = [...afterClips.keys()].filter(
    (id) => beforeClips.has(id) && !same(beforeClips.get(id), afterClips.get(id)),
  );

  if (added.length === 1 && !removed.length) {
    const clip = afterClips.get(added[0]!);
    if (clip) return `Añadió ${KIND_LABEL[clip.kind] ?? 'clip'} «${clipName(clip, names)}»`;
  }
  if (added.length > 1 && !removed.length) return `Añadió ${added.length} elementos`;
  if (removed.length === 1 && !added.length) {
    const clip = beforeClips.get(removed[0]!);
    if (clip) return `Eliminó ${KIND_LABEL[clip.kind] ?? 'clip'} «${clipName(clip, names)}»`;
  }
  if (removed.length > 1 && !added.length) return `Eliminó ${removed.length} elementos`;
  if (added.length || removed.length) return `Editó la timeline (${added.length}+/${removed.length}-)`;

  if (changed.length === 1) {
    const beforeClip = beforeClips.get(changed[0]!);
    const afterClip = afterClips.get(changed[0]!);
    if (beforeClip && afterClip) {
      return describeChangedClip(beforeClip, afterClip, clipName(afterClip, names));
    }
  }
  if (changed.length > 1) return `Editó ${changed.length} clips`;

  const beforeAssets = new Set(before.assets.map((asset) => asset.id));
  const imported = after.assets.filter((asset) => !beforeAssets.has(asset.id));
  if (imported.length === 1) return `Importó «${imported[0]!.label}»`;
  if (imported.length > 1) return `Importó ${imported.length} medios`;

  const beforeTracks = JSON.stringify(before.timeline.tracks);
  const afterTracks = JSON.stringify(after.timeline.tracks);
  if (beforeTracks !== afterTracks) return 'Ajustó las pistas';

  return 'Cambio en el proyecto';
}

/**
 * Etiquetas de los pasos del historial, de más antiguo a más nuevo.
 * `steps[i]` describe la transición `states[i] → states[i+1]`; el último
 * elemento describe `states.at(-1) → project` actual.
 */
export function historyStepLabels(
  states: readonly ProjectDocument[],
  project: ProjectDocument,
): string[] {
  const labels: string[] = [];
  for (let i = 0; i < states.length; i++) {
    const next = i + 1 < states.length ? states[i + 1]! : project;
    labels.push(describeHistoryStep(states[i]!, next));
  }
  return labels;
}
