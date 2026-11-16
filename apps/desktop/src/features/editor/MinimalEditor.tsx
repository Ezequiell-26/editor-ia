import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { Clip, ProjectDocument } from '@editor-ia/project-schema';
import type { DesktopService } from '../../services/project-service';
import { Icon } from '../../components/Icon';
import { WindowControls } from '../../components/WindowControls';
import { HistoryDialog } from './HistoryDialog';
import { useThumbnail } from '../../hooks/useThumbnail';
import {
  useProjectClips,
  useProjectPlayback,
  useProjectStore,
} from '../../state/project-store';
import {
  MEDIA_ITEMS, PRODUCT, clock,
  type Scene,
} from './minimal/model';
import { MonitorPanel } from './minimal/MonitorPanel';
import { MonitorVideo } from './minimal/MonitorVideo';
import {
  AvatarMeter, FeedbackBar, PlaybackBar, ProgressDialog, SceneNav, TutorialBanner,
} from './minimal/Floating';
import { ActionToast, ConsentDialog } from './minimal/Overlays';
import {
  useMinimalEditorActions, type MinimalEditorCallbacks,
} from './minimal/useMinimalEditorActions';
import { isHarnessHost } from './minimal/editor-actions';
import { usePlayback } from './usePlayback';
import { previewTransitionLeadFrames } from './preview-transition';

const ExportDialog = lazy(() =>
  import('./ExportDialog').then((module) => ({ default: module.ExportDialog })),
);

// UN SOLO EDITOR · la timeline del shell mínimo es la Timeline productiva
// real (split/trim/snapping/zoom/pistas propios, store compartido) — la
// réplica `minimal/TimelinePanel` queda sólo para sus tests, ya no se monta.
const Timeline = lazy(() =>
  import('./Timeline').then((module) => ({ default: module.Timeline })),
);

// UN SOLO EDITOR · el panel de detalles del shell mínimo es el Inspector
// productivo real (clip/track/cue/asset/scene/proyecto, mismas keys que el
// workspace). La réplica `minimal/InspectorPanel` queda sólo para sus tests.
const Inspector = lazy(() =>
  import('./Inspector').then((module) => ({ default: module.Inspector })),
);

// UN SOLO EDITOR · la biblioteca del shell mínimo es el rail de assets
// productivo real (importación, bins, búsqueda, efectos, stickers, títulos,
// proxies). La réplica `minimal/LibraryPanel` queda sólo para sus tests.
const EditorAssets = lazy(() =>
  import('./EditorAssets').then((module) => ({ default: module.EditorAssets })),
);

/**
 * Réplica visual del frente de AlaukCut. La geometría, la paleta y los textos
 * se mantienen medidos sobre las capturas de referencia; el ESTADO y los
 * CONTROLES ya no son una maqueta: consumen el store real del proyecto,
 * importan archivos de verdad y ejecutan las acciones puras del editor.
 *
 * El selector de escenas (`SceneNav`) y `?scene=` quedan acotados al arnés de
 * verificación en localhost: la app empaquetada arranca con el estado real.
 */

export type MinimalEditorProps = MinimalEditorCallbacks;

const MENU_ITEMS = ['Arquivo', 'Versão', 'Atualização', 'Configurações', 'Ajuda'] as const;

const SCENE_IDS: readonly Scene[] = ['empty', 'media', 'captions', 'studio'];

/** Clip visible en el frame del playhead; si ninguno cubre, el último que empieza antes. */
function clipAtFrame(project: ProjectDocument, frame: number): Clip | null {
  const list = project.timeline.clips;
  let covering: Clip | null = null;
  let before: Clip | null = null;
  for (const clip of list) {
    if (clip.startFrame <= frame && frame < clip.startFrame + clip.durationFrames) {
      covering = clip;
    }
    if (clip.startFrame <= frame && (!before || clip.startFrame > before.startFrame)) {
      before = clip;
    }
  }
  return covering ?? before ?? list[list.length - 1] ?? null;
}

/**
 * UI-002: frame REAL del monitor — compone la timeline en el playhead con
 * `renderPreviewFrame` (el mismo renderer del Preview principal, con caché
 * en Rust). Debounced 300 ms y pausado durante la reproducción para no
 * lanzar FFmpeg por cada rAF; al pausar o buscar se actualiza el cuadro.
 */
