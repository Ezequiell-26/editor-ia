import { useCallback, useEffect, useState } from 'react';
import type { CapabilityInfo, ModelInfo } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';

function megaBytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * Capacidades de la app en esta máquina y sus modelos.
 *
 * Es el panel de la regla fundacional: cada capacidad declara sus backends con
 * estado **medido** y, si falta algo, el motivo exacto. Los modelos se descargan
 * con checksum y muestran su licencia: app de pago, pesos auditados.
 */
export function CapabilitiesCard() {
  const store = useProjectStore();
  const [capabilities, setCapabilities] = useState<readonly CapabilityInfo[]>([]);
  const [models, setModels] = useState<readonly ModelInfo[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!store.service.available) {
      setCapabilities([]);
      setModels([]);
      return;
    }
    try {
      const [nextCapabilities, nextModels] = await Promise.all([
        store.service.listCapabilities(),
        store.service.listModels(),
      ]);
      setCapabilities(nextCapabilities);
      setModels(nextModels);
    } catch {
      // Sin backend, el panel queda vacío en lugar de romper Ajustes.
      setCapabilities([]);
      setModels([]);
    }
  }, [store.service]);

  useEffect(() => {
    void refresh();
  }, [refresh, store.service.available]);

  async function download(id: string): Promise<void> {
    setDownloadingId(id);
    setError(null);
    setNotice(null);
    try {
      await store.service.downloadModel(id);
      setNotice('Modelo descargado y verificado contra su checksum.');
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'la descarga del modelo falló');
    } finally {
      setDownloadingId(null);
    }
  }

  async function remove(id: string): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await store.service.deleteModel(id);
      setNotice('Modelo borrado del equipo. Se puede volver a descargar.');
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no se pudo borrar el modelo');
    }
  }

  return (
    <section className="card capabilities-card" aria-labelledby="capabilities-title">
      <header className="capabilities-head">
        <div>
          <p className="eyebrow">Capacidades con IA local</p>
          <h3 id="capabilities-title">Qué puede hacer tu equipo</h3>
          <p className="muted">
            Cada capacidad declara sus backends y su estado medido. Nada exige internet: si falta
            algo, te decimos exactamente qué.
          </p>
        </div>
      </header>

      {error ? <p className="notice notice-warning">{error}</p> : null}
      {notice ? <p className="notice notice-notice">{notice}</p> : null}

      <ul className="capabilities-list">
        {capabilities.map((capability) => (
          <li key={capability.id} className={`capability${capability.available ? ' ok' : ' missing'}`}>
            <span className="capability-state" aria-hidden="true">
              {capability.available ? '✓' : '!'}
            </span>
            <div className="capability-copy">
              <strong>{capability.label}</strong>
              <p>{capability.purpose}</p>
              {capability.backends.map((backend) => (
                <small key={backend.id}>
                  {backend.detail}
                  {backend.available ? ' · listo' : ` · ${backend.reason ?? 'no disponible'}`}
                </small>
              ))}
            </div>
          </li>
        ))}
        {capabilities.length === 0 ? (
          <li className="empty-inline">Este panel necesita la app de escritorio.</li>
        ) : null}
      </ul>

      {models.length > 0 ? (
        <div className="models-block">
          <p className="eyebrow">Modelos locales</p>
          <ul className="models-list">
            {models.map((model) => (
              <li key={model.id} className="model-row">
                <div className="model-copy">
                  <strong>{model.id}</strong>
                  <span>
                    {megaBytes(model.bytes)} · {model.downloaded ? 'descargado' : 'no descargado'}
                  </span>
                  <small title={model.license.detail}>
                    Licencia: {model.license.id} — {model.license.detail}
                  </small>
                </div>
                {model.downloaded ? (
                  <button type="button" className="ghost" onClick={() => void remove(model.id)}>
                    Borrar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void download(model.id)}
                    disabled={downloadingId !== null}
                  >
                    {downloadingId === model.id ? 'Descargando…' : 'Descargar'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
