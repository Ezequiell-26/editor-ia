/** Inserta un emoji en el texto respetando la selección del campo. */
export function insertEmoji(
  value: string,
  emoji: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): { readonly value: string; readonly cursor: number } {
  const start = Math.max(0, Math.min(value.length, selectionStart ?? value.length));
  const end = Math.max(start, Math.min(value.length, selectionEnd ?? start));
  return {
    value: value.slice(0, start) + emoji + value.slice(end),
    cursor: start + emoji.length,
  };
}

/** Detecta pictogramas emoji sin depender de una lista de secuencias. */
export function hasEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text);
}
