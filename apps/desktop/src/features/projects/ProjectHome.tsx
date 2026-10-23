import { useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { queueDownloadUrl } from '../download/pending';
import { normalizeDownloadUrl } from '../download/url';
import {
  framesToSeconds,
  fpsOf,
  formatTimecode,
  totalFrames,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { forgetRecent, loadRecents, rememberRecent, type RecentProject } from '../../lib/recents';
import {
  FPS_PRESETS,
  FORMAT_PRESETS,
  aspectRatioOf,
  evenDimension,
  formatFps,
  validFpsRange,
} from '../../state/video-format';

interface ProjectHomeProps {
  readonly onNavigate: (id: ViewId) => void;
}

export function ProjectHome({ onNavigate }: ProjectHomeProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const opened = store.state.opened;
  const [name, setName] = useState('');
  const [formatId, setFormatId] = useState(FORMAT_PRESETS[0]?.id ?? 'landscape');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fpsId, setFpsId] = useState('30');
  const [fpsNum, setFpsNum] = useState(30);
  const [fpsDen, setFpsDen] = useState(1);
  const [recents, setRecents] = useState<RecentProject[]>(() => loadRecents());
  const [busy, setBusy] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');

  useEffect(() => {
    if (store.state.opened) {
      setRecents(rememberRecent(store.state.opened));
      setName('');
    }
  }, [store.state.opened]);

  const locked = !store.service.available || busy;
  const duration = project ? totalFrames(project) : 0;
  const fps = project ? fpsOf(project) : 30;

  function confirmLeave(action: string): boolean {
    const phase = store.state.phase;
    if (phase === 'saving') {
      store.setNotice('El proyecto se está guardando; esperá un instante y reintentá.');
      return false;
    }
    if (phase === 'dirty' || phase === 'failed') {
      const detail =
        phase === 'failed'
          ? 'El último guardado falló y hay cambios sin guardar.'
          : 'Hay cambios sin guardar.';
      return window.confirm(`${detail} ¿${action} igual?`);
    }
    return true;
  }

  async function create(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      store.setNotice('Poné un nombre para el proyecto.');
      return;
    }
    if (!validFpsRange(fpsNum, fpsDen)) {
      store.setNotice('La tasa de frames debe quedar entre 1 y 240 fps.');
      return;
    }
    if (!confirmLeave('Crear un proyecto nuevo')) return;
    setBusy(true);
    const safeWidth = evenDimension(width);
    const safeHeight = evenDimension(height);
    const ok = await store.createProject({
      name: trimmed,
      width: safeWidth,
      height: safeHeight,
      fpsNum: Math.max(1, Math.round(fpsNum || 30)),
      fpsDen: Math.max(1, Math.round(fpsDen || 1)),
    });
    setBusy(false);
    if (ok) {
      onNavigate('editor');
    }
  }

  async function open(): Promise<void> {
    if (!confirmLeave('Abrir otro proyecto')) return;
    setBusy(true);
    const ok = await store.openProject();
    setBusy(false);
    if (ok) {
      onNavigate('editor');
    }
  }

  async function openRecent(recent: RecentProject): Promise<void> {
    if (!confirmLeave('Abrir otro proyecto')) return;
    setBusy(true);
    const ok = await store.openProjectAt(recent.path);
    setBusy(false);
    if (ok) {
      onNavigate('editor');
    }
  }

  function quickDownload(): void {
    const normalized = normalizeDownloadUrl(downloadUrl);
    if (!normalized) {
      store.setNotice('Pegá un enlace http(s) válido para descargar.');
      return;
    }
    queueDownloadUrl(normalized);
    onNavigate('download');
  }

  function close(): void {
    if (!confirmLeave('Cerrar el proyecto')) return;
    store.closeProject();
    if (store.service.available) {
      void store.service.closeProject().catch(() => {
        // Closing the native session is best-effort; the screen is already empty.
      });
    }
  }

  function chooseFormat(id: string): void {
    setFormatId(id);
    const preset = FORMAT_PRESETS.find((item) => item.id === id);
    if (preset) {
      setWidth(preset.width);
      setHeight(preset.height);
    }
  }

  function chooseFps(id: string): void {
    setFpsId(id);
    const preset = FPS_PRESETS.find((item) => item.id === id);
    if (preset) {
      setFpsNum(preset.num);
      setFpsDen(preset.den);
    }
  }

  return (
    <section className="view projects-view" aria-label="Proyectos">
      <div className="project-toolbar">
        <button type="button" className="ghost icon-text" onClick={open} disabled={locked}>
          <Icon name="projects" size={15} />
          <span>Abrir proyecto…</span>
        </button>
        <form
          className="quick-download"
          onSubmit={(event) => {
            event.preventDefault();
            quickDownload();
          }}
        >
          <Icon name="download" size={15} />
          <input
            type="text"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            value={downloadUrl}
            placeholder="Pegá un enlace de YouTube, Instagram, TikTok o cualquier sitio público…"
            aria-label="URL para descargar"
            onChange={(event) => setDownloadUrl(event.target.value)}
          />
          <button type="submit" className="primary" disabled={!downloadUrl.trim()}>
            Descargar
          </button>
        </form>
      </div>

      {!store.service.available ? (
        <p className="notice notice-warning">{store.service.unavailableReason}</p>
      ) : null}

      {project ? (
        <article className="project-current">
          <div className="project-current-head">
            <div>
              <p className="eyebrow">Proyecto abierto</p>
              <h3>{project.name}</h3>
              <p className="muted">
                {project.video.width}×{project.video.height} · {fps} fps ·{' '}
                {formatTimecode(duration, fps)} · {project.timeline.clips.length} clips ·{' '}
                {project.assets.length} medios · {project.scenes.length} escenas
              </p>
            </div>
            <span className={`status-pill ${store.state.phase}`}>{store.statusText}</span>
          </div>
          <div className="project-metrics">
            <div>
              <span>Archivo</span>
              <strong>{opened?.label ?? 'sin archivo'}</strong>
            </div>
            <div>
              <span>Duración</span>
              <strong>{framesToSeconds(duration, fps).toFixed(1)} s</strong>
            </div>
            <div>
              <span>Perfiles</span>
              <strong>{project.renderProfiles.length}</strong>
            </div>
            <div>
              <span>Guion</span>
              <strong>{project.scenes.length} escenas</strong>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={() => onNavigate('editor')}>
              Abrir editor
            </button>
            <button type="button" onClick={() => onNavigate('script')}>
              Guion y escenas
            </button>
            <button type="button" onClick={() => onNavigate('assets')}>
              Medios
            </button>
            <button
              type="button"
              onClick={() => {
                void store.saveNow();
              }}
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => {
                void store.saveAs();
              }}
            >
              Guardar como…
            </button>
            <button type="button" className="danger-ghost" onClick={close}>
              Cerrar proyecto
            </button>
          </div>
        </article>
      ) : (
        <p className="empty-state">No hay proyectos abiertos.</p>
      )}

      <div className="home-grid">
        <article className="card">
          <p className="eyebrow">Nuevo</p>
          <h3>Crear un proyecto</h3>
          <div className="form-grid">
            <label className="field">
              <span>Nombre</span>
              <input
                id="project-name"
                type="text"
                value={name}
                placeholder="Mi próximo video"
                maxLength={120}
                disabled={locked}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void create();
                  }
                }}
              />
            </label>
            <label className="field">
              <span>Formato</span>
              <select
                value={formatId}
                disabled={locked}
                onChange={(event) => chooseFormat(event.target.value)}
              >
                {FORMAT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} · {preset.width}×{preset.height}
                  </option>
                ))}
                <option value="custom">Personalizado…</option>
              </select>
            </label>
            {formatId === 'custom' ? (
              <div className="format-custom">
                <label className="field">
                  <span>Ancho</span>
                  <input
                    type="number"
                    min={16}
                    max={32_768}
                    step={2}
                    value={width}
                    disabled={locked}
                    onChange={(event) => setWidth(Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Alto</span>
                  <input
                    type="number"
                    min={16}
                    max={32_768}
                    step={2}
                    value={height}
                    disabled={locked}
                    onChange={(event) => setHeight(Number(event.target.value))}
                  />
                </label>
              </div>
            ) : null}
            <label className="field">
              <span>Tasa de frames</span>
              <select
                value={fpsId}
                disabled={locked}
                onChange={(event) => chooseFps(event.target.value)}
              >
                {FPS_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} fps
                  </option>
                ))}
                <option value="custom">Personalizada…</option>
              </select>
            </label>
            {fpsId === 'custom' ? (
              <div className="format-custom">
                <label className="field">
                  <span>FPS numerador</span>
                  <input
                    type="number"
                    min={1}
                    max={240_000}
                    value={fpsNum}
                    disabled={locked}
                    onChange={(event) => setFpsNum(Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span>FPS denominador</span>
                  <input
                    type="number"
                    min={1}
                    max={100_100}
                    value={fpsDen}
                    disabled={locked}
                    onChange={(event) => setFpsDen(Number(event.target.value))}
                  />
                </label>
              </div>
            ) : null}
          </div>
          <div className="project-format-summary">
            <span>
              <strong>{aspectRatioOf(evenDimension(width), evenDimension(height))}</strong>
            </span>
            <span>
              {evenDimension(width)}×{evenDimension(height)}
            </span>
            <span>{formatFps(fpsNum, fpsDen)} fps</span>
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={() => void create()} disabled={locked}>
              {busy ? 'Creando…' : 'Crear y elegir ubicación…'}
            </button>
            <button type="button" className="ghost" onClick={() => onNavigate('learn')}>
              Ver tutorial
            </button>
          </div>
          <p className="fine-print">
            Cualquier formato y fps exacto. Se abre el diálogo de Windows para guardar el archivo;
            nada se escribe hasta que elegís la carpeta.
          </p>
        </article>

        <article className="card">
          <p className="eyebrow">Recientes</p>
          <h3>Retomar</h3>
          {recents.length === 0 ? (
            <p className="empty-inline">Todavía no hay proyectos recientes en este equipo.</p>
          ) : (
            <ul className="recent-list">
              {recents.map((recent) => (
                <li key={recent.path}>
                  <button
                    type="button"
                    className="recent-open"
                    disabled={locked}
                    onClick={() => void openRecent(recent)}
                    title={recent.label}
                  >
                    <span className="recent-name">{recent.name}</span>
                    <span className="recent-file">{recent.label}</span>
                    <span className="recent-date">
                      {new Date(recent.openedAt).toLocaleString('es-AR')}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Quitar ${recent.name} de recientes`}
                    onClick={() => setRecents(forgetRecent(recent.path))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

    </section>
  );
}
