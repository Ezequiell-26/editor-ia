import type { KeyboardEvent } from 'react';

/**
 * Activación por teclado para superficies que se dibujan como `<div>` por
 * motivos de diseño. Sin `role`/`tabIndex`/`onKeyDown` esos elementos son
 * inalcanzables con Tab y no responden a Enter/Espacio.
 *
 * La comprobación de `target === currentTarget` evita que un botón anidado
 * (expandir carpeta, favorito, etc.) dispare DOS acciones al pulsar Enter:
 * el evento burbujea hasta el contenedor.
 */
export function onKeyboardActivate(
  event: KeyboardEvent<HTMLElement>,
  activate: () => void,
): void {
  if (event.target !== event.currentTarget) return;
  if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
  event.preventDefault();
  activate();
}
