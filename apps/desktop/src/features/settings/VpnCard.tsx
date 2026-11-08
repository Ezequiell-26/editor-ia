import { useCallback, useEffect, useState } from 'react';
import type { VpnConnection, WireGuardInfo } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';

interface Status {
  readonly kind: 'ok' | 'error';
  readonly text: string;
}

function statusLabel(status: string): string {
  if (status === 'Connected') return 'Conectada';
  if (status === 'Connecting') return 'Conectando…';
  return 'Desconectada';
}

/**
 * VPN del sistema: gestiona las conexiones VPN nativas de Windows
 * (IKEv2/L2TP/SSTP/PPTP) con `rasdial` usando las credenciales ya guardadas
 * por Windows — la app nunca pide ni maneja contraseñas. WireGuard se abre
 * en su app oficial si está instalada. Crear conexiones nuevas se hace en
 * Configuración de Windows: requiere admin y credenciales.
 */
export function VpnCard() {
  const store = useProjectStore();
  const [connections, setConnections] = useState<readonly VpnConnection[]>([]);
  const [wireguard, setWireguard] = useState<WireGuardInfo | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!store.service.available) {
      setConnections([]);
      setWireguard(null);
      setLoaded(true);
      return;
    }
    try {
      const [list, wg] = await Promise.all([
        store.service.vpnList(),
        store.service.vpnWireguard(),
      ]);
      setConnections(list);
      setWireguard(wg);
    } catch {
      // Sin backend (navegador u OS sin soporte) el panel queda vacío.
      setConnections([]);
      setWireguard(null);
    } finally {
      setLoaded(true);
    }
  }, [store.service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle(connection: VpnConnection): Promise<void> {
    const connected = connection.status === 'Connected';
    setBusyName(connection.name);
    setStatus(null);
    try {
      if (connected) {
        await store.service.vpnDisconnect(connection.name);
        setStatus({ kind: 'ok', text: `«${connection.name}» desconectada.` });
      } else {
        await store.service.vpnConnect(connection.name);
        setStatus({ kind: 'ok', text: `«${connection.name}» conectada.` });
      }
      await refresh();
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'la operación VPN falló',
      });
      await refresh();
    } finally {
      setBusyName(null);
    }
  }

  async function openWireguard(): Promise<void> {
    setStatus(null);
    try {
      await store.service.vpnWireguardOpen();
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'no se pudo abrir WireGuard',
      });
    }
  }

  return (
    <article className="card vpn-card">
      <p className="eyebrow">Red</p>
      <h3>VPN del sistema</h3>
      <p className="muted">
        Gestiona las conexiones VPN configuradas en Windows (Configuración → Red e
        Internet → VPN). La app conecta y desconecta con las credenciales que
        Windows ya tiene guardadas; nunca pide contraseñas. WireGuard se maneja
        desde su aplicación oficial.
      </p>

      {!loaded ? <p className="muted">Consultando conexiones…</p> : null}

      {loaded && connections.length === 0 ? (
        <p className="muted">
          No hay conexiones VPN configuradas en este equipo. Se crean desde
          Configuración de Windows y aparecen acá para conectarlas.
        </p>
      ) : null}

      {connections.length > 0 ? (
        <ul className="vpn-list">
          {connections.map((connection) => {
            const connected = connection.status === 'Connected';
            const busy = busyName === connection.name;
            return (
              <li key={connection.name} className="vpn-item">
                <div className="vpn-item-info">
                  <strong>{connection.name}</strong>
                  <span className="muted">
                    {connection.serverAddress || 'sin servidor'} · {connection.tunnelType || 'VPN'}
                  </span>
                </div>
                <span
                  className={`vpn-status${connected ? ' connected' : ''}`}
                  role="status"
                >
                  {statusLabel(connection.status)}
                </span>
                <button
                  type="button"
                  className={connected ? 'ghost' : 'primary'}
                  disabled={busy || connection.status === 'Connecting'}
                  onClick={() => void toggle(connection)}
                >
                  {busy ? 'Procesando…' : connected ? 'Desconectar' : 'Conectar'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {wireguard ? (
        <div className="vpn-wireguard">
          <p className="muted">
            {wireguard.installed
              ? 'WireGuard está instalado: su túnel se activa desde la app oficial (pide elevación propia).'
              : 'WireGuard no está instalado en este equipo; se descarga desde su sitio oficial.'}
          </p>
          {wireguard.installed ? (
            <button type="button" onClick={() => void openWireguard()}>
              Abrir WireGuard
            </button>
          ) : null}
        </div>
      ) : null}

      {status ? (
        <p className={status.kind === 'error' ? 'notice notice-warning' : 'notice notice-ok'}>
          {status.text}
        </p>
      ) : null}
    </article>
  );
}
