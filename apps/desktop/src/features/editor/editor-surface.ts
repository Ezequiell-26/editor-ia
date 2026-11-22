import type { EditorModeId } from '../../app/view-routing';

/**
 * UN SOLO EDITOR · superficie visual del workspace.
 *
 * `alaukcut-chrome` activa la barra superior, el pie y la paleta de la
 * referencia (`alauk-chrome.css`) en TODOS los modos: cambiar de
 * herramienta no puede cambiar la identidad visual del editor.
 *
 * `alaukcut` activa además la geometría de tres columnas medida en las
 * capturas 146-160 (`alaukcut-reference.css`). Esa grilla sólo es válida en
 * `timeline`: los modos de herramienta usan un grid de dos columnas con el
 * panel de la herramienta a la izquierda y el monitor persistente a la
 * derecha. Aplicarles la referencia los aplastaría.
 *
 * Función pura: permite gatear el contrato sin montar `EditorWorkspace`
 * (que arrastra Preview/Timeline/Inspector) en jsdom.
 */
export function editorSurfaceClass(mode: EditorModeId): string {
  const reference = mode === 'timeline' ? ' alaukcut' : '';
  return `editor-workspace alaukcut-chrome${reference}`;
}
