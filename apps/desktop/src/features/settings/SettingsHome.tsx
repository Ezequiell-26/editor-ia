import { useEffect, useState, type ReactNode } from 'react';
import type { ViewId } from '../../app/navigation';
import type {
  ProviderInfo,
  ProviderTestResult,
  SystemInfo,
} from '../../services/project-service';
import { providerUrlProblem } from '../../services/project-service';
import {
  AI_PROVIDERS,
  detectAiBrand,
  suggestedModels,
} from '../../services/ai-models';
import { AiBrandMark } from '../../components/AiBrandMark';
import { Icon, type IconName } from '../../components/Icon';
import { useProjectStore } from '../../state/project-store';
import { AudioProviderCard } from './AudioProviderCard';
import { CapabilitiesCard } from './CapabilitiesCard';
import { AppearanceCard } from './AppearanceCard';
import { ColorStudioCard } from './ColorStudioCard';
import { PluginsCard } from './PluginsCard';
import { BackupCard } from './BackupCard';
import { EditorPreferencesCard } from './EditorPreferencesCard';
import { ShortcutsCard } from './ShortcutsCard';
import {
  DEFAULT_ASSISTANT_TOKEN_BUDGET,
  MAX_ASSISTANT_TOKEN_BUDGET,
  MIN_ASSISTANT_TOKEN_BUDGET,
  loadAssistantTokenBudget,
  saveAssistantTokenBudget,
} from '../../state/assistant-budget';

type SettingsSectionId =
  | 'apariencia'
  | 'editor'
  | 'atajos'
  | 'ia'
  | 'voz'
  | 'herramientas'
  | 'datos'
  | 'alcance';

interface SettingsSectionInfo {
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly hint: string;
  readonly icon: IconName;
  readonly blurb: string;
}

const SETTINGS_SECTIONS: readonly SettingsSectionInfo[] = [
  {
    id: 'apariencia',
    label: 'Apariencia',
    hint: 'Tema, tipografía y densidad',
    icon: 'palette',
    blurb: 'Definí cómo se ve el editor. Los cambios se aplican al instante y quedan sólo en este equipo.',
  },
  {
    id: 'editor',
    label: 'Editor',
    hint: 'Guardado, timeline y reproducción',
    icon: 'grid',
    blurb: 'Cómo responde el editor: autoguardado, historial, zoom inicial, imán y qué se dibuja sobre los clips.',
  },
  {
    id: 'atajos',
    label: 'Atajos',
    hint: 'Teclado y comandos',
    icon: 'keyboard',
    blurb: 'Todos los atajos de teclado disponibles. Usá Ctrl+K para abrir la paleta de comandos en cualquier momento.',
  },
  {
    id: 'ia',
    label: 'Inteligencia artificial',
    hint: 'Guiones, escenas y proveedor',
    icon: 'sparkles',
    blurb: 'Elegí el modelo que escribe guiones y escenas. Podés usar un endpoint local o el simulador sin red.',
  },
  {
    id: 'voz',
    label: 'Voz y audio',
    hint: 'Narración y automatización',
    icon: 'audio',
    blurb: 'Configurá la voz de las narraciones y el puente para generar audio en webs externas.',
  },
  {
    id: 'herramientas',
    label: 'Herramientas',
    hint: 'FFmpeg, FFprobe y diagnóstico',
    icon: 'plug',
    blurb: 'La app mide, previsualiza y exporta con herramientas locales. Acá ves qué encontró y podés corregirlo.',
  },
  {
    id: 'datos',
    label: 'Datos locales',
    hint: 'Rutas, caché y credenciales',
    icon: 'save',
    blurb: 'Tus proyectos, medios y claves viven en este equipo. Revisá dónde se guarda cada cosa.',
  },
  {
    id: 'alcance',
    label: 'Alcance',
    hint: 'Qué hace y qué no',
    icon: 'info',
    blurb: 'Un resumen honesto de las capacidades actuales para que sepas con qué contás.',
  },
];

