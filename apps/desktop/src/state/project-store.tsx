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
import { parseProject, type ProjectDocument } from '@editor-ia/project-schema';
import type { DesktopService, OpenedProject } from '../services/project-service';
import { buildDeliveryPackage } from './delivery-package';
import { useEditorPreferences } from './useEditorPreferences';
import {
  RECOVERY_DEBOUNCE_MS,
  clearRecoverySnapshot,
  createRecoveryWriter,
  readRecoverySnapshot,
  shouldOfferRecovery,
  type RecoverySnapshot,
  type RecoveryWriter,
} from './recovery';
import {
  ProjectActionError,
  cloneProject,
  formatTimecode,
  totalFrames,
} from './project-actions';

/**
 * The single project store.
 *
 * All edits go through `mutate`: the recipe returns a new document, the store
 * validates it with the canonical schema, and only then adopts it and marks the
 * project dirty. A failed save never pretends to be a success, and a save that
 * completes while new edits exist keeps the new edits dirty.
 */

export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'clip'; readonly id: string }
  | { readonly kind: 'track'; readonly id: string }
  | { readonly kind: 'cue'; readonly id: string }
  | { readonly kind: 'asset'; readonly id: string }
  | { readonly kind: 'scene'; readonly id: string };

export type ProjectPhase = 'idle' | 'loading' | 'saved' | 'dirty' | 'saving' | 'failed';

interface StoreState {
  project: ProjectDocument | null;
  opened: OpenedProject | null;
  phase: ProjectPhase;
  error: string | null;
  notice: string | null;
  undo: ProjectDocument[];
  redo: ProjectDocument[];
  selection: Selection;
  playheadFrame: number;
  playing: boolean;
  lastSavedAt: string | null;
  exportRequested: boolean;
  /** Instantánea de la sesión anterior ofrecida al arrancar, si la hay. */
  recoveryOffer: RecoverySnapshot | null;
}

const INITIAL: StoreState = {
  project: null,
  opened: null,
  phase: 'idle',
  error: null,
  notice: null,
  undo: [],
  redo: [],
  selection: { kind: 'none' },
  playheadFrame: 0,
  playing: false,
  lastSavedAt: null,
  exportRequested: false,
  recoveryOffer: null,
};

export interface CreateProjectInput {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
}

