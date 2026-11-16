import type { Clip } from '@editor-ia/project-schema';
import type { ProjectStoreValue } from './project-store';

/** Pestañas de primer nivel del inspector de clip (`Inspector.tsx`). La
 *  unión vive acá para que la timeline pueda pedir una pestaña sin importar
 *  el componente; `ClipTab` del inspector es este mismo tipo. */
export type ClipInspectorTab =
  | 'video'
  | 'audio'
  | 'speed'
  | 'trim'
  | 'animation'
  | 'color'
  | 'mask'
  | 'style'
  | 'all';

/** Pedido de pestaña hacia el inspector. `nonce` distingue pedidos
 *  repetidos de la misma pestaña; el inspector lo consume una sola vez.
 *  `subTab` pide además una subpestaña concreta de esa pestaña (p. ej.
 *  `wheels`/`hdr` dentro de `color`); el inspector la valida contra su
 *  propio mapa y la ignora si no existe o está pendiente. */
export interface InspectorTabRequest {
  readonly tab: ClipInspectorTab;
  readonly subTab?: string;
  readonly nonce: number;
}

/**
 * Misma elegibilidad que la barra de pestañas del inspector: `video`,
 * `animation` y `style` piden clip visual; `audio`, `speed` y `trim` piden
 * clip con duración (video/audio); `color` y `mask` también admiten capas
 * de ajuste; `all` siempre existe.
 */
export function clipSupportsInspectorTab(clip: Clip, tab: ClipInspectorTab): boolean {
  const visual = clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze';
  const timed = clip.kind === 'video' || clip.kind === 'audio';
  const isAdjustment = clip.kind === 'adjustment';
  switch (tab) {
    case 'video':
    case 'animation':
    case 'style':
      return visual;
    case 'audio':
    case 'speed':
    case 'trim':
      return timed;
    case 'color':
    case 'mask':
      return visual || isAdjustment;
    case 'all':
      return true;
  }
}

/**
 * «Recortar», «Duración» y «Editar» de la barra rápida / «Más
 * herramientas»: abren el panel Detalles en la pestaña real del clip
 * seleccionado — `trim` (recorte y ajuste fino), `speed` (velocidad, que es
 * como se cambia la duración en la edición no lineal) y `all` (todas las
 * propiedades). El pedido lo resuelve el inspector; si el host no provee el
 * callback la timeline avisa que el panel ya está visible.
 */
export function openClipInspectorTab(
  store: ProjectStoreValue,
  tab: ClipInspectorTab,
  requestTab: (tab: ClipInspectorTab, subTab?: string) => void,
  subTab?: string,
): void {
  const project = store.getProject() ?? store.state.project;
  if (!project) return;
  const selection = store.state.selection;
  if (selection.kind !== 'clip') {
    store.setNotice('Seleccioná un clip para abrir sus propiedades en Detalles.');
    return;
  }
  const clip = project.timeline.clips.find((item) => item.id === selection.id);
  if (!clip) {
    store.setNotice('El clip seleccionado ya no está en la timeline.');
    return;
  }
  if (clip.kind === 'compound') {
    store.setNotice(
      'Un clip compuesto no tiene pestañas de edición: deshacelo para editar los clips internos.',
    );
    return;
  }
  if (!clipSupportsInspectorTab(clip, tab)) {
    store.setNotice('Esa pestaña del inspector no aplica a este tipo de clip.');
    return;
  }
  if (subTab === undefined) requestTab(tab);
  else requestTab(tab, subTab);
}
