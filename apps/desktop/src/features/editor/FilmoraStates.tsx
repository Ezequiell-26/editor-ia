import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '../../components/Icon';
import type { ViewId } from '../../app/navigation';

/* ────────────────────────────────────────────────────────────────────────────
   Estados de las capturas 93, 95, 97, 109, 114, 126 y 127 que no existían
   todavía en el frontend. Todo lo que aquí se renderiza tiene comportamiento
   real (navegación, estado local, persistencia o mutación del proyecto).
   Lo que requiere backend se declara `disabled` + `title`, nunca se simula.
   ──────────────────────────────────────────────────────────────────────────── */

const PENDING = 'Estructura preparada · requiere integración de backend (pendiente)';

/* ── 93 · Inicio: tarjeta promocional y guía de primer proyecto ─────────── */

export function HomePromoCard({ onOpen }: { readonly onOpen: (view: ViewId) => void }) {
  return (
    <aside className="start-promo-card" aria-label="Agente de idea a video">
      <div className="start-promo-art" aria-hidden="true">
        <span className="start-promo-art-glow" />
        <Icon name="sparkles" size={26} />
        {/* El badge vive sobre el arte, no sobre la columna de texto: así no
            tapa el titular y la tarjeta no necesita altura extra. */}
        <span className="start-promo-badge">New</span>
      </div>
      <div className="start-promo-copy">
        <strong>Agente de idea a video</strong>
        <p>
          Convierte tus ideas en vídeos: el agente del estudio ya está disponible en
          el Director de IA.
        </p>
        <button type="button" className="small ghost" onClick={() => onOpen('director')}>
          Abrir agente
        </button>
      </div>
    </aside>
  );
}

export function NewProjectTip({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <div className="start-new-project-tip" role="status">
      <button
        type="button"
        className="start-new-project-tip-close"
        aria-label="Cerrar guía"
        onClick={onDismiss}
      >
        <Icon name="close" size={11} />
      </button>
      <strong>Nuevo proyecto</strong>
      <p>Haz clic aquí para comenzar con tu primer vídeo.</p>
      <span className="start-new-project-tip-tail" aria-hidden="true" />
    </div>
  );
}

/* ── 95 · Editor vacío: guía de importación y aviso de rendimiento ─────── */

