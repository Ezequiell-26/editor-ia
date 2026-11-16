import type { Clip } from '@editor-ia/project-schema';
import {
  snapshotTransformKeyframes,
  type TransformKeyframePatch,
} from './project-actions';

/**
 * Portapapeles de keyframes de transformación, equivalente al `copiado` de
 * `curvas_predefinidas.js` de AlaukCut: una copia de las propiedades
 * animadas en un instante, pegable en cualquier clip en el playhead.
 */
let clipboard: TransformKeyframePatch | null = null;

/**
 * Última copia de la timeline (`ultimaCopia` de AlaukCut): distingue si el
 * portapapeles activo es el de keyframes o el de clips para que Ctrl+V sepa
 * qué pegar. Las copias de clip la marcan con `markClipCopied`.
 */
let lastCopy: 'keyframe' | 'clip' | null = null;

export function setTransformKeyframeClipboard(
  patch: TransformKeyframePatch | null,
): void {
  clipboard = patch === null ? null : { ...patch };
  if (patch === null) lastCopy = null;
}

export function getTransformKeyframeClipboard(): TransformKeyframePatch | null {
  return clipboard === null ? null : { ...clipboard };
}

export function hasTransformKeyframeClipboard(): boolean {
  return clipboard !== null;
}

export function markClipCopied(): void {
  lastCopy = 'clip';
}

/** `colarDaTecla` de AlaukCut: sólo pega keyframes si la última copia fue de claves. */
export function lastCopyWasKeyframes(): boolean {
  return lastCopy === 'keyframe' && clipboard !== null;
}

/** Copia todas las propiedades animadas que tengan keyframe en `frame`. */
export function copyTransformKeyframesAt(
  clip: Clip,
  frame: number,
): TransformKeyframePatch | null {
  const patch = snapshotTransformKeyframes(clip, frame);
  setTransformKeyframeClipboard(patch);
  if (patch !== null) lastCopy = 'keyframe';
  return patch;
}
