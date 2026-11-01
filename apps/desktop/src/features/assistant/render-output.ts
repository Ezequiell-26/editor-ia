/**
 * Nombre de salida determinista para el render iniciado por un agente.
 * Evita el diálogo nativo de guardado (que bloquea la UI y no puede operar un
 * cliente MCP) y deja el MP4 junto al proyecto.
 */
function safeStem(value: string, max: number): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '') || 'olyvia'
  );
}

export function renderOutputFileName(
  projectName: string,
  profileId: string | null,
  now: Date = new Date(),
): string {
  const base = safeStem(projectName, 60);
  const profile = profileId ? `-${safeStem(profileId, 24)}` : '';
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
  return `${base}${profile}-${stamp}.mp4`;
}

/** Nombre estable por escena y revisión: permite reanudar sin reutilizar un segmento viejo. */
export function segmentOutputFileName(
  projectName: string,
  sceneId: string,
  revision: number,
): string {
  return `${safeStem(projectName, 50)}-escena-${safeStem(sceneId, 12)}-r${Math.max(0, Math.round(revision))}.mp4`;
}
