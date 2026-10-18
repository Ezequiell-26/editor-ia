import { parseProject, type ProjectDocument } from '@editor-ia/project-schema';

/**
 * The UI's only door to project storage.
 *
 * The desktop screen never touches the filesystem: it calls three typed methods
 * and renders whatever comes back. Two rules keep the screen honest. The state
 * machine below has one name per visible condition, so a save that failed can
 * never render as a save that worked. And every string that came from the native
 * side passes through `sanitizeForUi` first, because a Rust error message quotes
 * the path it failed on and the user's home directory is not information this
 * screen should print.
 */

export type ProjectOp = 'create' | 'open' | 'save';

export type ProjectPhase = 'idle' | 'loading' | 'dirty' | 'saving' | 'saved' | 'failed';

export interface OpenedProject {
  readonly project: ProjectDocument;
  readonly label: string;
}

export interface ProjectService {
  readonly available: boolean;
  readonly unavailableReason: string | null;
  createProject(name: string): Promise<OpenedProject>;
  /** `null` means the user closed the dialog: not a failure. */
  openProject(): Promise<OpenedProject | null>;
  saveProject(project: ProjectDocument): Promise<OpenedProject>;
}

export interface ProjectFlowState {
  phase: ProjectPhase;
  op: ProjectOp | null;
  projectName: string | null;
  hasUnsavedChanges: boolean;
  reason: string | null;
}

export type ProjectFlowEvent =
  | { type: 'start'; op: ProjectOp }
  | { type: 'loaded'; op: ProjectOp; name: string }
  | { type: 'edited' }
  | { type: 'failed'; op: ProjectOp; reason: string }
  | { type: 'cancelled' };

export const INITIAL_FLOW: ProjectFlowState = {
  phase: 'idle',
  op: null,
  projectName: null,
  hasUnsavedChanges: false,
  reason: null,
};

export function transition(state: ProjectFlowState, event: ProjectFlowEvent): ProjectFlowState {
  switch (event.type) {
    case 'start':
      return {
        ...state,
        phase: event.op === 'save' ? 'saving' : 'loading',
        op: event.op,
        reason: null,
      };
    case 'loaded':
      return {
        phase: 'saved',
        op: event.op,
        projectName: event.name,
        hasUnsavedChanges: false,
        reason: null,
      };
    case 'edited':
      return { ...state, phase: 'dirty', hasUnsavedChanges: true, reason: null };
    case 'failed':
      return {
        ...state,
        phase: 'failed',
        op: event.op,
        hasUnsavedChanges: event.op === 'save' ? true : state.hasUnsavedChanges,
        reason: event.reason,
      };
    case 'cancelled':
      return { ...INITIAL_FLOW };
  }
}

const FAILED_PHRASE: Record<ProjectOp, string> = {
  create: 'crear el proyecto',
  open: 'abrir el proyecto',
  save: 'guardar el proyecto',
};

/** One sentence per state, so the screen cannot show two meanings at once. */
export function describeFlow(state: ProjectFlowState): string {
  switch (state.phase) {
    case 'idle':
      return 'Sin proyecto abierto.';
    case 'loading':
      return state.op === 'create' ? 'Creando proyecto…' : 'Abriendo proyecto…';
    case 'dirty':
      return 'Cambios sin guardar.';
    case 'saving':
      return 'Guardando proyecto…';
    case 'saved':
      if (state.op === 'save') {
        return `Guardado: ${state.projectName}.`;
      }
      return `${state.op === 'create' ? 'Proyecto creado' : 'Proyecto abierto'}: ${state.projectName}.`;
    case 'failed': {
      const what = FAILED_PHRASE[state.op ?? 'open'];
      const unsaved = state.hasUnsavedChanges ? ' Los cambios siguen sin guardar.' : '';
      return `Falló ${what}: ${state.reason ?? 'motivo desconocido'}.${unsaved}`;
    }
  }
}

function baseName(value: string): string {
  const segments = value.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? value;
}

export function safeDisplayLabel(path: string): string {
  return baseName(path);
}

/**
 * Replace every absolute path in a message with its file name. Windows drive
 * prefixes and POSIX absolute paths both count; a bare relative path is left
 * alone because it carries no private directory.
 */
export function sanitizeForUi(message: string): string {
  const withoutDrivePaths = message.replace(/[A-Za-z]:[\\/][^\s,;)"']*/g, (match) =>
    baseName(match),
  );
  const withoutAbsolutePaths = withoutDrivePaths.replace(/(?:[\\/][^\s,;)"'\\/]+){2,}/g, (match) =>
    baseName(match),
  );
  return withoutAbsolutePaths.slice(0, 200);
}

export const PROJECT_COMMANDS = {
  create: 'create_project',
  open: 'open_project',
  save: 'save_project',
} as const;

export const NATIVE_UNAVAILABLE_REASON =
  'Crear y abrir no están disponibles en esta ventana: los comandos nativos llegan con la tarea 4.';

export interface NativeInvoke {
  (command: string, args: Record<string, unknown>): Promise<unknown>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke?: NativeInvoke };
  }
}

export function detectNativeRuntime(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__?.invoke === 'function';
}

function requireOpened(raw: unknown): OpenedProject {
  if (typeof raw !== 'object' || raw === null || !('project' in raw) || !('path' in raw)) {
    throw new Error('el comando nativo devolvió un proyecto sin ruta');
  }
  const { project, path } = raw as { project: unknown; path: unknown };
  const parsed = parseProject(project);
  if (!parsed.ok) {
    throw new Error(sanitizeForUi(parsed.message));
  }
  return {
    project: parsed.project,
    label: typeof path === 'string' ? safeDisplayLabel(path) : parsed.project.name,
  };
}

/** The Tauri side of the boundary. Task 4 implements these commands. */
export function createNativeProjectService(invoke: NativeInvoke): ProjectService {
  return {
    available: true,
    unavailableReason: null,
    async createProject(name: string): Promise<OpenedProject> {
      return requireOpened(await invoke(PROJECT_COMMANDS.create, { name }));
    },
    async openProject(): Promise<OpenedProject | null> {
      const raw = await invoke(PROJECT_COMMANDS.open, {});
      return raw === null || raw === undefined ? null : requireOpened(raw);
    },
    async saveProject(project: ProjectDocument): Promise<OpenedProject> {
      return requireOpened(await invoke(PROJECT_COMMANDS.save, { project }));
    },
  };
}

function unavailableProjectService(): ProjectService {
  return {
    available: false,
    unavailableReason: NATIVE_UNAVAILABLE_REASON,
    async createProject(): Promise<OpenedProject> {
      throw new Error(NATIVE_UNAVAILABLE_REASON);
    },
    async openProject(): Promise<OpenedProject | null> {
      throw new Error(NATIVE_UNAVAILABLE_REASON);
    },
    async saveProject(): Promise<OpenedProject> {
      throw new Error(NATIVE_UNAVAILABLE_REASON);
    },
  };
}

/** Pick the adapter from the runtime that is actually hosting the screen. */
export function createProjectService(): ProjectService {
  if (!detectNativeRuntime()) {
    return unavailableProjectService();
  }
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  return invoke ? createNativeProjectService(invoke) : unavailableProjectService();
}
