import type { ClipTransition } from '@editor-ia/project-schema';

/**
 * Mini-preview animado de cada transición (paridad con `previa_transicoes.js`
 * de AlaukCut, que cicla la transición sobre imágenes de muestra). Es una
 * ilustración CSS: dos capas (clip saliente / entrante) ejecutan el mismo
 * gesto que el render — no es un frame real ni usa assets.
 */
export function TransitionPreview({ type }: { readonly type: ClipTransition['type'] }) {
  return (
    <div className="tp" data-tp={type} aria-hidden="true">
      <i className="tp-a" />
      <i className="tp-b" />
      <i className="tp-veil" />
    </div>
  );
}
