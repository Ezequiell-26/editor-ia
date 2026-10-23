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
import type { Asset } from '@editor-ia/project-schema';
import { artifactPaths, toolPayload } from './flow';
import {
  EMPTY_FLOW_QUEUE,
  createFlowQueue,
  finishFlowItem,
  flowQueueStopReason,
  flowQueueStopStatus,
  haltFlowQueue,
  loadFlowQueue,
  normalizeFlowQueueSettings,
  readFlowCredits,
  saveFlowQueue,
  takeNextItem,
  type FlowItemOutcome,
  type FlowQueueSettings,
  type FlowQueueState,
} from './flow-queue';
import { addAsset } from './project-actions';
import { useProjectStore } from './project-store';

/**
 * Ejecutor de la cola de Flow.
 *
 * Vive por encima de las vistas para que una corrida larga no se corte al
 * cambiar de pantalla. El bucle es secuencial a propósito: Flow es una interfaz
 * web con una sola sesión de Chrome; dos generaciones en paralelo se pisan.
 *
 * Cancelar no aborta la generación en curso —la llamada MCP es bloqueante—
 * sino que impide la siguiente. La interfaz lo dice explícitamente.
 */

export interface FlowQueueStartInput {
  readonly serverId: string;
  readonly prompts: readonly string[];
  readonly settings: FlowQueueSettings;
  readonly outputFolder: string;
}

export interface FlowQueueResumeInput {
  readonly serverId: string;
  readonly outputFolder: string;
}

export interface FlowQueueContextValue {
  readonly state: FlowQueueState;
  readonly running: boolean;
  start(input: FlowQueueStartInput): void;
  resume(input: FlowQueueResumeInput): void;
  stop(): void;
  reset(): void;
  setSettings(settings: FlowQueueSettings): void;
}

const FlowQueueContext = createContext<FlowQueueContextValue | null>(null);

function messageOf(payload: unknown): string {
  const value = toolPayload(payload);
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 400);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim().slice(0, 400);
      }
    }
  }
  return 'Flow devolvió un error sin detalle.';
}

