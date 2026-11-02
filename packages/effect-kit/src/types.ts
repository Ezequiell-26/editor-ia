/**
 * Tipos del motor de efectos.
 *
 * Un efecto es un dato, no una rama de código: un manifiesto declara sus
 * parámetros, su pipeline de fragment shaders y su receta de export. El editor
 * no conoce los efectos de antemano, sólo sabe dibujar manifiestos y apilar
 * instancias. Ésa es la diferencia estructural con el `ClipEffects` plano: acá
 * sumar un efecto no obliga a tocar el schema, el renderer ni la UI.
 */

export const EFFECT_KINDS = ['video', 'transition', 'audio'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

/**
 * Categorías del navegador. Se mantienen cortas y en inglés porque son claves
 * estables de traducción y de filtrado; la etiqueta visible vive en `CATEGORY_LABELS`.
 */
export const EFFECT_CATEGORIES = [
  'color',
  'light',
  'blur',
  'stylize',
  'glitch',
  'retro',
  'impact',
  'keying',
  'distort',
  'audio',
  'space',
  'texture',
  'transmission',
  'utility',
  'voice',
] as const;
export type EffectCategory = (typeof EFFECT_CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<EffectCategory, string>> = {
  color: 'Color',
  light: 'Luz',
  blur: 'Desenfoque',
  stylize: 'Estilo',
  glitch: 'Glitch',
  retro: 'Retro',
  impact: 'Impacto',
  keying: 'Croma',
  distort: 'Distorsión',
  audio: 'Audio',
  space: 'Espacio',
  texture: 'Textura',
  transmission: 'Transmisión',
  utility: 'Utilería',
  voice: 'Voz',
};

/** Un valor de parámetro ya normalizado: número, booleano, color `#rrggbb` o par. */
export type ParamValue = number | boolean | string | readonly [number, number];

export type ParamType = 'float' | 'int' | 'bool' | 'color' | 'vec2' | 'enum';

interface ParamBase {
  readonly id: string;
  readonly label: string;
  /** Sección del inspector. Sin grupo, el parámetro va suelto arriba. */
  readonly group?: string;
  /** El grupo arranca cerrado. */
  readonly groupCollapsed?: boolean;
  readonly hint?: string;
}

export interface FloatParamSpec extends ParamBase {
  readonly type: 'float';
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly default: number;
  readonly unit?: string;
}

export interface IntParamSpec extends ParamBase {
  readonly type: 'int';
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly unit?: string;
}

export interface BoolParamSpec extends ParamBase {
  readonly type: 'bool';
  readonly default: boolean;
}

export interface ColorParamSpec extends ParamBase {
  readonly type: 'color';
  /** `#rrggbb`. */
  readonly default: string;
}

export interface Vec2ParamSpec extends ParamBase {
  readonly type: 'vec2';
  /** Rango compartido por ambos ejes. */
  readonly min: number;
  readonly max: number;
  readonly default: readonly [number, number];
}

export interface EnumParamSpec extends ParamBase {
  readonly type: 'enum';
  readonly options: readonly string[];
  /** Índice de `options`. */
  readonly default: number;
}

export type ParamSpec =
  | FloatParamSpec
  | IntParamSpec
  | BoolParamSpec
  | ColorParamSpec
  | Vec2ParamSpec
  | EnumParamSpec;

/**
 * Entrada de un pass. `source` es el frame original del clip; `pass` es la
 * salida de un pass anterior, lo que permite cadenas (desenfoque separable,
 * bloom en dos tiempos, etc.).
 */
export type PassInput =
  | { readonly from: 'source' }
  | { readonly from: 'pass'; readonly index: number };

export interface GpuPass {
  /**
   * Cuerpo del fragment shader en GLSL ES 3.00. El renderer antepone el
   * encabezado (`#version`, precisión, `v_texCoord`, `fragColor`), el preludio
   * de utilidades y los uniforms; acá sólo va `void main()`.
   */
  readonly shader: string;
  /** Entradas extra, además de `u_currentTexture`. */
  readonly inputs?: readonly PassInput[];
}

export type ExportFidelity = 'exact' | 'approximate' | 'preview-only';

export interface FfmpegRecipe {
  /**
   * Plantillas de filtro que se agregan al final de la cadena del clip. Los
   * marcadores `{param}` se sustituyen por el valor formateado del parámetro;
   * `{param.x}` y `{param.y}` sirven para `vec2`.
   */
  readonly chain?: readonly string[];
  /**
   * Grafo que reemplaza la cola de la cadena del clip. `%A%` se sustituye por
   * un token único para que dos instancias del mismo efecto en el mismo clip no
   * colisionen con sus etiquetas. Sirve para `split` + `blend`, que no se pueden
   * expresar como filtros sueltos.
   */
  readonly graph?: string;
  readonly fidelity: Exclude<ExportFidelity, 'preview-only'>;
  /** Por qué la aproximación no es idéntica, cuando aplica. */
  readonly note?: string;
}

/**
 * Receta de audio: filtros que entran en la cadena del clip, no en la de video.
 *
 * Dos macros resuelven lo que una plantilla estática no puede:
 * - `%RATE%` → frecuencia de muestreo del perfil (48 kHz por defecto).
 * - `%INV:<param>%` → inverso del parámetro, para que un cambio de tono
 *   conserve la duración (`asetrate` + `atempo`).
 */
export interface AudioRecipe {
  readonly chain: readonly string[];
  readonly fidelity: Exclude<ExportFidelity, 'preview-only'>;
  /** Por qué la aproximación no es idéntica, cuando aplica. */
  readonly note?: string;
}

export interface EffectManifest {
  /** Identificador estable y único, en `snake_case` con prefijo de categoría. */
  readonly id: string;
  readonly name: string;
  readonly category: EffectCategory;
  readonly kind: EffectKind;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly params: readonly ParamSpec[];
  readonly gpu?: { readonly passes: readonly GpuPass[] };
  readonly ffmpeg?: FfmpegRecipe;
  /** Cadena de audio del export. Sólo para `kind: 'audio'`. */
  readonly audio?: AudioRecipe;
  /**
   * Nombre del `xfade` de FFmpeg que reproduce esta transición. Es metadata:
   * el renderer de transiciones lo consume, el compilador de stack lo ignora.
   */
  readonly xfade?: string;
  /** Orden dentro de la categoría; menor primero. */
  readonly order?: number;
}

export interface EffectKeyframe {
  readonly frame: number;
  readonly value: number;
  readonly easing?: 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

/**
 * Instancia aplicada a un clip. `params` guarda sólo lo que el usuario tocó;
 * el resto se resuelve contra los defaults del manifiesto en tiempo de lectura,
 * así un manifiesto puede ganar parámetros sin romper proyectos guardados.
 */
export interface EffectInstance {
  readonly id: string;
  readonly effectId: string;
  readonly enabled: boolean;
  readonly params: Readonly<Record<string, ParamValue>>;
  /** Animación por parámetro numérico. La clave es el `id` del parámetro. */
  readonly keyframes?: Readonly<Record<string, readonly EffectKeyframe[]>>;
}
