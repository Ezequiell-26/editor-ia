import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseProject, type ProjectDocument } from '@editor-ia/project-schema';
import type { OpenedProject } from '../services/project-service';
import { buildDeliveryPackage } from './delivery-package';
import { useEditorPreferences } from './useEditorPreferences';
import { ioRangeFromDocument, projectWithIoRange, type IoRange } from './io-range';
import { ProjectActionError, cloneProject, totalFrames } from './project-actions';
import { clearRecoverySnapshot, createRecoveryWriter, readRecoverySnapshot, shouldOfferRecovery, type RecoveryWriter } from './recovery';
import type { Selection, ProjectPhase, StoreState, CreateProjectInput, ProjectStoreValue, ProjectProviderProps } from './project-store-types';
import { ProjectContext, PlayheadContext, PlayingContext, PlaybackRateContext, PlaybackDirectionContext } from './project-store-context';



// Selector shallow para comparar referencias de objetos simples (performance)
function shallowEqualObjects(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
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
  ioRange: null,
  lastSavedAt: null,
  exportRequested: false,
  recoveryOffer: null,
};

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
  return 'la operaci├│n fall├│ sin un detalle disponible';
}

function phaseForAdopt(): ProjectPhase {
  return 'saved';
}

export function ProjectProvider({ service, children, initial }: ProjectProviderProps) {
  const [state, setState] = useState<StoreState>(() =>
    initial
      ? {
          ...INITIAL,
          project: initial.project,
          opened: initial.opened ?? null,
          phase: initial.opened ? 'saved' : 'idle',
          ioRange: ioRangeFromDocument(initial.project),
        }
      : INITIAL,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  // Contrato: los mutadores del documento (`applyRecipe`, `undo`, `redo`,
  // `adopt`, `closeProject`, `setIoPoint`, `clearIoRange`) adelantan
  // `stateRef.current` de forma s├│ncrona antes de pedir el render, igual que
  // `playbackRef`. Los lectores s├│ncronos (`saveNow`, `getProject`, la
  // siguiente receta) ven siempre la ├║ltima edici├│n aunque React todav├¡a no
  // haya confirmado el `setState`.
  // Playhead y reproducci├│n en estado propio: ver PlayheadContext arriba.
  // `playbackRef` se actualiza de forma s├¡ncrona para que `getPlayhead()` /
  // `getPlaying()` devuelvan el valor reci├®n fijado aunque `setState` a├║n no
  // haya llegado al render.
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const [playing, setPlayingState] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [playbackDirection, setPlaybackDirectionState] = useState<1 | -1>(1);
  const playbackRef = useRef({ frame: 0, playing: false, rate: 1, direction: 1 as 1 | -1 });
  /**
   * `totalFrames` recorre todos los clips y cues. Antes se ejecutaba una vez
   * por render del provider (es decir, en cada frame de reproducci├│n) y otra
   * vez dentro de `setPlayhead`. El documento es inmutable por contrato:
   * `applyRecipe` clona antes de pasar el borrador a la receta, as├¡ que la
   * duraci├│n puede cachearse por identidad del proyecto. Es O(1) en los
   * frames y sigue siendo correcto si en un mismo evento se edita y se
   * mueve el playhead (lee `current.project`, no un valor de un render
   * anterior).
   */
  const durationCache = useRef<{ project: ProjectDocument | null; duration: number }>({
    project: null,
    duration: 0,
  });
  const durationOf = useCallback((project: ProjectDocument | null): number => {
    if (!project) return 0;
    const cache = durationCache.current;
    if (cache.project !== project) {
      cache.project = project;
      cache.duration = totalFrames(project);
    }
    return cache.duration;
  }, []);
  const editVersionRef = useRef(0);
  // ├Ültima versi├│n cubierta por un guardado completado. Se actualiza de forma
  // s├¡ncrona (no depende del render) para que la instant├ínea de recuperaci├│n
  // sepa en todo momento si queda trabajo sin persistir.
  const persistedVersionRef = useRef(0);

  // Escritor de la instant├ínea de recuperaci├│n. Al vencer el temporizador solo
  // escribe si hay ediciones que ning├║n guardado completado haya cubierto ya:
  // si el autoguardado termin├│ bien, la instant├ínea no debe resucitar.
  const recoveryWriter = useMemo<RecoveryWriter>(
    () =>
      createRecoveryWriter({
        shouldWrite: () => editVersionRef.current !== persistedVersionRef.current,
      }),
    [],
  );

  // Preferencias que afectan al guardado y al historial. Se leen de
  // Ajustes ÔåÆ Editor y se aplican en vivo, sin reiniciar la app.
  const preferences = useEditorPreferences();
  const historyLimitRef = useRef(preferences.historyLimit);
  historyLimitRef.current = preferences.historyLimit;

  const adopt = useCallback((opened: OpenedProject) => {
    editVersionRef.current = 0;
    persistedVersionRef.current = 0;
    // Un proyecto reci├®n abierto desde disco invalida cualquier instant├ínea
    // previa: el registro de recuperaci├│n solo cubre trabajo sin persistir.
    clearRecoverySnapshot();
    playbackRef.current = { ...playbackRef.current, frame: 0, playing: false, direction: 1 };
    setPlayheadFrame(0);
    setPlayingState(false);
    setPlaybackDirectionState(1);
    const next: StoreState = {
      ...INITIAL,
      project: opened.project,
      opened,
      phase: phaseForAdopt(),
      ioRange: ioRangeFromDocument(opened.project),
      lastSavedAt: new Date().toISOString(),
    };
    // `stateRef` se adelanta al render (mismo criterio que `playbackRef`):
    // un `saveNow`/`getProject` inmediato despu├®s de abrir ve el proyecto
    // nuevo y no el anterior.
    stateRef.current = next;
    setState(next);
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

  const saveNow = useCallback(async (): Promise<boolean> => {
    const snapshot = stateRef.current;
    if (!snapshot.project || !snapshot.opened) {
      return false;
    }
    const captured = snapshot.project;
    const version = editVersionRef.current;
    setState((current) => ({ ...current, phase: 'saving', error: null }));
    try {
      // El documento guarda `x-ioRange` en cada set/clear, pero un undo puede
      // restaurar una instant├ínea con otro valor: al guardar se reescribe desde
      // el estado visible para que el archivo coincida con lo que ve el usuario.
      const toSave = projectWithIoRange(captured, snapshot.ioRange);
      const opened = await service.saveProject(toSave);
      const pendingChanges = editVersionRef.current !== version;
      // Guardado completado: esa versi├│n ya vive en disco. Se cancela de una
      // vez la escritura pendiente de la instant├ínea y se limpia el registro
      // (las ediciones nuevas, si las hay, volver├ín a agendarla).
      persistedVersionRef.current = version;
      recoveryWriter.cancel();
      clearRecoverySnapshot();
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
      return !pendingChanges;
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: current.project === captured ? 'failed' : current.phase,
        error: messageOf(error),
      }));
      return false;
    }
  }, [recoveryWriter, service]);

  const saveAs = useCallback(async (): Promise<boolean> => {
    const snapshot = stateRef.current;
    if (!snapshot.project) {
      return false;
    }
    const captured = snapshot.project;
    const version = editVersionRef.current;
    setState((current) => ({ ...current, phase: 'saving', error: null }));
    try {
      const opened = await service.saveProjectAs(projectWithIoRange(captured, snapshot.ioRange));
      if (!opened) {
        setState((current) => ({ ...current, phase: current.project === captured ? 'dirty' : current.phase }));
        return false;
      }
      // Guardado completado: la versi├│n capturada vive en disco; la escritura
      // pendiente de la instant├ínea deja de tener sentido.
      persistedVersionRef.current = version;
      recoveryWriter.cancel();
      clearRecoverySnapshot();
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
      return true;
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: current.project === captured ? 'failed' : current.phase,
        error: messageOf(error),
      }));
      return false;
    }
  }, [recoveryWriter, service]);

  /**
   * Empaqueta el proyecto en un `.zip` de entrega. No cambia el estado del
   * proyecto: es una exportaci├│n derivada y no debe marcar `dirty` ni entrar
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

  // Oferta de recuperaci├│n: se eval├║a una sola vez al montar. Si qued├│ una
  // instant├ínea de una sesi├│n que termin├│ de forma inesperada y es m├ís nueva
  // que el ├║ltimo guardado conocido, se expone en el estado para que una
  // tarjeta futura la consuma. No hay UI aqu├¡: solo el dato.
  useEffect(() => {
    const snapshot = readRecoverySnapshot();
    if (!snapshot || !shouldOfferRecovery(snapshot, { savedAt: stateRef.current.lastSavedAt })) {
      return;
    }
    setState((current) =>
      current.recoveryOffer ? current : { ...current, recoveryOffer: snapshot },
    );
    // Se ejecuta solo al montar: la oferta no se recalcula en caliente.
  }, []);

  // Instant├ínea de recuperaci├│n: cada cambio de proyecto reagenda una ├║nica
  // escritura 2 s despu├®s del ├║ltimo cambio (debounce cancelable). El
  // temporizador se cancela al cambiar de proyecto, guardar, cerrar o montar
  // otra cosa; `shouldWrite` decide al vencer si a├║n hay trabajo sin guardar.
  useEffect(() => {
    if (!state.project || !state.opened) {
      return;
    }
    recoveryWriter.schedule(state.project, state.opened.path);
    return () => recoveryWriter.cancel();
  }, [state.project, state.opened, recoveryWriter]);

  const getProject = useCallback((): ProjectDocument | null => stateRef.current.project ?? null, []);

  const applyRecipe = useCallback(
    <T extends { project: ProjectDocument }>(
      recipe: (project: ProjectDocument) => T,
      options?: { readonly history?: boolean; readonly notice?: string },
    ): T | null => {
      const snapshot = stateRef.current;
      if (!snapshot.project) {
        setState((current) => ({ ...current, error: 'abr├¡ un proyecto antes de editar' }));
        return null;
      }
      try {
        const result = recipe(cloneProject(snapshot.project));
        const parsed = parseProject(result.project);
        if (!parsed.ok) {
          const first = parsed.issues[0];
          setState((current) => ({
            ...current,
            error: `La edici├│n dejar├¡a el proyecto inv├ílido${first ? ` (${first.path}: ${first.message})` : ''}.`,
          }));
          return null;
        }
        // `stateRef` se adelanta al render: los lectores s├│ncronos
        // (`saveNow`, `getProject`, la pr├│xima `applyRecipe`) ven la edici├│n
        // ya aplicada. Sin esto, dos `update` en el mismo tick encadenaban
        // sobre el documento viejo (la primera edici├│n se perd├¡a) y un
        // `update` + `saveNow` inmediato guardaba el estado anterior.
        stateRef.current = {
          ...snapshot,
          project: parsed.project,
          phase: 'dirty',
          error: null,
          notice: options?.notice ?? snapshot.notice,
          undo:
            options?.history === false || !snapshot.project
              ? snapshot.undo
              : [...snapshot.undo, snapshot.project].slice(-historyLimitRef.current),
          redo: options?.history === false ? snapshot.redo : [],
        };
        setState((current) => ({
          ...current,
          project: parsed.project,
          phase: 'dirty',
          error: null,
          notice: options?.notice ?? current.notice,
          // El documento vivo nunca se muta in situ: `applyRecipe` entrega a
          // la receta un clon, por lo que `current.project` ya es una
          // instant├ínea segura para el historial. Guardarlo por referencia
          // evita un segundo deep-clone completo del proyecto en cada edici├│n.
          undo:
            options?.history === false || !current.project
              ? current.undo
              : [...current.undo, current.project].slice(-historyLimitRef.current),
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
    const snapshot = stateRef.current;
    const previous = snapshot.undo[snapshot.undo.length - 1];
    if (!snapshot.project || !previous) {
      return;
    }
    editVersionRef.current += 1;
    // Mismo adelanto de `stateRef` que en `applyRecipe`: un `saveNow` o una
    // edici├│n inmediatamente despu├®s del undo ven el documento restaurado.
    stateRef.current = {
      ...snapshot,
      project: previous,
      undo: snapshot.undo.slice(0, -1),
      redo: [snapshot.project, ...snapshot.redo].slice(0, historyLimitRef.current),
      phase: 'dirty',
      error: null,
    };
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
    const snapshot = stateRef.current;
    const next = snapshot.redo[0];
    if (!snapshot.project || !next) {
      return;
    }
    editVersionRef.current += 1;
    stateRef.current = {
      ...snapshot,
      project: next,
      undo: [...snapshot.undo, snapshot.project].slice(-historyLimitRef.current),
      redo: snapshot.redo.slice(1),
      phase: 'dirty',
      error: null,
    };
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

  const setIoPoint = useCallback(
    (edge: 'in' | 'out') => {
      const frame = playbackRef.current.frame;
      const next: IoRange = {
        inFrame: stateRef.current.ioRange?.inFrame ?? null,
        outFrame: stateRef.current.ioRange?.outFrame ?? null,
        [edge === 'in' ? 'inFrame' : 'outFrame']: frame,
      };
      // `stateRef` se adelanta al render: `saveNow` combina `project` +
      // `ioRange` del ref, as├¡ que el rango nuevo debe estar visible ya.
      stateRef.current = { ...stateRef.current, ioRange: next };
      setState((current) => ({ ...current, ioRange: next }));
      // El rango vive en el documento (`x-ioRange`) para sobrevivir al cierre:
      // `history:false` porque es una marca de UI, no una edici├│n del timeline.
      if (stateRef.current.project) {
        update((project) => projectWithIoRange(project, next), { history: false });
      }
    },
    [update],
  );

  const clearIoRange = useCallback(() => {
    stateRef.current = { ...stateRef.current, ioRange: null };
    setState((current) => (current.ioRange === null ? current : { ...current, ioRange: null }));
    if (stateRef.current.project) {
      update((project) => projectWithIoRange(project, null), { history: false });
    }
  }, [update]);

  const requestExport = useCallback(() => {
    setState((current) => (current.exportRequested ? current : { ...current, exportRequested: true }));
  }, []);

  const consumeExportRequest = useCallback(() => {
    setState((current) => (current.exportRequested ? { ...current, exportRequested: false } : current));
  }, []);

  const getPlayhead = useCallback((): number => playbackRef.current.frame, []);
  const getPlaying = useCallback((): boolean => playbackRef.current.playing, []);
  const getPlaybackRate = useCallback((): number => playbackRef.current.rate, []);
  const getPlaybackDirection = useCallback((): 1 | -1 => playbackRef.current.direction, []);

  const setPlaybackDirection = useCallback((direction: 1 | -1) => {
    if (playbackRef.current.direction === direction) {
      return;
    }
    playbackRef.current = { ...playbackRef.current, direction };
    setPlaybackDirectionState(direction);
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    if (!Number.isFinite(rate)) return;
    const next = Math.min(8, Math.max(0.1, rate));
    if (playbackRef.current.rate === next) {
      return;
    }
    playbackRef.current = { ...playbackRef.current, rate: next };
    setPlaybackRateState(next);
  }, []);

  const setPlayhead = useCallback(
    (frame: number) => {
      const duration = durationOf(stateRef.current.project);
      const target = Math.max(0, Math.min(duration, Math.round(frame)));
      if (playbackRef.current.frame === target) {
        return;
      }
      playbackRef.current = { ...playbackRef.current, frame: target };
      setPlayheadFrame(target);
    },
    [durationOf],
  );

  const setPlaying = useCallback((next: boolean) => {
    if (playbackRef.current.playing === next) {
      return;
    }
    playbackRef.current = { ...playbackRef.current, playing: next };
    setPlayingState(next);
  }, []);

  const closeProject = useCallback(() => {
    editVersionRef.current = 0;
    persistedVersionRef.current = 0;
    // Cierre voluntario: la instant├ínea deja de representar trabajo pendiente.
    clearRecoverySnapshot();
    playbackRef.current = { ...playbackRef.current, frame: 0, playing: false, direction: 1 };
    setPlayheadFrame(0);
    setPlayingState(false);
    setPlaybackDirectionState(1);
    stateRef.current = INITIAL;
    setState(INITIAL);
  }, []);

  const clearError = useCallback(() => {
    setState((current) => (current.error === null ? current : { ...current, error: null }));
  }, []);

  const setNotice = useCallback((notice: string | null) => {
    setState((current) => (current.notice === notice ? current : { ...current, notice }));
  }, []);

  // Aceptar la recuperaci├│n reabre el archivo anotado en la instant├ínea por la
  // v├¡a normal (disco + validaci├│n del servicio). Si falla, la oferta queda
  // en pie para reintentar o descartar; si tiene ├®xito, adopt() ya limpi├│ la
  // instant├ínea y la oferta (el estado vuelve de INITIAL).
  const acceptRecovery = useCallback(async (): Promise<boolean> => {
    const offer = stateRef.current.recoveryOffer;
    if (!offer) {
      return false;
    }
    return openProjectAt(offer.path);
  }, [openProjectAt]);

  const dismissRecovery = useCallback(() => {
    clearRecoverySnapshot();
    setState((current) =>
      current.recoveryOffer ? { ...current, recoveryOffer: null } : current,
    );
  }, []);

  const durationFrames = durationOf(state.project);
  const statusText = useMemo(() => {
    switch (state.phase) {
      case 'idle':
        return 'Sin proyecto abierto';
      case 'loading':
        return 'Abriendo proyectoÔÇª';
      case 'saved':
        return state.lastSavedAt ? 'Guardado' : 'Proyecto listo';
      case 'dirty':
        return 'Cambios sin guardar ┬À autoguardado en 2 s';
      case 'saving':
        return 'GuardandoÔÇª';
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
      saveNow,
      saveAs,
      packageProject,
      closeProject,
      getProject,
      mutate: applyRecipe,
      update,
      undo,
      redo,
      setSelection,
      setIoPoint,
      clearIoRange,
      setPlayhead,
      setPlaying,
      setPlaybackDirection,
      setPlaybackRate,
      getPlayhead,
      getPlaying,
      getPlaybackDirection,
      getPlaybackRate,
      requestExport,
      consumeExportRequest,
      acceptRecovery,
      dismissRecovery,
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
      getProject,
      openProject,
      getPlayhead,
      getPlaying,
      getPlaybackDirection,
      getPlaybackRate,
      openProjectAt,
      packageProject,
      redo,
      saveAs,
      saveNow,
      service,
      setIoPoint,
      clearIoRange,
      setNotice,
      setPlayhead,
      setPlaying,
      setPlaybackDirection,
      setPlaybackRate,
      setSelection,
      requestExport,
      consumeExportRequest,
      state,
      statusText,
      undo,
      update,
    ],
  );

  return (
    <PlayheadContext.Provider value={playheadFrame}>
      <PlayingContext.Provider value={playing}>
        <PlaybackRateContext.Provider value={playbackRate}>
          <PlaybackDirectionContext.Provider value={playbackDirection}>
            <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
          </PlaybackDirectionContext.Provider>
        </PlaybackRateContext.Provider>
      </PlayingContext.Provider>
    </PlayheadContext.Provider>
  );
}