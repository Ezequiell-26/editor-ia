import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useProjectStore } from '../../state/project-store';
import {
  addQueueFinal,
  applyQueueAction,
  batchReadyForFinalize,
  enqueueScenes,
  loadRenderQueue,
  markQueueItemCompleted,
  markQueueItemFailed,
  markQueueItemRunning,
  newBatchId,
  nextQueuedItem,
  saveRenderQueue,
  type RenderQueueAction,
  type RenderQueueItem,
  type RenderQueueState,
} from '../../state/scene-render-queue';
import { createAssistantToolHost } from '../assistant/assistant-host';
import {
  setRenderQueueApi,
  type RenderQueueSnapshot,
} from '../assistant/render-queue-bridge';

export interface RenderQueueContextValue {
  readonly state: RenderQueueState;
  readonly running: boolean;
  addScenes(sceneIds: readonly string[], includeCaptions?: boolean, concat?: boolean): string[];
  pause(): void;
  resume(): void;
  cancel(id?: string): void;
  clearFinished(): void;
}

const RenderQueueContext = createContext<RenderQueueContextValue | null>(null);

export function useRenderQueue(): RenderQueueContextValue | null {
  return useContext(RenderQueueContext);
}

function snapshotOf(state: RenderQueueState): RenderQueueSnapshot {
  const running = state.items.find((item) => item.status === 'running');
  return {
    paused: state.paused,
    runningId: running?.id ?? null,
    items: state.items,
    finals: state.finals,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Ejecuta la cola de escenas de a una. El segmento de cada escena ya es
 * reanudable; si la app se cierra, los trabajos “running” vuelven a “queued” al
 * cargar y el siguiente arranque los reutiliza o regenera.
 */
export function RenderQueueProvider({ children }: { readonly children: ReactNode }) {
  const store = useProjectStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const [state, setState] = useState<RenderQueueState>(() => loadRenderQueue());
  const stateRef = useRef(state);
  stateRef.current = state;
  const [running, setRunning] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  const commit = useCallback((next: RenderQueueState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    saveRenderQueue(state);
  }, [state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const root = store.state.opened?.root ?? null;

  const addScenes = useCallback(
    (sceneIds: readonly string[], includeCaptions = false, concat = false): string[] => {
      const current = storeRef.current;
      const project = current.state.project;
      const projectRoot = current.state.opened?.root;
      if (!project || !projectRoot) throw new Error('no hay un proyecto abierto');
      const wanted = new Set(sceneIds);
      const scenes = project.scenes
        .filter((scene) => wanted.has(scene.id))
        .map((scene) => ({ id: scene.id, title: scene.title }));
      if (scenes.length === 0) throw new Error('ninguna escena existe en el proyecto');
      const outcome = enqueueScenes(stateRef.current, {
        projectRoot,
        scenes,
        includeCaptions,
        ...(concat ? { batchId: newBatchId() } : {}),
      });
      commit(outcome.state);
      return outcome.addedIds;
    },
    [commit],
  );

  const control = useCallback(
    (action: RenderQueueAction, id?: string) => {
      const next = applyQueueAction(stateRef.current, action, id);
      commit(next);
      return snapshotOf(next);
    },
    [commit],
  );

  const pause = useCallback(() => control('pause'), [control]);
  const resume = useCallback(() => control('resume'), [control]);
  const cancel = useCallback((id?: string) => control('cancel', id), [control]);
  const clearFinished = useCallback(() => control('clear-finished'), [control]);

  useEffect(() => {
    setRenderQueueApi({
      add: async (input) => ({
        ids: addScenes(input.sceneIds, input.includeCaptions, input.concat === true),
        snapshot: snapshotOf(stateRef.current),
      }),
      status: () => snapshotOf(stateRef.current),
      control: (action, id) => control(action, id),
    });
    return () => setRenderQueueApi(null);
  }, [addScenes, control]);

  // Bucle serial: un render de escena a la vez, respetando un render activo.
  useEffect(() => {
    if (!root || state.paused || busyRef.current) return;
    const item = nextQueuedItem(state, root);
    if (!item) return;
    busyRef.current = true;
    setRunning(true);
    void (async () => {
      let failure: string | null = null;
      commit(markQueueItemRunning(stateRef.current, item.id));
      try {
        for (let guard = 0; guard < 600; guard += 1) {
          const active = await storeRef.current.service.activeRender();
          if (!active) break;
          await sleep(2000);
          if (!mountedRef.current) return;
        }
        if (storeRef.current.state.opened?.root !== item.projectRoot) {
          commit(
            applyQueueAction(stateRef.current, 'pause'),
          );
          return;
        }
        const hostForQueue = () =>
          createAssistantToolHost({
            store: storeRef.current,
            view: () => 'production',
            navigate: () => undefined,
            renderEvents: {
              progress: () => null,
              finished: () => null,
            },
          });
        const finalizeBatch = async (batchId?: string) => {
          if (!batchId) return;
          const items = batchReadyForFinalize(stateRef.current, batchId);
          if (!items) return;
          const outputs = items.map((entry) => entry.outputPath!).filter(Boolean);
          if (outputs.length < 2) return;
          try {
            const concatenated = await hostForQueue().concatVideos(outputs);
            if (!concatenated) return;
            commit(
              addQueueFinal(stateRef.current, {
                batchId,
                projectRoot: item.projectRoot,
                outputPath: concatenated.outputPath,
                bytes: concatenated.bytes,
                durationSeconds: concatenated.durationSeconds,
                createdAt: new Date().toISOString(),
              }),
            );
          } catch {
            // El concat no debe tumbar la cola; los segmentos quedan listos.
          }
        };
        const host = hostForQueue();
        const result = host.renderSceneSegmentChunked
          ? await host.renderSceneSegmentChunked({
              sceneId: item.sceneId,
              includeCaptions: item.includeCaptions,
            })
          : await host.renderSceneSegment({
              sceneId: item.sceneId,
              includeCaptions: item.includeCaptions,
            });
        if (!result) throw new Error('la escena no tiene clips o no se pudo renderizar');
        let bytes = result.bytes;
        if (!result.skipped) {
          // `renderSceneSegment` inicia el job y vuelve; la cola debe esperar a
          // que FFmpeg cierre el archivo antes de pasar a la escena siguiente.
          let idle = 0;
          let info: { exists: boolean; bytes: number } | null = null;
          for (let attempt = 0; attempt < 600; attempt += 1) {
            const active = await storeRef.current.service.activeRender();
            if (!active) {
              info = await storeRef.current.service.fileInfo(result.outputPath);
              if (info.exists && info.bytes > 0) break;
              idle += 1;
              if (idle >= 3) break;
            } else {
              idle = 0;
            }
            await sleep(1000);
            if (!mountedRef.current) return;
          }
          if (!info?.exists || info.bytes <= 0) {
            throw new Error('el render de la escena no dejó un archivo utilizable');
          }
          bytes = info.bytes;
        }
        const project = storeRef.current.state.project;
        const fps = project ? project.video.frameRate.num / project.video.frameRate.den : 30;
        commit(
          markQueueItemCompleted(stateRef.current, item.id, {
            outputPath: result.outputPath,
            bytes,
            durationSeconds:
              fps > 0 ? Math.max(0, (result.endFrame - result.startFrame) / fps) : 0,
          }),
        );
        await finalizeBatch(item.batchId);
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : String(cause);
        commit(markQueueItemFailed(stateRef.current, item.id, failure));
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setRunning(false);
      }
    })();
  }, [commit, root, state]);

  const runningNow = running || state.items.some((item) => item.status === 'running');
  const value = useMemo<RenderQueueContextValue>(
    () => ({ state, running: runningNow, addScenes, pause, resume, cancel, clearFinished }),
    [state, runningNow, addScenes, pause, resume, cancel, clearFinished],
  );

  return <RenderQueueContext.Provider value={value}>{children}</RenderQueueContext.Provider>;
}

export type { RenderQueueItem };
