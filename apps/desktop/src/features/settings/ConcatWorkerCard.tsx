import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import type {
  ConcatWorkerEnvelope,
  ConcatWorkerStatus,
} from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Estado del concat-worker (`concat_worker_status` / `concat_worker_request`):
 * el proceso JSON-lines de `concat-media` que el backend usa para concatenar
 * y sondear medios. Vive en Ajustes › Herramientas porque es una herramienta
 * local más, igual que FFmpeg/FFprobe: si el binario no está compilado ni
 * empaquetado se muestra como no disponible con el motivo real, y el botón
 * "Probar conexión" hace un `ping` de verdad (spawnea el proceso si hace
 * falta) y muestra el envelope que devolvió.
 */
export function ConcatWorkerCard() {
  const store = useProjectStore();
  const [status, setStatus] = useState<ConcatWorkerStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pingBusy, setPingBusy] = useState(false);
  const [pingResult, setPingResult] = useState<{
    readonly ok: boolean;
    readonly text: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!store.service.available) {
      setStatus(null);
      setChecked(true);
      return;
    }
    setError(null);
    try {
      setStatus(await store.service.concatWorkerStatus());
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'no se pudo leer el estado del concat-worker',
      );
    } finally {
      setChecked(true);
    }
  }, [store.service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * `ping` es la op más barata del protocolo: verifica que el ejecutable
   * exista, que el spawn funcione y que el handshake JSON-lines responda.
   * El timeout es corto a propósito: un worker colgado no debe congelar la UI.
   */
  async function ping(): Promise<void> {
    setPingBusy(true);
    setPingResult(null);
    setError(null);
    try {
      const envelope: ConcatWorkerEnvelope = await store.service.concatWorkerRequest(
        'ping',
        null,
        10_000,
      );
      setPingResult({
        ok: envelope.ok === true,
        text: pretty(envelope),
      });
      // El ping puede haber spawneado el proceso: el estado `running` cambió.
      await refresh();
    } catch (failure) {
      setPingResult({
        ok: false,
        text:
          failure instanceof Error
            ? failure.message
            : 'el concat-worker no respondió',
      });
    } finally {
      setPingBusy(false);
    }
  }

  return (
    <article className="card">
      <div className="production-card-head">
        <div>
          <p className="eyebrow">Herramienta de medios</p>
          <h3>Concat worker</h3>
        </div>
        {status ? (
          <span className={`status-pill ${status.available ? 'saved' : 'failed'}`}>
            {status.available ? 'Disponible' : 'No disponible'}
          </span>
        ) : checked ? (
          <span className="status-pill dirty">Sin lectura</span>
        ) : (
          <span className="status-pill">Comprobando</span>
        )}
      </div>
      <p className="muted">
        Proceso auxiliar que ejecuta <code>concat-media</code> en JSON-lines para unir y sondear
        medios sin pasar por la UI. No viene empaquetado en todas las builds.
      </p>
      {!store.service.available ? (
        <p className="fine-print">
          El estado del concat-worker sólo se puede leer en la app de escritorio.
        </p>
      ) : (
        <>
          {error ? (
            <p className="notice notice-warning" role="alert">
              {error}
            </p>
          ) : null}
          {status ? (
            <dl className="data-list">
              <div>
                <dt>Estado</dt>
                <dd>
                  {status.available
                    ? status.running
                      ? 'Binario presente · proceso activo'
                      : 'Binario presente · sin proceso'
                    : `No disponible${status.reason ? `: ${status.reason}` : ''}`}
                </dd>
              </div>
              {status.path ? (
                <div>
                  <dt>Ruta</dt>
                  <dd className="path">{status.path}</dd>
                </div>
              ) : null}
              {status.ops.length > 0 ? (
                <div>
                  <dt>Operaciones</dt>
                  <dd>
                    {status.ops.map((op, index) => (
                      <span key={op}>
                        {index > 0 ? ' · ' : ''}
                        <code>{op}</code>
                      </span>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : checked ? (
            <p className="empty-inline">No se pudo leer el estado del worker.</p>
          ) : (
            <p className="fine-print">Leyendo el estado del worker…</p>
          )}
          <div className="actions">
            <button
              type="button"
              className="ghost small icon-text"
              onClick={() => void refresh()}
              disabled={pingBusy}
            >
              <Icon name="refresh" size={14} />
              <span>Comprobar estado</span>
            </button>
            <button
              type="button"
              className="primary small"
              onClick={() => void ping()}
              disabled={pingBusy || !status?.available}
              title={
                status?.available
                  ? 'Enviá un ping al worker (spawnea el proceso si hace falta)'
                  : 'El worker no está disponible en esta instalación'
              }
            >
              {pingBusy ? 'Probando…' : 'Probar conexión'}
            </button>
          </div>
          {pingResult ? (
            <div className={`mcp-result${pingResult.ok ? '' : ' error'}`} role="status">
              <div>
                <span>{pingResult.ok ? 'Respuesta del worker' : 'Falló la prueba'}</span>
                <span>ping</span>
              </div>
              <pre>{pingResult.text}</pre>
            </div>
          ) : null}
          <p className="fine-print">
            «Probar conexión» ejecuta la op <code>ping</code> con timeout de 10 s. Si el worker no
            responde a tiempo el proceso se mata y la próxima llamada lo vuelve a levantar.
          </p>
        </>
      )}
    </article>
  );
}
