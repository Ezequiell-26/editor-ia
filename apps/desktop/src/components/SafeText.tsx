import type { ReactNode } from 'react';
import { sanitizeForUi } from '../platform/tauri/shared';

/**
 * Renderiza mensajes que pueden venir del backend o de un proveedor externo.
 * `sanitizeForUi` reduce rutas absolutas a su nombre de archivo y limita el
 * texto a 400 caracteres; para un mensaje corto normal es un no-op, así que
 * no cambia el contenido legítimo de la UI.
 *
 * Usar este componente en los puntos de salida evita tener que recordar la
 * redacción en cada `catch` y deja un único lugar que auditar.
 */
export function SafeText({ value }: {
  readonly value: string | null | undefined;
}): ReactNode {
  if (!value) return null;
  return <>{sanitizeForUi(value)}</>;
}
