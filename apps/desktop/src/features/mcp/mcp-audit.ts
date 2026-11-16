import type { McpAuditEntry, McpAuditTail } from '../../services/project-service';

/**
 * Helpers puros para el audit log del servidor MCP (`mcp_audit_tail`).
 *
 * Las entradas vienen del JSONL ya sanitizadas por el backend, pero el
 * archivo es texto plano y admite líneas de versiones viejas o editadas a
 * mano: todo se lee de forma defensiva y ningún campo se inventa.
 */

export type AuditEntryStatus = 'ok' | 'error' | 'denied' | 'unknown';

/**
 * Una línea del JSONL puede parsear como cualquier JSON válido (string,
 * número, array). Sólo los objetos tienen campos auditables.
 */
export function asAuditEntry(value: unknown): McpAuditEntry {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as McpAuditEntry;
  }
  return {};
}

/** Entradas del tail normalizadas, en el mismo orden cronológico. */
export function auditEntriesOf(tail: McpAuditTail | null): McpAuditEntry[] {
  return (tail?.entries ?? []).map(asAuditEntry);
}

/**
 * Estado visible de la entrada: el rechazo por scope es propio (no es un
 * "error" de la herramienta) y `ok` ausente queda como desconocido.
 */
export function auditEntryStatus(entry: McpAuditEntry): AuditEntryStatus {
  if (typeof entry.denied === 'string' && entry.denied.length > 0) return 'denied';
  if (entry.ok === true) return 'ok';
  if (entry.ok === false) return 'error';
  return 'unknown';
}

export const AUDIT_STATUS_LABELS: Record<AuditEntryStatus, string> = {
  ok: 'OK',
  error: 'Error',
  denied: 'Rechazada',
  unknown: '—',
};

/** Nombre de la herramienta; las líneas sin `tool` se muestran honestas. */
export function auditEntryTool(entry: McpAuditEntry): string {
  return typeof entry.tool === 'string' && entry.tool.trim().length > 0
    ? entry.tool
    : '(sin herramienta)';
}

/** `ts` es epoch ms; formato corto fecha+hora local, '—' si no es válido. */
export function auditEntryTime(ts: unknown): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '—';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Duración en ms → "12 ms" / "1,4 s"; null si el campo no vino. */
export function auditEntryDuration(durationMs: unknown): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} s`;
}

/**
 * Scopes de una llamada rechazada: `requiredScope` y `grantedScopes` vienen
 * sólo en entradas `denied`. Devuelve texto listo para mostrar o null.
 */
export function auditEntryScopes(entry: McpAuditEntry): string | null {
  if (auditEntryStatus(entry) !== 'denied') return null;
  const parts: string[] = [];
  if (typeof entry.requiredScope === 'string' && entry.requiredScope) {
    parts.push(`requiere «${entry.requiredScope}»`);
  }
  const granted = Array.isArray(entry.grantedScopes)
    ? entry.grantedScopes.filter((scope): scope is string => typeof scope === 'string')
    : [];
  if (granted.length > 0) parts.push(`concedidos: ${granted.join(', ')}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** JSON legible de la entrada cruda para el `<details>` de cada fila. */
export function prettyAuditEntry(entry: McpAuditEntry): string {
  try {
    return JSON.stringify(entry, null, 2);
  } catch {
    return String(entry);
  }
}
