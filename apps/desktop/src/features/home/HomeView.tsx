import { useEffect, useState } from 'react';
import type { NavGroup, ViewId } from '../../app/navigation';
import { NAV_VIEWS } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { ViewToolbar } from '../../components/ViewToolbar';
import { loadRecents, type RecentProject } from '../../lib/recents';
import {
  detectNativeRuntime,
  type DownloaderBridgeInfo,
  type DownloaderStatus,
  type ExtensionInstallStatus,
  type SystemInfo,
} from '../../services/project-service';
import { queueDownloadUrl } from '../download/pending';
import { normalizeDownloadUrl } from '../download/url';
import { useProjectStore } from '../../state/project-store';
import { usePipeline } from '../../state/usePipeline';
import { PipelineGuide } from './PipelineGuide';

type ToolKey = 'engine' | 'ffmpeg' | 'ffprobe';

const TOOL_GROUPS: ReadonlyArray<{ id: NavGroup; label: string }> = [
  { id: 'ruta', label: 'Crear y editar' },
  { id: 'herramientas', label: 'Herramientas' },
  { id: 'ayuda', label: 'Sistema y ayuda' },
];

function statusText(available: boolean, version: string | null, missing: string): string {
  return available ? version ?? 'Disponible' : missing;
}

/** Estado de una fila del diagnóstico. `unavailable`/`demo` evitan el falso
 *  "Listo" cuando la capacidad sólo existe en la app de escritorio. */
type SetupState = 'ready' | 'missing' | 'unavailable' | 'demo';

const SETUP_STATE_LABEL: Record<SetupState, string> = {
  ready: 'Listo',
  missing: 'Falta',
  unavailable: 'Solo nativo',
  demo: 'Demo',
};

function SetupRow({
  icon,
  title,
  detail,
  state,
  busy,
  actionLabel,
  onAction,
}: {
  readonly icon: 'download' | 'film' | 'audio' | 'plug';
  readonly title: string;
  readonly detail: string;
  readonly state: SetupState;
  readonly busy: boolean;
  readonly actionLabel: string;
  readonly onAction: () => void;
}) {
  return (
    <li className="home-setup-row">
      <span className={`home-setup-icon ${state}`}>
        <Icon name={icon} size={15} />
      </span>
      <span className="home-setup-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className={`home-status ${state}`}>{SETUP_STATE_LABEL[state]}</span>
      <button type="button" className="small ghost" onClick={onAction} disabled={busy}>
        {busy ? 'Instalando…' : actionLabel}
      </button>
    </li>
  );
}