export function FlowQueueProvider({ children }: { readonly children: ReactNode }) {
  const store = useProjectStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  const [state, setState] = useState<FlowQueueState>(() => loadFlowQueue());
  const stateRef = useRef(state);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const cancelRef = useRef(false);
  const wakeRef = useRef<(() => void) | null>(null);

  // El plan se guarda en cada transición: si la app se cierra a mitad de una
  // corrida, al volver aparece el avance y no una pantalla en blanco.
  useEffect(() => {
    saveFlowQueue(state);
  }, [state]);

  useEffect(
    () => () => {
      cancelRef.current = true;
      wakeRef.current?.();
    },
    [],
  );

  const commit = useCallback((next: FlowQueueState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const wait = useCallback((ms: number) => {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        wakeRef.current = null;
        resolve();
      }, ms);
      wakeRef.current = () => {
        window.clearTimeout(timer);
        wakeRef.current = null;
        resolve();
      };
    });
  }, []);

  const readCredits = useCallback(async (serverId: string): Promise<number | null> => {
    try {
      const status = await storeRef.current.service.callMcpTool(serverId, 'flow_status', {
        full: true,
      });
      if (status.isError) return null;
      return readFlowCredits(toolPayload(status.result));
    } catch {
      return null;
    }
  }, []);

  const importArtifacts = useCallback(async (paths: readonly string[]) => {
    const current = storeRef.current;
    const project = current.state.project;
    if (!project || paths.length === 0) return;
    try {
      const outcome = await current.service.importMediaPaths({
        paths: [...paths],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'google-flow-image',
      });
      if (outcome.assets.length === 0) return;
      current.update((doc) => {
        let next = doc;
        for (const asset of outcome.assets as Asset[]) {
          next = addAsset(next, asset);
        }
        return next;
      });
    } catch {
      // Importar es un extra: si falla, la imagen ya está descargada y el error
      // no debe cortar la corrida.
    }
  }, []);

  const runLoop = useCallback(
    async (serverId: string, outputFolder: string) => {
      runningRef.current = true;
      setRunning(true);
      try {
        // Conexión best-effort: si el servidor expone `flow_connect` y Chrome
        // todavía no está enganchado, se abre. Si ya estaba conectado o el
        // servidor no tiene la herramienta, el error no debe cortar la corrida.
        try {
          await storeRef.current.service.callMcpTool(serverId, 'flow_connect', {
            headless: false,
          });
        } catch {
          // se ignora a propósito
        }

        while (!cancelRef.current) {
          const stop = flowQueueStopReason(stateRef.current);
          if (stop) {
            commit(
              haltFlowQueue(stateRef.current, stop, flowQueueStopStatus(stateRef.current)),
            );
            break;
          }

          const taken = takeNextItem(stateRef.current);
          if (!taken.item) break;
          commit(taken.state);
          const item = taken.item;

          if (stateRef.current.settings.checkCredits) {
            const credits = await readCredits(serverId);
            if (credits !== null && credits <= 0) {
              commit(
                haltFlowQueue(
                  stateRef.current,
                  'El saldo de créditos de Flow llegó a cero.',
                  'failed',
                ),
              );
              break;
            }
          }

          let outcome: FlowItemOutcome;
          try {
            const result = await storeRef.current.service.callMcpTool(
              serverId,
              'flow_generate_image',
              {
                prompt: item.prompt,
                model: stateRef.current.settings.model,
                ratio: stateRef.current.settings.ratio,
                auto_confirm: true,
                output_folder: outputFolder,
                response_format: 'concise',
              },
            );
            outcome = result.isError
              ? { ok: false, error: messageOf(result.result) }
              : { ok: true, artifacts: artifactPaths(result.result) };
          } catch (error) {
            outcome = {
              ok: false,
              error: error instanceof Error ? error.message : 'la llamada MCP falló',
            };
          }

          commit(finishFlowItem(stateRef.current, item.id, outcome));

          if (outcome.ok && stateRef.current.settings.importToMedia) {
            await importArtifacts(outcome.artifacts);
          }

          if (cancelRef.current) break;
          await wait(stateRef.current.settings.cooldownMs);
        }
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [commit, importArtifacts, readCredits, wait],
  );

  const start = useCallback(
    (input: FlowQueueStartInput) => {
      if (runningRef.current) return;
      const queue = createFlowQueue(input.prompts, input.settings);
      if (queue.items.length === 0) return;
      cancelRef.current = false;
      commit(queue);
      void runLoop(input.serverId, input.outputFolder);
    },
    [commit, runLoop],
  );

  const resume = useCallback(
    (input: FlowQueueResumeInput) => {
      if (runningRef.current) return;
      const current = stateRef.current;
      const hasPending = current.items.some((item) => item.status === 'pending');
      if (!hasPending && !current.settings.repeatForever) return;
      cancelRef.current = false;
      commit({
        ...current,
        status: 'running',
        stopReason: null,
        startedAt: current.startedAt ?? new Date().toISOString(),
      });
      void runLoop(input.serverId, input.outputFolder);
    },
    [commit, runLoop],
  );

  const stop = useCallback(() => {
    cancelRef.current = true;
    wakeRef.current?.();
    if (stateRef.current.status === 'running') {
      commit(
        haltFlowQueue(
          stateRef.current,
          'Detenido por el usuario. La imagen en curso termina; después no sigue.',
          'stopped',
        ),
      );
    }
  }, [commit]);

  const reset = useCallback(() => {
    cancelRef.current = true;
    wakeRef.current?.();
    commit(EMPTY_FLOW_QUEUE);
  }, [commit]);

  const setSettings = useCallback(
    (settings: FlowQueueSettings) => {
      if (stateRef.current.status === 'running') return;
      commit({ ...stateRef.current, settings: normalizeFlowQueueSettings(settings) });
    },
    [commit],
  );

  const value = useMemo<FlowQueueContextValue>(
    () => ({ state, running, start, resume, stop, reset, setSettings }),
    [state, running, start, resume, stop, reset, setSettings],
  );

  return <FlowQueueContext.Provider value={value}>{children}</FlowQueueContext.Provider>;
}

export function useFlowQueue(): FlowQueueContextValue {
  const value = useContext(FlowQueueContext);
  if (!value) {
    throw new Error('useFlowQueue necesita un FlowQueueProvider');
  }
  return value;
}
