import type { ClipTransition } from '@editor-ia/project-schema';

/**
 * Selección automática de transiciones para el montaje.
 *
 * El montaje automático usaba siempre un `dissolve` del mismo largo en cada
 * corte. Eso es seguro pero monótono: no distingue un corte entre dos fotos de
 * un cambio de foto a video, ni baja la intensidad cuando hay voz encima. Este
 * módulo decide tipo y duración por corte con reglas explicables y sin azar,
 * para que el mismo proyecto produzca siempre el mismo plan.
 *
 * Límites que respetan el resto del pipeline:
 * - `MAX_TRANSITION_SECONDS` (2 s) y `MAX_TRANSITION_FRAMES` (120) del esquema.
 * - La transición nunca es más larga que el clip entrante ni que el saliente.
 * - Los fundidos a negro/blanco sólo aceptan easing lineal (lo exige el esquema).
 */

/** Espejo de `MAX_TRANSITION_SECONDS` en `state/transition.ts`. */
export const SMART_TRANSITION_MAX_SECONDS = 2;
/** Espejo de `MAX_TRANSITION_FRAMES` en el esquema del proyecto. */
export const SMART_TRANSITION_MAX_FRAMES = 120;
/** Por debajo de tres frames el solape se percibe como un parpadeo. */
export const MIN_SMART_TRANSITION_FRAMES = 3;

export type TransitionRhythm = 'calm' | 'steady' | 'punchy';

/** Un plano del montaje: lo mínimo para decidir cómo se entra a él. */
export interface AssemblyShot {
  readonly kind: 'image' | 'video';
  readonly durationFrames: number;
  readonly hasNarration: boolean;
}

export interface SmartTransitionOptions {
  readonly fps: number;
  /** Duración pedida para un corte; si falta se usa medio segundo. */
  readonly baseFrames?: number;
  readonly rhythm?: TransitionRhythm;
  readonly maxSeconds?: number;
}

export interface SmartTransition {
  readonly type: ClipTransition['type'];
  readonly frames: number;
  readonly easing: NonNullable<ClipTransition['easing']>;
  readonly reason: string;
}

const RHYTHM_SCALE: Record<TransitionRhythm, number> = {
  calm: 0.75,
  steady: 1,
  punchy: 1.4,
};

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function capFrames(options: SmartTransitionOptions): number {
  const fps = positive(options.fps, 30);
  const seconds = Math.min(
    SMART_TRANSITION_MAX_SECONDS,
    positive(options.maxSeconds, SMART_TRANSITION_MAX_SECONDS),
  );
  return Math.min(SMART_TRANSITION_MAX_FRAMES, Math.floor(seconds * fps));
}

/**
 * Elige el tipo de transición para el corte `index` (1 = primer corte real).
 *
 * Prioridad de reglas:
 * 1. Planos muy cortos → disolvencia, que es la que menos movimiento agrega.
 * 2. Cambio de material (foto ↔ video) → fundido a negro: tapa el salto de
 *    textura sin fingir continuidad.
 * 3. Foto → foto → disolvencia; con ritmo `punchy` alterna barridos.
 * 4. Video → video con voz en ambos lados → disolvencia, para no competir con
 *    la narración. Sin voz, el corte puede ser más dinámico.
 */
function chooseType(
  previous: AssemblyShot,
  current: AssemblyShot,
  index: number,
  rhythm: TransitionRhythm,
  roomFrames: number,
  fps: number,
): { type: ClipTransition['type']; reason: string } {
  if (roomFrames < fps * 0.75) {
    return {
      type: 'dissolve',
      reason: 'planos muy cortos: disolvencia para no sumar movimiento',
    };
  }
  if (previous.kind !== current.kind) {
    return {
      type: 'fade-black',
      reason: `cambio de ${previous.kind === 'image' ? 'foto' : 'video'} a ${
        current.kind === 'image' ? 'foto' : 'video'
      }: fundido a negro`,
    };
  }
  // El primer corte real (index 1) abre la serie con la variante "izquierda".
  const alternate = index % 2 === 1;
  if (current.kind === 'image') {
    if (rhythm === 'punchy') {
      return {
        type: alternate ? 'wipe-left' : 'wipe-right',
        reason: 'foto a foto con ritmo rápido: barrido alternado',
      };
    }
    return { type: 'dissolve', reason: 'foto a foto: disolvencia' };
  }
  if (previous.hasNarration && current.hasNarration) {
    return {
      type: 'dissolve',
      reason: 'hay narración a ambos lados: disolvencia que no compite con la voz',
    };
  }
  if (rhythm === 'calm') {
    return { type: 'dissolve', reason: 'ritmo calmo sin voz: disolvencia' };
  }
  return {
    type: alternate ? 'slide-left' : 'slide-right',
    reason: 'video sin narración: desplazamiento alternado',
  };
}

function easingFor(type: ClipTransition['type']): NonNullable<ClipTransition['easing']> {
  if (type === 'fade-black' || type === 'fade-white') {
    // El esquema rechaza otra curva en los fundidos opacos.
    return 'linear';
  }
  if (type === 'dissolve') return 'ease-out';
  return 'ease-in-out';
}

/**
 * Plan de transiciones alineado con `shots`. La posición 0 siempre es `null`:
 * el primer plano no tiene corte de entrada (su fade lo maneja el clip).
 */
export function planSmartTransitions(
  shots: readonly AssemblyShot[],
  options: SmartTransitionOptions,
): (SmartTransition | null)[] {
  const fps = positive(options.fps, 30);
  const rhythm = options.rhythm ?? 'steady';
  const base = positive(options.baseFrames, Math.max(1, Math.round(fps * 0.5)));
  const cap = capFrames({ ...options, fps });
  const scaled = base * RHYTHM_SCALE[rhythm];

  return shots.map((current, index) => {
    if (index === 0) return null;
    const previous = shots[index - 1];
    if (!previous) return null;
    if (
      !Number.isFinite(current.durationFrames) ||
      !Number.isFinite(previous.durationFrames) ||
      current.durationFrames <= 0 ||
      previous.durationFrames <= 0
    ) {
      return null;
    }
    const roomFrames = Math.min(previous.durationFrames, current.durationFrames);
    const frames = Math.floor(Math.min(scaled, cap, roomFrames));
    if (frames < MIN_SMART_TRANSITION_FRAMES) return null;
    const choice = chooseType(previous, current, index, rhythm, roomFrames, fps);
    return {
      type: choice.type,
      frames,
      easing: easingFor(choice.type),
      reason: choice.reason,
    };
  });
}

/** Resumen legible del plan para avisos del montaje. */
export function describeTransitionPlan(plan: readonly (SmartTransition | null)[]): string {
  const counts = new Map<ClipTransition['type'], number>();
  let cuts = 0;
  for (const entry of plan) {
    if (!entry) continue;
    cuts += 1;
    counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  }
  if (cuts === 0) return 'Sin transiciones: los planos van a corte seco.';
  const detail = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');
  return `${cuts} corte(s) con transición: ${detail}.`;
}
