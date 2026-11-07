import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { NavView, ViewId } from '../app/navigation';
import { NAV_VIEWS } from '../app/navigation';
import { CURRENT_APP_VERSION } from '../app/version';
import { detectNativeRuntime } from '../services/project-service';
import { useAppearance } from '../state/AppearanceProvider';
import { deleteCaptionCue, deleteClip, duplicateClip, splitClip, totalFrames } from '../state/project-actions';
import { runSilenceCuts } from '../state/silence-cuts';
import { autoCleanupSummary, runAutoCleanup } from '../state/auto-cleanup';
import { autoPilotSummary, runAutoPilot } from '../state/auto-pilot';
import { ReviewDialog } from '../features/editor/ReviewDialog';
import { CriticDialog } from '../features/editor/CriticDialog';
import { applyProjectTitleCard } from '../state/auto-title';
import { useProjectPlaying, useProjectStore } from '../state/project-store';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { Icon } from './Icon';
import { LIVE_UPDATE_FEATURES, LiveUpdateFeatureList } from '../features/editor/FilmoraStates';

// Referencias 132–137: la barra agrupa las herramientas especializadas en un
// menú «Avanzado». Se agrega ANTES de Ayuda para no alterar el orden
// Archivo → Editar → Ver que prueba la navegación por teclado.
type MenuId = 'file' | 'edit' | 'view' | 'playback' | 'tools' | 'advanced' | 'help';

interface MenuItem {
  readonly kind: 'item';
  readonly label: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  readonly action: () => void;
}

interface MenuSeparator {
  readonly kind: 'separator';
  readonly id: string;
}

type MenuEntry = MenuItem | MenuSeparator;

interface MenuDefinition {
  readonly id: MenuId;
  readonly label: string;
  readonly entries: readonly MenuEntry[];
}

interface MenuBarProps {
  readonly activeId: ViewId;
  readonly views?: readonly NavView[];
  readonly onSelect: (id: ViewId) => void;
  readonly onOpenStart?: () => void;
  readonly onOpenShortcuts?: () => void;
  readonly onOpenTour?: () => void;
}

/** Disponibilidad real de cada entrada visible en la captura 99. Las que ya
 *  existen en Editor IA permiten abrir su superficie; las demás se declaran
 *  pendientes en lugar de simular que funcionan. */
interface NewsAvailability {
  readonly detail: string;
  readonly view?: ViewId;
  readonly pending?: boolean;
}
const NEWS_AVAILABILITY: Record<string, NewsAvailability> = {
  'Seguimiento de cámara': {
    detail: 'Seguimiento de objeto/cámara sobre la timeline. Requiere el motor de tracking; la estructura del inspector está preparada.',
    pending: true,
  },
  'Máscara de color': {
    detail: 'Pestaña del inspector con capas de gradación, Básico, HSL, Curvas, Ruedas cromáticas y HDR. Los controles tienen estado real de capa.',
    view: 'editor',
  },
  'Recuadre de vídeo inteligente': {
    detail: 'Reencuadre automático por sujeto. Editor IA ofrece variantes de formato 9:16 / 16:9 / 1:1 en el Creador.',
    view: 'creator',
  },
  'Análisis multimedia con IA': {
    detail: 'Análisis medido de clips, cortes con motivo y shorts. Disponible en el Director local y el Editor automático.',
    view: 'director',
  },
  'Corrección inteligente de color': {
    detail: 'Corrección automática asistida. Los ajustes manuales de Color y Máscara de color funcionan; el automático requiere motor de color.',
    pending: true,
  },
  'Grabación de varias fuentes': {
    detail: 'Captura multipantalla/multicámara con conmutación en vivo. La superficie Multicámara está preparada, la captura requiere backend.',
    pending: true,
  },
  'Atajos de teclado': {
    detail: 'Atajos configurables del estudio, disponibles desde el menú Ayuda y desde Ajustes.',
    view: 'settings',
  },
  'Contenedor multimedia': {
    detail: 'Biblioteca local de vídeo, imagen y audio con importación, metadatos y estados de verificación.',
    view: 'assets',
  },
  'Exportación por lotes': {
    detail: 'Cola de renders múltiples. La exportación individual verificada con FFmpeg funciona; el lote requiere integración.',
    pending: true,
  },
  'Color automático': {
    detail: 'Balance de blancos y color automáticos. Los controles manuales están activos; el cálculo automático requiere motor de color.',
    pending: true,
  },
  'Animación combinada': {
    detail: 'Presets de entrada, salida y combinados sobre el clip. Disponible en la pestaña Animación del inspector.',
    view: 'editor',
  },
};

/** Ilustración real de seguimiento de cámara (referencia 99): plano,
 *  sujeto, reticle de tracking y trayectoria. No es un icono genérico. */
