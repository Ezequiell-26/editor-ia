/**
 * División determinista de un rango de escena en chunks para reanudar renders
 * largos. No toca FFmpeg: sólo calcula rangos y nombres estables.
 */
export interface SceneChunk {
  readonly index: number;
  readonly startFrame: number;
  readonly endFrame: number;
}

export function planSceneChunks(
  startFrame: number,
  endFrame: number,
  chunkFrames: number,
): SceneChunk[] {
  const start = Math.max(0, Math.round(Number.isFinite(startFrame) ? startFrame : 0));
  const end = Math.max(start, Math.round(Number.isFinite(endFrame) ? endFrame : start));
  const size = Math.max(1, Math.round(Number.isFinite(chunkFrames) ? chunkFrames : 1));
  if (end <= start) return [];
  const chunks: SceneChunk[] = [];
  let cursor = start;
  let index = 0;
  while (cursor < end) {
    const next = Math.min(end, cursor + size);
    chunks.push({ index, startFrame: cursor, endFrame: next });
    cursor = next;
    index += 1;
  }
  return chunks;
}

/**
 * Nombre de archivo de una ruta absoluta, aceptando `/` y `\` (Windows).
 * Evita regex con backslash para no depender del escapado del fuente.
 */
export function fileNameOf(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf(String.fromCharCode(92)));
  return index >= 0 ? path.slice(index + 1) : path;
}

/** `foo-r3.mp4` → `foo-r3-c02.mp4`. */
export function chunkOutputName(finalName: string, index: number): string {
  const suffix = `-c${String(index + 1).padStart(2, '0')}`;
  const match = finalName.match(/^(.*?)(\.[a-z0-9]+)$/i);
  return match ? `${match[1]}${suffix}${match[2]}` : `${finalName}${suffix}`;
}