/**
 * Busca la sección por id en lugar de por posición: agregar una sección nueva
 * no obliga a renumerar las demás.
 */
function sectionById(id: SettingsSectionId): SettingsSectionInfo {
  const found = SETTINGS_SECTIONS.find((section) => section.id === id);
  if (!found) {
    throw new Error(`sección de ajustes desconocida: ${id}`);
  }
  return found;
}

function SettingsSection({
  section,
  active,
  children,
}: {
  readonly section: SettingsSectionInfo;
  readonly active: boolean;
  readonly children: ReactNode;
}) {  return (
    <section
      id={`settings-${section.id}`}
      className="settings-section"
      aria-labelledby={`settings-${section.id}-title`}
      hidden={!active}
    >
      <header className="settings-section-head">
        <span className="settings-section-icon" aria-hidden="true">
          <Icon name={section.icon} size={15} />
        </span>
        <div>
          <h2 id={`settings-${section.id}-title`}>{section.label}</h2>
          <p>{section.blurb}</p>
        </div>
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

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

/** Etiqueta legible del estado tipado que devuelve `test_provider`. */
const PROVIDER_TEST_LABELS: Record<string, string> = {
  ok: 'el endpoint respondió y el modelo está disponible',
  mock: 'Proveedor simulado (sin red)',
  unconfigured: 'Sin proveedor configurado',
  'missing-key': 'Falta la clave del proveedor',
  unauthorized: 'Clave rechazada por el proveedor',
  forbidden: 'Acceso denegado por el proveedor',
  'not-found': 'URL o modelo no encontrado',
  'rate-limited': 'El proveedor limitó las peticiones',
  timeout: 'El proveedor no respondió a tiempo',
  unreachable: 'No se pudo conectar con el endpoint',
  'http-error': 'El proveedor respondió con un error HTTP',
  'invalid-response': 'Respuesta del proveedor no válida',
};

function providerTestLabel(status: string): string {
  return PROVIDER_TEST_LABELS[status] ?? `Resultado: ${status}`;
}

export function SettingsHome({
  onNavigate,
}: {
  readonly onNavigate?: (id: ViewId) => void;
} = {}) {
  const store = useProjectStore();
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [kind, setKind] = useState('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('apariencia');
  const [tokenBudget, setTokenBudget] = useState(loadAssistantTokenBudget);

  // Antes las secciones se apilaban y un IntersectionObserver marcaba la activa.
  // Ahora se muestra una sola por vez dentro de un panel compacto: sin scroll
  // largo, sin observador y sin recalcular posiciones en cada scroll.
  function goToSection(id: SettingsSectionId): void {
    setActiveSection(id);
  }
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
      setTestResult(null);
      setTestError(null);
      store.setNotice('Proveedor guardado. La clave, si la escribiste, quedó en el almacén de Windows.');
    } catch (error) {
      store.setNotice(error instanceof Error ? error.message : 'no se pudo guardar el proveedor');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Prueba real del proveedor **guardado**: el backend consulta `GET /models`
   * con timeout corto y devuelve un estado tipado (HTTP, latencia, modelo) o un
   * error accionable. No hay éxito inventado: si el método no puede ejecutarse,
   * se muestra el motivo.
   */
  async function testConnection(): Promise<void> {
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      setTestResult(await store.service.testProvider());
    } catch (error) {
      setTestResult(null);
      setTestError(
        error instanceof Error
          ? `La prueba no pudo ejecutarse: ${error.message}`
          : 'La prueba no pudo ejecutarse: el servicio no respondió.',
      );
    } finally {
      setTestBusy(false);
    }
  }

  /** La prueba usa lo guardado: avisar si el formulario tiene cambios sin guardar. */
  const providerDirty =
    provider === null ||
    provider.kind !== kind ||
    provider.baseUrl !== baseUrl ||
    provider.model !== model;
  const canTestProvider =
    !busy && !testBusy && (kind === 'mock' || (baseUrl.trim().length > 0 && model.trim().length > 0));

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
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Secciones de Ajustes">
          <div className="settings-nav-head">
            <span className="settings-nav-kicker">Preferencias locales</span>
            <strong>Ajustes</strong>
            <small>Se guardan en este equipo</small>
          </div>
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={activeSection === section.id ? 'active' : undefined}
              aria-current={activeSection === section.id ? 'location' : undefined}
              onClick={() => goToSection(section.id)}
            >
              <span className="settings-nav-icon" aria-hidden="true">
                <Icon name={section.icon} size={14} />
              </span>
              <span className="settings-nav-copy">
                <strong>{section.label}</strong>
                <small>{section.hint}</small>
              </span>
            </button>
          ))}
          <div className="settings-nav-foot">
            <Icon name="shield" size={11} />
            <span>Claves en el almacén de Windows</span>
          </div>
        </nav>

        <div className="settings-content">
          {!store.service.available ? (
            <p className="notice notice-warning">{store.service.unavailableReason}</p>
          ) : null}

          <SettingsSection section={sectionById('apariencia')} active={activeSection === 'apariencia'}>
            <AppearanceCard />
            <ColorStudioCard />
            <PluginsCard />
          </SettingsSection>

          <SettingsSection section={sectionById('editor')} active={activeSection === 'editor'}>
            <EditorPreferencesCard />
          </SettingsSection>

          <SettingsSection section={sectionById('atajos')} active={activeSection === 'atajos'}>
            <ShortcutsCard />
          </SettingsSection>

          <SettingsSection section={sectionById('ia')} active={activeSection === 'ia'}>
            <CapabilitiesCard />
            <article className="card">
              <p className="eyebrow">Modelo de texto</p>
          <h3>Texto para guiones y escenas</h3>
          <p className="muted">
            Compatible con la API de chat de OpenAI: OpenAI, un endpoint local (Ollama, LM Studio,
            vLLM) o cualquier servicio con el mismo contrato. El proveedor simulado no hace red.
          </p>
          <div className="ai-provider-grid" role="group" aria-label="Proveedores conocidos">
            {AI_PROVIDERS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`ai-provider-card${detectAiBrand(baseUrl, model) === preset.brand ? ' active' : ''}${
                  baseUrl && preset.baseUrl === baseUrl ? ' current' : ''
                }`}
                disabled={busy}
                title={preset.note}
                onClick={() => {
                  setKind(preset.id === 'mock' ? 'mock' : 'openai-compatible');
                  setBaseUrl(preset.baseUrl);
                  setModel(preset.model);
                }}
              >
                <AiBrandMark brand={preset.brand} size={22} title={preset.label} />
                <span className="ai-provider-name">{preset.label}</span>
                <span className="ai-provider-tag">{preset.local ? 'local' : 'nube'}</span>
              </button>
            ))}
          </div>
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
              <span className="ai-model-label">
                <AiBrandMark
                  brand={detectAiBrand(baseUrl, model)}
                  size={16}
                  title={model || 'sin modelo'}
                />
                Modelo
              </span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="llama3.1"
                disabled={kind === 'mock'}
                autoComplete="off"
                list="ai-model-options"
              />
              <datalist id="ai-model-options">
                {suggestedModels(baseUrl, model).map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
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
            <button
              type="button"
              onClick={() => void testConnection()}
              disabled={!canTestProvider}
              title={
                canTestProvider
                  ? 'Consulta el endpoint guardado y muestra modelo, latencia y estado HTTP'
                  : 'Completá la URL base y el modelo (o usá el simulado) para poder probar'
              }
            >
              {testBusy ? 'Probando…' : 'Probar conexión'}
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

          {providerDirty && kind !== 'mock' ? (
            <p className="fine-print">
              La prueba consulta el proveedor <strong>guardado</strong>. Guardá estos cambios para
              probar exactamente esta configuración.
            </p>
          ) : null}

          {testBusy ? (
            <p className="fine-print" role="status">
              Probando el proveedor guardado…
            </p>
          ) : null}

          {testError ? (
            <p className="notice notice-warning" role="status">
              {testError}
            </p>
          ) : null}

          {testResult ? (
            <div
              className={`notice ${testResult.ok ? 'notice-ok' : 'notice-warning'}`}
              role="status"
            >
              <strong>
                {testResult.ok ? 'Conexión correcta' : 'Conexión fallida'} ·{' '}
                {providerTestLabel(String(testResult.status))}
              </strong>
              <p>{testResult.detail}</p>
              <p className="fine-print">
                {testResult.httpStatus !== null ? `HTTP ${testResult.httpStatus} · ` : ''}
                {testResult.latencyMs > 0 ? `${testResult.latencyMs} ms · ` : ''}
                {testResult.model ? `modelo ${testResult.model} · ` : ''}
                {testResult.baseUrl ? testResult.baseUrl : kind === 'mock' ? 'simulado, sin red' : ''}
              </p>
              {!testResult.ok ? (
                <p className="fine-print">
                  Corregí URL base, modelo o clave arriba y volvé a probar; para modelos locales
                  verificá que Ollama, LM Studio o vLLM estén escuchando en esa URL.
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="fine-print">
            {provider?.keyringAvailable
              ? 'Almacén de Windows disponible. La clave se lee sólo al hacer una llamada.'
              : 'El almacén de credenciales no respondió; las claves no se guardarán hasta que esté disponible.'}
              </p>
            </article>
            <article className="card">
              <p className="eyebrow">Asistente</p>
              <h3>Presupuesto de tokens</h3>
              <p className="muted">
                El asistente estima el tamaño de la conversación (~4 caracteres por token) y
                muestra un aviso cuando supera este umbral. Es sólo un aviso: no recorta el
                mensaje ni bloquea el envío; el contexto del proyecto no se cuenta en la
                estimación.
              </p>
              <div className="form-grid">
                <label className="field">
                  <span>Avisar a partir de (tokens estimados)</span>
                  <input
                    type="number"
                    min={MIN_ASSISTANT_TOKEN_BUDGET}
                    max={MAX_ASSISTANT_TOKEN_BUDGET}
                    step={500}
                    value={tokenBudget}
                    onChange={(event) => setTokenBudget(Number(event.target.value))}
                    onBlur={() => setTokenBudget(saveAssistantTokenBudget(tokenBudget))}
                  />
                </label>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="ghost small"
                  onClick={() =>
                    setTokenBudget(saveAssistantTokenBudget(DEFAULT_ASSISTANT_TOKEN_BUDGET))
                  }
                >
                  Restablecer ({DEFAULT_ASSISTANT_TOKEN_BUDGET.toLocaleString('es-AR')})
                </button>
              </div>
              <p className="fine-print">
                Rango permitido: {MIN_ASSISTANT_TOKEN_BUDGET.toLocaleString('es-AR')}–
                {MAX_ASSISTANT_TOKEN_BUDGET.toLocaleString('es-AR')} tokens estimados. Se guarda
                sólo en este equipo.
              </p>
            </article>
            <article className="card">
              <p className="eyebrow">Asistente e integraciones</p>
              <h3>IA y MCP</h3>
              <p className="muted">
                El asistente global se abre con Ctrl+K o con el dock flotante. Las skills,
                prompts y el operador local viven en AI Hub; los servidores MCP se administran
                en una pantalla aparte.
              </p>
              <div className="actions">
                {onNavigate ? (
                  <>
                    <button type="button" className="ghost" onClick={() => onNavigate('ai-hub')}>
                      Abrir AI Hub
                    </button>
                    <button type="button" className="ghost" onClick={() => onNavigate('mcp')}>
                      Servidores MCP
                    </button>
                  </>
                ) : (
                  <span className="fine-print">
                    Cerrá esta ventana y usá Ctrl+K para abrir el asistente.
                  </span>
                )}
              </div>
            </article>
          </SettingsSection>

          <SettingsSection section={sectionById('voz')} active={activeSection === 'voz'}>
            <div className="settings-cards two">
              <AudioProviderCard />

              <article className="card">
                <p className="eyebrow">Automatización web</p>
          <h3>Web TTS Bridge</h3>
          <p className="muted">
            Extensión companion de Chrome para webs de voz: pide permiso por sitio, escribe el
            texto, pulsa generar y descarga el audio en <code>Descargas/web-tts</code>. No inicia
            sesión, no paga y no evade captchas; si encuentra un bloqueo, se detiene y lo informa.
          </p>
          <ul className="scope-list">
            <li>Se instala como extensión descomprimida desde el repositorio.</li>
            <li>El texto se escribe en la web que vos abrís y autorizás.</li>
            <li>Después importás el audio descargado desde Medios.</li>
          </ul>
          <div className="actions">
            <button
              type="button"
              className="ghost"
              onClick={() =>
                void store.service
                  .openExternalUrl(
                    'https://github.com/Ezequiell-26/editor-ia/tree/main/extensions/web-tts-bridge',
                  )
                  .catch((error) =>
                    store.setNotice(error instanceof Error ? error.message : 'no se pudo abrir la web'),
                  )
              }
            >
              Ver extensión en GitHub
            </button>
          </div>
              </article>
            </div>
          </SettingsSection>

          <SettingsSection section={sectionById('herramientas')} active={activeSection === 'herramientas'}>
            <article className="card">
              <p className="eyebrow">Diagnóstico local</p>
              <h3>FFmpeg, FFprobe y voz</h3>
          {system ? (
            <div className="tool-list">
              <VersionLine label="FFmpeg" info={system.ffmpeg} />
              <VersionLine label="FFprobe" info={system.ffprobe} />
              <VersionLine label="Windows PowerShell (SAPI)" info={system.powershell} />
              <div className={system.hardware.h264 ? 'tool-line ready' : 'tool-line'}>
                <div>
                  <strong>Aceleración por hardware</strong>
                  <span>
                    {system.hardware.h264
                      ? `${system.hardware.h264} · proxies con GPU`
                      : 'sólo software (libx264)'}
                  </span>
                </div>
                <p className="tool-path">
                  {system.hardware.h264
                    ? 'Los proxies se generan con la GPU: la vista previa carga más rápido.'
                    : 'Sin encoder de video por hardware: los proxies usan la CPU.'}
                </p>
              </div>
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
                Sin FFmpeg no hay miniaturas ni exportación. Sin FFprobe no se importa material
                medido ni se verifica un render.
              </p>
            </article>
          </SettingsSection>

          <SettingsSection section={sectionById('datos')} active={activeSection === 'datos'}>
            <article className="card">
              <p className="eyebrow">Almacenamiento</p>
              <h3>Dónde vive cada cosa</h3>
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

            <BackupCard />
          </SettingsSection>

          <SettingsSection section={sectionById('alcance')} active={activeSection === 'alcance'}>
            <article className="card">
              <p className="eyebrow">Capacidades</p>
              <h3>Qué hace y qué no</h3>
              <ul className="scope-list">
            <li>Render MP4 H.264/AAC con libx264 y verificación FFprobe.</li>
            <li>Timeline multipista en frames, trims, splits y subtítulos ASS.</li>
            <li>Guiones por proveedor compatible o simulador; TTS local con SAPI.</li>
            <li>Voz por ElevenLabs (API oficial, consume créditos) o web externa manual.</li>
            <li>Servidores MCP locales por stdio: listar y ejecutar herramientas.</li>
            <li>Preferencias del editor y respaldo local de la configuración en JSON.</li>
            <li>Manifiesto local de publicación con hashes, licencias y procedencia.</li>
            <li>No publica en redes ni descarga stock sin procedencia.</li>
            <li>Remotion queda fuera hasta validar su licencia comercial.</li>
            <li>Los clips gráficos se rechazan en render hasta tener motor propio.</li>
          </ul>
            </article>
          </SettingsSection>
        </div>
      </div>
    </section>
  );
}