function NewsTrackingArt(): ReactNode {
  return (
    <svg className="fm-news-art-svg" viewBox="0 0 560 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect x="0" y="0" width="560" height="200" fill="#121a21" />
      <path d="M0 156 L560 156" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
      <path d="M0 40 L560 40" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />
      <rect x="26" y="22" width="508" height="156" rx="3" fill="#18232c" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1" />
      <path d="M26 138 L150 82 L226 118 L318 62 L410 112 L534 70 L534 178 L26 178 Z" fill="#1d2c36" />
      <path d="M26 158 L128 122 L226 150 L330 108 L430 146 L534 116 L534 178 L26 178 Z" fill="#233844" />
      <circle cx="452" cy="58" r="20" fill="#2e5b6b" fillOpacity="0.65" />
      <g fill="#314b5a">
        <rect x="58" y="96" width="20" height="62" />
        <rect x="84" y="112" width="14" height="46" />
        <rect x="486" y="104" width="18" height="54" />
      </g>
      <g fill="#0e1a22" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1">
        <circle cx="278" cy="72" r="13" />
        <path d="M265 88 q13 -7 26 0 l7 46 l-13 4 l-7 -28 l-7 28 l-13 -4 Z" />
        <path d="M266 92 l-16 24 M290 92 l16 24" stroke="currentColor" strokeOpacity="0.28" strokeWidth="7" strokeLinecap="round" fill="none" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M238 52 v-12 h12 M318 52 v-12 h-12 M238 148 v12 h12 M318 148 v12 h-12" />
        <rect x="238" y="52" width="80" height="96" rx="2" strokeDasharray="6 5" strokeOpacity="0.7" />
      </g>
      <path d="M120 128 C170 108 196 96 238 92" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 6" />
      <circle cx="120" cy="128" r="4" fill="currentColor" fillOpacity="0.8" />
      <circle cx="238" cy="92" r="4" fill="currentColor" fillOpacity="0.8" />
      <g fill="none" stroke="currentColor" strokeOpacity="0.42" strokeWidth="1.5">
        <rect x="404" y="126" width="92" height="36" rx="3" />
        <path d="M414 144 h18 M440 144 h18 M466 144 h20" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function NewsDialog({
  onSelect,
  onClose,
}: {
  readonly onSelect: (id: ViewId) => void;
  readonly onClose: () => void;
}): ReactNode {
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 500);
    return () => window.clearTimeout(timer);
  }, []);
  if (loading) {
    return (
      <div className="app-modal-body news-dialog">
        <div className="news-loading">Actualización en vivo · Cargando…</div>
      </div>
    );
  }
  const label = LIVE_UPDATE_FEATURES[index] ?? LIVE_UPDATE_FEATURES[0]!;
  const availability = NEWS_AVAILABILITY[label];
  return (
    <div className="app-modal-body news-dialog fm-news-dialog">
      <p className="news-version">Novedades de Editor IA {CURRENT_APP_VERSION}</p>
      <div className="fm-news-layout">
        <div className="fm-news-stage">
          <div className="fm-news-art" aria-hidden="true">
            <NewsTrackingArt />
            <span className="fm-news-art-index">
              {String(index + 1).padStart(2, '0')} / {LIVE_UPDATE_FEATURES.length}
            </span>
          </div>
          <h3>{label}</h3>
          <p className="news-detail">{availability?.detail ?? ''}</p>
          {availability?.pending ? (
            <span className="fm-news-pending">
              Estructura preparada · requiere integración de backend (pendiente)
            </span>
          ) : availability?.view ? (
            <button
              type="button"
              className="small primary"
              onClick={() => {
                onSelect(availability.view!);
                onClose();
              }}
            >
              Abrir en Editor IA
            </button>
          ) : null}
        </div>
        <div className="fm-news-index">
          <LiveUpdateFeatureList activeIndex={index} onSelect={setIndex} />
        </div>
      </div>
      <div className="news-actions">
        <button type="button" className="small ghost" onClick={() => setShowHistory((value) => !value)}>
          {showHistory ? 'Ocultar historial' : 'Ver historial de actualizaciones de versión'}
        </button>
        <button
          type="button"
          className="small ghost"
          onClick={() => setIndex((i) => (i + 1) % LIVE_UPDATE_FEATURES.length)}
        >
          Siguiente función
        </button>
      </div>
      {showHistory ? (
        <ol className="fm-news-history" aria-label="Historial de actualizaciones de versión">
          <li><strong>Editor IA {CURRENT_APP_VERSION}</strong> · Máscara de color, rueda HDR y estados de la interfaz.</li>
          <li><strong>Editor IA 0.2.0</strong> · Timeline multicapa, exportación verificada con FFmpeg y servicios locales.</li>
          <li><strong>Editor IA 0.1.0</strong> · Proyectos, importación de medios y vista previa.</li>
        </ol>
      ) : null}
    </div>
  );
}