function useMonitorFrame(
  service: DesktopService,
  project: ProjectDocument | null,
  frame: number,
  playing: boolean,
  enabled = true,
): string | null {
  const [src, setSrc] = useState<string | null>(null);
  // En reproducción el monitor avanza ~1 vez por segundo de timeline en
  // vez de congelarse: un render compuesto por frame saturaría FFmpeg.
  const fps = project
    ? project.video.frameRate.num / project.video.frameRate.den
    : 30;
  const second = Math.max(1, Math.round(fps));
  const renderFrame = playing
    ? Math.floor(frame / second) * second
    : frame;
  useEffect(() => {
    // Con el <video> en vivo tapando el monitor, renderizar el frame
    // compuesto sería FFmpeg gastado a escondidas.
    if (!enabled) return;
    if (!project || project.timeline.clips.length === 0) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const clip = clipAtFrame(project, renderFrame);
      if (!clip) {
        if (!cancelled) setSrc(null);
        return;
      }
      service
        .renderPreviewFrame({
          project,
          clipId: clip.id,
          frame: renderFrame,
          composite: true,
        })
        .then((result) => {
          if (!cancelled) setSrc(service.absoluteFileUrl(result.path));
        })
        .catch(() => {
          if (!cancelled) setSrc(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [service, project, renderFrame, playing, enabled]);
  return src;
}

const IS_HARNESS = typeof window !== 'undefined' && isHarnessHost(window.location.hostname);

const BOOT = (() => {
  const params = IS_HARNESS ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const requested = params.get('scene');
  const scene = SCENE_IDS.find((id) => id === requested) ?? 'empty';
  return {
    scene,
    selectedId: scene === 'studio' ? 'video' : 'menino',
  };
})();

export const MinimalEditor = memo(function MinimalEditor(props: MinimalEditorProps) {
  const store = useProjectStore();
  const project = store.state.project;
  const clips = useProjectClips();
  const playback = useProjectPlayback();
  // UI-001: el motor es un singleton a nivel módulo (usePlayback.ts) —
  //MinimalEditor y EditorWorkspace comparten UN solo rAF aunque ambos
  // estén montados; el último en desmontar suelta el bucle.
  usePlayback();

  const [scene, setScene] = useState<Scene>(BOOT.scene);
  const [selectedId, setSelectedId] = useState<string | null>(BOOT.selectedId);
  const [exportOpen, setExportOpen] = useState(false);
  const [showProgress, setShowProgress] = useState(IS_HARNESS && BOOT.scene === 'captions');
  const [showTutorial, setShowTutorial] = useState(IS_HARNESS && BOOT.scene === 'captions');
  const [historyOpen, setHistoryOpen] = useState(false);

  const callbacks = useMemo<MinimalEditorCallbacks>(() => ({
    onNavigate: props.onNavigate,
    onOpenShortcuts: props.onOpenShortcuts,
    onOpenTour: props.onOpenTour,
    onOpenHistory: () => setHistoryOpen(true),
    onOpenAssistant: () => props.onNavigate?.('ai-hub'),
  }), [props.onNavigate, props.onOpenShortcuts, props.onOpenTour]);

  const actions = useMinimalEditorActions(callbacks);

  const fps = project ? project.video.frameRate.num / project.video.frameRate.den : 30;
  const projectName = project?.name ?? '0919';
  const width = project?.video.width ?? 1920;
  const height = project?.video.height ?? 1080;
  const assets = project?.assets ?? [];

  // Con material real, la biblioteca abandona el empty-state por sí sola.
  useEffect(() => {
    if (assets.length > 0 && scene === 'empty') setScene('media');
  }, [assets.length, scene]);

  const changeScene = useCallback((next: Scene) => {
    if (!IS_HARNESS) return;
    setScene(next);
    setShowProgress(next === 'captions');
    setShowTutorial(next === 'captions');
    // P4/P5: ni el Inspector ni el rail de assets tienen tabs de escena —
    // la escena sólo gobierna monitor del arnés.
    if (next === 'media') { setSelectedId('menino'); }
    if (next === 'studio') { setSelectedId('video'); }
  }, []);

  const timecode = clock(playback.frame, fps);
  const duration = clock(store.durationFrames, fps);

  const saveState = useMemo(() => {
    switch (store.state.phase) {
      case 'saved':
        return `✓ Salvo automaticamente: ${new Date().toLocaleTimeString('pt-BR')}`;
      case 'saving': return 'Salvando…';
      case 'dirty': return 'Alterações não salvas';
      case 'failed': return 'Falha ao salvar';
      default: return '';
    }
  }, [store.state.phase, store.state.lastSavedAt]);

  const togglePlay = useCallback(() => { store.setPlaying(!store.getPlaying()); }, [store]);
  const stop = useCallback(() => { store.setPlaying(false); store.setPlayhead(0); }, [store]);
  const selectedAsset = assets.find((asset) => asset.id === selectedId) ?? null;
  // P4: el Inspector productivo lee store.selection directamente — el
  // puente clipTransform/commitTransform de la réplica ya no hace falta.
  const realThumb = useThumbnail(store.service, selectedAsset, store.state.opened?.root ?? null);
  // UI-001/UI-002: durante la reproducción el monitor muestra el VIDEO
  // EN VIVO del clip bajo el playhead (sin reverse ni speedCurve — la
  // velocidad sí se reproduce vía playbackRate; shuttle inverso y esos
  // casos siguen con el frame compuesto estático).
  // Fuera de Tauri `mediaUrl` devuelve '' y cae al frame estático.
  const liveMonitor = useMemo(() => {
    // El shuttle inverso mueve el playhead hacia atrás y el <video> no
    // puede reproducir en reversa: ese caso queda en frame compuesto.
    if (!playback.playing || playback.direction !== 1 || !project) return null;
    // Durante una transición (solape de `transitionIn`) el compuesto
    // mezcla dos clips — el video de uno solo mentiría. Fuera de la
    // ventana de lead se puede mostrar el clip que cubre.
    const inTransition = project.timeline.clips.some((entry) => {
      const lead = previewTransitionLeadFrames(entry, fps);
      return (
        lead > 0 &&
        playback.frame >= entry.startFrame - lead &&
        playback.frame < entry.startFrame
      );
    });
    if (inTransition) return null;
    // Sólo si un clip CUBRE el playhead: en un hueco `clipAtFrame` devuelve
    // el anterior y el video mostraría material que no está en pantalla.
    const clip = project.timeline.clips.find(
      (entry) =>
        entry.startFrame <= playback.frame &&
        playback.frame < entry.startFrame + entry.durationFrames,
    );
    if (!clip || clip.kind !== 'video') return null;
    if (clip.reverse === true || clip.speedCurve) return null;
    if (clip.source.type !== 'asset') return null;
    const asset = project.assets.find((entry) => entry.id === clip.source.assetId);
    const root = store.state.opened?.root;
    if (!asset || !root) return null;
    // Proxy aplicado = mismo medio a menor resolución: decode más barato
    // en el monitor en vivo (mismo criterio que Preview).
    const proxyPath =
      'proxy' in asset && asset.proxy && typeof asset.proxy === 'object'
        ? (asset.proxy as { path?: unknown }).path
        : undefined;
    const mediaPath =
      typeof proxyPath === 'string' && proxyPath.length > 0
        ? proxyPath
        : asset.source.path;
    const url = store.service.mediaUrl(root, mediaPath);
    return url ? { clip, url } : null;
  }, [playback.playing, playback.direction, playback.frame, project, store, fps]);
  // Con el <video> en vivo tapando el monitor no tiene sentido gastar
  // renders compuestos: el frame pausado se sigue pidiendo al pausar.
  const monitorFrame = useMonitorFrame(
    store.service,
    project,
    playback.frame,
    playback.playing,
    liveMonitor === null,
  );
  const monitorSrc = useMemo(() => {
    // UI-002: el frame compuesto real manda; después la miniatura del
    // asset seleccionado; las imágenes de `public/alaukcut/` son material
    // de demostración y sólo tienen sentido en el arnés de verificación.
    if (monitorFrame) return monitorFrame;
    if (realThumb) return realThumb;
    if (!IS_HARNESS) return null;
    if (scene === 'empty' || scene === 'studio') return null;
    if (scene === 'captions') return './alaukcut/media-green-boy.png';
    const item = MEDIA_ITEMS.find((entry) => entry.id === selectedId);
    return item?.monitor ?? './alaukcut/media-green-boy.png';
  }, [monitorFrame, realThumb, scene, selectedId]);

  // P5: el rail de assets productivo (EditorAssets) se encarga de
  // importar/insertar — el addToTitle de la réplica ya no hace falta.


  const isStudio = scene === 'studio';
  const isTutorial = showTutorial;

  return (
    <div className={`editor-workspace minimal-editor me-scene-${scene}`} data-minimal-editor="true">
      {/* ── Barra superior (32px) ─────────────────────────────────────── */}
      <div className="me-topbar">
        {isTutorial ? <TutorialBanner /> : (
          <>
            <div className={`me-topbar-left${isStudio ? ' me-menubar' : ''}`}>
              <span className="me-brand-mark" aria-hidden="true">AC</span>
              {isStudio ? (
                MENU_ITEMS.map((item) => (
                  <button type="button" key={item} className="me-menu-item" onClick={() => actions.runLabel(item)}>
                    {item}
                  </button>
                ))
              ) : (
                <>
                  <span className="me-brand">{PRODUCT}</span>
                  <button
                    type="button"
                    className="me-projects-btn"
                    onClick={() => actions.runLabel('Projetos')}
                  >
                    <Icon name="folder" size={11} /> Projetos
                  </button>
                  <span className="me-save-state">{isStudio ? '' : saveState}</span>
                </>
              )}
            </div>
            <span className={`me-topbar-project${isStudio ? ' with-sub' : ''}`}>
              {isStudio ? 'Demo Michelle' : projectName}
              {isStudio ? <small>● Salvo agora</small> : null}
            </span>
          </>
        )}
        <div className="me-topbar-right">
          <button type="button" className="me-icon-btn" aria-label="Layout" title="Ajustes de apariencia" onClick={() => actions.runLabel('Layout')}>
            <Icon name="grid" size={12} />
          </button>
          {isStudio ? (
            <button type="button" className="me-icon-btn" aria-label="Histórico" title="Historial" onClick={() => actions.runLabel('Histórico')}>
              <Icon name="refresh" size={12} />
            </button>
          ) : null}
          <button type="button" className="me-text-btn" onClick={() => actions.runLabel('Edição automática')}>
            <Icon name="sparkles" size={12} /> Edição automática
          </button>
          <button type="button" className="me-text-btn" onClick={() => actions.runLabel('Atalhos')}>
            <Icon name="keyboard" size={12} /> Atalhos
          </button>
          <button
            type="button"
            className="me-export"
            aria-label="Exportar"
            title="Exportar"
            onClick={() => setExportOpen(true)}
          >
            <Icon name="export" size={12} /> Exportar
          </button>
          <WindowControls />
        </div>
      </div>

      {/* ── Cuerpo: tres columnas ─────────────────────────────────────── */}
      <div className="me-body">
        {/* P5 · UN SOLO EDITOR: el rail de assets productivo real en la
            columna izquierda del shell mínimo (misma tienda de medios,
            efectos, stickers y títulos que el workspace). */}
        <div className="me-library">
          <Suspense fallback={null}>
            <EditorAssets onNavigate={(id) => props.onNavigate?.(id)} />
          </Suspense>
        </div>

        <MonitorPanel
          scene={scene}
          monitorSrc={monitorSrc}
          liveVideo={liveMonitor ? (
            <MonitorVideo
              clip={liveMonitor.clip}
              url={liveMonitor.url}
              fps={fps}
              frame={playback.frame}
              playing={playback.playing}
              rate={playback.rate}
            />
          ) : null}
          playing={playback.playing}
          onTogglePlay={togglePlay}
          onStop={stop}
          timecode={timecode}
          duration={duration}
          aspect="16:9"
          onTool={actions.runLabel}
        />

        {/* P4 · UN SOLO EDITOR: el Inspector productivo real en la columna
            derecha del shell mínimo (clip/track/cue/asset/proyecto según
            store.selection). «Pedir ao assistente» navega al modo ai-hub
            del mismo editor — no hay segundo panel de chat. */}
        <div className="me-inspector">
          <Suspense fallback={null}>
            <Inspector />
          </Suspense>
          <button
            type="button"
            className="me-assistant"
            onClick={() => props.onNavigate?.('ai-hub')}
          >
            <span className="me-dot" /> Pedir ao assistente
          </button>
        </div>
      </div>

      {/* ── Timeline · UN SOLO EDITOR: la Timeline productiva real, no la
          réplica. Lee/escribe el mismo store (clips, selección, playhead,
          zoom, snapping); sus estilos vienen del CSS del editor ya cargado
          para esta vista. */}
      <div className="me-timeline-real">
        <Suspense fallback={null}>
          <Timeline />
        </Suspense>
      </div>

      {/* ── Pie negro ─────────────────────────────────────────────────── */}
      <div className="me-footer">
        {IS_HARNESS ? (
          <SceneNav scene={scene} onScene={changeScene} />
        ) : (
          <span className="me-footer-status">
            {assets.length} {assets.length === 1 ? 'material' : 'materiales'} · {clips.length} {clips.length === 1 ? 'clip' : 'clips'}
            {actions.snapEnabled ? ' · imán activo' : ''}
          </span>
        )}
        <span className="me-watermark">AC</span>
      </div>

      {/* ── Capas flotantes (sólo arnés / estados medidos) ─────────────── */}
      {isTutorial ? <PlaybackBar /> : null}
      {isTutorial ? <FeedbackBar /> : null}
      {isStudio && IS_HARNESS ? <AvatarMeter /> : null}
      {showProgress && scene === 'captions' ? <ProgressDialog onCancel={() => setShowProgress(false)} /> : null}

      {actions.consentOpen ? (
        <ConsentDialog onConfirm={actions.confirmImport} onCancel={actions.cancelImport} />
      ) : null}
      {actions.notice ? (
        <ActionToast message={actions.notice} onDismiss={actions.dismissNotice} />
      ) : null}
      {historyOpen ? <HistoryDialog onClose={() => setHistoryOpen(false)} /> : null}

      {exportOpen ? (
        <Suspense fallback={null}>
          <ExportDialog open onClose={() => setExportOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  );
});
