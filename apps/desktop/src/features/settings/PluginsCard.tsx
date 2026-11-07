import { useEffect, useState } from 'react';
import { useProjectStore } from '../../state/project-store';
import type { PluginCommandInfo, PluginInfo } from '../../services/project-service';
import {
  applyPluginCaptionStyles,
  applyPluginExportProfiles,
  countPluginPresets,
  importPluginEffectTemplate,
  parsePluginPresets,
} from '../../state/plugin-presets';

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
  // Resultado de aplicar presets (`pluginId` → texto).
  const [presetFeedback, setPresetFeedback] = useState<Record<string, string>>({});

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

  /**
   * Aplica los presets válidos de un plugin. Las plantillas de efectos se
   * importan a la biblioteca del usuario; los perfiles y estilos se agregan al
   * proyecto abierto (sin proyecto, se explica por qué no se puede).
   */
  function applyPresets(
    item: PluginInfo,
    kind: 'effects' | 'exportProfiles' | 'captionStyles',
  ): void {
    const parsed = parsePluginPresets(item);
    const feedback = (text: string) =>
      setPresetFeedback((current) => ({ ...current, [item.id]: text }));
    if (kind === 'effects') {
      const templates = parsed.effects.flatMap((entry) =>
        'error' in entry ? [] : [entry.template],
      );
      if (templates.length === 0) {
        feedback('El plugin no tiene plantillas de efectos válidas.');
        return;
      }
      for (const template of templates) importPluginEffectTemplate(template);
      const invalid = parsed.effects.length - templates.length;
      feedback(
        `${templates.length} plantilla(s) de efectos importadas` +
          (invalid > 0 ? ` · ${invalid} inválida(s) omitida(s)` : '') +
          '.',
      );
      return;
    }
    const project = store.state.project;
    if (!project) {
      feedback('Abrí un proyecto para aplicar presets de exportación o subtítulos.');
      return;
    }
    if (kind === 'exportProfiles') {
      const presets = parsed.exportProfiles.flatMap((entry) =>
        'error' in entry ? [] : [entry.preset],
      );
      const invalid = parsed.exportProfiles.length - presets.length;
      if (presets.length === 0) {
        feedback('El plugin no tiene perfiles de exportación válidos.');
        return;
      }
      const result = applyPluginExportProfiles(project, presets);
      if (result.added === 0) {
        feedback(`${result.skipped} perfil(es) ya existían en el proyecto; no se agregó nada.`);
        return;
      }
      store.update(() => result.project, {
        notice:
          `${result.added} perfil(es) de exportación agregados al proyecto` +
          (result.skipped > 0 ? ` · ${result.skipped} ya existían` : '') +
          (invalid > 0 ? ` · ${invalid} inválido(s)` : '') +
          '.',
      });
      return;
    }
    const presets = parsed.captionStyles.flatMap((entry) =>
      'error' in entry ? [] : [entry.preset],
    );
    const invalid = parsed.captionStyles.length - presets.length;
    if (presets.length === 0) {
      feedback('El plugin no tiene estilos de subtítulos válidos.');
      return;
    }
    const result = applyPluginCaptionStyles(project, presets);
    if (result.added === 0) {
      feedback(`${result.skipped} estilo(s) ya existían en el proyecto; no se agregó nada.`);
      return;
    }
    store.update(() => result.project, {
      notice:
        `${result.added} estilo(s) de subtítulos agregados al proyecto` +
        (result.skipped > 0 ? ` · ${result.skipped} ya existían` : '') +
        (invalid > 0 ? ` · ${invalid} inválido(s)` : '') +
        '.',
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
                      <PluginPresetsBlock
                        item={item}
                        hasProject={Boolean(store.state.project)}
                        onApply={applyPresets}
                        feedback={presetFeedback[item.id] ?? null}
                      />
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

type PresetKind = 'effects' | 'exportProfiles' | 'captionStyles';

/**
 * Presets declarados por el manifiesto. Muestra cuántos son válidos según el
 * contrato de `state/plugin-presets` y un botón por grupo; los inválidos se
 * cuentan, no se ocultan.
 */
function PluginPresetsBlock({
  item,
  hasProject,
  onApply,
  feedback,
}: {
  item: PluginInfo;
  hasProject: boolean;
  onApply: (item: PluginInfo, kind: PresetKind) => void;
  feedback: string | null;
}) {
  const parsed = parsePluginPresets(item);
  const { valid, invalid } = countPluginPresets(parsed);
  if (valid + invalid === 0) return null;
  const effects = parsed.effects.filter((entry) => !('error' in entry)).length;
  const profiles = parsed.exportProfiles.filter((entry) => !('error' in entry)).length;
  const styles = parsed.captionStyles.filter((entry) => !('error' in entry)).length;
  return (
    <div className="plugin-commands">
      <p className="fine-print">
        Presets: {valid} válido(s)
        {invalid > 0 ? ` · ${invalid} inválido(s)` : ''}
      </p>
      {effects > 0 ? (
        <button type="button" className="small ghost" onClick={() => onApply(item, 'effects')}>
          Importar {effects} plantilla(s) de efectos
        </button>
      ) : null}
      {profiles > 0 ? (
        <button
          type="button"
          className="small ghost"
          disabled={!hasProject}
          title={hasProject ? undefined : 'Abrí un proyecto primero'}
          onClick={() => onApply(item, 'exportProfiles')}
        >
          Agregar {profiles} perfil(es) de exportación
        </button>
      ) : null}
      {styles > 0 ? (
        <button
          type="button"
          className="small ghost"
          disabled={!hasProject}
          title={hasProject ? undefined : 'Abrí un proyecto primero'}
          onClick={() => onApply(item, 'captionStyles')}
        >
          Agregar {styles} estilo(s) de subtítulos
        </button>
      ) : null}
      {feedback ? <p className="fine-print plugin-command-reply">{feedback}</p> : null}
    </div>
  );
}
