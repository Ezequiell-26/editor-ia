/**
 * Lienzos de trabajo reutilizables para la ruta 2D de la preview.
 *
 * La ruta 2D de efectos (LUT sin WebGL) hacía `document.createElement('canvas')`
 * en cada frame —dos veces si además había grade del look—, es decir dos
 * lienzos de 1280×720 de basura por frame a 60 fps. Estos helpers crean el
 * lienzo una vez y sólo lo redimensionan cuando cambia el tamaño pedido.
 */

export interface ScratchCanvas {
  readonly canvas: HTMLCanvasElement;
  /** `true` si esta llamada tuvo que crear o redimensionar el lienzo. */
  readonly resized: boolean;
}

/**
 * Devuelve el lienzo de trabajo con el tamaño pedido, creándolo o
 * redimensionándolo sólo cuando hace falta. `current` puede ser `null` en el
 * primer frame.
 */
export function ensureScratchCanvas(
  current: HTMLCanvasElement | null,
  width: number,
  height: number,
  create: () => HTMLCanvasElement,
): ScratchCanvas {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  if (!current) {
    const canvas = create();
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    return { canvas, resized: true };
  }
  if (current.width === targetWidth && current.height === targetHeight) {
    return { canvas: current, resized: false };
  }
  // Asignar tamaño reinicia el contexto del lienzo: sólo se hace al cambiar.
  current.width = targetWidth;
  current.height = targetHeight;
  return { canvas: current, resized: true };
}