export function EditorImportGuide({
  onImport,
  onDismiss,
}: {
  readonly onImport: () => void;
  readonly onDismiss: () => void;
}) {
  /* Vive dentro del panel de medios: el dropzone real ya está en
     `rail-empty-import`. Esta guía sólo aporta la llamada a la acción y su
     conector, como en la referencia 95, sin tapar el monitor de preview. */
  return (
    <div className="fm-import-guide" role="presentation">
      <div className="fm-import-guide-cta" role="status">
        <span className="fm-import-guide-cta-tail" aria-hidden="true" />
        <button type="button" onClick={onImport}>
          Importar archivos
        </button>
      </div>
      <button
        type="button"
        className="fm-import-guide-close"
        aria-label="Cerrar guía de importación"
        onClick={onDismiss}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

const PERF_KEY = 'editor-ia.performance-warning.dismissed.v1';

export function PerformanceNotice({ onDismiss }: { readonly onDismiss: () => void }) {
  const [remember, setRemember] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const close = useCallback(() => {
    if (remember) {
      try {
        window.localStorage.setItem(PERF_KEY, '1');
      } catch {
        // Sin almacenamiento: el aviso reaparece en la próxima sesión.
      }
    }
    onDismiss();
  }, [remember, onDismiss]);
  return (
    // `group` + `aria-live` en vez de `alert`: es un aviso descartable, no una
    // incidencia urgente, y así no compite con los `alert` de error del store.
    <div
      className="fm-performance-notice"
      role="group"
      aria-live="polite"
      aria-label="Advertencia de rendimiento"
    >
      <button
        type="button"
        className="fm-performance-notice-close"
        aria-label="Cerrar aviso"
        onClick={close}
      >
        <Icon name="close" size={12} />
      </button>
      <strong>Advertencia de rendimiento</strong>
      <p>
        Una memoria insuficiente podría afectar a la estabilidad de Editor IA. Cierra
        las aplicaciones que consumen mucha memoria.
      </p>
      <button
        type="button"
        className="fm-performance-notice-link"
        aria-expanded={showDetails}
        onClick={() => setShowDetails((value) => !value)}
      >
        {showDetails ? 'Ocultar detalles' : 'Más información'}
      </button>
      {showDetails ? (
        <ul className="fm-performance-notice-details">
          <li>Cerrá otras aplicaciones que estén consumiendo mucha memoria.</li>
          <li>Reducí la resolución de la vista previa o activá proxies en Preferencias.</li>
          <li>
            Editor IA no simula el render: la exportación real la ejecuta FFmpeg y
            este aviso sólo refleja la memoria disponible del sistema.
          </li>
        </ul>
      ) : null}
      <div className="fm-performance-notice-foot">
        <label>
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          No recordar
        </label>
        <button type="button" className="primary small" onClick={close}>
          Entendido
        </button>
      </div>
    </div>
  );
}

export function performanceNoticeDismissed(): boolean {
  try {
    return window.localStorage.getItem(PERF_KEY) === '1';
  } catch {
    return false;
  }
}

/* ── 97 · Exportación completada ───────────────────────────────────────── */

const CAPABILITIES: readonly { readonly icon: IconName; readonly label: string }[] = [
  { icon: 'check', label: 'Sin marca de agua' },
  { icon: 'assets', label: 'Biblioteca local' },
  { icon: 'captions', label: 'Voz a texto' },
  { icon: 'palette', label: 'Fotogramas clave' },
  { icon: 'film', label: 'Admite 4K' },
  { icon: 'ripple', label: 'Rampa de velocidad' },
];

/** Composición real del resultado: fotograma, escena, play y progreso. */
function RenderSuccessArt() {
  return (
    <svg className="fm-render-art" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect x="0" y="0" width="320" height="180" fill="#101a26" />
      <circle cx="248" cy="46" r="22" fill="#2f6f8f" opacity="0.55" />
      <path d="M0 132 L74 84 L128 122 L196 66 L268 118 L320 88 L320 180 L0 180 Z" fill="#1c3a4c" />
      <path d="M0 150 L92 112 L164 146 L236 106 L320 140 L320 180 L0 180 Z" fill="#24506a" />
      <rect x="14" y="14" width="292" height="152" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      <circle cx="160" cy="90" r="27" fill="#0b1620" fillOpacity="0.72" stroke="currentColor" strokeOpacity="0.8" strokeWidth="1.5" />
      <path d="M153 79 L174 90 L153 101 Z" fill="currentColor" />
      <rect x="14" y="152" width="292" height="14" rx="2" fill="#0b1620" fillOpacity="0.7" />
      <rect x="20" y="158" width="196" height="3" rx="1.5" fill="currentColor" />
      <circle cx="218" cy="159.5" r="4" fill="currentColor" />
      <circle cx="292" cy="26" r="11" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="1.5" />
      <path d="M287 26 l3.5 3.5 l6 -7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RenderSuccessCard({
  name,
  onOpenFolder,
}: {
  readonly name: string;
  readonly onOpenFolder: () => void;
}) {
  return (
    <div className="fm-render-success" role="status" aria-label="Resultado del render">
      <div className="fm-render-success-preview" aria-hidden="true">
        <RenderSuccessArt />
      </div>
      <div className="fm-render-success-main">
        <strong>{name || 'Mi vídeo'}</strong>
        <span className="fm-render-success-ok">Convertido con éxito</span>
        <div className="fm-render-success-rows">
          <button type="button" onClick={onOpenFolder} title="Abrir la carpeta del resultado">
            <Icon name="folder" size={13} />
            <span>Renderizar</span>
            <Icon name="check" size={12} />
            <Icon name="folder" size={13} />
          </button>
          <button type="button" onClick={onOpenFolder} title="Abrir el archivo generado">
            <Icon name="external" size={13} />
            <span>Resultado automático</span>
            <Icon name="check" size={12} />
            <Icon name="folder" size={13} />
          </button>
          <button type="button" disabled title={PENDING}>
            <Icon name="send" size={13} />
            <span>Compartir en redes</span>
            <span className="fm-pending-tag">Pendiente</span>
          </button>
        </div>
      </div>
      <div className="fm-render-success-capabilities">
        <strong>Características de Editor IA</strong>
        <div className="fm-capability-grid">
          {CAPABILITIES.map((item) => (
            <span key={item.label}>
              <Icon name={item.icon} size={16} />
              <em>{item.label}</em>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── 109 · Ventana de vista previa desacoplada ─────────────────────────── */

export function useDraggableWindow(initial: { x: number; y: number }) {
  const [position, setPosition] = useState(initial);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest('button')) return;
      dragRef.current = { dx: event.clientX - position.x, dy: event.clientY - position.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [position.x, position.y],
  );
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const maxX = Math.max(0, window.innerWidth - 260);
    const maxY = Math.max(0, window.innerHeight - 80);
    setPosition({
      x: Math.min(maxX, Math.max(0, event.clientX - drag.dx)),
      y: Math.min(maxY, Math.max(0, event.clientY - drag.dy)),
    });
  }, []);
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);
  const style: CSSProperties = { left: position.x, top: position.y };
  return {
    style,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}

export function DetachedPreviewTitlebar({
  onDock,
  children,
  dragHandlers,
}: {
  readonly onDock: () => void;
  readonly children?: ReactNode;
  /** Handlers reales de arrastre de `useDraggableWindow` (captura 109). */
  readonly dragHandlers?: ReturnType<typeof useDraggableWindow>['handlers'];
}) {
  return (
    <div
      className="fm-preview-titlebar"
      data-tauri-drag-region=""
      {...dragHandlers}
    >
      <span>{children ?? 'Vista previa'}</span>
      <div className="fm-preview-titlebar-actions">
        <button type="button" aria-label="Minimizar vista previa" title="Volver al panel" onClick={onDock}>
          <Icon name="minus" size={12} />
        </button>
        <button type="button" aria-label="Acoplar vista previa" title="Acoplar al editor" onClick={onDock}>
          <Icon name="restore" size={12} />
        </button>
        <button type="button" aria-label="Cerrar ventana de vista previa" onClick={onDock}>
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}

/* ── 114 · Plantillas de pantalla dividida ─────────────────────────────── */

export interface SplitScreenTemplate {
  readonly id: string;
  readonly label: string;
  /** Celdas en porcentaje: [left, top, width, height]. */
  readonly cells: readonly (readonly [number, number, number, number])[];
}

export const SPLIT_SCREEN_TEMPLATES: readonly SplitScreenTemplate[] = [
  {
    id: 'split-4',
    label: 'Pantalla Dividida 4',
    cells: [
      [0, 0, 62, 100],
      [62, 0, 38, 100],
      [62, 0, 38, 50],
      [62, 50, 38, 50],
    ],
  },
  {
    id: 'split-18',
    label: 'Pantalla Dividida 18',
    cells: [
      [0, 0, 50, 50],
      [50, 0, 50, 50],
      [0, 50, 50, 50],
      [50, 50, 50, 50],
    ],
  },
  {
    id: 'split-17',
    label: 'Pantalla Dividida 17',
    cells: [
      [0, 0, 25, 100],
      [25, 0, 25, 100],
      [50, 0, 25, 100],
      [75, 0, 25, 100],
    ],
  },
  {
    id: 'split-16',
    label: 'Pantalla Dividida 16',
    cells: [
      [0, 0, 100, 50],
      [0, 50, 100, 50],
    ],
  },
  {
    id: 'split-1',
    label: 'Pantalla simple 1',
    cells: [[0, 0, 100, 100]],
  },
  {
    id: 'split-2',
    label: 'Pantalla Dividida 2',
    cells: [
      [0, 0, 50, 100],
      [50, 0, 50, 100],
    ],
  },
];

export function SplitScreenTemplates({
  selectedId,
  onSelect,
}: {
  readonly selectedId: string | null;
  readonly onSelect: (template: SplitScreenTemplate) => void;
}) {
  return (
    <div className="fm-split-templates">
      <div className="fm-split-templates-head">
        <strong>BÁSICO</strong>
        <span>{SPLIT_SCREEN_TEMPLATES.length} plantillas</span>
      </div>
      <div className="fm-split-templates-grid">
        {SPLIT_SCREEN_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className={selectedId === template.id ? 'active' : ''}
            aria-pressed={selectedId === template.id}
            onClick={() => onSelect(template)}
            title={template.label}
          >
            <span className="fm-split-preview" aria-hidden="true">
              {template.cells.map(([left, top, width, height], index) => (
                <span
                  key={`${left}-${top}-${index}`}
                  style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                >
                  {index + 1}
                </span>
              ))}
            </span>
            <span className="fm-split-label">{template.label}</span>
          </button>
        ))}
      </div>
      <p
        className="fm-split-templates-note"
        title={`${selectedId ? `Plantilla seleccionada: ${SPLIT_SCREEN_TEMPLATES.find((item) => item.id === selectedId)?.label ?? ''}. ` : 'Elegí una plantilla para ver su distribución. '}La composición en la timeline requiere el motor de plantillas (pendiente).`}
      >
        {selectedId
          ? `Plantilla seleccionada: ${SPLIT_SCREEN_TEMPLATES.find((item) => item.id === selectedId)?.label ?? ''}. `
          : 'Elegí una plantilla para ver su distribución. '}
        La composición en la timeline requiere el motor de plantillas (pendiente).
      </p>
    </div>
  );
}

/* ── 126 · Personalización de la barra de herramientas ────────────────── */

export interface ToolbarTool {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** `aria-label` del botón real de la toolbar que se dispara. */
  readonly action?: string;
  readonly pending?: boolean;
}

export const DEFAULT_TOOLBAR_TOOLS: readonly string[] = [
  'undo',
  'redo',
  'delete',
  'split',
  'trim',
  'quick-text',
];

export const TOOLBAR_CATALOG: readonly ToolbarTool[] = [
  { id: 'undo', label: 'Deshacer', icon: 'undo', action: 'Deshacer' },
  { id: 'redo', label: 'Rehacer', icon: 'redo', action: 'Rehacer' },
  { id: 'delete', label: 'Eliminar', icon: 'trash', action: 'Borrar clip' },
  { id: 'split', label: 'Dividir', icon: 'split', action: 'Dividir en playhead' },
  { id: 'trim', label: 'Recortar', icon: 'film', pending: true },
  { id: 'quick-text', label: 'Texto rápido', icon: 'text', pending: true },
  { id: 'silence', label: 'Detección de Silencio', icon: 'volume', pending: true },
  { id: 'duration', label: 'Duración', icon: 'refresh', pending: true },
  { id: 'keyframes', label: 'Fotogramas Clave', icon: 'marker', pending: true },
  { id: 'edit', label: 'Editar', icon: 'effects', pending: true },
  { id: 'devices', label: 'Editar Dispositivos', icon: 'settings', pending: true },
  { id: 'rhythm', label: 'Detección de ritmo', icon: 'audio', action: 'Detectar beats para el imán' },
  { id: 'voice-to-text', label: 'Voz a texto', icon: 'captions', pending: true },
  { id: 'text-to-voice', label: 'Texto a Voz', icon: 'volume', pending: true },
  { id: 'ai-extend', label: 'Extensión con IA', icon: 'sparkles', pending: true },
  { id: 'audio-extend', label: 'Extensión de audio', icon: 'audio', pending: true },
  { id: 'ambient-music', label: 'Generación de música ambiental inteligente', icon: 'ai-hub', pending: true },
  { id: 'ai-cutout', label: 'Herramientas de recorte de IA', icon: 'split', pending: true },
  { id: 'object-remover', label: 'Eliminador de objetos con IA', icon: 'background', pending: true },
  { id: 'ai-tracking', label: 'Herramientas de seguimiento con IA', icon: 'marker', pending: true },
  { id: 'text-edit', label: 'Edición basada en texto', icon: 'text', pending: true },
  { id: 'ai-palette', label: 'Paleta de colores con IA', icon: 'palette', pending: true },
  { id: 'ai-translate', label: 'Traducción con IA', icon: 'globe', pending: true },
  { id: 'auto-sync', label: 'Sincronización automática', icon: 'refresh', pending: true },
  { id: 'image-to-video', label: 'Imagen a video', icon: 'film', pending: true },
  { id: 'text-to-video', label: 'Texto a video', icon: 'sparkles', pending: true },
];

const TOOLBAR_KEY = 'editor-ia.toolbar-tools.v2';

export function readToolbarTools(): string[] {
  try {
    const raw = window.localStorage.getItem(TOOLBAR_KEY);
    if (!raw) return [...DEFAULT_TOOLBAR_TOOLS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_TOOLBAR_TOOLS];
    const known = new Set(TOOLBAR_CATALOG.map((item) => item.id));
    return parsed.filter((id): id is string => typeof id === 'string' && known.has(id));
  } catch {
    return [...DEFAULT_TOOLBAR_TOOLS];
  }
}

export function writeToolbarTools(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(TOOLBAR_KEY, JSON.stringify(ids));
  } catch {
    // Sin almacenamiento: la personalización vale para esta sesión.
  }
}

export function ToolbarCustomizerDialog({
  open,
  onClose,
  onSaved,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSaved: (ids: readonly string[]) => void;
}) {
  const [draft, setDraft] = useState<readonly string[]>(() => readToolbarTools());
  const draggingRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(readToolbarTools());
      draggingRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const catalog = useMemo(() => new Map(TOOLBAR_CATALOG.map((item) => [item.id, item])), []);

  const dropOnCurrent = (event: DragEvent<HTMLElement>, index: number): void => {
    event.preventDefault();
    const id = draggingRef.current;
    if (!id) return;
    setDraft((current) => {
      const next = current.filter((item) => item !== id);
      next.splice(Math.min(index, next.length), 0, id);
      return next;
    });
    draggingRef.current = null;
  };

  if (!open) return null;

  return (
    <div className="fm-toolbar-customizer-backdrop" role="presentation" onPointerDown={onClose}>
      <div
        className="fm-toolbar-customizer"
        role="dialog"
        aria-modal="true"
        aria-label="Personalizar barra de herramientas"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="fm-toolbar-customizer-head">
          <strong>Arrastra los elementos que desea utilizar a la barra de herramientas…</strong>
          <button type="button" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
        </header>
        <div className="fm-toolbar-customizer-body">
          <div className="fm-toolbar-current">
            <span className="fm-toolbar-column-title">Barra actual ({draft.length})</span>
            <div
              className="fm-toolbar-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropOnCurrent(event, draft.length)}
            >
              {draft.length === 0 ? <em>Arrastrá herramientas aquí</em> : null}
              {draft.map((id, index) => {
                const tool = catalog.get(id);
                if (!tool) return null;
                return (
                  <div
                    key={id}
                    className="fm-toolbar-chip"
                    draggable
                    onDragStart={() => {
                      draggingRef.current = id;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropOnCurrent(event, index)}
                  >
                    <Icon name={tool.icon} size={13} />
                    <span>{tool.label}</span>
                    <button
                      type="button"
                      aria-label={`Quitar ${tool.label}`}
                      onClick={() => setDraft((current) => current.filter((item) => item !== id))}
                    >
                      <Icon name="close" size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="small ghost"
              onClick={() => setDraft([...DEFAULT_TOOLBAR_TOOLS])}
            >
              Restablecer
            </button>
          </div>
          <div className="fm-toolbar-catalog">
            <span className="fm-toolbar-column-title">Herramientas disponibles</span>
            <div className="fm-toolbar-catalog-grid">
              {TOOLBAR_CATALOG.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  draggable
                  className={draft.includes(tool.id) ? 'in-bar' : ''}
                  onDragStart={() => {
                    draggingRef.current = tool.id;
                  }}
                  onClick={() =>
                    setDraft((current) =>
                      current.includes(tool.id)
                        ? current.filter((item) => item !== tool.id)
                        : [...current, tool.id],
                    )
                  }
                  title={
                    tool.pending
                      ? PENDING
                      : `${draft.includes(tool.id) ? 'Quitar' : 'Agregar'} ${tool.label}`
                  }
                >
                  <Icon name={tool.icon} size={13} />
                  <span>{tool.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <footer className="fm-toolbar-customizer-foot">
          <button type="button" className="ghost small" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary small"
            onClick={() => {
              writeToolbarTools(draft);
              onSaved(draft);
              onClose();
            }}
          >
            Guardar
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Barra rápida generada desde la personalización. Cada botón dispara el
 *  botón REAL de la toolbar por `aria-label`; no duplica lógica de edición. */
export function QuickToolsBar({ tools }: { readonly tools: readonly string[] }) {
  const catalog = useMemo(() => new Map(TOOLBAR_CATALOG.map((item) => [item.id, item])), []);
  if (tools.length === 0) return null;
  return (
    <div className="fm-quick-tools" role="toolbar" aria-label="Herramientas rápidas personalizadas">
      {tools.map((id) => {
        const tool = catalog.get(id);
        if (!tool) return null;
        return (
          <button
            key={id}
            type="button"
            className="fm-quick-tool"
            disabled={!tool.action}
            title={tool.action ? tool.label : PENDING}
            onClick={() => {
              if (!tool.action) return;
              // Primero los botones propios de la timeline; Deshacer/Rehacer
              // viven en la barra superior del shell, así que se buscan ahí
              // como respaldo. En ambos casos se dispara el comando REAL.
              const toolbar = document.querySelector<HTMLElement>('.timeline-toolbar');
              const target =
                toolbar?.querySelector<HTMLButtonElement>(`[aria-label="${tool.action}"]`) ??
                document.querySelector<HTMLButtonElement>(
                  `.app-shell [aria-label="${tool.action}"]`,
                );
              if (target && !target.disabled) target.click();
            }}
          >
            <Icon name={tool.icon} size={13} />
            <span>{tool.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── 127 · Selector de herramienta de la timeline ──────────────────────── */

export type ToolSelectorId =
  | 'select'
  | 'agile-split'
  | 'select-forward'
  | 'select-backward'
  | 'zoom';

export const TOOL_SELECTOR_OPTIONS: readonly {
  readonly id: ToolSelectorId;
  readonly label: string;
  readonly shortcut: string;
}[] = [
  { id: 'select', label: 'Seleccionar', shortcut: 'V' },
  { id: 'agile-split', label: 'Modo de división ágil', shortcut: 'C' },
  { id: 'select-forward', label: 'Seleccionar todo hacia delante', shortcut: 'A' },
  { id: 'select-backward', label: 'Seleccionar todo hacia atrás', shortcut: 'Shift+A' },
  { id: 'zoom', label: 'Herramienta de zoom', shortcut: 'Z' },
];

export function ToolSelectorMenu({
  value,
  onChange,
}: {
  readonly value: ToolSelectorId;
  readonly onChange: (id: ToolSelectorId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0 });
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      setOpen(false);
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  const current = TOOL_SELECTOR_OPTIONS.find((item) => item.id === value) ?? TOOL_SELECTOR_OPTIONS[0]!;
  return (
    <div className="fm-tool-selector" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className="small ghost icon-text"
        aria-label="Seleccionar herramienta"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Herramienta: ${current.label} (${current.shortcut})`}
        onClick={() => {
          // La toolbar tiene overflow:hidden: un menú `absolute` se recorta.
          // Se posiciona en `fixed` midiendo el disparador, y abre hacia
          // arriba si no entra debajo (igual que el menú «Más» de Timeline).
          if (!open && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const height = TOOL_SELECTOR_OPTIONS.length * 28 + 12;
            const viewportH = document.documentElement.clientHeight;
            const spaceBelow = viewportH - rect.bottom;
            setMenuPos({
              left: Math.max(8, Math.min(rect.left, document.documentElement.clientWidth - 252)),
              top:
                spaceBelow >= height + 8
                  ? rect.bottom + 2
                  : Math.max(8, rect.top - height - 2),
            });
          }
          setOpen((state) => !state);
        }}
      >
        <Icon name="grid" size={13} />
        <span className="tool-label">{current.label}</span>
        <Icon name="chevron-down" size={11} />
      </button>
      {open ? (
        <div
          className="fm-tool-selector-menu"
          role="menu"
          aria-label="Herramientas de selección"
          style={{ left: menuPos.left, top: menuPos.top }}
        >
          {TOOL_SELECTOR_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={value === item.id}
              className={value === item.id ? 'active' : ''}
              onClick={() => {
                onChange(item.id);
                setOpen(false);
              }}
            >
              <Icon name="check" size={12} />
              <span>{item.label}</span>
              <kbd>{item.shortcut}</kbd>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── 98/99 · Novedades: carrusel con imagen, lista y navegación ────────── */

export const LIVE_UPDATE_FEATURES: readonly string[] = [
  'Seguimiento de cámara',
  'Máscara de color',
  'Recuadre de vídeo inteligente',
  'Análisis multimedia con IA',
  'Corrección inteligente de color',
  'Grabación de varias fuentes',
  'Atajos de teclado',
  'Contenedor multimedia',
  'Exportación por lotes',
  'Color automático',
  'Animación combinada',
];

export function LiveUpdateFeatureList({
  activeIndex,
  onSelect,
}: {
  readonly activeIndex: number;
  readonly onSelect: (index: number) => void;
}) {
  return (
    <ol className="fm-live-update-list" aria-label="Novedades de la versión">
      {LIVE_UPDATE_FEATURES.map((label, index) => (
        <li key={label}>
          <button
            type="button"
            className={index === activeIndex ? 'active' : ''}
            aria-current={index === activeIndex ? 'true' : undefined}
            onClick={() => onSelect(index)}
          >
            {label}
          </button>
        </li>
      ))}
    </ol>
  );
}
