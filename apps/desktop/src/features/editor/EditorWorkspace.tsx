import { lazy, Suspense, useEffect, useState } from 'react';
import type { ViewId } from '../../app/navigation';
import type { EditorModeId } from '../../app/view-routing';
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
import { updateEditorPreferences } from '../../state/editor-preferences';
import { PanelSplitter } from './PanelSplitter';
import {
  clampStudioWidth,
  studioGridClasses,
  studioGridStyle,
  studioLayoutFromPreferences,
  type StudioFocus,
} from './studio-layout';
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

type EditorMode = EditorModeId;

const EDITOR_MODES: readonly {
  readonly id: EditorMode;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: 'timeline', label: 'Edición', hint: 'Timeline, preview e inspector' },
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

export function EditorWorkspace({
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
  const [liveLayout, setLiveLayout] = useState<{
    leftWidth?: number;
    rightWidth?: number;
    timelineHeight?: number;
  }>({});
  const [focus, setFocus] = useState<StudioFocus>('none');
  const [drawers, setDrawers] = useState({ left: false, right: false });
  const [narrow, setNarrow] = useState(false);
  const [mode, setMode] = useState<EditorMode>(initialMode);
  usePlayback();

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
          store.setPlayhead(Math.min(store.state.playheadFrame, nextDuration));
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
            const split = splitClip(current, selection.id, store.state.playheadFrame);
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
        store.setPlayhead(store.state.playheadFrame + (event.key === 'ArrowLeft' ? -delta : delta));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project, store, preferences.jumpStepFrames]);

  if (!project) {
    return (
      <section className="view">
        <p className="empty-state">
          No hay proyecto abierto. Creá o abrí un proyecto para editar. La timeline no inventa
          pistas ni clips: aparece vacía hasta que montás un medio.
        </p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onNavigate('projects')}>
            Ir a Proyectos
          </button>
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
    ) : null;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 999px)');
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const baseLayout = studioLayoutFromPreferences(preferences);
  const layout = { ...baseLayout, ...liveLayout };

  function setPanelSize(kind: 'left' | 'right' | 'timeline', value: number): void {
    const key = kind === 'left' ? 'leftWidth' : kind === 'right' ? 'rightWidth' : 'timelineHeight';
    setLiveLayout((current) => ({ ...current, [key]: value }));
  }

  function commitPanelSize(kind: 'left' | 'right' | 'timeline', value: number): void {
    const key = kind === 'left' ? 'leftWidth' : kind === 'right' ? 'rightWidth' : 'timelineHeight';
    setLiveLayout((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    updateEditorPreferences(
      kind === 'left'
        ? { studioLeftWidth: value }
        : kind === 'right'
          ? { studioRightWidth: value }
          : { studioTimelineHeight: value },
    );
  }

  function togglePanel(kind: 'left' | 'right' | 'timeline'): void {
    setFocus('none');
    if (narrow && kind !== 'timeline') {
      setDrawers((current) => ({ ...current, [kind]: !current[kind] }));
      return;
    }
    updateEditorPreferences(
      kind === 'left'
        ? { studioLeftCollapsed: !baseLayout.leftCollapsed }
        : kind === 'right'
          ? { studioRightCollapsed: !baseLayout.rightCollapsed }
          : { studioTimelineCollapsed: !baseLayout.timelineCollapsed },
    );
  }

  function resetStudioLayout(): void {
    setLiveLayout({});
    setFocus('none');
    setDrawers({ left: false, right: false });
    updateEditorPreferences({
      studioLeftWidth: 320,
      studioRightWidth: 340,
      studioTimelineHeight: 285,
      studioLeftCollapsed: false,
      studioRightCollapsed: false,
      studioTimelineCollapsed: false,
    });
  }

  return (
    <section className="editor-workspace">
      {/* Una sola franja superior: los modos a la izquierda y el control del
          layout a la derecha. Antes eran dos filas de 32 px cada una. */}
      <div className="editor-top-strip">
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
      {mode === 'timeline' ? (
      <div className="studio-layout-tools" role="toolbar" aria-label="Diseño del Studio">
        <button
          type="button"
          className="studio-layout-tool"
          aria-pressed={narrow ? drawers.left : !layout.leftCollapsed}
          onClick={() => togglePanel('left')}
          title="Mostrar u ocultar la biblioteca de medios"
        >
          Medios
        </button>
        <button
          type="button"
          className="studio-layout-tool"
          aria-pressed={narrow ? drawers.right : !layout.rightCollapsed}
          onClick={() => togglePanel('right')}
          title="Mostrar u ocultar el inspector"
        >
          Inspector
        </button>
        <button
          type="button"
          className="studio-layout-tool"
          aria-pressed={!layout.timelineCollapsed}
          onClick={() => togglePanel('timeline')}
          title="Mostrar u ocultar la timeline"
        >
          Timeline
        </button>
        <span className="studio-layout-separator" aria-hidden="true" />
        <button
          type="button"
          className="studio-layout-tool"
          aria-pressed={focus === 'viewer'}
          onClick={() => setFocus((current) => (current === 'viewer' ? 'none' : 'viewer'))}
          title="Maximizar el visor"
        >
          Visor ampliado
        </button>
        <button
          type="button"
          className="studio-layout-tool"
          aria-pressed={focus === 'timeline'}
          onClick={() => setFocus((current) => (current === 'timeline' ? 'none' : 'timeline'))}
          title="Maximizar la timeline"
        >
          Timeline ampliada
        </button>
        <button
          type="button"
          className="studio-layout-tool ghost"
          onClick={resetStudioLayout}
          title="Restaurar la distribución predeterminada"
        >
          Restablecer
        </button>
      </div>
      ) : null}
      </div>
      <div
        className={`${studioGridClasses(layout, focus, drawers)}${mode !== 'timeline' ? ' editor-mode-active' : ''}`}
        style={studioGridStyle(layout, focus)}
      >
        {mode === 'timeline' ? (
          <>
            <Suspense fallback={<AssetsFallback />}>
              <EditorAssets onNavigate={onNavigate} />
            </Suspense>
            <div className="preview-panel">
              <Preview />
              <Transport />
            </div>
            <Suspense fallback={<InspectorFallback />}>
              <Inspector />
            </Suspense>
          </>
        ) : (
          <div className="editor-mode-panel" role="tabpanel" aria-label={modeInfo.label}>
            <Suspense fallback={<TimelineFallback />}>{modeContent}</Suspense>
          </div>
        )}
        <div className="timeline-panel">
          <div className="timeline-tabs">
            <span className="timeline-tab-static" title="Secuencia principal del proyecto">
              Timeline 01
            </span>
            <span className="timeline-tabs-meta">
              {project.name} · {(totalFrames(project) / fps).toFixed(1)} s
            </span>
          </div>
          <Suspense fallback={<TimelineFallback />}>
            <Timeline />
          </Suspense>
        </div>
        {mode === 'timeline' && focus === 'none' && !narrow ? (
          <>
            {!layout.leftCollapsed ? (
              <PanelSplitter
                axis="x"
                side="left"
                value={layout.leftWidth}
                min={180}
                max={520}
                label="Ancho de la biblioteca de medios"
                onChange={(value) => setPanelSize('left', value)}
                onCommit={(value) => commitPanelSize('left', clampStudioWidth('left', value))}
                onReset={() => commitPanelSize('left', 320)}
              />
            ) : null}
            {!layout.rightCollapsed ? (
              <PanelSplitter
                axis="x"
                side="right"
                invert
                value={layout.rightWidth}
                min={220}
                max={520}
                label="Ancho del inspector"
                onChange={(value) => setPanelSize('right', value)}
                onCommit={(value) => commitPanelSize('right', clampStudioWidth('right', value))}
                onReset={() => commitPanelSize('right', 340)}
              />
            ) : null}
            {!layout.timelineCollapsed ? (
              <PanelSplitter
                axis="y"
                invert
                value={layout.timelineHeight}
                min={120}
                max={520}
                label="Altura de la timeline"
                onChange={(value) => setPanelSize('timeline', value)}
                onCommit={(value) => commitPanelSize('timeline', clampStudioWidth('timeline', value))}
                onReset={() => commitPanelSize('timeline', 285)}
              />
            ) : null}
          </>
        ) : null}
      </div>

      {exportOpen ? (
        <Suspense fallback={null}>
          <ExportDialog open onClose={() => setExportOpen(false)} />
        </Suspense>
      ) : null}
    </section>
  );
}
