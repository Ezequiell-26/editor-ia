/**
 * Asistente de «Crear proyecto»: la intención del usuario (Short vertical,
 * Horizontal, Cuadrado, Cine) se traduce a una configuración recomendada de
 * formato y fps. Es un módulo puro: no toca React ni el store, así la
 * recomendación es verificable en tests y reutilizable si otro flujo la
 * necesita (p. ej. las plantillas de un clic).
 *
 * Los fps recomendados usan ids de `FPS_PRESETS` que existen hoy
 * (30, 60 y 24 exactos); el test `project-intent.test.ts` lo garantiza para
 * que un preset renombrado no rompa el asistente en silencio.
 */

export type ProjectIntentId = 'short' |'horizontal' |'square' |'cinema';

export interface ProjectIntentOption {
  readonly id: ProjectIntentId;
  readonly label: string;
  /** Resumen corto visible en la opción (ej. «9:16 · 30 fps»). */
  readonly summary: string;
}

export const PROJECT_INTENTS: readonly ProjectIntentOption[] = [
  { id: 'short', label: 'Short vertical', summary: '9:16 · 30 fps' },
  { id: 'horizontal', label: 'Horizontal', summary: '16:9 · 60 fps' },
  { id: 'square', label: 'Cuadrado', summary: '1:1 · 30 fps' },
  { id: 'cinema', label: 'Cine', summary: '21:9 · 24 fps' },
];

export interface ProjectIntentConfig {
  /** Id del preset de `FORMAT_PRESETS` que queda seleccionado en el diálogo. */
  readonly formatId: string;
  readonly width: number;
  readonly height: number;
  /** Id del preset de `FPS_PRESETS` que queda seleccionado en el diálogo. */
  readonly fpsId: string;
  readonly fpsNum: number;
  readonly fpsDen: number;
  /** Línea de ayuda contextual que explica la recomendación. */
  readonly help: string;
}

const INTENT_CONFIGS: Record<ProjectIntentId, ProjectIntentConfig> = {
  short: {
    formatId: 'vertical',
    width: 1080,
    height: 1920,
    fpsId: '30',
    fpsNum: 30,
    fpsDen: 1,
    help: 'Vertical 1080×1920 a 30 fps: el formato de Shorts, Reels y TikTok.',
  },
  horizontal: {
    formatId: 'landscape',
    width: 1920,
    height: 1080,
    fpsId: '60',
    fpsNum: 60,
    fpsDen: 1,
    help: 'Horizontal 1920×1080 a 60 fps: YouTube y pantalla completa se ven más fluídos.',
  },
  square: {
    formatId: 'square',
    width: 1080,
    height: 1080,
    fpsId: '30',
    fpsNum: 30,
    fpsDen: 1,
    help: 'Cuadrado 1080×1080 a 30 fps: el formato del feed de Instagram y publicaciones.',
  },
  cinema: {
    formatId: 'cinema',
    width: 2560,
    height: 1080,
    fpsId: '24',
    fpsNum: 24,
    fpsDen: 1,
    help: 'Ultra-wide 2560×1080 a 24 fps: el look cinematográfico de 21:9.',
  },
};

/** Configuración recomendada para una intención. Siempre devuelve valores. */
export function intentConfig(intentId: ProjectIntentId): ProjectIntentConfig {
  return INTENT_CONFIGS[intentId];
}

/** Etiqueta de la intención para mensajes o aria-describedby. */
export function intentLabel(intentId: ProjectIntentId): string {
  return PROJECT_INTENTS.find((intent) => intent.id === intentId)?.label ?? intentId;
}

/**
 * Guard para valores que llegan de fuera (localStorage, deep links). Sólo
 * acepta ids declarados en `PROJECT_INTENTS`.
 */
export function isProjectIntentId(value: unknown): value is ProjectIntentId {
  return typeof value === 'string' && PROJECT_INTENTS.some((intent) => intent.id === value);
}
