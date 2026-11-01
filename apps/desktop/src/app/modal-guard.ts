/**
 * Los atajos globales no deben actuar detrás de un modal (`role=dialog` con
 * `aria-modal`). Sin esta guarda, con Configuración o la paleta abiertas,
 * Delete/Ctrl+D/S pueden borrar, duplicar o cortar el clip de fondo.
 */
export function hasOpenModal(doc: Document = document): boolean {
  return Boolean(doc.querySelector('[role="dialog"][aria-modal="true"]'));
}
