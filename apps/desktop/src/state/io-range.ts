import type { ProjectDocument } from '@editor-ia/project-schema';

/**
 * Persistencia de los puntos in/out de la secuencia dentro del `.olyp`.
 *
 * El schema es estricto con las claves raíz, pero reserva el namespace `x-`
 * para campos forward-compatible (`KNOWN_ROOT_KEYS` exime `x-*` y el
 * `catchall(JsonValueSchema)` los conserva en la round-trip). Guardar el rango
 * como `x-ioRange` evita un bump de `schemaVersion`: builds anteriores ignoran
 * la clave y la preservan al re-guardar.
 */
export const IO_RANGE_KEY = 'x-ioRange';

export interface IoRange {
  readonly inFrame: number | null;
  readonly outFrame: number | null;
}

function frameOrNull(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return undefined;
}

/** Lee `x-ioRange` del documento; cualquier forma inválida se ignora. */
export function ioRangeFromDocument(project: ProjectDocument | null | undefined): IoRange | null {
  const raw = project?.[IO_RANGE_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const inFrame = frameOrNull(record.inFrame);
  const outFrame = frameOrNull(record.outFrame);
  if (inFrame === undefined || outFrame === undefined) {
    return null;
  }
  if (inFrame === null && outFrame === null) {
    return null;
  }
  return { inFrame, outFrame };
}

/** Devuelve el documento con el rango escrito (o la clave eliminada si es null). */
export function projectWithIoRange(project: ProjectDocument, range: IoRange | null): ProjectDocument {
  const next: ProjectDocument = { ...project };
  if (range === null) {
    delete next[IO_RANGE_KEY];
  } else {
    next[IO_RANGE_KEY] = { inFrame: range.inFrame, outFrame: range.outFrame };
  }
  return next;
}
