/**
 * Teleprompter: lógica pura del scroll automático para narrar/locutar.
 *
 * El texto se parte en líneas (una por renglón no vacío del guion) y cada
 * línea dura `palabras / WPM` minutos. El scroll recorre las duraciones en
 * orden; la línea activa es la que contiene el tiempo transcurrido. Nada de
 * esto toca el DOM: el componente sólo dibuja y este módulo decide.
 */

import type { ProjectDocument } from '@editor-ia/project-schema';

/** Velocidad de lectura en palabras por minuto (locución tranquila ~140). */
export const TELEPROMPTER_MIN_WPM = 60;
export const TELEPROMPTER_MAX_WPM = 240;
export const TELEPROMPTER_DEFAULT_WPM = 140;

/** Tamaño de fuente del escenario, en px. */
export const TELEPROMPTER_MIN_FONT = 20;
export const TELEPROMPTER_MAX_FONT = 64;
export const TELEPROMPTER_DEFAULT_FONT = 36;

/** Clave base de persistencia; el proyecto abierto la sufija con su id. */
export const TELEPROMPTER_SCRIPT_STORAGE_PREFIX = 'editoria.teleprompter.script.';
export const TELEPROMPTER_PREFS_STORAGE_KEY = 'editoria.teleprompter.prefs.v1';

export interface TeleprompterPrefs {
  readonly wpm: number;
  readonly fontSize: number;
  readonly wrap: boolean;
}

export const TELEPROMPTER_DEFAULT_PREFS: TeleprompterPrefs = {
  wpm: TELEPROMPTER_DEFAULT_WPM,
  fontSize: TELEPROMPTER_DEFAULT_FONT,
  wrap: true,
};

/** Subconjunto de Web Storage para testear sin jsdom. */
export interface TeleprompterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function clampTeleprompterWpm(wpm: number): number {
  if (!Number.isFinite(wpm)) return TELEPROMPTER_DEFAULT_WPM;
  return Math.min(TELEPROMPTER_MAX_WPM, Math.max(TELEPROMPTER_MIN_WPM, Math.round(wpm)));
}

export function clampTeleprompterFontSize(px: number): number {
  if (!Number.isFinite(px)) return TELEPROMPTER_DEFAULT_FONT;
  return Math.min(TELEPROMPTER_MAX_FONT, Math.max(TELEPROMPTER_MIN_FONT, Math.round(px)));
}

/**
 * Texto del guion → unidades de scroll: un renglón por línea no vacía.
 * Normaliza CRLF y descarta líneas en blanco (los párrafos se leen como una
 * unidad por renglón, que es como se locuta un teleprompter real).
 */
export function splitTeleprompterLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Palabras de una línea: cualquier bloque separado por espacios. */
export function countTeleprompterWords(line: string): number {
  const matches = line.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/** Duración estimada de una línea a `wpm` palabras por minuto, en ms. */
export function teleprompterLineDurationMs(line: string, wpm: number): number {
  const safeWpm = clampTeleprompterWpm(wpm);
  const words = countTeleprompterWords(line);
  if (words === 0) return 0;
  return (words / safeWpm) * 60_000;
}

/** Duración total del guion, en ms. */
export function teleprompterTotalDurationMs(durationsMs: readonly number[]): number {
  return durationsMs.reduce((total, duration) => total + duration, 0);
}

/**
 * Índice de la línea que se está leyendo a `elapsedMs`. Las líneas vacías no
 * existen en `durationsMs` (vienen de `splitTeleprompterLines`), así que los
 * índices coinciden 1:1. Devuelve `durationsMs.length` cuando el tiempo ya
 * superó el final: el llamador decide si frena el scroll.
 */
export function teleprompterLineAt(
  elapsedMs: number,
  durationsMs: readonly number[],
): number {
  if (durationsMs.length === 0) return 0;
  const safeElapsed = Math.max(0, elapsedMs);
  let accumulated = 0;
  for (let index = 0; index < durationsMs.length; index += 1) {
    accumulated += durationsMs[index] ?? 0;
    if (safeElapsed < accumulated) return index;
  }
  return durationsMs.length;
}

/**
 * Clave de persistencia del guion. Con proyecto abierto se guarda por
 * proyecto (`…script.<id>`); sin proyecto, en la clave compartida para no
 * mezclar locuciones de trabajos distintos.
 */
export function teleprompterScriptStorageKey(projectId?: string | null): string {
  return projectId
    ? `${TELEPROMPTER_SCRIPT_STORAGE_PREFIX}${projectId}`
    : `${TELEPROMPTER_SCRIPT_STORAGE_PREFIX}shared`;
}

export function loadTeleprompterScript(
  storage: TeleprompterStorage,
  projectId?: string | null,
): string {
  try {
    return storage.getItem(teleprompterScriptStorageKey(projectId)) ?? '';
  } catch {
    return '';
  }
}

export function saveTeleprompterScript(
  storage: TeleprompterStorage,
  text: string,
  projectId?: string | null,
): void {
  try {
    storage.setItem(teleprompterScriptStorageKey(projectId), text);
  } catch {
    // Storage bloqueado o lleno: el guion sigue valiendo para la sesión.
  }
}

export function loadTeleprompterPrefs(storage: TeleprompterStorage): TeleprompterPrefs {
  try {
    const raw = storage.getItem(TELEPROMPTER_PREFS_STORAGE_KEY);
    if (!raw) return TELEPROMPTER_DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<TeleprompterPrefs>;
    return {
      wpm: clampTeleprompterWpm(typeof parsed.wpm === 'number' ? parsed.wpm : TELEPROMPTER_DEFAULT_WPM),
      fontSize: clampTeleprompterFontSize(
        typeof parsed.fontSize === 'number' ? parsed.fontSize : TELEPROMPTER_DEFAULT_FONT,
      ),
      wrap: typeof parsed.wrap === 'boolean' ? parsed.wrap : true,
    };
  } catch {
    return TELEPROMPTER_DEFAULT_PREFS;
  }
}

export function saveTeleprompterPrefs(
  storage: TeleprompterStorage,
  prefs: TeleprompterPrefs,
): void {
  try {
    storage.setItem(
      TELEPROMPTER_PREFS_STORAGE_KEY,
      JSON.stringify({
        wpm: clampTeleprompterWpm(prefs.wpm),
        fontSize: clampTeleprompterFontSize(prefs.fontSize),
        wrap: prefs.wrap,
      }),
    );
  } catch {
    // Sin persistencia las preferencias valen sólo para la sesión.
  }
}

/**
 * «Usar guion del proyecto»: la narración escrita de cada escena, en orden,
 * separada por una línea en blanco. Devuelve '' si el proyecto no tiene
 * texto de narración (el llamador avisa en vez de fingir contenido).
 */
export function scriptFromProject(
  project: Pick<ProjectDocument, 'scenes'> | null | undefined,
): string {
  if (!project) return '';
  return [...project.scenes]
    .sort((a, b) => a.order - b.order)
    .map((scene) => scene.narration.text?.trim() ?? '')
    .filter((text) => text.length > 0)
    .join('\n\n');
}