export function HomeView({ onNavigate }: { readonly onNavigate: (id: ViewId) => void }) {
  const store = useProjectStore();
  const project = store.state.project;
  const service = store.service;
  const pipeline = usePipeline();
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [engine, setEngine] = useState<DownloaderStatus | null>(null);
  const [bridge, setBridge] = useState<DownloaderBridgeInfo | null>(null);
  const [extension, setExtension] = useState<ExtensionInstallStatus | null>(null);
  const [recents, setRecents] = useState<RecentProject[]>(() => loadRecents());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');

  useEffect(() => {
    if (!service.available) return;
    let active = true;
    void Promise.allSettled([
      service.systemInfo(),
      service.downloaderStatus(),
      service.downloaderBridgeInfo(),
      service.extensionStatus(),
    ]).then(([systemResult, engineResult, bridgeResult, extensionResult]) => {
      if (!active) return;
      if (systemResult.status === 'fulfilled') setSystem(systemResult.value);
      if (engineResult.status === 'fulfilled') setEngine(engineResult.value);
      if (bridgeResult.status === 'fulfilled') setBridge(bridgeResult.value);
      if (extensionResult.status === 'fulfilled') setExtension(extensionResult.value);
      setRecents(loadRecents());
    });
    return () => {
      active = false;
    };
  }, [service]);

  async function installEngine(): Promise<void> {
    setBusy('engine');
    setError(null);
    try {
      setEngine(await service.installDownloader());
      store.setNotice('Motor de descargas instalado.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo instalar el motor');
    } finally {
      setBusy(null);
    }
  }

  async function choose(tool: 'ffmpeg' | 'ffprobe'): Promise<void> {
    setBusy(tool);
    try {
      const next = await service.chooseTool(tool);
      if (next) setSystem(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `no se pudo elegir ${tool}`);
    } finally {
      setBusy(null);
    }
  }

  async function prepareExtension(): Promise<void> {
    setBusy('extension');
    try {
      const next = await service.prepareExtension();
      setExtension(next);
      if (next.preparedPath) {
        await service
          .revealOutput(`${next.preparedPath}\\manifest.json`)
          .catch(() => undefined);
      }
      store.setNotice('Extensión preparada. Cargala desde Chrome o Edge.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'no se pudo preparar la extensión');
    } finally {
      setBusy(null);
    }
  }

  async function copyBridge(): Promise<void> {
    if (!bridge) return;
    try {
      await navigator.clipboard.writeText(`${bridge.port}:${bridge.token}`);
      store.setNotice('Conexión de la extensión copiada.');
    } catch {
      store.setNotice('No se pudo copiar; el token está en la vista Descargar.');
    }
  }

  function confirmLeave(action: string): boolean {
    const phase = store.state.phase;
    if (phase === 'saving') {
      store.setNotice('El proyecto se está guardando; esperá un instante y reintentá.');
      return false;
    }
    if (phase === 'dirty' || phase === 'failed') {
      return window.confirm(
        `${phase === 'failed' ? 'El último guardado falló.' : 'Hay cambios sin guardar.'} ¿${action} igual?`,
      );
    }
    return true;
  }

  async function openProject(): Promise<void> {
    if (!confirmLeave('Abrir otro proyecto')) return;
    setBusy('project');
    setError(null);
    try {
      const ok = await store.openProject();
      if (ok) onNavigate('editor');
    } finally {
      setBusy(null);
    }
  }

  async function openRecent(recent: RecentProject): Promise<void> {
    if (!confirmLeave('Abrir otro proyecto')) return;
    setBusy('project');
    const ok = await store.openProjectAt(recent.path);
    setBusy(null);
    if (ok) onNavigate('editor');
  }

  const hasClip = (project?.timeline.clips.length ?? 0) > 0;
  // Exportar es una acción del editor (abre su diálogo): se navega primero y se
  // deja la solicitud en el store, que el workspace consume al montarse.
  function exportProject(): void {
    onNavigate('editor');
    store.requestExport();
  }

  function startDownload(): void {
    const normalized = normalizeDownloadUrl(downloadUrl);
    if (!normalized) {
      setError('Pegá un enlace http(s) válido para descargar.');
      return;
    }
    queueDownloadUrl(normalized);
    onNavigate('download');
  }

  const native = detectNativeRuntime();
  // Modo navegador real = sin runtime nativo y sin servicio utilizable. Con un
  // servicio disponible (app de escritorio o servicio de prueba) se mantiene
  // la UI completa. En navegador la UI lo dice en vez de fingir un estudio
  // preparado (auditoría P0-1).
  const browserMode = !native && !service.available;
  // En escritorio se mide el entorno real; en modo web las filas dicen la
  // verdad: las capacidades que dependen del sistema son "solo nativo".
  const heroChecks = native
    ? [
        { label: 'Motor de descargas', ok: engine?.available === true },
        { label: 'FFmpeg local', ok: system?.ffmpeg.available === true },
        { label: 'FFprobe', ok: system?.ffprobe.available === true },
        { label: 'Voz SAPI', ok: system?.powershell.available === true },
      ]
    : [
        { label: 'Recorrido de la interfaz y la guía', ok: true },
        { label: 'Proyectos en disco · solo app nativa', ok: false },
        { label: 'Voz, MCP y descargas · solo app nativa', ok: false },
        { label: 'Render y export verificado · solo app nativa', ok: false },
      ];
  const readyCount = heroChecks.filter((check) => check.ok).length;

  return (
    <section className="view home-view">
      <ViewToolbar
        label="Inicio"
        actions={
          <>
            <button type="button" className="ghost icon-text" onClick={() => onNavigate('learn')}>
              <Icon name="learn" size={14} />
              <span>Tutorial</span>
            </button>
            <button type="button" className="ghost icon-text" onClick={() => onNavigate('settings')}>
              <Icon name="settings" size={14} />
              <span>Ajustes</span>
            </button>
          </>
        }
      />

      <header className="home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">Estudio de producción audiovisual IA</p>
          <h1>{project ? `Continuar con ${project.name}` : 'Creá videos virales en minutos con IA'}</h1>
          <p className="home-hero-lead">
            {project
              ? `Proyecto actual: ${project.name} (${(project.video?.height ?? 1080) > (project.video?.width ?? 1920) ? '9:16 vertical' : '16:9 horizontal'}). Línea de tiempo con ${project.timeline?.tracks?.length ?? 2} pistas listas para editar.`
              : 'Olyvia combina un editor de video multipista profesional con herramientas de inteligencia artificial: corte automático de silencios, subtítulos sincronizados, locución natural y plantillas para TikTok, Reels y YouTube.'}
          </p>
          <div className="home-hero-actions">
            {project ? (
              <>
                <button
                  type="button"
                  className="primary icon-text"
                  onClick={() => onNavigate('editor')}
                >
                  <Icon name="editor" size={15} />
                  <span>Continuar edición</span>
                </button>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={exportProject}
                  disabled={!hasClip}
                  title={
                    hasClip
                      ? 'Abrí el editor con el diálogo de exportación'
                      : 'Montá al menos un clip en la timeline para exportar'
                  }
                >
                  <Icon name="export" size={15} />
                  <span>Exportar</span>
                </button>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() => onNavigate('script')}
                >
                  <Icon name="script" size={15} />
                  <span>Guion</span>
                </button>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() => onNavigate('projects')}
                >
                  <Icon name="plus" size={15} />
                  <span>Nuevo proyecto</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="primary icon-text"
                  aria-label="Abrir proyecto"
                  onClick={() => void openProject()}
                  disabled={busy === 'project' || browserMode}
                  title={
                    browserMode
                      ? 'Sólo en la app de escritorio: el navegador no puede abrir proyectos del disco'
                      : undefined
                  }
                >
                  <Icon name="folder" size={15} />
                  <span>{busy === 'project' ? 'Abriendo…' : 'Abrir proyecto'}</span>
                </button>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() => onNavigate('projects')}
                  disabled={browserMode}
                  title={
                    browserMode
                      ? 'Sólo en la app de escritorio: crear un proyecto necesita diálogos nativos'
                      : undefined
                  }
                >
                  <Icon name="plus" size={15} />
                  <span>Nuevo proyecto</span>
                </button>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() => onNavigate('learn')}
                >
                  <Icon name="learn" size={15} />
                  <span>Ver la guía</span>
                </button>
              </>
            )}
          </div>
          <div className="home-hero-meta">
            {browserMode ? (
              <>
                <span className="home-hero-chip">
                  <Icon name="info" size={12} />
                  <span>Vista de evaluación en navegador</span>
                </span>
                <span className="home-hero-chip">
                  <Icon name="lock" size={12} />
                  <span>Sin estado real ni guardado</span>
                </span>
                <span className="home-hero-chip">
                  <Icon name="download" size={12} />
                  <span>La app nativa ejecuta todo</span>
                </span>
              </>
            ) : (
              <>
                <span className="home-hero-chip">
                  <Icon name="shield" size={12} />
                  <span>Procesado local, sin nube</span>
                </span>
                <span className="home-hero-chip">
                  <Icon name="editor" size={12} />
                  <span>Timeline multipista</span>
                </span>
                <span className="home-hero-chip">
                  <Icon name="sparkles" size={12} />
                  <span>IA integrada</span>
                </span>
              </>
            )}
          </div>
        </div>
        <aside className="home-hero-status" aria-label="Estado del estudio">
          {browserMode ? (
            <>
              <div className="home-hero-status-head">
                <span className="home-hero-status-icon" aria-hidden="true">
                  <Icon name="info" size={18} />
                </span>
                <div className="home-hero-status-copy">
                  <strong>Modo navegador</strong>
                  <span>Interfaz de evaluación, sin runtime nativo</span>
                </div>
                <span className="home-status home-status-unmeasured home-hero-badge">
                  NO MEDIDO
                </span>
              </div>
              <ul className="home-hero-checks">
                {heroChecks.map((check) => (
                  <li
                    key={check.label}
                    data-ready={check.ok ? 'true' : 'unknown'}
                  >
                    <span aria-hidden="true" className="home-hero-check-dot" />
                    {check.label}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="ghost small icon-text"
                onClick={() => onNavigate('learn')}
              >
                <Icon name="learn" size={13} />
                <span>Qué se puede probar acá</span>
              </button>
            </>
          ) : (
            <>
              <div className="home-hero-status-head">
                <strong className="home-hero-status-value">
                  {readyCount}
                  <span>/{heroChecks.length}</span>
                </strong>
                <div className="home-hero-status-copy">
                  <strong>Preparación del estudio</strong>
                  <span>Componentes verificados</span>
                </div>
                <span
                  className={`home-status ${readyCount === heroChecks.length ? 'ready' : 'missing'} home-hero-badge`}
                >
                  {readyCount === heroChecks.length ? 'LISTO' : 'REVISAR'}
                </span>
              </div>
              <ul className="home-hero-checks">
                {heroChecks.map((check) => (
                  <li key={check.label} data-ready={check.ok ? 'true' : 'false'}>
                    <span aria-hidden="true" className="home-hero-check-dot" />
                    {check.label}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="ghost small icon-text"
                onClick={() => onNavigate('settings')}
              >
                <Icon name="settings" size={13} />
                <span>Revisar preparación</span>
              </button>
            </>
          )}
        </aside>
      </header>

      {/* Feature Pillars Grid */}
      <section className="home-feature-pillars" aria-label="Herramientas clave">
        <div
          className="home-pillar-card"
          onClick={() => onNavigate('editor')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('editor'); }}
        >
          <div className="home-pillar-header">
            <span className="home-pillar-icon icon-blue">
              <Icon name="editor" size={18} />
            </span>
            <span className="home-pillar-tag">Pilar 1</span>
          </div>
          <h3>Editor Multi-Pista</h3>
          <p>Línea de tiempo con capas de video V1/V2, audio A1/A2, cortes precisos, zoom y preview en tiempo real.</p>
          <span className="home-pillar-cta">Abrir Editor →</span>
        </div>

        <div
          className="home-pillar-card"
          onClick={() => onNavigate('creator')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('creator'); }}
        >
          <div className="home-pillar-header">
            <span className="home-pillar-icon icon-purple">
              <Icon name="sparkles" size={18} />
            </span>
            <span className="home-pillar-tag">Pilar 2</span>
          </div>
          <h3>Creador 9:16 & 16:9</h3>
          <p>Plantillas optimizadas para TikTok, Reels y Shorts con ganchos visuales en los primeros 3 segundos.</p>
          <span className="home-pillar-cta">Explorar Plantillas →</span>
        </div>

        <div
          className="home-pillar-card"
          onClick={() => onNavigate('localization')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('localization'); }}
        >
          <div className="home-pillar-header">
            <span className="home-pillar-icon icon-green">
              <Icon name="audio" size={18} />
            </span>
            <span className="home-pillar-tag">Pilar 3</span>
          </div>
          <h3>Subtítulos y Cues</h3>
          <p>Generación de subtítulos automáticos con sincronización temporal exacta y exportación en SRT / VTT.</p>
          <span className="home-pillar-cta">Gestionar Subtítulos →</span>
        </div>

        <div
          className="home-pillar-card"
          onClick={() => onNavigate('director')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('director'); }}
        >
          <div className="home-pillar-header">
            <span className="home-pillar-icon icon-amber">
              <Icon name="learn" size={18} />
            </span>
            <span className="home-pillar-tag">Pilar 4</span>
          </div>
          <h3>Director & Guiones IA</h3>
          <p>Asistente para estructurar ideas, generar diálogos por escena y optimizar la retención de audiencia.</p>
          <span className="home-pillar-cta">Consultar Director →</span>
        </div>
      </section>

      {error ? (
        <p className="notice notice-warning" role="alert">
          {error}
        </p>
      ) : null}

      <PipelineGuide progress={pipeline} onNavigate={onNavigate} />

      <div className="home-grid">
        <section className="card home-setup" aria-labelledby="home-setup-title">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Diagnóstico del Entorno</p>
              <h2 id="home-setup-title">{native ? 'Preparación del estudio' : 'Capacidades del Estudio Web'}</h2>
            </div>
            <button type="button" className="small ghost" onClick={() => onNavigate('settings')}>
              Ajustes
            </button>
          </div>
          <ul className="home-setup-list">
            <SetupRow
              icon="film"
              title="Línea de Tiempo y Render"
              detail={
                native
                  ? (system ? statusText(system.ffmpeg.available, system.ffmpeg.version, 'No encontrado') : 'Consultando…')
                  : 'Canvas 2D + Web Audio Activo · render solo en la app nativa'
              }
              state={
                native ? (system?.ffmpeg.available === true ? 'ready' : 'missing') : 'demo'
              }
              busy={busy === 'ffmpeg'}
              actionLabel={native ? (system?.ffmpeg.available ? 'Cambiar' : 'Elegir') : 'Ver editor'}
              onAction={() => {
                if (native) void choose('ffmpeg');
                else onNavigate('editor');
              }}
            />
            <SetupRow
              icon="audio"
              title="Voz y Locución IA"
              detail={
                native
                  ? (system ? statusText(system.powershell.available, system.powershell.version, 'PowerShell no disponible') : 'Consultando…')
                  : 'Voz del sistema · solo en la app nativa'
              }
              state={
                native ? (system?.powershell.available === true ? 'ready' : 'missing') : 'unavailable'
              }
              busy={false}
              actionLabel="Ajustes"
              onAction={() => onNavigate('settings')}
            />
            <SetupRow
              icon="download"
              title="Motor de Medios & Descargas"
              detail={
                native
                  ? (engine == null ? 'Consultando yt-dlp…' : statusText(engine.available, engine.version, 'yt-dlp no instalado'))
                  : 'yt-dlp y archivos · solo en la app nativa'
              }
              state={
                native ? (engine?.available === true ? 'ready' : 'missing') : 'unavailable'
              }
              busy={busy === 'engine'}
              actionLabel="Abrir"
              onAction={() => onNavigate('download')}
            />
            <SetupRow
              icon="plug"
              title="Subtítulos & Cues"
              detail={
                native
                  ? 'Generador sincronizado SRT / VTT'
                  : 'Editor SRT / VTT de lectura · sin export en navegador'
              }
              state={native ? 'ready' : 'demo'}
              busy={false}
              actionLabel="Subtítulos"
              onAction={() => onNavigate('localization')}
            />
          </ul>
          <p className="fine-print">
            {native
              ? 'El motor de descargas se instala desde el ejecutable oficial de yt-dlp y utiliza FFmpeg local.'
              : 'En el navegador sólo podés recorrer la interfaz y la guía. Crear, importar, exportar, voz IA, MCP y descargas requieren la app de escritorio de Olyvia.'}
          </p>
        </section>

        <section className="card home-extension" aria-labelledby="home-extension-title">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Navegador</p>
              <h2 id="home-extension-title">Extensión de Chrome / Edge</h2>
            </div>
            <span className={extension?.prepared ? 'home-status ready' : 'home-status missing'}>
              {extension?.prepared ? 'Preparada' : extension?.available ? 'Disponible' : 'No incluida'}
            </span>
          </div>
          <p className="muted">
            Descargá videos y fotos desde la página que estés viendo. La app guarda el resultado
            en <code>Descargas/Videos descargados</code>.
          </p>
          <div className="home-extension-actions">
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void prepareExtension()}
              disabled={busy === 'extension' || !extension?.available}
            >
              <Icon name="plug" size={14} />
              <span>
                {busy === 'extension'
                  ? 'Preparando…'
                  : extension?.prepared
                    ? 'Actualizar extensión'
                    : 'Instalar extensión'}
              </span>
            </button>
            {bridge ? (
              <button type="button" className="ghost" onClick={() => void copyBridge()}>
                Copiar conexión
              </button>
            ) : null}
            {extension?.preparedPath ? (
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  void service
                    .revealOutput(`${extension.preparedPath}\\manifest.json`)
                    .catch(() => store.setNotice('No se pudo abrir la carpeta de la extensión.'))
                }
              >
                Abrir carpeta
              </button>
            ) : null}
          </div>
          {extension?.preparedPath ? (
            <p className="home-path">
              <code>{extension.preparedPath}</code>
            </p>
          ) : null}
          <ol className="home-extension-steps">
            <li>Prepará la extensión y abrí su carpeta.</li>
            <li>
              En Chrome o Edge abrí <code>chrome://extensions</code>, activá Modo desarrollador y
              elegí “Cargar descomprimida”.
            </li>
            <li>Seleccioná esa carpeta y pegá la conexión copiada en la extensión.</li>
          </ol>
          <p className="fine-print">
            El navegador no permite instalar extensiones descomprimidas sin tu confirmación. La app
            prepara la carpeta y la conexión; el último paso lo hacés vos.
          </p>
        </section>

        <section className="card home-recents" aria-labelledby="home-recents-title">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Retomar</p>
              <h2 id="home-recents-title">Proyectos recientes</h2>
            </div>
            <button type="button" className="small ghost" onClick={() => onNavigate('projects')}>
              Ver todos
            </button>
          </div>
          {recents.length === 0 ? (
            <p className="empty-inline">
              Todavía no hay proyectos. Creá uno para empezar tu biblioteca.
            </p>
          ) : (
            <ul className="home-recent-list">
              {recents.slice(0, 4).map((recent) => (
                <li key={recent.path}>
                  <button
                    type="button"
                    className="home-recent-open"
                    onClick={() => void openRecent(recent)}
                    disabled={busy === 'project'}
                  >
                    <span className="home-recent-icon">
                      <Icon name="projects" size={14} />
                    </span>
                    <span>
                      <strong>{recent.name}</strong>
                      <small>{recent.label}</small>
                    </span>
                    <span className="home-recent-arrow" aria-hidden="true">
                      <Icon name="chevron" size={12} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card home-quick" aria-labelledby="home-quick-title">
          <div className="production-card-head">
            <div>
              <p className="eyebrow">Accesos</p>
              <h2 id="home-quick-title">Descarga rápida</h2>
            </div>
          </div>
          <form
            className="home-download"
            onSubmit={(event) => {
              event.preventDefault();
              startDownload();
            }}
          >
            <Icon name="download" size={15} />
            <input
              type="text"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              value={downloadUrl}
              placeholder="Pegá un enlace de YouTube, TikTok o cualquier sitio…"
              aria-label="URL para descargar desde Inicio"
              onChange={(event) => setDownloadUrl(event.target.value)}
            />
            <button type="submit" className="primary" disabled={!downloadUrl.trim()}>
              Descargar
            </button>
          </form>
          <div className="home-links">
            <button type="button" onClick={() => onNavigate('editor')}>
              <Icon name="editor" size={15} />
              <span>Editor</span>
            </button>
            <button type="button" onClick={() => onNavigate('auto-edit')}>
              <Icon name="sparkles" size={15} />
              <span>Automático</span>
            </button>
            <button type="button" onClick={() => onNavigate('youtube')}>
              <Icon name="globe" size={15} />
              <span>YouTube</span>
            </button>
            <button type="button" onClick={() => onNavigate('learn')}>
              <Icon name="learn" size={15} />
              <span>Aprender</span>
            </button>
            <button type="button" onClick={() => onNavigate('download')}>
              <Icon name="download" size={15} />
              <span>Descargar</span>
            </button>
            <button type="button" onClick={() => onNavigate('compliance')}>
              <Icon name="shield" size={15} />
              <span>Cumplimiento</span>
            </button>
          </div>
        </section>
      </div>

      <details className="card home-tools">
        <summary>
          <span>
            <span className="eyebrow">Mapa del estudio</span>
            <strong>Todas las herramientas</strong>
          </span>
          <span className="home-tools-count">{NAV_VIEWS.length - 1} vistas</span>
        </summary>
        <div className="home-tool-groups">
          {TOOL_GROUPS.map((group) => (
            <div key={group.id} className="home-tool-group">
              <h3>{group.label}</h3>
              <div className="home-tool-grid">
                {NAV_VIEWS.filter(
                  (view) => view.group === group.id && view.id !== 'home',
                ).map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    className="home-tool-btn"
                    title={view.hint}
                    onClick={() => onNavigate(view.id)}
                  >
                    <span>{view.label}</span>
                    <small>{view.hint.split('·')[1]?.trim() ?? view.hint}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
