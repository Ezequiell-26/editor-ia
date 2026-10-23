import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import { Icon, type IconName } from '../../components/Icon';
import { forgetRecent, loadRecents, type RecentProject } from '../../lib/recents';
import { useProjectStore } from '../../state/project-store';
import {
  FPS_PRESETS,
  FORMAT_PRESETS,
  evenDimension,
  validFpsRange,
} from '../../state/video-format';
import { detectNativeRuntime } from '../../services/project-service';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { AppUpdaterModal } from '../updater/AppUpdaterModal';
import {
  CURRENT_APP_VERSION,
  checkForUpdates,
  loadUpdaterConfig,
} from '../updater/updater-service';

export interface StartScreenProps {
  readonly onEnterApp: (view: ViewId) => void;
}

type StartPhase = 'idle' | 'exit';

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (Number.isNaN(diffMs)) return 'Reciente';

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 45) return 'Hace un momento';
    if (diffMin < 60) return `Hace ${diffMin} min`;
    if (diffHours < 24) return `Hace ${diffHours} h`;
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) return `Hace ${diffDays} días`;
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  } catch {
    return 'Reciente';
  }
}

function getDefaultProjectName(): string {
  const today = new Date();
  const day = today.getDate();
  const month = today.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
  return `Proyecto ${day} ${month}`;
}

const QUICK_AI_TOOLS: readonly {
  readonly id: ViewId;
  readonly label: string;
  readonly icon: IconName;
  readonly tag: string;
}[] = [
  { id: 'director', label: 'Director IA', icon: 'director', tag: 'Auto-corte' },
  { id: 'script', label: 'Guion IA', icon: 'script', tag: 'Asistente' },
  { id: 'production', label: 'Locución', icon: 'production', tag: 'Voz & Mix' },
  { id: 'background', label: 'Quitar fondo', icon: 'background', tag: 'IA local' },
  { id: 'upscale', label: 'Upscale 4K', icon: 'upscale', tag: 'Real-ESRGAN' },
  { id: 'compress', label: 'Comprimir', icon: 'compress', tag: 'Optimizar' },
];

const QUICK_TEMPLATES: readonly {
  readonly id: string;
  readonly label: string;
  readonly icon: 'film' | 'layers' | 'assets' | 'fit';
  readonly aspect: string;
  readonly width: number;
  readonly height: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
  readonly badge: string;
}[] = [
  {
    id: 'tiktok',
    label: 'TikTok / Reels',
    icon: 'film',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fpsNum: 30,
    fpsDen: 1,
    badge: 'Vertical 1080p',
  },
  {
    id: 'youtube',
    label: 'YouTube 60fps',
    icon: 'layers',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fpsNum: 60,
    fpsDen: 1,
    badge: 'Horizontal HD',
  },
  {
    id: 'instagram',
    label: 'Instagram Feed',
    icon: 'assets',
    aspect: '1:1',
    width: 1080,
    height: 1080,
    fpsNum: 30,
    fpsDen: 1,
    badge: 'Cuadrado 1:1',
  },
  {
    id: 'cinema',
    label: 'Cine 21:9',
    icon: 'fit',
    aspect: '21:9',
    width: 2560,
    height: 1080,
    fpsNum: 24,
    fpsDen: 1,
    badge: 'Cinemático',
  },
];

const LAUNCHER_TIPS = [
  'Espacio reproduce/pausa · Ctrl+Z deshace · Ctrl+E exporta',
  '100% Privado: Todo el procesamiento y modelos corren localmente',
  'Director IA: Analiza tu metraje y propone cortes automáticos',
  'Locución local: Genera narraciones sin conexión a internet',
  'Comprimir: Optimiza videos para plataformas con máxima calidad',
];

