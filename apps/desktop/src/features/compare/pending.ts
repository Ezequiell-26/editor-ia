const PENDING_KEY = 'editor-ia.pending-comparison';

export interface PendingComparison {
  readonly beforePath: string;
  readonly afterPath: string;
}

/**
 * Pasa un par original/procesado de otra vista a Comparar sin persistirlo.
 * Mismo patrón que la URL pendiente de Descargar: es una orden de una sola vez,
 * no un estado que la app deba recordar para siempre.
 */
export function queuePendingComparison(pair: PendingComparison): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pair));
  } catch {
    // Sin sessionStorage la comparación se arma a mano en la vista.
  }
}

export function takePendingComparison(): PendingComparison | null {
  try {
    const text = window.sessionStorage.getItem(PENDING_KEY);
    if (!text) return null;
    window.sessionStorage.removeItem(PENDING_KEY);
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const beforePath = typeof record.beforePath === 'string' ? record.beforePath : '';
    const afterPath = typeof record.afterPath === 'string' ? record.afterPath : '';
    if (!beforePath || !afterPath) return null;
    return { beforePath, afterPath };
  } catch {
    return null;
  }
}
