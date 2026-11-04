/**
 * Ayudas para mostrar una respuesta del asistente mientras llega en streaming.
 *
 * El proveedor devuelve un único objeto JSON (`{"reply": "...", "actions":
 * [...]}`), así que un delta crudo puede ser `{"rep`, `ly":"Ho`, etc. Para la
 * burbuja en vivo se muestra sólo el valor parcial de `reply`, decodificando los
 * escapes que ya llegaron; el resto del JSON no se muestra. El cierre del
 * streaming sigue validando el JSON completo en Rust/frontend.
 */

/** Valor parcial de `reply` en un buffer JSON incompleto ("" si aún no hay). */
export function replyPreviewFromStream(buffer: string): string {
  const markerIndex = buffer.indexOf('"reply"');
  if (markerIndex < 0) return '';
  const colonIndex = buffer.indexOf(':', markerIndex + '"reply"'.length);
  if (colonIndex < 0) return '';
  let index = colonIndex + 1;
  while (index < buffer.length && /\s/.test(buffer[index] ?? '')) index += 1;
  if (buffer[index] !== '"') return '';
  index += 1;
  let preview = '';
  while (index < buffer.length) {
    const character = buffer[index]!;
    if (character === '\\') {
      const escaped = buffer[index + 1];
      // El escape puede venir cortado por el borde del chunk: se espera al próximo.
      if (escaped === undefined) break;
      if (escaped === 'n') preview += '\n';
      else if (escaped === 'r') preview += '\r';
      else if (escaped === 't') preview += '\t';
      else preview += escaped;
      index += 2;
      continue;
    }
    if (character === '"') break;
    preview += character;
    index += 1;
  }
  return preview;
}
