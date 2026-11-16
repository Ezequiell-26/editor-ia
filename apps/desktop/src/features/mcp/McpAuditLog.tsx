import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import type { McpAuditTail } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';
import {
  AUDIT_STATUS_LABELS,
  auditEntriesOf,
  auditEntryDuration,
  auditEntryScopes,
  auditEntryStatus,
  auditEntryTime,
  auditEntryTool,
  prettyAuditEntry,
} from './mcp-audit';

/** Límites que ofrece el selector; el backend acepta hasta 500. */
const AUDIT_LIMITS = [25, 50, 100] as const;

/**
 * Audit log del servidor MCP propio (`mcp_audit_tail`): las últimas
 * llamadas `tools/call` registradas en `<config_dir>/mcp-audit.jsonl`.
 * Muestra lo que el backend sanitizó (secretos `[redacted]`) y distingue
 * "sin auditoría todavía" de "no se pudo leer el archivo".
 */
export function McpAuditLog() {
  const store = useProjectStore();
  const [limit, setLimit] = useState<number>(50);
  const [tail, setTail] = useState<McpAuditTail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!store.service.available) {
      setTail(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setTail(await store.service.mcpAuditTail(limit));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'no se pudo leer el audit log del servidor MCP',
      );
    } finally {
      setLoading(false);
    }
  }, [store.service, limit]);

  // `refresh` depende de `limit`: cambiar el selector vuelve a pedir la cauda.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // El backend devuelve orden cronológico; la UI muestra lo más nuevo arriba.
  const entries = [...auditEntriesOf(tail)].reverse();

  return (
    <section className="card" aria-labelledby="mcp-audit-title">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Auditoría</p>
          <h3 id="mcp-audit-title">Audit log del servidor MCP</h3>
        </div>
        {tail ? (
          <span className="status-pill">
            {tail.entries.length} entrada{tail.entries.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
      <p className="muted">
        Registro de las últimas llamadas <code>tools/call</code> que atendió el servidor MCP de
        Olyvia. Los argumentos sensibles llegan ya redactados desde el backend.
      </p>
      {!store.service.available ? (
        <p className="fine-print">
          El audit log sólo existe en la app de escritorio: el navegador no puede leer el archivo
          del servidor MCP.
        </p>
      ) : (
        <>
          <div className="actions">
            <button
              type="button"
              className="ghost small icon-text"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <Icon name="refresh" size={14} />
              <span>{loading ? 'Leyendo…' : 'Recargar'}</span>
            </button>
            <label className="field mcp-audit-limit">
              <span>Mostrar últimas</span>
              <select
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
                disabled={loading}
              >
                {AUDIT_LIMITS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error ? (
            <p className="notice notice-warning" role="alert">
              {error}
            </p>
          ) : null}
          {loading && !tail ? (
            <p className="fine-print" role="status">
              Leyendo el audit log…
            </p>
          ) : null}
          {tail && entries.length === 0 && !loading ? (
            <p className="empty-inline">
              Todavía no hay llamadas auditadas: el registro se escribe con la primera herramienta
              que atienda el servidor MCP.
            </p>
          ) : null}
          {entries.length > 0 ? (
            <>
              <ul className="mcp-audit-list">
                {entries.map((entry, index) => {
                  const status = auditEntryStatus(entry);
                  const duration = auditEntryDuration(entry.durationMs);
                  const scopes = auditEntryScopes(entry);
                  return (
                    <li key={index} className={`mcp-audit-row status-${status}`}>
                      <div className="mcp-audit-row-head">
                        <span className="mcp-audit-time">{auditEntryTime(entry.ts)}</span>
                        <code className="mcp-audit-tool">{auditEntryTool(entry)}</code>
                        <span className={`status-pill ${status === 'ok' ? 'saved' : status === 'error' || status === 'denied' ? 'failed' : ''}`}>
                          {AUDIT_STATUS_LABELS[status]}
                        </span>
                        {duration ? <span className="mcp-audit-duration">{duration}</span> : null}
                      </div>
                      {scopes ? <p className="fine-print">Scope: {scopes}</p> : null}
                      {typeof entry.result === 'string' && entry.result ? (
                        <p className="mcp-audit-result fine-print" title={entry.result}>
                          {entry.result}
                        </p>
                      ) : null}
                      <details className="mcp-schema">
                        <summary>Entrada completa</summary>
                        <pre>{prettyAuditEntry(entry)}</pre>
                      </details>
                    </li>
                  );
                })}
              </ul>
              {tail?.truncated ? (
                <p className="fine-print">
                  El archivo tiene más entradas: se muestran sólo las últimas {limit}.
                </p>
              ) : null}
              {tail && tail.skipped > 0 ? (
                <p className="fine-print">
                  {tail.skipped} línea{tail.skipped === 1 ? '' : 's'} del archivo no se pudieron
                  leer y no aparecen acá.
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
