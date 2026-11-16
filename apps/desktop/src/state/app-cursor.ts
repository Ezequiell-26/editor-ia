/**
 * Cursor propio de la app — paridad del modo `cursor_editar` de AlaukCut
 * (`cursor_mouse.js`/`cursor_estilos.js`), que reemplaza el cursor del
 * sistema por un PNG generado por canvas (3 estilos × colores × onda).
 *
 * Aquí los cursores son SVG inline (assets propios, no se copian los PNG de
 * AlaukCut): puntero clásico, flecha gruesa y flecha 3D con extrusión.
 * El hotspot es la punta de la flecha (6,4) en una imagen de 32×32.
 */

export type AppCursorStyle = 'system' | 'classico' | 'cheia' | '3d';

const HOTSPOT_X = 6;
const HOTSPOT_Y = 4;

const ARROW_CLASSIC =
  'M6 4 L6 23 L10.5 18.6 L13.5 25 L16.5 23.8 L13.6 17.4 L20.5 17.4 Z';
const ARROW_BOLD =
  'M6 4 L6 24.5 L11.2 20 L14.8 27 L18.4 25.5 L14.9 18.2 L22.5 18.2 Z';
const ARROW_3D_BODY =
  'M8.5 6.5 L8.5 25.5 L13 21 L16 27.5 L19 26.2 L15.9 19.8 L23 19.8 Z';

function svgUri(body: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    body +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const CURSOR_IMAGES: Record<Exclude<AppCursorStyle, 'system'>, string> = {
  classico: svgUri(
    `<path d="${ARROW_CLASSIC}" fill="#ffffff" stroke="#101828" stroke-width="1.8" stroke-linejoin="round"/>`,
  ),
  cheia: svgUri(
    `<path d="${ARROW_BOLD}" fill="#ffffff" stroke="#101828" stroke-width="2.6" stroke-linejoin="round"/>`,
  ),
  '3d': svgUri(
    `<path d="${ARROW_3D_BODY}" fill="#101828" opacity="0.85"/>` +
      `<path d="${ARROW_CLASSIC}" fill="#ffffff" stroke="#101828" stroke-width="1.6" stroke-linejoin="round"/>`,
  ),
};

/**
 * Valor CSS `cursor` para el estilo pedido. `system` devuelve `auto` (el
 * cursor heredado del sistema). El `, auto` final es el fallback cuando el
 * navegador no soporta cursores SVG.
 */
export function appCursorCss(style: AppCursorStyle): string {
  if (style === 'system') return 'auto';
  return `url("${CURSOR_IMAGES[style]}") ${HOTSPOT_X} ${HOTSPOT_Y}, auto`;
}

/** Estilos elegibles en Ajustes → Editor. */
export const APP_CURSOR_OPTIONS: readonly {
  value: AppCursorStyle;
  label: string;
}[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'classico', label: 'Clásico' },
  { value: 'cheia', label: 'Gruesa' },
  { value: '3d', label: '3D' },
];