const LauncherTipText = memo(function LauncherTipText() {
  const [tipIndex, setTipIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setTipIndex((prev) => (prev + 1) % LAUNCHER_TIPS.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, []);

  return <span className="start-tip-text">{LAUNCHER_TIPS[tipIndex]}</span>;
});

/**
 * DaVinci Resolve-inspired Project Manager.
 * Compact floating window (900x580), zero glow, zero blur, pure graphite flat aesthetic.
 */
export function StartScreen({ onEnterApp }: StartScreenProps) {
  const store = useProjectStore();
  const [recents, setRecents] = useState<RecentProject[]>(() => loadRecents());
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'name'>('recent');
  const [phase, setPhase] = useState<StartPhase>('idle');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Updater state
  const [showUpdaterModal, setShowUpdaterModal] = useState(false);
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState(false);

  // Drag and drop overlay
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Create-project form state
  const [name, setName] = useState(getDefaultProjectName);
  const [formatId, setFormatId] = useState(FORMAT_PRESETS[0]?.id ?? 'landscape');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fpsId, setFpsId] = useState('30');
  const [fpsNum, setFpsNum] = useState(30);
  const [fpsDen, setFpsDen] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const native = detectNativeRuntime();
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-check for updates silently on launch if enabled in preferences
  useEffect(() => {
    const cfg = loadUpdaterConfig();
    if (cfg.autoCheck) {
      void checkForUpdates(cfg.channel)
        .then((res) => {
          if (res.available) setHasUpdateAvailable(true);
        })
        .catch(() => {});
    }
  }, []);

  // Ensure compact window size on mount (DaVinci Project Manager style: 900x580)
  useEffect(() => {
    if (!native) return;
    const appWindow = getCurrentWindow();
    void appWindow
      .unmaximize()
      .then(() => appWindow.setSize(new LogicalSize(900, 580)))
      .then(() => appWindow.center())
      .catch(() => {});
  }, [native]);

  // Focus name input when create modal opens
  useEffect(() => {
    if (showCreateModal) {
      setName(getDefaultProjectName());
      setError(null);
      window.setTimeout(() => {
        nameInputRef.current?.select();
      }, 60);
    }
  }, [showCreateModal]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!showCreateModal && !showUpdaterModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowCreateModal(false);
        setShowUpdaterModal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCreateModal, showUpdaterModal]);

  function pickFormat(id: string) {
    setFormatId(id);
    const preset = FORMAT_PRESETS.find((f) => f.id === id);
    if (preset) {
      setWidth(preset.width);
      setHeight(preset.height);
    }
  }

  function pickFps(id: string) {
    setFpsId(id);
    const preset = FPS_PRESETS.find((f) => f.id === id);
    if (preset) {
      setFpsNum(preset.num);
      setFpsDen(preset.den);
    }
  }

  const transitionOut = useCallback(
    (view: ViewId) => {
      setPhase('exit');
      if (native) {
        const appWindow = getCurrentWindow();
        void appWindow.maximize().catch(() => {
          void appWindow.toggleMaximize().catch(() => {});
        });
      }
      const timer = window.setTimeout(() => onEnterApp(view), 80);
      return () => window.clearTimeout(timer);
    },
    [native, onEnterApp],
  );

  async function handleCreateProject(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Escribe un nombre para el proyecto.');
      return;
    }
    if (!validFpsRange(fpsNum, fpsDen)) {
      setError('La tasa de cuadros debe quedar entre 1 y 240 fps.');
      return;
    }
    setError(null);
    setBusy(true);
    const ok = await store.createProject({
      name: trimmed,
      width: evenDimension(width),
      height: evenDimension(height),
      fpsNum: Math.max(1, Math.round(fpsNum || 30)),
      fpsDen: Math.max(1, Math.round(fpsDen || 1)),
    });
    setBusy(false);
    if (ok) {
      setShowCreateModal(false);
      transitionOut('editor');
    }
  }

  async function handleQuickTemplate(tpl: (typeof QUICK_TEMPLATES)[number]): Promise<void> {
    setBusy(true);
    const ok = await store.createProject({
      name: `${tpl.label} · ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`,
      width: tpl.width,
      height: tpl.height,
      fpsNum: tpl.fpsNum,
      fpsDen: tpl.fpsDen,
    });
    setBusy(false);
    if (ok) transitionOut('editor');
  }

  async function handleOpenProject(): Promise<void> {
    setBusy(true);
    const ok = await store.openProject();
    setBusy(false);
    if (ok) transitionOut('editor');
  }

  async function handleOpenRecent(recent: RecentProject): Promise<void> {
    setBusy(true);
    const ok = await store.openProjectAt(recent.path);
    setBusy(false);
    if (ok) transitionOut('editor');
  }

  function handleDeleteRecent(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    const updated = forgetRecent(path);
    setRecents(updated);
  }

  // Drag and drop file support
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;

    const first = files[0];
    const baseName = first?.name.replace(/\.[^/.]+$/, '') || 'Nuevo proyecto importado';

    setBusy(true);
    const ok = await store.createProject({
      name: baseName,
      width: 1920,
      height: 1080,
      fpsNum: 30,
      fpsDen: 1,
    });
    setBusy(false);
    if (ok) transitionOut('editor');
  }

  const filteredRecents = useMemo(() => {
    let list = recents;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) => r.name.toLowerCase().includes(q) || r.label.toLowerCase().includes(q),
      );
    }
    if (sortBy === 'name') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [recents, searchQuery, sortBy]);

  return (
    <div
      className={`start-screen ${phase === 'exit' ? 'start-screen--exit' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      {/* Drag & Drop overlay */}
      {isDraggingOver && (
        <div className="start-drop-overlay" aria-hidden="true">
          <div className="start-drop-card">
            <span className="start-drop-icon">
              <Icon name="plus" size={26} />
            </span>
            <strong className="start-drop-title">Soltar archivos para iniciar</strong>
            <span className="start-drop-desc">Se creará un proyecto automáticamente</span>
          </div>
        </div>
      )}

      {/* DaVinci Resolve Project Manager window container */}
      <div className="start-window">
        {/* ─── Window Header (Titlebar) ─── */}
        <header className="start-window-header" data-tauri-drag-region>
          <div className="start-window-brand">
            <div className="start-brand-box">
              <Icon name="film" size={14} />
            </div>
            <div className="start-brand-titles">
              <span className="start-app-title">Montaje</span>
              <span className="start-app-pill">Editor IA Local</span>
            </div>

            {/* Version & Update button */}
            <button
              type="button"
              className={`start-version-btn ${hasUpdateAvailable ? 'has-update' : ''}`}
              title="Actualizador de la app · Buscar nuevas versiones"
              aria-label="Abrir actualizador de la app"
              onClick={() => setShowUpdaterModal(true)}
            >
              <span className="start-version-dot" aria-hidden="true" />
              <span>v{CURRENT_APP_VERSION}</span>
              {hasUpdateAvailable ? (
                <span className="start-update-chip">Actualización</span>
              ) : (
                <Icon name="refresh" size={10} />
              )}
            </button>
          </div>

          <div className="start-window-drag-area" data-tauri-drag-region />

          <div className="start-window-controls">
            <button
              type="button"
              className="start-win-btn"
              title="Ajustes de la aplicación"
              aria-label="Ajustes"
              onClick={() => transitionOut('settings')}
            >
              <Icon name="settings" size={13} />
            </button>
            {native && (
              <>
                <button
                  type="button"
                  className="start-win-btn"
                  title="Minimizar"
                  aria-label="Minimizar"
                  onClick={() => {
                    void getCurrentWindow().minimize().catch(() => {});
                  }}
                >
                  <Icon name="minus" size={12} />
                </button>
                <button
                  type="button"
                  className="start-win-btn"
                  title="Maximizar"
                  aria-label="Maximizar"
                  onClick={() => {
                    void getCurrentWindow().toggleMaximize().catch(() => {});
                  }}
                >
                  <Icon name="maximize" size={11} />
                </button>
                <button
                  type="button"
                  className="start-win-btn start-win-btn--close"
                  title="Cerrar"
                  aria-label="Cerrar"
                  onClick={() => {
                    void getCurrentWindow().close().catch(() => {});
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
              </>
            )}
          </div>
        </header>

        {/* ─── Window Body: 2 Columns ─── */}
        <div className="start-body">
          {/* Left Column: Quick Actions, 1-Click Templates, AI Tools */}
          <aside className="start-left-pane">
            {/* Primary Actions */}
            <div className="start-actions-group">
              <button
                type="button"
                className="start-action-card start-action-card--create"
                onClick={() => setShowCreateModal(true)}
                disabled={busy}
              >
                <div className="start-action-icon">
                  <Icon name="plus" size={18} />
                </div>
                <div className="start-action-text">
                  <strong className="start-action-title">Crear proyecto</strong>
                  <span className="start-action-desc">Nuevo video con IA</span>
                </div>
              </button>

              <button
                type="button"
                className="start-action-card start-action-card--open"
                onClick={() => void handleOpenProject()}
                disabled={busy}
              >
                <div className="start-action-icon">
                  <Icon name="folder" size={16} />
                </div>
                <div className="start-action-text">
                  <strong className="start-action-title">Abrir proyecto</strong>
                  <span className="start-action-desc">Archivo .editoria</span>
                </div>
              </button>
            </div>

            {/* 1-Click Templates */}
            <div className="start-pane-section">
              <div className="start-section-header">
                <span className="start-section-title">Plantillas Rápidas</span>
              </div>
              <div className="start-templates-list">
                {QUICK_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="start-template-row"
                    onClick={() => void handleQuickTemplate(tpl)}
                    disabled={busy}
                    title={`Crear proyecto ${tpl.label} (${tpl.width}×${tpl.height})`}
                  >
                    <span
                      className="start-tpl-ratio"
                      style={{ aspectRatio: tpl.aspect.replace(':', '/') }}
                    >
                      <Icon name={tpl.icon} size={11} />
                    </span>
                    <span className="start-tpl-name">{tpl.label}</span>
                    <span className="start-tpl-badge">{tpl.badge}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick AI Tools */}
            <div className="start-pane-section">
              <div className="start-section-header">
                <span className="start-section-title">Herramientas IA Rápidas</span>
              </div>
              <div className="start-tools-chips">
                {QUICK_AI_TOOLS.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className="start-tool-chip"
                    onClick={() => transitionOut(tool.id)}
                    disabled={busy}
                  >
                    <Icon name={tool.icon} size={13} />
                    <span className="start-tool-name">{tool.label}</span>
                    <span className="start-tool-tag">{tool.tag}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="start-left-spacer" />

            {/* Status note */}
            <div className="start-privacy-note">
              <span className="start-privacy-dot" />
              <span>100% Offline · FFmpeg 7</span>
            </div>
          </aside>

          {/* Right Column: Recent Projects Manager */}
          <main className="start-right-pane">
            {/* Toolbar */}
            <div className="start-recents-toolbar">
              <div className="start-toolbar-left">
                <h2 className="start-section-title">Proyectos recientes</h2>
                {recents.length > 0 && (
                  <span className="start-count-chip">{recents.length}</span>
                )}
              </div>

              <div className="start-toolbar-right">
                {/* Search input */}
                <div className="start-search-box">
                  <Icon name="search" size={12} />
                  <input
                    type="text"
                    className="start-search-input"
                    placeholder="Buscar proyectos…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="start-search-clear"
                      onClick={() => setSearchQuery('')}
                      aria-label="Limpiar búsqueda"
                    >
                      <Icon name="close" size={10} />
                    </button>
                  )}
                </div>

                {/* Sort selector */}
                <div className="start-sort-group">
                  <button
                    type="button"
                    className={`start-sort-btn ${sortBy === 'recent' ? 'active' : ''}`}
                    onClick={() => setSortBy('recent')}
                    title="Ordenar por fecha reciente"
                  >
                    Recientes
                  </button>
                  <button
                    type="button"
                    className={`start-sort-btn ${sortBy === 'name' ? 'active' : ''}`}
                    onClick={() => setSortBy('name')}
                    title="Ordenar por nombre"
                  >
                    Nombre
                  </button>
                </div>
              </div>
            </div>

            {/* Projects Grid */}
            <div className="start-projects-scroll">
              {filteredRecents.length > 0 ? (
                <div className="start-projects-grid">
                  {filteredRecents.map((project) => (
                    <div
                      key={project.path}
                      className="start-project-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => void handleOpenRecent(project)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleOpenRecent(project);
                      }}
                    >
                      <div className="start-thumb-box">
                        <Icon name="film" size={24} />
                        <div className="start-thumb-badge">1080p</div>
                      </div>

                      <div className="start-project-info">
                        <strong className="start-project-name" title={project.name}>
                          {project.name}
                        </strong>
                        <div className="start-project-meta-row">
                          <span className="start-project-time">
                            {formatRelativeTime(project.openedAt)}
                          </span>
                          <span className="start-project-path" title={project.label}>
                            {project.label}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="start-card-delete"
                        title="Eliminar de recientes"
                        aria-label={`Eliminar ${project.name} de recientes`}
                        onClick={(e) => handleDeleteRecent(e, project.path)}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : recents.length > 0 ? (
                <div className="start-empty-notice">
                  <Icon name="search" size={20} />
                  <span>No se encontraron proyectos con «{searchQuery}»</span>
                  <button
                    type="button"
                    className="start-btn-link"
                    onClick={() => setSearchQuery('')}
                  >
                    Mostrar todos los proyectos
                  </button>
                </div>
              ) : (
                <div className="start-empty-notice">
                  <Icon name="film" size={28} />
                  <strong>Aún no tienes proyectos recientes</strong>
                  <span>Crea un nuevo proyecto o arrastra un video aquí para comenzar.</span>
                </div>
              )}
            </div>
          </main>
        </div>

        {/* ─── Window Bottom Status Bar ─── */}
        <footer className="start-window-footer">
          <div className="start-footer-left">
            <span className="start-footer-dot" aria-hidden="true" />
            <LauncherTipText />
          </div>

          <div className="start-footer-right">
            <button
              type="button"
              className="start-footer-link"
              onClick={() => setShowUpdaterModal(true)}
            >
              <Icon name="refresh" size={11} />
              <span>Actualizaciones</span>
            </button>
            <button
              type="button"
              className="start-footer-link"
              onClick={() => transitionOut('learn')}
            >
              <Icon name="learn" size={11} />
              <span>Tutorial</span>
            </button>
          </div>
        </footer>
      </div>

      {/* ─── Create Project Dialog Modal ─── */}
      {showCreateModal && (
        <div
          className="start-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreateModal(false);
          }}
        >
          <div className="start-create-dialog">
            <header className="start-dialog-header">
              <div className="start-dialog-title-group">
                <div className="start-dialog-icon">
                  <Icon name="plus" size={14} />
                </div>
                <h2 id="create-dialog-title" className="start-dialog-title">
                  Nuevo proyecto
                </h2>
              </div>
              <button
                type="button"
                className="start-dialog-close"
                aria-label="Cerrar diálogo"
                onClick={() => setShowCreateModal(false)}
              >
                <Icon name="close" size={13} />
              </button>
            </header>

            <form
              className="start-dialog-form"
              onSubmit={(e) => {
                e.preventDefault();
                void handleCreateProject();
              }}
            >
              {/* Project Name */}
              <label className="start-field">
                <span className="start-label">Nombre del proyecto</span>
                <input
                  ref={nameInputRef}
                  type="text"
                  className="start-input"
                  value={name}
                  placeholder="Ej: Video para YouTube"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              {/* Format selection */}
              <div className="start-field">
                <span className="start-label">Formato y relación de aspecto</span>
                <div className="start-format-grid">
                  {FORMAT_PRESETS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`start-format-card ${formatId === f.id ? 'active' : ''}`}
                      onClick={() => pickFormat(f.id)}
                    >
                      <span
                        className="start-format-frame"
                        style={{ aspectRatio: `${f.width} / ${f.height}` }}
                      />
                      <span className="start-format-name">{f.label}</span>
                      <span className="start-format-dim">
                        {f.width}×{f.height}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Frame rate */}
              <div className="start-field">
                <span className="start-label">Tasa de cuadros (FPS)</span>
                <div className="start-fps-grid">
                  {FPS_PRESETS.slice(0, 6).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`start-fps-chip ${fpsId === f.id ? 'active' : ''}`}
                      onClick={() => pickFps(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="start-error-notice" role="alert">
                  <Icon name="alert" size={13} />
                  <span>{error}</span>
                </div>
              )}

              {/* Dialog Actions */}
              <div className="start-dialog-actions">
                <button
                  type="button"
                  className="start-btn start-btn--ghost"
                  onClick={() => setShowCreateModal(false)}
                  disabled={busy}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="start-btn start-btn--primary"
                  disabled={busy || !name.trim()}
                >
                  {busy ? (
                    <span className="start-spinner" />
                  ) : (
                    <Icon name="plus" size={14} />
                  )}
                  <span>{busy ? 'Creando proyecto…' : 'Crear y entrar al editor'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── App Updater Modal ─── */}
      <AppUpdaterModal
        isOpen={showUpdaterModal}
        onClose={() => setShowUpdaterModal(false)}
      />
    </div>
  );
}
