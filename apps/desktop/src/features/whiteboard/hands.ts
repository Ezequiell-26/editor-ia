/**
 * Estilos de mano para la pizarra blanca. Los sprites webp (720p) vienen de
 * Inkplainer-OS (Apache-2.0, ver `src/assets/whiteboard/NOTICE.md`) y la
 * geometría `tipX`/`tipY`/`width`/`height` replica `CUSTOM_HANDS` de su
 * `index.html`: el punto (tipX, tipY) del sprite es el que toca el trazo.
 * Las fracciones `tipU`/`tipV` son adimensionales (0..1 del tamaño lógico),
 * así la misma tabla sirve para cualquier escala de render.
 */
import hand1Url from '../../assets/whiteboard/hand1-720p.webp';
import hand1vUrl from '../../assets/whiteboard/hand1vertical-720p.webp';
import hand2Url from '../../assets/whiteboard/hand2-720p.webp';
import hand2vUrl from '../../assets/whiteboard/hand2vertical-720p.webp';
import hand3Url from '../../assets/whiteboard/hand3-720p.webp';
import hand3vUrl from '../../assets/whiteboard/hand3vertical-720p.webp';
import hand4Url from '../../assets/whiteboard/hand4-720p.webp';
import hand4vUrl from '../../assets/whiteboard/hand4vertical-720p.webp';
import hand5Url from '../../assets/whiteboard/hand5-720p.webp';
import hand5vUrl from '../../assets/whiteboard/hand5vertical-720p.webp';
import hand6Url from '../../assets/whiteboard/hand6-720p.webp';
import hand6vUrl from '../../assets/whiteboard/hand6vertical-720p.webp';

export interface HandSpriteVariant {
  /** URL del sprite (importada por Vite). */
  readonly url: string;
  /** Tamaño lógico del lienzo para el que se midió la punta (px). */
  readonly width: number;
  readonly height: number;
  /** Punta del lápiz como fracción del tamaño lógico (0..1). */
  readonly tipU: number;
  readonly tipV: number;
}

export interface WhiteboardHandStyle {
  readonly id: string;
  readonly label: string;
  readonly landscape: HandSpriteVariant;
  readonly portrait: HandSpriteVariant;
}

function variant(
  url: string,
  width: number,
  height: number,
  tipX: number,
  tipY: number,
): HandSpriteVariant {
  return { url, width, height, tipU: tipX / width, tipV: tipY / height };
}

export const WHITEBOARD_HAND_STYLES: readonly WhiteboardHandStyle[] = [
  {
    id: 'hand1',
    label: 'Mano 1',
    landscape: variant(hand1Url, 432, 768, 229, 0),
    portrait: variant(hand1vUrl, 720, 1280, 0, 0),
  },
  {
    id: 'hand2',
    label: 'Mano 2',
    landscape: variant(hand2Url, 432, 768, 166, 0),
    portrait: variant(hand2vUrl, 720, 1280, 0, 0),
  },
  {
    id: 'hand3',
    label: 'Mano 3',
    landscape: variant(hand3Url, 432, 768, 117, 0),
    portrait: variant(hand3vUrl, 720, 1280, 1, 0),
  },
  {
    id: 'hand4',
    label: 'Mano 4',
    landscape: variant(hand4Url, 432, 768, 81, 628),
    // En Inkplainer los verticales de hand4-6 son el mismo archivo que el
    // horizontal (mismo SHA-256); se reutiliza la variante landscape.
    portrait: variant(hand4vUrl, 432, 768, 81, 628),
  },
  {
    id: 'hand5',
    label: 'Mano cartoon',
    landscape: variant(hand5Url, 180, 320, 0, 49),
    portrait: variant(hand5vUrl, 180, 320, 0, 49),
  },
  {
    id: 'hand6',
    label: 'Mano pixel',
    landscape: variant(hand6Url, 180, 320, 19, 94),
    portrait: variant(hand6vUrl, 180, 320, 19, 94),
  },
];

export const DEFAULT_HAND_STYLE = 'hand1';

export function whiteboardHandStyle(id: string): WhiteboardHandStyle {
  return (
    WHITEBOARD_HAND_STYLES.find((style) => style.id === id) ?? WHITEBOARD_HAND_STYLES[0]!
  );
}

/** Variante del sprite según la orientación del lienzo (>= 1 = landscape). */
export function handVariantFor(
  style: WhiteboardHandStyle,
  aspect: number,
): HandSpriteVariant {
  return aspect >= 1 ? style.landscape : style.portrait;
}
