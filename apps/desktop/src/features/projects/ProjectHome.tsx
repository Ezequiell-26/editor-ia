import { useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import {
  framesToSeconds,
  fpsOf,
  formatTimecode,
  totalFrames,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { forgetRecent, loadRecents, rememberRecent, type RecentProject } from '../../lib/recents';

interface ProjectHomeProps {
  readonly onNavigate: (id: ViewId) => void;
}

type Preset = '16:9' | '9:16';

const PRESETS: Record<Preset, { width: number; height: number; label: string; note: string }> = {
  '16:9': { width: 1920, height: 1080, label: 'Horizontal 16:9', note: 'YouTube, tutoriales, escritorio' },
  '9:16': { width: 1080, height: 1920, label: 'Vertical 9:16', note: 'Shorts, Reels, TikTok' },
};

export function ProjectHome({ onNavigate }: ProjectHomeProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const opened = store.state.opened;
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<Preset>('16:9');
  const [recents, setRecents] = useState<RecentProject[]>(() => loadRecents());
  const [busy, setBusy] = useState(false);

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
    if (!confirmLeave('Crear un proyecto nuevo')) return;
    setBusy(true);
    const chosen = PRESETS[preset];
    const ok = await store.createProject({
      name: trimmed,
      width: chosen.width,
      height: chosen.height,
      fpsNum: 30,
      fpsDen: 1,
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

  function close(): void {
    if (!confirmLeave('Cerrar el proyecto')) return;
    store.closeProject();
    if (store.service.available) {
      void store.service.closeProject().catch(() => {
        // Closing the native session is best-effort; the screen is already empty.
      });
    }
  }

  return (
    <section className="view projects-view">
      <div className="view-head">
        <div>
          <p className="eyebrow">Local-first</p>
          <h2>Proyectos</h2>
          <p className="view-summary">
            Tus archivos y tu timeline quedan en este equipo. El proyecto es un{' '}
            <code>.editoria.json</code> portable; los medios se copian a su carpeta.
          </p>
        </div>
        <div className="head-actions">
          <button type="button" className="ghost" onClick={open} disabled={locked}>
            Abrir proyecto…
          </button>
        </div>
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
        <p className="empty-state">
          No hay proyectos abiertos. Creá uno nuevo o abrí un archivo{' '}
          <code>.editoria.json</code> existente. La lista de recientes se llena a medida que
          abrís proyectos en este equipo.
        </p>
      )}

      <div className="home-grid">
        <article className="card">
          <p className="eyebrow">Nuevo</p>
          <h3>Crear un proyecto</h3>
          <div className="form-grid">
            <label className="field">
              <span>Nombre</span>
              <input
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
            <fieldset className="preset-group" disabled={locked}>
              <legend>Formato</legend>
              {(Object.keys(PRESETS) as Preset[]).map((key) => (
                <label key={key} className={preset === key ? 'preset selected' : 'preset'}>
                  <input
                    type="radio"
                    name="preset"
                    value={key}
                    checked={preset === key}
                    onChange={() => setPreset(key)}
                  />
                  <strong>{PRESETS[key].label}</strong>
                  <span>{PRESETS[key].note}</span>
                  <span className="preset-size">
                    {PRESETS[key].width}×{PRESETS[key].height} · 30 fps
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={() => void create()} disabled={locked}>
              {busy ? 'Creando…' : 'Crear y elegir ubicación…'}
            </button>
          </div>
          <p className="fine-print">
            Se abre el diálogo de Windows para guardar el archivo. Nada se escribe hasta que
            elegís la carpeta.
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

      <article className="card minimal">
        <p className="eyebrow">Qué guarda el proyecto</p>
        <div className="feature-grid">
          <p>
            <strong>Medios con derechos.</strong> Cada archivo importado guarda hash, bytes,
            duración y licencia. Sin derechos confirmados no se exporta.
          </p>
          <p>
            <strong>Timeline en frames.</strong> Los cortes y trims son enteros: no hay deriva al
            renderizar a otra tasa.
          </p>
          <p>
            <strong>Guion y escenas.</strong> La IA propone un plan estructurado; vos lo aplicás y
            queda registrado en el proyecto.
          </p>
          <p>
            <strong>Render verificado.</strong> El estado “completado” sólo aparece si FFprobe
            confirma archivo, tamaño, duración y resolución.
          </p>
        </div>
      </article>
    </section>
  );
}