export interface ProjectStoreValue {
  readonly state: StoreState;
  readonly service: DesktopService;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly durationFrames: number;
  readonly statusText: string;
  createProject(input: CreateProjectInput): Promise<boolean>;
  openProject(): Promise<boolean>;
  openProjectAt(path: string): Promise<boolean>;
  /** Reabre el archivo de la instantánea de recuperación. */
  acceptRecovery(): Promise<boolean>;
  /** Descarta la instantánea y la oferta. */
  dismissRecovery(): void;
  saveNow(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  packageProject(): Promise<boolean>;
  closeProject(): void;
  mutate<T extends { project: ProjectDocument }>(
    recipe: (project: ProjectDocument) => T,
    options?: { readonly history?: boolean; readonly notice?: string },
  ): T | null;
  update(
    recipe: (project: ProjectDocument) => ProjectDocument,
    options?: { readonly history?: boolean; readonly notice?: string },
  ): boolean;
  undo(): void;
  redo(): void;
  setSelection(selection: Selection): void;
  setPlayhead(frame: number): void;
  setPlaying(playing: boolean): void;
  requestExport(): void;
  consumeExportRequest(): void;
  clearError(): void;
  setNotice(notice: string | null): void;
}

const ProjectContext = createContext<ProjectStoreValue | null>(null);

function messageOf(error: unknown): string {
  if (error instanceof ProjectActionError) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'la operación falló sin un detalle disponible';
}

function phaseForAdopt(): ProjectPhase {
  return 'saved';
}

export interface ProjectProviderProps {
  readonly service: DesktopService;
  readonly children: ReactNode;
  readonly initial?: {
    readonly project: ProjectDocument;
    readonly opened?: OpenedProject | null;
  };
}

export function ProjectProvider({ service, children, initial }: ProjectProviderProps) {
  const [state, setState] = useState<StoreState>(() =>
    initial
      ? {
          ...INITIAL,
          project: initial.project,
          opened: initial.opened ?? null,
          phase: initial.opened ? 'saved' : 'idle',
        }
      : INITIAL,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const editVersionRef = useRef(0);
  // Escritor de la instantánea de recuperación: agrupa ráfagas de edición en
  // una sola escritura 2 s después del último cambio. `shouldWrite` evita
  // resucitar el registro si mientras tanto el autoguardado terminó bien.
  const recoveryWriterRef = useRef<RecoveryWriter | null>(null);
  if (!recoveryWriterRef.current) {
    recoveryWriterRef.current = createRecoveryWriter({
      delayMs: RECOVERY_DEBOUNCE_MS,
      shouldWrite: () => stateRef.current.phase === 'dirty',
    });
  }

  // Preferencias que afectan al guardado y al historial. Se leen de
  // Ajustes → Editor y se aplican en vivo, sin reiniciar la app.
  const preferences = useEditorPreferences();
  const historyLimitRef = useRef(preferences.historyLimit);
  historyLimitRef.current = preferences.historyLimit;

  // Al arrancar, una instantánea viva sólo puede venir de un cierre
  // inesperado: se ofrece una vez y, si no aplica, se descarta.
  useEffect(() => {
    const snapshot = readRecoverySnapshot();
    if (!snapshot) return;
    const current = stateRef.current;
    if (shouldOfferRecovery(snapshot, { savedAt: current.lastSavedAt })) {
      setState((s0) => (s0.recoveryOffer ? s0 : { ...s0, recoveryOffer: snapshot }));
      return;
    }
    clearRecoverySnapshot();
  }, []);

  const adopt = useCallback((opened: OpenedProject) => {
    editVersionRef.current = 0;
    setState({
      ...INITIAL,
      project: opened.project,
      opened,
      phase: phaseForAdopt(),
      lastSavedAt: new Date().toISOString(),
    });
  }, []);

  const createProject = useCallback(
    async (input: CreateProjectInput): Promise<boolean> => {
      const previousPhase = stateRef.current.phase;
      setState((current) => ({ ...current, phase: 'loading', error: null }));
      try {
        const opened = await service.createProject(input);
        if (!opened) {
          setState((current) => ({
            ...current,
            phase: current.project ? previousPhase : 'idle',
          }));
          return false;
        }
        const adopted = await service.adoptProject(opened.path);
        adopt(adopted);
        return true;
      } catch (error) {
        setState((current) => ({
          ...current,
          phase: current.project ? previousPhase : 'failed',
          error: messageOf(error),
        }));
        return false;
      }
    },
    [adopt, service],
  );

  const openProject = useCallback(async (): Promise<boolean> => {
    const previousPhase = stateRef.current.phase;
    setState((current) => ({ ...current, phase: 'loading', error: null }));
    try {
      const opened = await service.openProject();
      if (!opened) {
        setState((current) => ({
          ...current,
          phase: current.project ? previousPhase : 'idle',
        }));
        return false;
      }
      const adopted = await service.adoptProject(opened.path);
      adopt(adopted);
      return true;
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: current.project ? previousPhase : 'failed',
        error: messageOf(error),
      }));
      return false;
    }
  }, [adopt, service]);

  const openProjectAt = useCallback(
    async (path: string): Promise<boolean> => {
      const previousPhase = stateRef.current.phase;
      setState((current) => ({ ...current, phase: 'loading', error: null }));
      try {
        const opened = await service.openProjectAt(path);
        const adopted = await service.adoptProject(opened.path);
        adopt(adopted);
        return true;
      } catch (error) {
        setState((current) => ({
          ...current,
          phase: current.project ? previousPhase : 'failed',
          error: messageOf(error),
        }));
        return false;
      }
    },
    [adopt, service],
  );

  const dismissRecovery = useCallback(() => {
    clearRecoverySnapshot();
    setState((current) =>
      current.recoveryOffer === null ? current : { ...current, recoveryOffer: null },
    );
  }, []);

  const acceptRecovery = useCallback(async (): Promise<boolean> => {
    const offer = stateRef.current.recoveryOffer;
    if (!offer) {
      return false;
    }
    const ok = await openProjectAt(offer.path);
    // Se limpia siempre: si el archivo ya no está, la oferta tampoco sirve.
    clearRecoverySnapshot();
    setState((current) =>
      current.recoveryOffer === null ? current : { ...current, recoveryOffer: null },
    );
    return ok;
  }, [openProjectAt]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    const snapshot = stateRef.current;
    if (!snapshot.project || !snapshot.opened) {
      return false;
    }
    const captured = snapshot.project;
    const version = editVersionRef.current;
    setState((current) => ({ ...current, phase: 'saving', error: null }));
    try {
      const opened = await service.saveProject(captured);
      const pendingChanges = editVersionRef.current !== version;
      setState((current) => {
        if (current.project !== captured) {
          return {
            ...current,
            opened: current.opened ? { ...current.opened, path: opened.path, root: opened.root, label: opened.label } : opened,
            phase: 'dirty',
            notice: 'Guardado anterior completado; hay cambios nuevos pendientes.',
            lastSavedAt: new Date().toISOString(),
          };
        }
        return {
          ...current,
          opened: { ...opened, project: current.project },
          phase: 'saved',
          error: null,
          lastSavedAt: new Date().toISOString(),
        };
      });
      if (!pendingChanges) {
        recoveryWriterRef.current?.cancel();
        clearRecoverySnapshot();
      }
      return !pendingChanges;
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: current.project === captured ? 'failed' : current.phase,
        error: messageOf(error),
      }));
      return false;
    }
  }, [service]);

  const saveAs = useCallback(async (): Promise<boolean> => {
    const snapshot = stateRef.current;
    if (!snapshot.project) {
      return false;
    }
    const captured = snapshot.project;
    setState((current) => ({ ...current, phase: 'saving', error: null }));
    try {
      const opened = await service.saveProjectAs(captured);
      if (!opened) {
        setState((current) => ({ ...current, phase: current.project === captured ? 'dirty' : current.phase }));
        return false;
      }
      setState((current) => ({
        ...current,
        opened:
          current.project === captured
            ? { ...opened, project: current.project }
            : current.opened,
        phase: current.project === captured ? 'saved' : 'dirty',
        error: null,
        lastSavedAt: new Date().toISOString(),
      }));
      // Guardar como deja el archivo a salvo: la instantánea anterior ya no
      // representa trabajo pendiente.
      recoveryWriterRef.current?.cancel();
      clearRecoverySnapshot();
      return true;
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: current.project === captured ? 'failed' : current.phase,
        error: messageOf(error),
      }));
      return false;
    }
  }, [service]);

  /**
   * Empaqueta el proyecto en un `.zip` de entrega. No cambia el estado del
   * proyecto: es una exportación derivada y no debe marcar `dirty` ni entrar
   * en el historial de deshacer.
   */
  const packageProject = useCallback(async (): Promise<boolean> => {
    const snapshot = stateRef.current;
    if (!snapshot.project) {
      return false;
    }
    try {
      const bundle = await buildDeliveryPackage(snapshot.project);
      const saved = await service.saveDeliveryPackage(bundle.bytes, bundle.fileName);
      if (!saved) {
        return false;
      }
      setState((current) => ({
        ...current,
        notice: `Paquete de entrega guardado en ${saved}`,
      }));
      return true;
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: `No se pudo empaquetar el proyecto: ${messageOf(error)}`,
      }));
      return false;
    }
  }, [service]);

  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;

  useEffect(() => {
    if (state.phase !== 'dirty' || !state.opened) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveRef.current();
    }, preferences.autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.project, state.opened, preferences.autosaveDelayMs]);

  // Cada cambio sin guardar agenda la instantánea; el escritor la agrupa.
  useEffect(() => {
    if (state.phase !== 'dirty' || !state.opened || !state.project) {
      return;
    }
    recoveryWriterRef.current?.schedule(state.project, state.opened.path);
  }, [state.project, state.phase, state.opened]);

  // Al desmontar no deben quedar temporizadores vivos.
  useEffect(() => () => recoveryWriterRef.current?.cancel(), []);

  const applyRecipe = useCallback(
    <T extends { project: ProjectDocument }>(
      recipe: (project: ProjectDocument) => T,
      options?: { readonly history?: boolean; readonly notice?: string },
    ): T | null => {
      const snapshot = stateRef.current;
      if (!snapshot.project) {
        setState((current) => ({ ...current, error: 'abrí un proyecto antes de editar' }));
        return null;
      }
      try {
        const result = recipe(cloneProject(snapshot.project));
        const parsed = parseProject(result.project);
        if (!parsed.ok) {
          const first = parsed.issues[0];
          setState((current) => ({
            ...current,
            error: `La edición dejaría el proyecto inválido${first ? ` (${first.path}: ${first.message})` : ''}.`,
          }));
          return null;
        }
        setState((current) => ({
          ...current,
          project: parsed.project,
          phase: 'dirty',
          error: null,
          notice: options?.notice ?? current.notice,
          undo:
            options?.history === false || !current.project
              ? current.undo
              : [...current.undo, cloneProject(current.project)].slice(
                  -historyLimitRef.current,
                ),
          redo: options?.history === false ? current.redo : [],
        }));
        editVersionRef.current += 1;
        return { ...result, project: parsed.project };
      } catch (error) {
        setState((current) => ({ ...current, error: messageOf(error) }));
        return null;
      }
    },
    [],
  );

  const update = useCallback(
    (
      recipe: (project: ProjectDocument) => ProjectDocument,
      options?: { readonly history?: boolean; readonly notice?: string },
    ): boolean => {
      const result = applyRecipe((project) => ({ project: recipe(project) }), options);
      return result !== null;
    },
    [applyRecipe],
  );

  const undo = useCallback(() => {
    if (!stateRef.current.project || stateRef.current.undo.length === 0) {
      return;
    }
    editVersionRef.current += 1;
    setState((current) => {
      const previous = current.undo[current.undo.length - 1];
      if (!previous || !current.project) {
        return current;
      }
      return {
        ...current,
        project: previous,
        undo: current.undo.slice(0, -1),
        redo: [current.project, ...current.redo].slice(0, historyLimitRef.current),
        phase: 'dirty',
        error: null,
      };
    });
  }, []);

  const redo = useCallback(() => {
    if (!stateRef.current.project || stateRef.current.redo.length === 0) {
      return;
    }
    editVersionRef.current += 1;
    setState((current) => {
      const next = current.redo[0];
      if (!next || !current.project) {
        return current;
      }
      return {
        ...current,
        project: next,
        undo: [...current.undo, current.project].slice(-historyLimitRef.current),
        redo: current.redo.slice(1),
        phase: 'dirty',
        error: null,
      };
    });
  }, []);

  const setSelection = useCallback((selection: Selection) => {
    setState((current) => {
      if (
        current.selection.kind === selection.kind &&
        ('id' in current.selection && 'id' in selection ? current.selection.id === selection.id : true)
      ) {
        return current;
      }
      return { ...current, selection };
    });
  }, []);

  const requestExport = useCallback(() => {
    setState((current) => (current.exportRequested ? current : { ...current, exportRequested: true }));
  }, []);

  const consumeExportRequest = useCallback(() => {
    setState((current) => (current.exportRequested ? { ...current, exportRequested: false } : current));
  }, []);

  const setPlayhead = useCallback((frame: number) => {
    setState((current) => {
      const duration = current.project ? totalFrames(current.project) : 0;
      const target = Math.max(0, Math.min(duration, Math.round(frame)));
      if (current.playheadFrame === target) {
        return current;
      }
      return {
        ...current,
        playheadFrame: target,
      };
    });
  }, []);

  const setPlaying = useCallback((playing: boolean) => {
    setState((current) => (current.playing === playing ? current : { ...current, playing }));
  }, []);

  const closeProject = useCallback(() => {
    editVersionRef.current = 0;
    recoveryWriterRef.current?.cancel();
    clearRecoverySnapshot();
    setState(INITIAL);
  }, []);

  const clearError = useCallback(() => {
    setState((current) => (current.error === null ? current : { ...current, error: null }));
  }, []);

  const setNotice = useCallback((notice: string | null) => {
    setState((current) => (current.notice === notice ? current : { ...current, notice }));
  }, []);

  const durationFrames = state.project ? totalFrames(state.project) : 0;
  const statusText = useMemo(() => {
    switch (state.phase) {
      case 'idle':
        return 'Sin proyecto abierto';
      case 'loading':
        return 'Abriendo proyecto…';
      case 'saved':
        return state.lastSavedAt ? 'Guardado' : 'Proyecto listo';
      case 'dirty':
        return 'Cambios sin guardar · autoguardado en 2 s';
      case 'saving':
        return 'Guardando…';
      case 'failed':
        return `Error: ${state.error ?? 'sin detalle'}`;
    }
  }, [state.error, state.lastSavedAt, state.phase]);

  const value = useMemo<ProjectStoreValue>(
    () => ({
      state,
      service,
      canUndo: state.undo.length > 0,
      canRedo: state.redo.length > 0,
      durationFrames,
      statusText,
      createProject,
      openProject,
      openProjectAt,
      acceptRecovery,
      dismissRecovery,
      saveNow,
      saveAs,
      packageProject,
      closeProject,
      mutate: applyRecipe,
      update,
      undo,
      redo,
      setSelection,
      setPlayhead,
      setPlaying,
      requestExport,
      consumeExportRequest,
      clearError,
      setNotice,
    }),
    [
      acceptRecovery,
      applyRecipe,
      clearError,
      closeProject,
      createProject,
      dismissRecovery,
      durationFrames,
      openProject,
      openProjectAt,
      packageProject,
      redo,
      saveAs,
      saveNow,
      service,
      setNotice,
      setPlayhead,
      setPlaying,
      setSelection,
      requestExport,
      consumeExportRequest,
      state,
      statusText,
      undo,
      update,
    ],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectStore(): ProjectStoreValue {
  const value = useContext(ProjectContext);
  if (!value) {
    throw new Error('useProjectStore necesita un ProjectProvider');
  }
  return value;
}

export function useProjectDocument(): ProjectDocument | null {
  return useProjectStore().state.project;
}

export function describeFrame(frame: number, project: ProjectDocument | null): string {
  return formatTimecode(frame, project ? project.video.frameRate.num / project.video.frameRate.den : 30);
}
