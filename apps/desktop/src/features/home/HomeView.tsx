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

function SetupRow({
  icon,
  title,
  detail,
  ready,
  busy,
  actionLabel,
  onAction,
}: {
  readonly icon: 'download' | 'film' | 'audio' | 'plug';
  readonly title: string;
  readonly detail: string;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly actionLabel: string;
  readonly onAction: () => void;
}) {
  return (
    <li className="home-setup-row">
      <span className={`home-setup-icon${ready ? ' ready' : ''}`}>
        <Icon name={icon} size={15} />
      </span>
      <span className="home-setup-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className={ready ? 'home-status ready' : 'home-status missing'}>
        {ready ? 'Listo' : 'Falta'}
      </span>
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
    const ok = await store.openProject();
    if (ok) onNavigate('editor');
  }

  async function openRecent(recent: RecentProject): Promise<void> {
    if (!confirmLeave('Abrir otro proyecto')) return;
    setBusy('project');
    const ok = await store.openProjectAt(recent.path);
    setBusy(null);
    if (ok) onNavigate('editor');
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

  const readyChecks = [
    engine?.available === true,
    system?.ffmpeg.available === true,
    system?.ffprobe.available === true,
    system?.powershell.available === true,
  ];
  const readyCount = readyChecks.filter(Boolean).length;
  const native = detectNativeRuntime();

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
          <p className="eyebrow">OLYVIA</p>
          <h1>{project ? 'Seguimos donde quedaste' : 'Tu estudio, listo para crear'}</h1>
          <p>
            {project
              ? `Proyecto activo: ${project.name}.`
              : 'Prepará las herramientas, instalá la extensión y empezá tu primer video. Todo queda en este equipo.'}
          </p>
        </div>
        <div className="home-hero-actions">
          {project ? (
            <button
              type="button"
              className="primary icon-text"
              onClick={() => onNavigate(pipeline.next?.view ?? 'editor')}
            >
              <Icon name={pipeline.next?.icon ?? 'editor'} size={15} />
              <span>
                {pipeline.next
                  ? `Seguir con ${pipeline.next.label}`
                  : 'Ruta completa · revisar edición'}
              </span>
            </button>
          ) : (
            <button type="button" className="primary icon-text" onClick={() => onNavigate('projects')}>
              <Icon name="plus" size={15} />
              <span>Nuevo proyecto</span>
            </button>
          )}
          <button type="button" className="ghost icon-text" onClick={() => void openProject()}>
            <Icon name="projects" size={15} />
            <span>Abrir proyecto</span>
          </button>
          <button type="button" className="ghost icon-text" onClick={() => onNavigate('download')}>
            <Icon name="download" size={15} />
            <span>Descargar</span>
          </button>
        </div>
        <div className="home-hero-status" aria-label={`${readyCount} de 4 herramientas listas`}>
          <strong>{readyCount}/4</strong>
          <span>herramientas listas</span>
        </div>
      </header>

      {!native ? (
        <p className="notice notice-warning">
          Estás en el navegador: las instalaciones y el acceso a archivos requieren la app de
          escritorio.
        </p>
      ) : null}
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
              <p className="eyebrow">Instalación</p>
              <h2 id="home-setup-title">Preparación del estudio</h2>
            </div>
            <button type="button" className="small ghost" onClick={() => onNavigate('settings')}>
              Ver todo en Ajustes
            </button>
          </div>
          <ul className="home-setup-list">
            <SetupRow
              icon="download"
              title="Motor de descargas"
              detail={
                engine == null
                  ? 'Consultando yt-dlp…'
                  : statusText(engine.available, engine.version, 'yt-dlp no instalado')
              }
              ready={engine?.available === true}
              busy={busy === 'engine'}
              actionLabel={engine?.available ? 'Abrir Descargar' : 'Instalar motor'}
              onAction={() => {
                if (engine?.available) onNavigate('download');
                else void installEngine();
              }}
            />
            <SetupRow
              icon="film"
              title="FFmpeg"
              detail={system ? statusText(system.ffmpeg.available, system.ffmpeg.version, 'No encontrado') : 'Consultando…'}
              ready={system?.ffmpeg.available === true}
              busy={busy === 'ffmpeg'}
              actionLabel={system?.ffmpeg.available ? 'Cambiar' : 'Elegir'}
              onAction={() => void choose('ffmpeg')}
            />
            <SetupRow
              icon="film"
              title="FFprobe"
              detail={system ? statusText(system.ffprobe.available, system.ffprobe.version, 'No encontrado') : 'Consultando…'}
              ready={system?.ffprobe.available === true}
              busy={busy === 'ffprobe'}
              actionLabel={system?.ffprobe.available ? 'Cambiar' : 'Elegir'}
              onAction={() => void choose('ffprobe')}
            />
            <SetupRow
              icon="audio"
              title="Voz local (SAPI)"
              detail={system ? statusText(system.powershell.available, system.powershell.version, 'PowerShell no disponible') : 'Consultando…'}
              ready={system?.powershell.available === true}
              busy={false}
              actionLabel="Ajustes"
              onAction={() => onNavigate('settings')}
            />
          </ul>
          <p className="fine-print">
            Sin FFmpeg/FFprobe no hay miniaturas, importación medida ni exportación. El motor de
            descargas se instala desde el ejecutable oficial de yt-dlp.
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
