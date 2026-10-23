/**
 * Lógica del comparador antes/después.
 *
 * Todo lo que se puede probar sin DOM vive acá: el cálculo de posición desde el
 * puntero, el recorte y los modos de vista. El componente sólo pinta y delega.
 */

export type BeforeAfterMode = 'slider' | 'difference';

/** Posición de la línea en porcentaje, siempre acotada a 0–100. */
export function clampPosition(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

/** Paso de teclado: ±1 %, con Shift ±10 %. */
export function stepForKey(key: string, shift: boolean): number | null {
  const coarse = shift ? 10 : 1;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return -coarse;
    case 'ArrowRight':
    case 'ArrowUp':
      return coarse;
    case 'Home':
      return -Infinity;
    case 'End':
      return Infinity;
    default:
      return null;
  }
}

/** Porcentaje de la línea según el puntero, sin importar cómo esté anclado el contenedor. */
export function positionFromPointerX(clientX: number, rect: DOMRect): number {
  if (rect.width <= 0) return 50;
  return clampPosition(((clientX - rect.left) / rect.width) * 100);
}

/** Igual que la horizontal, para el modo vertical (por ahora reservado). */
export function positionFromPointerY(clientY: number, rect: DOMRect): number {
  if (rect.height <= 0) return 50;
  return clampPosition(((clientY - rect.top) / rect.height) * 100);
}

/**
 * Recorte de la capa "después": la imagen procesada se ve sólo a la derecha de
 * la línea. `clip-path: inset(top right bottom left)` con porcentajes.
 */
export function afterClip(position: number): string {
  return `inset(0 0 0 ${clampPosition(position)}%)`;
}

/**
 * Cuánto hay que acercar para que ambas imágenes se vean del mismo tamaño.
 * El zoom se aplica a las dos por igual: si el usuario acercó, la línea sigue
 * funcionando porque el recorte es del contenedor, no de la imagen.
 */
export function zoomTransform(zoom: number): string {
  if (!Number.isFinite(zoom) || zoom <= 0) return 'scale(1)';
  return `scale(${Math.min(8, Math.max(1, zoom))})`;
}

/** El modo "diferencia" mezcla las dos capas: igual píxel ⇒ negro. */
export function isDifferenceMode(mode: BeforeAfterMode): boolean {
  return mode === 'difference';
}

export function modeLabel(mode: BeforeAfterMode): string {
  switch (mode) {
    case 'slider':
      return 'Deslizar';
    case 'difference':
      return 'Diferencia';
  }
}
