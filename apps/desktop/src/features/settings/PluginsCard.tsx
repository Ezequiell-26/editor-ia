import { useEffect, useState } from 'react';
import { useProjectStore } from '../../state/project-store';
import type { PluginCommandInfo, PluginInfo } from '../../services/project-service';

/**
 * Extensiones: plugins, skills y conectores.
 *
 * Los tres comparten el mismo formato de manifiesto (`plugin.json`) y se
 * distinguen por `kind`:
 * - `plugin`: presets y comandos.
 * - `skill`: comandos que se ejecutan en cadena (un flujo de trabajo).
 * - `connector`: registra un servidor MCP con un clic.
 *
 * Los comandos se ejecutan con el operador local del asistente a través del
 * evento `olyvia:run-command`: no pasan por el modelo, así que son instantáneos.
 */

const KIND_LABEL: Record<PluginInfo['kind'], string> = {
  connector: 'Conectores',
  skill: 'Skills',
  plugin: 'Plugins',
};

export function PluginsCard() {
  const store = useProjectStore();
  const [items, setItems] = useState<readonly PluginInfo[]>([]);
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Respuesta del operador por comando (`pluginId:commandId` → texto).
  const [commandFeedback, setCommandFeedback] = useState<Record<string, string>>({});

  async function refresh(): Promise<void> {
    try {
      setItems(await store.service.listPlugins());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no pude leer las extensiones');
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function install(): Promise<void> {
    if (!path.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const installed = await store.service.installPlugin(path.trim());
      setPath('');
      store.setNotice(`«${installed.name}» instalado.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no pude instalar');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: PluginInfo): Promise<void> {
    try {
      await store.service.setPluginEnabled(item.id, !item.enabled);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no pude cambiar el estado');
    }
  }

  async function remove(item: PluginInfo): Promise<void> {
    try {
      await store.service.removePlugin(item.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no pude quitarlo');
    }
  }

  /** Registra el servidor MCP que declara el conector. */
  async function connect(item: PluginInfo): Promise<void> {
    if (!item.mcp) {
      setError('el conector no declara un servidor MCP');
      return;
    }
    try {
      await store.service.saveMcpServer({
        name: item.name,
        command: item.mcp.command,
        args: [...item.mcp.args],
        env: item.mcp.env.map((key) => ({ key })),
        enabled: true,
      });
      store.setNotice(`Conector «${item.name}» agregado. Probalo en la vista MCP.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'no pude agregar el conector');
    }
  }

  /**
   * Dispara los pasos del comando por el puente del asistente y muestra la
   * respuesta inline: sin `onResult` el usuario no vería que pasó nada.
   */
  function runCommand(plugin: PluginInfo, command: PluginCommandInfo): void {
    const key = `${plugin.id}:${command.id}`;
    setCommandFeedback((current) => ({ ...current, [key]: 'Ejecutando…' }));
    command.steps.forEach((text, index) => {
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('olyvia:run-command', {
            detail: {
              text,
              onResult: (reply: string) =>
                setCommandFeedback((current) => ({ ...current, [key]: reply })),
            },
          }),
        );
      }, index * 600);
    });
  }

  const groups: PluginInfo['kind'][] = ['connector', 'skill', 'plugin'];

  return (
    <section className="card" aria-labelledby="plugins-title">
      <header className="card-head">
        <div>
          <p className="eyebrow">Extensiones</p>
          <h3 id="plugins-title">Plugins, skills y conectores</h3>
          <p className="fine-print">
            Instalá una carpeta con <code>plugin.json</code>. El campo <code>kind</code> decide si es
            plugin, skill o conector.
          </p>
        </div>
        <span className="badge">{items.length}</span>
      </header>

      <div className="plugins-install">
        <label className="field">
          <span>Instalar desde una carpeta</span>
          <input
            type="text"
            value={path}
            placeholder="C:/MisExtensiones/mi-skill"
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void install();
            }}
          />
        </label>
        <button type="button" className="small primary" disabled={busy || !path.trim()} onClick={() => void install()}>
          Instalar
        </button>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {items.length === 0 ? (
        <p className="fine-print">Todavía no hay extensiones instaladas.</p>
      ) : (
        groups.map((kind) => {
          const group = items.filter((item) => item.kind === kind);
          if (group.length === 0) return null;
          return (
            <div key={kind} className="plugin-group">
              <h4 className="plugin-group-title">{KIND_LABEL[kind]}</h4>
              <ul className="plugins-list">
                {group.map((item) => (
                  <li key={item.id} className={`plugin-row${item.enabled ? '' : ' disabled'}`}>
                    <div className="plugin-main">
                      <strong>
                        {item.name} <span className="fine-print">v{item.version}</span>
                        {item.official ? <span className="badge official">oficial</span> : null}
                      </strong>
                      <p className="fine-print">{item.description || 'Sin descripción.'}</p>
                      {item.error ? <p className="form-error">{item.error}</p> : null}
                      {item.commands.length > 0 ? (
                        <div className="plugin-commands">
                          {item.commands.map((command) => (
                            <button
                              key={command.id}
                              type="button"
                              className="small ghost"
                              disabled={!item.enabled}
                              onClick={() => runCommand(item, command)}
                            >
                              {command.label}
                            </button>
                          ))}
                          {item.commands.map((command) => {
                            const reply = commandFeedback[`${item.id}:${command.id}`];
                            return reply ? (
                              <p key={command.id} className="fine-print plugin-command-reply">
                                {reply}
                              </p>
                            ) : null;
                          })}
                        </div>
                      ) : null}
                    </div>
                    <div className="plugin-actions">
                      {item.kind === 'connector' && item.mcp ? (
                        <button type="button" className="small primary" onClick={() => void connect(item)}>
                          Conectar
                        </button>
                      ) : null}
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          aria-label={`Activar ${item.name}`}
                          onChange={() => void toggle(item)}
                        />
                        <span className="fine-print">activo</span>
                      </label>
                      {item.official ? null : (
                        <button type="button" className="small ghost" onClick={() => void remove(item)}>
                          Quitar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
