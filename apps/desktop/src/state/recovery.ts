/**
 * Registro de recuperación ante cierre inesperado.
 *
 * Mientras se edita, el store deja en `localStorage` una instantánea
 * `{project, path, savedAt}` del proyecto abierto (con retardo de 2 s). Si la
 * app muere sin guardar ni cerrar el proyecto, la instantánea sobrevive y la
 * sesión siguiente puede ofrecer recuperar ese archivo.
 *
 * Reglas de honestidad:
 * - Guardar con éxito, cerrar el proyecto o descartar la oferta LIMPIA la
 *   instantánea: si hay instantánea al arrancar es porque la sesión anterior
 *   terminó de forma inesperada con trabajo sin guardar.
 * - Cualquier error (cuota llena, JSON corrupto, forma inesperada) se degrada
 *   a `null`/`false` sin lanzar: la recuperación es una conveniencia y nunca
 *   debe impedir arrancar el editor.
 *
 * Este módulo es lógica pura: no importa Tauri ni React. El almacenamiento se
 * puede inyectar para las pruebas. La instantánea no guarda datos volátiles
 * de la sesión (sin pid, sin relojes de proceso): solo lo que la siguiente
 * sesión puede usar de forma verificable.
 */

import type { ProjectDocument } from '@editor-ia/project-schema';

/** Clave de `localStorage` donde vive la instantánea de recuperación. */
export const RECOVERY_STORAGE_KEY = 'editoria.recovery.v1';

/** Retardo de la escritura tras el último cambio de proyecto, en ms. */
export const RECOVERY_DEBOUNCE_MS = 2_000;

/** Instantánea de recuperación: documento, ruta del archivo y cuándo. */
export interface RecoverySnapshot {
  readonly project: ProjectDocument;
  readonly path: string;
  readonly savedAt: string;
}

/** Estado actual contra el que se compara la instantánea. */
export interface RecoveryCurrentState {
  /** Último guardado conocido del proyecto abierto, o null si no hay ninguno. */
  readonly savedAt: string | null;
}

/** Almacenamiento mínimo que necesita el registro; `window.localStorage` lo cumple. */
export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function safeStorage(): RecoveryStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Guarda la instantánea. Devuelve `true` si quedó escrita y `false` si no se
 * pudo (sin almacenamiento, cuota llena o storage que lanza al escribir).
 */
export function writeRecoverySnapshot(
  project: ProjectDocument,
  path: string,
  savedAt: string,
  storage: RecoveryStorage | null = safeStorage(),
): boolean {
  if (!storage) {
    return false;
  }
  try {
    const snapshot: RecoverySnapshot = { project, path, savedAt };
    storage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    // Cuota llena o almacenamiento hostil: la sesión sigue sin instantánea.
    return false;
  }
}

/**
 * Lee la instantánea. Devuelve `null` si no hay registro, si el JSON está
 * corrupto o si la forma guardada no es una instantánea utilizable.
 */
export function readRecoverySnapshot(
  storage: Pick<RecoveryStorage, 'getItem'> | null = safeStorage(),
): RecoverySnapshot | null {
  if (!storage) {
    return null;
  }
  try {
    const text = storage.getItem(RECOVERY_STORAGE_KEY);
    if (!text) {
      return null;
    }
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const source = raw as Record<string, unknown>;
    const { project, path, savedAt } = source;
    if (!project || typeof project !== 'object') {
      return null;
    }
    if (typeof path !== 'string' || path.length === 0) {
      return null;
    }
    if (typeof savedAt !== 'string' || !Number.isFinite(Date.parse(savedAt))) {
      return null;
    }
    return { project: project as ProjectDocument, path, savedAt };
  } catch {
    // JSON corrupto o lectura que lanza: nada verificable que recuperar.
    return null;
  }
}

/** Borra la instantánea: guardado limpio, cierre del proyecto o descarte. */
export function clearRecoverySnapshot(
  storage: Pick<RecoveryStorage, 'removeItem'> | null = safeStorage(),
): void {
  try {
    storage?.removeItem?.(RECOVERY_STORAGE_KEY);
  } catch {
    // Nada que limpiar de forma fiable; no debe romper el cierre.
  }
}

/**
 * ¿Se debe ofrecer la recuperación? Solo si hay instantánea y es MÁS NUEVA
 * que el último guardado conocido del proyecto abierto. Sin guardado conocido
 * (arranque en frío) cualquier instantánea válida se ofrece.
 */
export function shouldOfferRecovery(
  recovered: RecoverySnapshot | null,
  current: RecoveryCurrentState | null,
): boolean {
  if (!recovered) {
    return false;
  }
  const recoveredTime = Date.parse(recovered.savedAt);
  if (!Number.isFinite(recoveredTime)) {
    return false;
  }
  if (!current || !current.savedAt) {
    return true;
  }
  const currentTime = Date.parse(current.savedAt);
  if (!Number.isFinite(currentTime)) {
    return true;
  }
  return recoveredTime > currentTime;
}

/** Opciones del escritor con retardo. */
export interface RecoveryWriterOptions {
  /** Retardo del debounce; por defecto `RECOVERY_DEBOUNCE_MS`. */
  readonly delayMs?: number;
  /** Almacenamiento donde escribir; por defecto `window.localStorage`. */
  readonly storage?: RecoveryStorage | null;
  /**
   * Se consulta cuando vence el temporizador: si devuelve `false` no se
   * escribe (p. ej. el proyecto ya se guardó mientras se esperaba).
   */
  readonly shouldWrite?: () => boolean;
}

/** Escritor con debounce, cancelable para no dejar temporizadores vivos. */
export interface RecoveryWriter {
  /** Agenda (o reagenda) la escritura 2 s después de la última llamada. */
  schedule(project: ProjectDocument, path: string): void;
  /** Cancela la escritura pendiente y olvida lo agendado. */
  cancel(): void;
}

/**
 * Crea el escritor con debounce: agrupa una ráfaga de cambios en una sola
 * escritura `delayMs` después del último. Cada `schedule` reinicia el
 * temporizador y conserva solo el documento más reciente.
 */
export function createRecoveryWriter(options: RecoveryWriterOptions = {}): RecoveryWriter {
  const delayMs = options.delayMs ?? RECOVERY_DEBOUNCE_MS;
  const storage = options.storage === undefined ? safeStorage() : options.storage;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { readonly project: ProjectDocument; readonly path: string } | null = null;

  return {
    schedule(project: ProjectDocument, path: string): void {
      pending = { project, path };
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        const snapshot = pending;
        pending = null;
        if (!snapshot) {
          return;
        }
        if (options.shouldWrite && !options.shouldWrite()) {
          return;
        }
        writeRecoverySnapshot(snapshot.project, snapshot.path, new Date().toISOString(), storage);
      }, delayMs);
    },
    cancel(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