function LoginDialog(): ReactNode {
  return (
    <div className="app-modal-body login-dialog">
      <p className="login-lead">INICIA SESIÓN AHORA PARA OBTENER:</p>
      <ul className="login-benefits">
        {['Sincronización en la nube', 'Recursos de stock', 'Exportación a redes', 'Copias de seguridad', 'Soporte prioritario'].map(
          (item) => <li key={item}>{item}</li>,
        )}
      </ul>
      <p className="login-pending">
        Editor IA es 100% local: no existe cuenta ni backend de sincronización.
        Este diálogo reproduce la estructura de la captura 101 y está declarado
        pendiente, no simulado.
      </p>
      <div className="login-fields">
        <input type="email" placeholder="Correo electrónico" disabled />
        <input type="password" placeholder="Contraseña" disabled />
        <button type="button" className="primary" disabled>Iniciar sesión</button>
      </div>
      <div className="login-social">
        {['Google', 'Facebook', 'X'].map((item) => (
          <button key={item} type="button" disabled>{item}</button>
        ))}
      </div>
    </div>
  );
}

export function MenuBar({
  activeId,
  views = NAV_VIEWS,
  onSelect,
  onOpenStart,
  onOpenShortcuts,
  onOpenTour,
}: MenuBarProps) {
  const store = useProjectStore();
  // Sólo se necesita saber si está sonando (etiqueta Reproducir/Pausar): el
  // frame del playhead se lee con `getPlayhead()` dentro de cada acción para
  // no re-renderizar el menú ~30 veces por segundo durante la reproducción.
  const playing = useProjectPlaying();
  const { appearance, update, reset } = useAppearance();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [modal, setModal] = useState<'shortcuts' | 'about' | 'review' | 'critic' | 'news' | 'login' | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [configDir, setConfigDir] = useState<string | null>(null);
  const [menuTabIndex, setMenuTabIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef(new Map<MenuId, HTMLButtonElement>());
  /**
   * Foco pendiente al abrir un menú con teclado: el desplegable todavía no
   * existe cuando corre el handler, así que lo consume el efecto posterior al
   * render. También cubre el salto entre menús hermanos.
   */
  const pendingFocusRef = useRef<'first' | 'last' | null>(null);

  // Trampa de foco (auditoría de accesibilidad, H1/H2) para el modal de
  // Atajos / Acerca de: guarda el disparador, enfoca el primer control (el
  // botón cerrar), atrapa Tab y cierra con Escape. `active` cubre que el
  // componente vive siempre montado y el modal sólo a ratos.
  useDialogFocus({
    containerRef: dialogRef,
    active: modal !== null,
    onClose: () => setModal(null),
  });

  const project = store.state.project;
  const opened = store.state.opened;
  const selection = store.state.selection;
  // Entrega automática: mientras está activa, cada 10 minutos revisa si el
  // proyecto cambió y, si cambió, vuelve a limpiar y exportar sin intervención.
  const [unattended, setUnattended] = useState(
    () => window.localStorage.getItem('olyvia.pilot.unattended') === '1',
  );
  useEffect(() => {
    if (!unattended) return;
    const timer = window.setInterval(() => {
      const current = store.state.project;
      const currentOpened = store.state.opened;
      if (!current || !currentOpened) return;
      const last = Number(window.localStorage.getItem('olyvia.pilot.revision') ?? '-1');
      if (current.revision <= last) return;
      window.localStorage.setItem('olyvia.pilot.revision', String(current.revision));
      void (async () => {
        const saved = await store.saveNow();
        if (!saved) return;
        try {
          const report = await runAutoPilot({
            project: current,
            service: store.service,
            options: {
              outputDir: `${currentOpened.root.replace(/[\\/]+$/, '')}\\entregas`,
            },
          });
          store.setNotice(`Entrega automática: ${autoPilotSummary(report)}`);
        } catch {
          // En modo desatendido no se interrumpe: el aviso manual explica los errores.
        }
      })();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [unattended, store]);
  const clipId = selection.kind === 'clip' ? selection.id : null;
  const cueId = selection.kind === 'cue' ? selection.id : null;
  const hasClip = Boolean(project?.timeline.clips.length);
  const canEdit = store.service.available && project !== null;

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openMenu]);

  useEffect(() => {
    if (!detectNativeRuntime()) return;
    let active = true;
    void getCurrentWindow()
      .isFullscreen()
      .then((value) => {
        if (active) setFullscreen(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'F11') {
        event.preventDefault();
        void toggleFullscreen();
      }
      if (event.key === 'Escape') {
        setOpenMenu(null);
        setModal(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // The handler only uses stable setters and the window API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleFullscreen(): Promise<void> {
    if (!detectNativeRuntime()) return;
    try {
      const next = !(await getCurrentWindow().isFullscreen());
      await getCurrentWindow().setFullscreen(next);
      setFullscreen(next);
    } catch {
      setFullscreen(false);
    }
  }

  // Un solo desplegable puede estar abierto: se consulta desde la raíz para
  // no depender del orden en que React desmonta el menú anterior y monta el
  // siguiente sobre un ref compartido.
  const menuItemButtons = useCallback(
    () => [
      ...(rootRef.current?.querySelectorAll<HTMLButtonElement>(
        '.menubar-dropdown [role^="menuitem"]:not(:disabled)',
      ) ?? []),
    ],
    [],
  );

  const focusMenuItem = useCallback(
    (position: 'first' | 'last') => {
      const items = menuItemButtons();
      if (items.length === 0) return false;
      (position === 'last' ? items[items.length - 1] : items[0])?.focus();
      return true;
    },
    [menuItemButtons],
  );

  function openExport(): void {
    if (!project) return;
    if (activeId !== 'editor') onSelect('editor');
    store.requestExport();
  }

  function splitSelected(): void {
    if (!clipId) return;
    store.mutate((current) => {
      const split = splitClip(current, clipId, store.getPlayhead());
      if (!split) throw new Error('el cabezal no está dentro del clip seleccionado');
      return { project: split.project, rightClipId: split.rightClipId };
    });
  }

  function duplicateSelected(): void {
    if (!clipId) return;
    const result = store.mutate((current) => {
      const copy = duplicateClip(current, clipId);
      if (!copy) throw new Error('no se pudo duplicar el clip');
      return { project: copy.project, clipId: copy.clipId };
    });
    if (result) store.setSelection({ kind: 'clip', id: result.clipId });
  }

  /**
   * Corte automático de silencios desde el menú: mismos valores por defecto y
   * mismo motor que la sección del Inspector y el asistente. Si hay un clip
   * seleccionado opera sobre él; si no, sobre todo el proyecto.
   */
  async function cutSilences(): Promise<void> {
    if (!project) return;
    const current = store.state.selection;
    const clipIds = current.kind === 'clip' ? [current.id] : undefined;
    const result = await runSilenceCuts(
      project,
      (assetId) => store.service.audioPeaks(assetId),
      { clipIds },
    );
    if (result.clips === 0) {
      store.setNotice(
        result.candidates === 0
          ? 'No hay clips con audio a 1× en pistas desbloqueadas para analizar.'
          : result.skipped === result.candidates
            ? 'No pude medir los picos de esos clips: el material no tiene audio analizable.'
            : 'No encontré silencios con los valores por defecto.',
      );
      return;
    }
    store.update(() => result.project, {
      notice: `Silencios recortados en ${result.clips} clip(s): ${result.removedSeconds.toFixed(2)} s menos. Ctrl+Z para deshacer.`,
    });
  }

  /**
   * Limpieza completa del proyecto en un clic: silencios, pausas (si hay
   * subtítulos), ruido, nivelado y zoom. Un solo paso de deshacer.
   */
  async function autoCleanupProject(): Promise<void> {
    if (!project) return;
    const report = await runAutoCleanup(project, (assetId) =>
      store.service.audioPeaks(assetId),
    );
    if (report.project === project) {
      store.setNotice('No había nada que limpiar.');
      return;
    }
    store.update(() => report.project, {
      notice: `Limpieza automática: ${autoCleanupSummary(report)}`,
    });
  }

  /**
   * Piloto automático: mide el material, limpia con esos valores, exporta y
   * verifica el MP4. Escribe en `<raíz del proyecto>\entregas`.
   */
  async function runPilot(): Promise<void> {
    const project = store.state.project;
    const opened = store.state.opened;
    if (!project) return;
    if (!opened) {
      store.setNotice('Guardá el proyecto antes de usar el piloto automático.');
      return;
    }
    const saved = await store.saveNow();
    if (!saved) {
      store.setNotice('No pude guardar el proyecto; el piloto necesita el archivo en disco.');
      return;
    }
    store.setNotice('Piloto automático en marcha: mide, limpia y exporta. Puede tardar.');
    try {
      const report = await runAutoPilot({
        project: store.state.project ?? project,
        service: store.service,
        options: { outputDir: `${opened.root.replace(/[\\/]+$/, '')}\\entregas` },
      });
      // Si el usuario editó mientras renderizaba, no se pisa su trabajo: la
      // entrega corresponde al estado anterior y se avisa.
      const unchanged = store.state.project === project;
      if (unchanged) {
        store.update(() => report.project);
      }
      const suffix = unchanged ? '' : ' (la entrega corresponde al estado previo a tus últimos cambios)';
      store.setNotice(`Piloto automático: ${autoPilotSummary(report)} → ${report.videoPath}${suffix}`);
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'el piloto automático no pudo completar la entrega',
      );
    }
  }

  function deleteSelected(): void {
    if (clipId) {
      let duration = 0;
      store.update((current) => {
        const next = deleteClip(current, clipId);
        duration = totalFrames(next);
        return next;
      });
      store.setSelection({ kind: 'none' });
      store.setPlayhead(Math.min(store.getPlayhead(), duration));
      return;
    }
    if (cueId) {
      store.update((current) => deleteCaptionCue(current, cueId));
      store.setSelection({ kind: 'none' });
    }
  }

  function seek(frame: number): void {
    store.setPlaying(false);
    store.setPlayhead(frame);
  }

  async function showAbout(): Promise<void> {
    setModal('about');
    if (configDir || !store.service.available) return;
    try {
      const info = await store.service.systemInfo();
      setConfigDir(info.configDir);
    } catch {
      setConfigDir(null);
    }
  }

  const viewItems: MenuItem[] = views.map((view) => ({
    kind: 'item',
    label: view.label,
    checked: activeId === view.id,
    action: () => onSelect(view.id),
  }));

  const menus: readonly MenuDefinition[] = [
    {
      id: 'file',
      label: 'Archivo',
      entries: [
        {
          kind: 'item',
          label: 'Pantalla de inicio…',
          action: () => {
            if (onOpenStart) onOpenStart();
            else onSelect('home');
          },
        },
        { kind: 'separator', id: 'file-start' },
        {
          kind: 'item',
          label: 'Nuevo proyecto…',
          action: () => {
            onSelect('projects');
            window.setTimeout(() => {
              document.querySelector<HTMLInputElement>('#project-name')?.focus();
            }, 30);
          },
        },
        {
          kind: 'item',
          label: 'Abrir proyecto…',
          shortcut: 'Ctrl+O',
          disabled: !store.service.available || store.state.phase === 'saving',
          action: () => {
            void store.openProject().then((ok) => {
              if (ok) onSelect('editor');
            });
          },
        },
        { kind: 'separator', id: 'file-save' },
        {
          kind: 'item',
          label: 'Guardar',
          shortcut: 'Ctrl+S',
          disabled: !canEdit || store.state.phase === 'saving',
          action: () => void store.saveNow(),
        },
        {
          kind: 'item',
          label: 'Guardar como…',
          shortcut: 'Ctrl+Shift+S',
          disabled: !canEdit || store.state.phase === 'saving',
          action: () => void store.saveAs(),
        },
        {
          kind: 'item',
          label: 'Empaquetar proyecto (.zip)…',
          disabled: !canEdit || store.state.phase === 'saving',
          action: () => void store.packageProject(),
        },
        { kind: 'separator', id: 'file-export' },
        {
          kind: 'item',
          label: 'Exportar video…',
          shortcut: 'Ctrl+E',
          disabled: !canEdit || !hasClip,
          action: openExport,
        },
        {
          kind: 'item',
          label: 'Convertir medios…',
          action: () => onSelect('convert'),
        },
        { kind: 'separator', id: 'file-close' },
        {
          kind: 'item',
          label: 'Cerrar proyecto',
          disabled: !project,
          action: () => {
            store.closeProject();
            onSelect('projects');
          },
        },
      ],
    },
    {
      id: 'edit',
      label: 'Editar',
      entries: [
        {
          kind: 'item',
          label: 'Deshacer',
          shortcut: 'Ctrl+Z',
          disabled: !store.canUndo,
          action: store.undo,
        },
        {
          kind: 'item',
          label: 'Rehacer',
          shortcut: 'Ctrl+Shift+Z',
          disabled: !store.canRedo,
          action: store.redo,
        },
        { kind: 'separator', id: 'edit-clip' },
        {
          kind: 'item',
          label: 'Duplicar clip',
          shortcut: 'Ctrl+D',
          disabled: !clipId,
          action: duplicateSelected,
        },
        {
          kind: 'item',
          label: 'Dividir en el cabezal',
          shortcut: 'S',
          disabled: !clipId,
          action: splitSelected,
        },
        {
          kind: 'item',
          label: 'Cortar silencios automáticamente',
          disabled: !project,
          action: () => void cutSilences(),
        },
        {
          kind: 'item',
          label: 'Limpieza automática del proyecto',
          disabled: !project,
          action: () => void autoCleanupProject(),
        },
        {
          kind: 'item',
          label: 'Agregar tarjeta de título',
          disabled: !project,
          action: () => {
            if (!project) return;
            const next = applyProjectTitleCard(project);
            if (!next) return;
            store.update(() => next, { notice: 'Tarjeta de título agregada al inicio.' });
          },
        },
        {
          kind: 'item',
          label: 'Criticar edición…',
          disabled: !project,
          action: () => setModal('critic'),
        },
        {
          kind: 'item',
          label: 'Revisar automatización…',
          disabled: !project,
          action: () => setModal('review'),
        },
        {
          kind: 'item',
          label: 'Piloto automático: limpiar y exportar',
          disabled: !project || !opened,
          action: () => void runPilot(),
        },
        {
          kind: 'item',
          label: 'Entrega automática cada 10 min',
          checked: unattended,
          disabled: !opened,
          action: () => {
            setUnattended((value) => {
              const nextValue = !value;
              window.localStorage.setItem('olyvia.pilot.unattended', nextValue ? '1' : '0');
              return nextValue;
            });
          },
        },
        {
          kind: 'item',
          label: 'Eliminar clip o subtítulo',
          shortcut: 'Supr',
          disabled: !clipId && !cueId,
          action: deleteSelected,
        },
        { kind: 'separator', id: 'edit-selection' },
        {
          kind: 'item',
          label: 'Quitar selección',
          shortcut: 'Esc',
          disabled: selection.kind === 'none',
          action: () => store.setSelection({ kind: 'none' }),
        },
      ],
    },
    {
      id: 'view',
      label: 'Ver',
      entries: [
        ...viewItems,
        { kind: 'separator', id: 'view-chrome' },
        {
          kind: 'item',
          label: 'Etiquetas del rail',
          checked: appearance.sidebarLabels,
          action: () => update({ sidebarLabels: !appearance.sidebarLabels }),
        },
        {
          kind: 'item',
          label: 'Barra de estado',
          checked: appearance.showStatusbar,
          action: () => update({ showStatusbar: !appearance.showStatusbar }),
        },
        {
          kind: 'item',
          label: fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa',
          shortcut: 'F11',
          action: () => void toggleFullscreen(),
        },
      ],
    },
    {
      id: 'playback',
      label: 'Reproducción',
      entries: [
        {
          kind: 'item',
          label: playing ? 'Pausar' : 'Reproducir',
          shortcut: 'Espacio',
          disabled: !canEdit,
          action: () => store.setPlaying(!playing),
        },
        { kind: 'separator', id: 'playback-seek' },
        {
          kind: 'item',
          label: 'Ir al inicio',
          disabled: !canEdit,
          action: () => seek(0),
        },
        {
          kind: 'item',
          label: 'Frame anterior',
          disabled: !canEdit,
          action: () => seek(store.getPlayhead() - 1),
        },
        {
          kind: 'item',
          label: 'Frame siguiente',
          disabled: !canEdit,
          action: () => seek(store.getPlayhead() + 1),
        },
        {
          kind: 'item',
          label: 'Ir al final',
          disabled: !canEdit,
          action: () => seek(store.durationFrames),
        },
      ],
    },
    {
      id: 'tools',
      label: 'Herramientas',
      entries: [
        { kind: 'item', label: 'Director automático', action: () => onSelect('director') },
        { kind: 'item', label: 'Fábrica de variantes', action: () => onSelect('factory') },
        { kind: 'item', label: 'Producción', action: () => onSelect('production') },
        { kind: 'item', label: 'Convertir medios', action: () => onSelect('convert') },
        { kind: 'separator', id: 'tools-mcp' },
        { kind: 'item', label: 'Servidores MCP', action: () => onSelect('mcp') },
        { kind: 'item', label: 'Apariencia y ajustes', action: () => onSelect('settings') },
      ],
    },
    {
      id: 'advanced',
      label: 'Avanzado',
      entries: [
        // Accesos reales: cada id resuelve a un MODO del editor (o a su
        // superficie standalone sin proyecto). No hay botones decorativos.
        { kind: 'item', label: 'Edición por texto', action: () => onSelect('text-edit') },
        { kind: 'item', label: 'Multicámara', action: () => onSelect('multicam') },
        { kind: 'item', label: 'Mezcla de audio', action: () => onSelect('mixer') },
        { kind: 'item', label: 'VFX y rotoscopía', action: () => onSelect('vfx') },
        { kind: 'item', label: 'Motion graphics', action: () => onSelect('motion') },
        { kind: 'item', label: 'Efectos y transiciones', action: () => onSelect('visuals') },
        { kind: 'separator', id: 'advanced-ai' },
        { kind: 'item', label: 'Director local', action: () => onSelect('director') },
        { kind: 'item', label: 'Editor automático', action: () => onSelect('auto-edit') },
        { kind: 'item', label: 'AI Hub', action: () => onSelect('ai-hub') },
        { kind: 'item', label: 'Servidores MCP', action: () => onSelect('mcp') },
      ],
    },
    {
      id: 'help',
      label: 'Ayuda',
      entries: [
        {
          kind: 'item',
          label: 'Tour interactivo de Olyvia',
          action: () => {
            if (onOpenTour) onOpenTour();
            else onSelect('learn');
          },
        },
        {
          kind: 'item',
          label: 'Atajos de teclado',
          shortcut: 'Shift+?',
          action: () => {
            if (onOpenShortcuts) onOpenShortcuts();
            else setModal('shortcuts');
          },
        },
        {
          kind: 'item',
          label: 'Tutorial completo',
          action: () => onSelect('learn'),
        },
        {
          kind: 'item',
          label: 'Novedades de la versión',
          action: () => setModal('news'),
        },
        {
          kind: 'item',
          label: 'Iniciar sesión (pendiente)',
          action: () => setModal('login'),
        },
        {
          kind: 'item',
          label: 'Documentación en GitHub',
          action: () => {
            void store.service
              .openExternalUrl('https://github.com/Ezequiell-26/editor-ia')
              .catch((error) =>
                store.setNotice(
                  error instanceof Error ? error.message : 'no se pudo abrir la documentación',
                ),
              );
          },
        },
        {
          kind: 'item',
          label: 'Restaurar apariencia',
          action: () => {
            reset();
            store.setNotice('Apariencia restaurada a los valores de fábrica.');
          },
        },
        { kind: 'separator', id: 'help-about' },
        { kind: 'item', label: 'Acerca de Olyvia', action: () => void showAbout() },
      ],
    },
  ];

  // El desplegable no existe cuando el handler de teclado corre; el foco
  // pedido se aplica recién después del render que lo monta. Si el menú no
  // tiene ítems habilitados (p. ej. Editar sin proyecto), el foco vuelve al
  // disparador para no perder la navegación por flechas.
  useEffect(() => {
    if (!openMenu) {
      pendingFocusRef.current = null;
      return;
    }
    const position = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (!position) return;
    if (!focusMenuItem(position)) triggerRefs.current.get(openMenu)?.focus();
  }, [openMenu, focusMenuItem]);

  function focusMenuTitle(index: number): void {
    const total = menus.length;
    const wrapped = ((index % total) + total) % total;
    setMenuTabIndex(wrapped);
    triggerRefs.current.get(menus[wrapped]!.id)?.focus();
  }

  function openMenuFocused(id: MenuId, position: 'first' | 'last'): void {
    if (openMenu === id) {
      focusMenuItem(position);
      return;
    }
    pendingFocusRef.current = position;
    setOpenMenu(id);
  }

  function onDropdownKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      // Cortar la propagación para que el Escape global no deseleccione el
      // clip mientras sólo se cierra el menú.
      event.preventDefault();
      event.stopPropagation();
      const trigger = openMenu ? triggerRefs.current.get(openMenu) : null;
      setOpenMenu(null);
      trigger?.focus();
      return;
    }
    if (event.key === 'Tab') {
      // Sin esto el ítem enfocado se desmonta y el foco cae en <body>; el Tab
      // nativo sigue desde el disparador hacia el resto de la barra.
      if (openMenu) triggerRefs.current.get(openMenu)?.focus();
      setOpenMenu(null);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (!openMenu) return;
      event.preventDefault();
      const current = menus.findIndex((menu) => menu.id === openMenu);
      const next = current + (event.key === 'ArrowRight' ? 1 : -1);
      setMenuTabIndex(((next % menus.length) + menus.length) % menus.length);
      openMenuFocused(
        menus[((next % menus.length) + menus.length) % menus.length]!.id,
        'first',
      );
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = menuItemButtons();
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div className="menubar" ref={rootRef}>
      <div className="menubar-menus" role="menubar" aria-label="Menú principal">
        {menus.map((menu, index) => (
          <div className="menubar-slot" key={menu.id}>
            <button
              type="button"
              ref={(node) => {
                if (node) triggerRefs.current.set(menu.id, node);
                else triggerRefs.current.delete(menu.id);
              }}
              tabIndex={menuTabIndex === index ? 0 : -1}
              onFocus={() => setMenuTabIndex(index)}
              className={`menubar-title${openMenu === menu.id ? ' open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={openMenu === menu.id}
              onClick={() => setOpenMenu((current) => (current === menu.id ? null : menu.id))}
              onPointerEnter={() => {
                if (openMenu) setOpenMenu(menu.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openMenuFocused(menu.id, 'first');
                  return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  openMenuFocused(menu.id, event.key === 'ArrowUp' ? 'last' : 'first');
                  return;
                }
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  const next = index + (event.key === 'ArrowRight' ? 1 : -1);
                  const wrapped = ((next % menus.length) + menus.length) % menus.length;
                  if (openMenu) openMenuFocused(menus[wrapped]!.id, 'first');
                  focusMenuTitle(next);
                  return;
                }
                if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault();
                  focusMenuTitle(event.key === 'Home' ? 0 : menus.length - 1);
                  return;
                }
                if (event.key === 'Escape' && openMenu === menu.id) {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpenMenu(null);
                  event.currentTarget.focus();
                }
              }}
            >
              {menu.label}
            </button>
            {openMenu === menu.id ? (
              <div
                className="menubar-dropdown"
                role="menu"
                aria-label={menu.label}
                onKeyDown={onDropdownKeyDown}
              >
                {menu.entries.map((entry, index) =>
                  entry.kind === 'separator' ? (
                    <div className="menubar-separator" key={entry.id} role="separator" />
                  ) : (
                    <button
                      key={`${menu.id}-${index}-${entry.label}`}
                      type="button"
                      role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                      aria-checked={entry.checked === undefined ? undefined : entry.checked}
                      className="menubar-item"
                      disabled={entry.disabled}
                      onClick={(event) => {
                        // Enter/Espacio generan un click con detail 0; devolver
                        // el foco al disparador conserva la continuidad de teclado.
                        if (event.detail === 0) triggerRefs.current.get(menu.id)?.focus();
                        setOpenMenu(null);
                        entry.action();
                      }}
                    >
                      <span className="menubar-check" aria-hidden="true">
                        {entry.checked ? <Icon name="check" size={13} /> : null}
                      </span>
                      <span className="menubar-label">{entry.label}</span>
                      {entry.shortcut ? (
                        <span className="menubar-shortcut">{entry.shortcut}</span>
                      ) : null}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {modal ? (
        <div
          className="app-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          {/* Captura 99: el modal de novedades necesita dos columnas (imagen +
              índice de funciones); el ancho de 560 px las recortaba. */}
          <div
            className={`app-modal${modal === 'news' ? ' news-modal-wide' : ''}`}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === 'shortcuts'
                ? 'Atajos de teclado'
                : modal === 'review'
                  ? 'Revisar automatización'
                  : modal === 'critic'
                    ? 'Criticar edición'
                    : modal === 'news'
                      ? 'Novedades de Editor IA'
                      : modal === 'login'
                        ? 'Iniciar sesión'
                        : 'Acerca de Olyvia'
            }
          >
            <header>
              <h2>
                {modal === 'shortcuts'
                  ? 'Atajos de teclado'
                  : modal === 'review'
                    ? 'Revisar automatización'
                    : modal === 'critic'
                      ? 'Criticar edición'
                      : modal === 'news'
                        ? 'Novedades de Editor IA'
                        : modal === 'login'
                          ? 'Iniciar sesión'
                          : 'Acerca de Olyvia'}
              </h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Cerrar"
                data-tooltip="Cerrar"
                onClick={() => setModal(null)}
              >
                <Icon name="close" size={16} />
              </button>
            </header>
            {modal === 'news' ? (
              <NewsDialog onSelect={onSelect} onClose={() => setModal(null)} />
            ) : modal === 'login' ? (
              <LoginDialog />
            ) : modal === 'critic' ? (
              <CriticDialog onClose={() => setModal(null)} />
            ) : modal === 'review' ? (
              <ReviewDialog onClose={() => setModal(null)} />
            ) : modal === 'shortcuts' ? (
              <div className="shortcut-grid">
                {[
                  ['Ctrl+O', 'Abrir proyecto'],
                  ['Ctrl+S', 'Guardar'],
                  ['Ctrl+Shift+S', 'Guardar como'],
                  ['Ctrl+E', 'Exportar video'],
                  ['Ctrl+Z', 'Deshacer'],
                  ['Ctrl+Shift+Z', 'Rehacer'],
                  ['Ctrl+D', 'Duplicar clip'],
                  ['S', 'Dividir en el cabezal'],
                  ['Supr', 'Eliminar clip o subtítulo'],
                  ['Espacio', 'Reproducir o pausar'],
                  ['H', 'Herramienta mano para mover la timeline'],
                  ['Ctrl+rueda', 'Zoom en la timeline'],
                  ['Shift+rueda', 'Desplazar la timeline en horizontal'],
                  ['← / →', 'Un frame (Shift: diez)'],
                  ['F11', 'Pantalla completa'],
                  ['Esc', 'Cerrar menú o quitar selección'],
                ].map(([keys, description]) => (
                  <div className="shortcut-row" key={keys}>
                    <kbd>{keys}</kbd>
                    <span>{description}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="about-copy">
                <p>
                  <strong>Olyvia</strong> es un estudio de video local-first para Windows:
                  timeline por frames, Director automático, fábrica de variantes, conversión de
                  medios, subtítulos y render FFmpeg verificado.
                </p>
                <p>
                  No publica en redes por vos, no descarga stock sin procedencia y no guarda claves
                  en el proyecto. La apariencia y los servidores MCP viven sólo en este equipo.
                </p>
                <dl className="data-list">
                  <div>
                    <dt>Versión</dt>
                    <dd>{CURRENT_APP_VERSION}</dd>
                  </div>
                  <div>
                    <dt>Runtime</dt>
                    <dd>{detectNativeRuntime() ? 'Tauri · WebView2' : 'Navegador (sin archivos)'}</dd>
                  </div>
                  <div>
                    <dt>Datos locales</dt>
                    <dd className="path">{configDir ?? '—'}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="ghost icon-text"
                  onClick={() =>
                    void store.service
                      .openExternalUrl('https://github.com/Ezequiell-26/editor-ia')
                      .catch(() => store.setNotice('no se pudo abrir la documentación'))
                  }
                >
                  <Icon name="external" size={14} />
                  <span>Abrir repositorio</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
