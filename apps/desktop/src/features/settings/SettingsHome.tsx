import { useEffect, useState } from 'react';
import type {
  ProviderInfo,
  SystemInfo,
} from '../../services/project-service';
import { providerUrlProblem } from '../../services/project-service';
import { useProjectStore } from '../../state/project-store';

function VersionLine({ label, info }: { readonly label: string; readonly info: SystemInfo['ffmpeg'] }) {
  return (
    <div className={info.available ? 'tool-line ready' : 'tool-line missing'}>
      <div>
        <strong>{label}</strong>
        <span>{info.available ? info.version ?? 'disponible' : 'no disponible'}</span>
      </div>
      <p className="tool-path">{info.path ?? info.hint ?? 'sin ruta'}</p>
    </div>
  );
}

export function SettingsHome() {
  const store = useProjectStore();
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [kind, setKind] = useState('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [toolBusy, setToolBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!store.service.available) return;
    let active = true;
    void store.service
      .getProvider()
      .then((info) => {
        if (!active) return;
        setProvider(info);
        setKind(info.kind === 'mock' ? 'mock' : 'openai-compatible');
        setBaseUrl(info.baseUrl);
        setModel(info.model);
      })
      .catch(() => {
        if (active) setProvider(null);
      });
    void store.service
      .systemInfo()
      .then((info) => {
        if (active) setSystem(info);
      })
      .catch(() => {
        if (active) setSystem(null);
      });
    return () => {
      active = false;
    };
  }, [store.service]);

  async function saveProvider(): Promise<void> {
    if (kind !== 'mock') {
      const problem = providerUrlProblem(baseUrl);
      if (problem) {
        store.setNotice(problem);
        return;
      }
    }
    setBusy(true);
    try {
      const info = await store.service.saveProvider({
        kind,
        baseUrl,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setProvider(info);
      setApiKey('');
      store.setNotice('Proveedor guardado. La clave, si la escribiste, quedó en el almacén de Windows.');
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudo guardar el proveedor');
    } finally {
      setBusy(false);
    }
  }

  async function clearKey(): Promise<void> {
    setBusy(true);
    try {
      const info = await store.service.clearProviderKey();
      setProvider(info);
      store.setNotice('Clave del proveedor eliminada del almacén de Windows.');
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudo borrar la clave');
    } finally {
      setBusy(false);
    }
  }

  async function choose(tool: 'ffmpeg' | 'ffprobe'): Promise<void> {
    setToolBusy(tool);
    try {
      const info = await store.service.chooseTool(tool);
      if (info) {
        setSystem(info);
        store.setNotice(`${tool} actualizado.`);
      }
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : `no se pudo elegir ${tool}`);
    } finally {
      setToolBusy(null);
    }
  }

  async function refreshSystem(): Promise<void> {
    setToolBusy('refresh');
    try {
      setSystem(await store.service.systemInfo());
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudieron leer las capacidades');
    } finally {
      setToolBusy(null);
    }
  }

  async function pruneCache(): Promise<void> {
    try {
      const removed = await store.service.pruneRenderCache();
      store.setNotice(`Caché de render limpiada (${removed} carpeta(s) temporales).`);
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudo limpiar la caché');
    }
  }

  return (
    <section className="view settings-view">
      <div className="view-head">
        <div>
          <p className="eyebrow">Configuración</p>
          <h2>Ajustes</h2>
          <p className="view-summary">
            Proveedor de IA, herramientas de render y almacenamiento. Ninguna clave se guarda en el
            proyecto, en el navegador ni en los logs.
          </p>
        </div>
      </div>

      {!store.service.available ? (
        <p className="notice notice-warning">{store.service.unavailableReason}</p>
      ) : null}

      <div className="settings-grid">
        <article className="card">
          <p className="eyebrow">Proveedor de IA</p>
          <h3>Texto para guiones y escenas</h3>
          <p className="muted">
            Compatible con la API de chat de OpenAI: OpenAI, un endpoint local (Ollama, LM Studio,
            vLLM) o cualquier servicio con el mismo contrato. El proveedor simulado no hace red.
          </p>
          <div className="form-grid">
            <label className="field">
              <span>Tipo</span>
              <select value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="mock">Simulado (sin red)</option>
              </select>
            </label>
            <label className="field">
              <span>URL base</span>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://127.0.0.1:11434/v1"
                disabled={kind === 'mock'}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Modelo</span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="llama3.1"
                disabled={kind === 'mock'}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Clave API {provider?.hasKey ? '(ya guardada)' : '(opcional en local)'}</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={provider?.hasKey ? '••••••••  dejala vacía para conservarla' : 'sk-…'}
                disabled={kind === 'mock'}
                autoComplete="new-password"
              />
            </label>
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={() => void saveProvider()} disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar proveedor'}
            </button>
            <button type="button" onClick={() => void clearKey()} disabled={busy || !provider?.hasKey}>
              Borrar clave
            </button>
            <button
              type="button"
              onClick={() => {
                setKind('mock');
                setBaseUrl('');
                setModel('mock');
              }}
            >
              Usar simulado
            </button>
          </div>
          <p className="fine-print">
            {provider?.keyringAvailable
              ? 'Almacén de Windows disponible. La clave se lee sólo al hacer una llamada.'
              : 'El almacén de credenciales no respondió; las claves no se guardarán hasta que esté disponible.'}
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">Herramientas</p>
          <h3>FFmpeg, FFprobe y voz</h3>
          {system ? (
            <div className="tool-list">
              <VersionLine label="FFmpeg" info={system.ffmpeg} />
              <VersionLine label="FFprobe" info={system.ffprobe} />
              <VersionLine label="Windows PowerShell (SAPI)" info={system.powershell} />
            </div>
          ) : (
            <p className="empty-inline">Sin lectura de capacidades todavía.</p>
          )}
          <div className="actions">
            <button type="button" onClick={() => void choose('ffmpeg')} disabled={toolBusy !== null}>
              {toolBusy === 'ffmpeg' ? 'Eligiendo…' : 'Elegir ffmpeg.exe'}
            </button>
            <button type="button" onClick={() => void choose('ffprobe')} disabled={toolBusy !== null}>
              {toolBusy === 'ffprobe' ? 'Eligiendo…' : 'Elegir ffprobe.exe'}
            </button>
            <button type="button" className="ghost" onClick={() => void refreshSystem()} disabled={toolBusy !== null}>
              {toolBusy === 'refresh' ? 'Leyendo…' : 'Volver a detectar'}
            </button>
          </div>
          <p className="fine-print">
            Sin FFmpeg no hay miniaturas ni exportación. Sin FFprobe no se importa material medido
            ni se verifica un render.
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">Datos locales</p>
          <h3>Almacenamiento</h3>
          <dl className="data-list">
            <div>
              <dt>Versión</dt>
              <dd>{system?.appVersion ?? '0.1.0'}</dd>
            </div>
            <div>
              <dt>Plataforma</dt>
              <dd>{system?.os ?? 'Windows'}</dd>
            </div>
            <div>
              <dt>Configuración</dt>
              <dd className="path">{system?.configDir ?? '—'}</dd>
            </div>
            <div>
              <dt>Caché de trabajo</dt>
              <dd className="path">{system?.cacheDir ?? '—'}</dd>
            </div>
          </dl>
          <div className="actions">
            <button type="button" className="ghost" onClick={() => void pruneCache()} disabled={!system}>
              Limpiar caché de render
            </button>
          </div>
          <p className="fine-print">
            Los proyectos y los medios viven en la carpeta que elegís al crear o abrir. Los
            recientes se guardan sólo en este equipo. Las claves viven en el Administrador de
            credenciales de Windows, nunca en estos archivos.
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">Alcance</p>
          <h3>Qué hace y qué no</h3>
          <ul className="scope-list">
            <li>Render MP4 H.264/AAC con libx264 y verificación FFprobe.</li>
            <li>Timeline multipista en frames, trims, splits y subtítulos ASS.</li>
            <li>Guiones por proveedor compatible o simulador; TTS local con SAPI.</li>
            <li>No publica en redes ni descarga stock sin procedencia.</li>
            <li>Remotion queda fuera hasta validar su licencia comercial.</li>
            <li>Los clips gráficos se rechazan en render hasta tener motor propio.</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
