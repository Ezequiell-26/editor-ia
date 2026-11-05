import {memo,  lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ViewId } from '../../app/navigation';
import type { EditorModeId } from '../../app/view-routing';
import { Icon } from '../../components/Icon';
import {
  ProjectActionError,
  deleteCaptionCue,
  deleteClip,
  fpsOf,
  moveClip,
  splitClip,
  totalFrames,
  trimClip,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { useEditorPreferences } from '../../state/useEditorPreferences';
import {
  clipKeyboardAction,
  nearestCompatibleTrack,
  type ClipKeyboardAction,
} from './timeline-keyboard';
import { Preview } from './Preview';
import { Transport } from './Transport';
import { usePlayback } from './usePlayback';

const loadAssets = () =>
  import('./EditorAssets').then((module) => ({ default: module.EditorAssets }));
const loadInspector = () =>
  import('./Inspector').then((module) => ({ default: module.Inspector }));
const loadTimeline = () => import('./Timeline').then((module) => ({ default: module.Timeline }));
const loadExportDialog = () =>
  import('./ExportDialog').then((module) => ({ default: module.ExportDialog }));
const loadTextEdit = () =>
  import('../text-edit/TextEditView').then((module) => ({ default: module.TextEditView }));
const loadMulticam = () =>
  import('../multicam/MulticamView').then((module) => ({ default: module.MulticamView }));
const loadMixer = () =>
  import('../mixer/MixerView').then((module) => ({ default: module.MixerView }));
const loadVfx = () =>
  import('../vfx/VfxView').then((module) => ({ default: module.VfxView }));
const loadMotion = () =>
  import('../motion/MotionView').then((module) => ({ default: module.MotionView }));
const loadVisuals = () =>
  import('../visuals/VisualsView').then((module) => ({ default: module.VisualsView }));
const loadBrain = () =>
  import('../brain/BrainPanel').then((module) => ({ default: module.BrainPanel }));

const EditorAssets = lazy(loadAssets);
const Inspector = lazy(loadInspector);
const Timeline = lazy(loadTimeline);
const ExportDialog = lazy(loadExportDialog);
const TextEditView = lazy(loadTextEdit);
const MulticamView = lazy(loadMulticam);
const MixerView = lazy(loadMixer);
const VfxView = lazy(loadVfx);
const MotionView = lazy(loadMotion);
const VisualsView = lazy(loadVisuals);
const BrainPanel = lazy(loadBrain);

type EditorMode = EditorModeId;

const EDITOR_MODES: readonly {
  readonly id: EditorMode;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: 'timeline', label: 'Edición', hint: 'Timeline, preview e inspector' },
  { id: 'brain', label: 'Cerebro', hint: 'Mide la timeline y propone cortes con motivo' },
  { id: 'text-edit', label: 'Texto', hint: 'Transcribir y cortar desde las frases' },
  { id: 'multicam', label: 'Multicámara', hint: 'Sincronizar cámaras y cambiar de ángulo' },
  { id: 'mixer', label: 'Mezcla', hint: 'Ganancia, paneo y EQ por pista' },
  { id: 'vfx', label: 'VFX', hint: 'Nodos, rotoscopía y seguimiento' },
  { id: 'motion', label: 'Motion', hint: 'Títulos y gráficos en movimiento' },
  { id: 'visuals', label: 'Efectos', hint: 'Presets, transiciones y auditoría visual' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Reservas de layout mientras llegan los chunks de los paneles. Conservan el
 * landmark y el ancho de cada columna para que el montaje no salte.
 */
function AssetsFallback() {
  return (
    <aside
      className="asset-rail"
      aria-label="Herramientas y biblioteca del editor"
      aria-busy="true"
    >
      <div className="view-loading panel-loading" aria-hidden="true">
        <span className="view-loading-dot" />
      </div>
    </aside>
  );
}

function InspectorFallback() {
  return (
    <aside className="inspector" aria-label="Detalles" aria-busy="true">
      <div className="inspector-head">
        <h3>Detalles</h3>
      </div>
      <div className="view-loading panel-loading" aria-hidden="true">
        <span className="view-loading-dot" />
      </div>
    </aside>
  );
}

function TimelineFallback() {
  return (
    <div className="view-loading" aria-hidden="true">
      <span className="view-loading-dot" />
    </div>
  );
}

// Inspector derecho redimensionable (patrón CapCut/Filmora): el ancho se
// persiste por equipo y el divisor es accesible por puntero y teclado.
const INSPECTOR_WIDTH_KEY = 'editoria.inspector-width.v1';
// 400 px acerca el panel de propiedades al ~25 % del ancho que muestran las
// referencias de Filmora; el rango 280–560 del divisor sigue intacto.
const INSPECTOR_WIDTH_DEFAULT = 400;
const INSPECTOR_WIDTH_MIN = 280;
const INSPECTOR_WIDTH_MAX = 560;

function clampInspectorWidth(value: number): number {
  return Math.min(INSPECTOR_WIDTH_MAX, Math.max(INSPECTOR_WIDTH_MIN, Math.round(value)));
}

function readInspectorWidth(): number {
  if (typeof window === 'undefined') return INSPECTOR_WIDTH_DEFAULT;
  try {
    const stored = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampInspectorWidth(stored)
      : INSPECTOR_WIDTH_DEFAULT;
  } catch {
    return INSPECTOR_WIDTH_DEFAULT;
  }
}

export const EditorWorkspace = memo(function EditorWorkspace({
  onNavigate,
  initialMode = 'timeline',
  modeRequest = 0,
}: {
  readonly onNavigate: (id: ViewId) => void;
  readonly initialMode?: EditorModeId;
  readonly modeRequest?: number;
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const preferences = useEditorPreferences();
  const [exportOpen, setExportOpen] = useState(false);
  const [mode, setMode] = useState<EditorMode>(initialMode);
  usePlayback();

  // Ancho del panel Detalles (persistido). El drag actualiza sólo este estado:
  // el timeline no se re-renderiza por mover el divisor.
  const [inspectorWidth, setInspectorWidth] = useState<number>(readInspectorWidth);
  const inspectorDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth));
    } catch {
      // Sin almacenamiento: el ancho vale para esta sesión.
    }
  }, [inspectorWidth]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode, modeRequest]);

  useEffect(() => {
    if (!store.state.exportRequested) return;
    setExportOpen(true);
    store.consumeExportRequest();
  }, [store.state.exportRequested, store.consumeExportRequest]);

  useEffect(() => {
    /**
     * Ejecuta una acción de clip pedida por teclado (fase 2 de accesibilidad).
     * Usa las mismas acciones de dominio que el arrastre (`moveClip`,
     * `trimClip`); si la acción no se puede aplicar (pista bloqueada, hueco
     * ocupado, ventana de origen agotada) avisa por el mismo canal que el
     * mouse: el error del store o un `notice`.
     */
    const runClipKeyboardAction = (action: ClipKeyboardAction, clipId: string): void => {
      const current = store.state.project;
      if (!current) return;
      const clip = current.timeline.clips.find((item) => item.id === clipId);
      if (!clip) return;
      const owner = current.timeline.tracks.find((item) => item.id === clip.trackId);
      if (owner?.locked) {
        store.setNotice('La pista del clip está bloqueada; desbloqueala para moverla o recortarla.');
        return;
      }
      if (action.kind === 'move') {
        const target = clip.startFrame + action.deltaFrames;
        store.update((doc) => {
          const next = moveClip(doc, clipId, target);
          if (!next) {
            throw new ProjectActionError('no hay lugar libre para mover el clip a ese frame');
          }
          return next;
        });
        return;
      }
      if (action.kind === 'move-track') {
        const target = nearestCompatibleTrack(current, clip, action.direction);
        if (!target) {
          store.setNotice('No hay una pista compatible en esa dirección.');
          return;
        }
        store.update((doc) => {
          const next = moveClip(doc, clipId, clip.startFrame, target.id);
          if (!next) {
            throw new ProjectActionError(
              `no se pudo mover el clip a ${target.label}: la pista está bloqueada u ocupada en ese tramo`,
            );
          }
          return next;
        });
        return;
      }
      const target =
        action.edge === 'start'
          ? clip.startFrame + action.deltaFrames
          : clip.startFrame + clip.durationFrames + action.deltaFrames;
      store.update((doc) => {
        const next = trimClip(doc, clipId, action.edge, target);
        if (!next) {
          throw new ProjectActionError('ese recorte no es válido para la ventana de origen del clip');
        }
        return next;
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || !project) return;
      const selection = store.state.selection;
      // Fase 2 de accesibilidad: mover y recortar el clip seleccionado con el
      // teclado (Alt = mover, Ctrl+Alt = recortar). Va antes del paso del
      // playhead: con un clip seleccionado las flechas con Alt editan el clip;
      // sin selección las flechas siguen moviendo el cabezal como siempre.
      const clipAction = clipKeyboardAction(event, fpsOf(project));
      if (clipAction && selection.kind === 'clip') {
        event.preventDefault();
        runClipKeyboardAction(clipAction, selection.id);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.kind === 'clip') {
          event.preventDefault();
          let nextDuration = 0;
          store.update((current) => {
            const next = deleteClip(current, selection.id);
            nextDuration = totalFrames(next);
            return next;
          });
          store.setSelection({ kind: 'none' });
          store.setPlayhead(Math.min(store.getPlayhead(), nextDuration));
        } else if (selection.kind === 'cue') {
          event.preventDefault();
          store.update((current) => deleteCaptionCue(current, selection.id));
          store.setSelection({ kind: 'none' });
        }
      }
      if (event.key.toLowerCase() === 's' && !event.ctrlKey && !event.metaKey) {
        if (selection.kind === 'clip') {
          event.preventDefault();
          store.mutate((current) => {
            const split = splitClip(current, selection.id, store.getPlayhead());
            if (!split) throw new Error('el playhead no está dentro del clip seleccionado');
            return { project: split.project, rightClipId: split.rightClipId };
          });
        }
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        // El paso base y el paso con Shift salen de Ajustes → Editor, así que
        // se puede trabajar frame a frame o saltos largos según el proyecto.
        const step = preferences.jumpStepFrames;
        const delta = event.shiftKey ? step * 10 : step;
        store.setPlaying(false);
        store.setPlayhead(store.getPlayhead() + (event.key === 'ArrowLeft' ? -delta : delta));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project, store, preferences.jumpStepFrames]);

  if (!project) {
    return (
      <section className="view editor-empty-view">
        <div className="editor-empty-card">
          <span className="editor-empty-eyebrow">Olyvia · Estudio de edición</span>
          <div className="editor-empty-icon" aria-hidden="true">
            <Icon name="film" size={24} />
          </div>
          <h2 className="editor-empty-title">Estudio de Edición de Video</h2>
          <p className="editor-empty-desc">
            Abrí un proyecto existente o creá uno nuevo en blanco para empezar a cortar y
            componer. No hay proyectos de demostración empaquetados: todo lo que ves en la
            timeline es material que importaste vos.
          </p>
          <div className="editor-empty-actions">
            <button
              type="button"
              className="primary icon-text"
              onClick={() => void store.openProject()}
            >
              <Icon name="folder" size={15} />
              <span>Abrir proyecto</span>
            </button>
            <button
              type="button"
              className="ghost icon-text"
              onClick={() => onNavigate('projects')}
            >
              <Icon name="plus" size={15} />
              <span>Nuevo proyecto</span>
            </button>
            <button
              type="button"
              className="ghost icon-text"
              onClick={() => onNavigate('home')}
            >
              <Icon name="home" size={15} />
              <span>Volver a Inicio</span>
            </button>
          </div>
          <ul className="editor-empty-hints" aria-label="Primeros pasos del editor">
            <li className="editor-empty-hint">
              <span>01</span>
              <strong>Abrí o creá un proyecto</strong>
              <em>Elegís carpeta y formato; después importás medios.</em>
            </li>
            <li className="editor-empty-hint">
              <span>02</span>
              <strong>Armá la timeline</strong>
              <em>Montá medios, recortá y dividí con S.</em>
            </li>
            <li className="editor-empty-hint">
              <span>03</span>
              <strong>Exportá verificado</strong>
              <em>Render MP4 con FFmpeg y control de calidad.</em>
            </li>
          </ul>
        </div>
      </section>
    );
  }

  const fps = fpsOf(project);
  const modeInfo = EDITOR_MODES.find((item) => item.id === mode) ?? EDITOR_MODES[0]!;

  function navigateFromMode(id: ViewId): void {
    if (id === 'editor') {
      setMode('timeline');
      return;
    }
    onNavigate(id);
  }

  const modeContent =
    mode === 'text-edit' ? (
      <TextEditView onNavigate={navigateFromMode} />
    ) : mode === 'multicam' ? (
      <MulticamView onNavigate={navigateFromMode} />
    ) : mode === 'mixer' ? (
      <MixerView onNavigate={navigateFromMode} />
    ) : mode === 'vfx' ? (
      <VfxView onNavigate={navigateFromMode} />
    ) : mode === 'motion' ? (
      <MotionView onNavigate={navigateFromMode} />
    ) : mode === 'visuals' ? (
      <VisualsView onNavigate={navigateFromMode} />
    ) : mode === 'brain' ? (
      <BrainPanel />
    ) : null;

  return (
    <section className="editor-workspace">
      <nav className="editor-mode-tabs" role="tablist" aria-label="Modos de edición">
        {EDITOR_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            className={`editor-mode-tab${mode === item.id ? ' active' : ''}`}
            data-tooltip={item.hint}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div
        className={`editor-grid${mode !== 'timeline' ? ' editor-mode-active' : ''}`}
        style={{ '--inspector-width': `${inspectorWidth}px` } as CSSProperties}
      >
        {mode === 'timeline' ? (
          <>
            <Suspense fallback={<AssetsFallback />}>
              <EditorAssets onNavigate={onNavigate} />
            </Suspense>
            <div className="preview-panel" data-tour="preview">
              <Preview />
              <Transport />
            </div>
            <div
              className="editor-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label="Cambiar el ancho del panel Detalles"
              aria-valuemin={INSPECTOR_WIDTH_MIN}
              aria-valuemax={INSPECTOR_WIDTH_MAX}
              aria-valuenow={inspectorWidth}
              tabIndex={0}
              title="Arrastrá para cambiar el ancho de Detalles · doble clic para restablecer"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                inspectorDragRef.current = { startX: event.clientX, startWidth: inspectorWidth };
                document.body.classList.add('inspector-resizing');
                const move = (pointer: PointerEvent): void => {
                  const drag = inspectorDragRef.current;
                  if (!drag) return;
                  setInspectorWidth(
                    clampInspectorWidth(drag.startWidth - (pointer.clientX - drag.startX)),
                  );
                };
                const up = (): void => {
                  inspectorDragRef.current = null;
                  document.body.classList.remove('inspector-resizing');
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                  window.removeEventListener('pointercancel', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
                window.addEventListener('pointercancel', up);
              }}
              onDoubleClick={() => setInspectorWidth(INSPECTOR_WIDTH_DEFAULT)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  setInspectorWidth((width) => clampInspectorWidth(width + 16));
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  setInspectorWidth((width) => clampInspectorWidth(width - 16));
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  setInspectorWidth(INSPECTOR_WIDTH_DEFAULT);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  setInspectorWidth(INSPECTOR_WIDTH_MAX);
                }
              }}
            />
            <Suspense fallback={<InspectorFallback />}>
              <Inspector />
            </Suspense>
          </>
        ) : (
          <div className="editor-mode-panel" role="tabpanel" aria-label={modeInfo.label}>
            <Suspense fallback={<TimelineFallback />}>{modeContent}</Suspense>
          </div>
        )}
        <div className="timeline-panel" data-tour="timeline">
          <div className="timeline-tabs" role="tablist" aria-label="Secuencias de la timeline">
            <button
              type="button"
              role="tab"
              aria-selected="true"
              className="active"
              title="Secuencia principal del proyecto"
            >
              Timeline 01
            </button>
            <span className="timeline-tabs-meta">
              {project.name} · {(totalFrames(project) / fps).toFixed(1)} s
            </span>
          </div>
          <Suspense fallback={<TimelineFallback />}>
            <Timeline />
          </Suspense>
        </div>
      </div>

      {exportOpen ? (
        <Suspense fallback={null}>
          <ExportDialog open onClose={() => setExportOpen(false)} />
        </Suspense>
      ) : null}
    </section>
  );
});
