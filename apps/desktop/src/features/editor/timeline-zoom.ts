/**
 * Escala de zoom de la línea de tiempo, en px/frame.
 *
 * CapCut expone un deslizador continuo en la barra inferior del timeline en
 * lugar de sólo botones «− / +». La escala perceptual del zoom es
 * multiplicativa (cada paso multiplica, no suma), así que el control usa un
 * mapeo logarítmico: posiciones iguales del slider producen el mismo factor
 * de acercamiento en todo el rango. Mantener `ZOOM_MIN`/`ZOOM_MAX` acá evita
 * que el slider y los botones divergan.
 */
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 14;
export const ZOOM_SLIDER_MAX = 100;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Posición del slider (0…100) → px/frame. */
export function zoomFromSlider(position: number): number {
  const t = clamp(position, 0, ZOOM_SLIDER_MAX) / ZOOM_SLIDER_MAX;
  return clamp(ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** t, ZOOM_MIN, ZOOM_MAX);
}

/** px/frame → posición del slider (0…100), inversa de `zoomFromSlider`. */
export function sliderFromZoom(zoom: number): number {
  const value = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  return Math.round(
    (Math.log(value / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)) * ZOOM_SLIDER_MAX,
  );
}
