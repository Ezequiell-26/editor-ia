import type { VisualCatalog } from '../../services/project-service';

/**
 * Verificación del catálogo visual: **declarar no es verificar**.
 *
 * Lección tomada del análisis estático de AlaukCut (REA/Ghidra sobre
 * `motorcpp.cp311-win_amd64.pyd`, 2026-11-11): el módulo nativo expone
 * `*_suportada(s)` y el frontend pregunta antes de ofrecer una función.
 * Dos docstrings embebidos documentan el límite del enfoque:
 *
 * - `acabamento_suportado` responde `true` en un módulo compilado ANTES de
 *   que existieran efectos nuevos: el video sale válido pero sin el efecto,
 *   en silencio. La solución del autor fue devolver la LISTA de lo que el
 *   módulo realmente dibuja para que el frontend "pregunte y desista solo".
 * - `transicoes_suportadas` es "sólo una promesa": lista nombres sin
 *   compilarlos; un shader roto aparece recién en el export, que aborta en
 *   silencio. La solución fue compilar todo por adelantado y devolver
 *   nombre -> error.
 *
 * En Olyvia el equivalente es este módulo: el catálogo estático de la UI
 * (`FALLBACK_VISUAL_CATALOG`) es una declaración, no una medición. Sólo se
 * considera `verified` lo que el backend midió, existe y marcó disponible.
 * Todo lo demás se clasifica con un motivo explícito y la UI se niega a
 * aplicarlo en lugar de escribir una transición que luego no se renderiza.
 *
 * Es una comprobación de frontend sobre datos ya medidos: no ejecuta FFmpeg,
 * no compila shaders y no cambia el contrato del backend.
 */

export type VerificationState = 'verified' | 'unverified' | 'unsupported' | 'drift';

export interface DeclaredEntry {
  readonly id: string;
  readonly label: string;
}

export interface VerificationEntry extends DeclaredEntry {
  readonly kind: 'transition' | 'effect';
  readonly state: VerificationState;
  readonly reason: string;
}

export interface CatalogVerification {
  /** `listVisualCatalog()` respondió: el catálogo viene del backend. */
  readonly measured: boolean;
  readonly ffmpegAvailable: boolean;
  /** El backend informó inventario de filtros (sin él no se puede verificar un efecto). */
  readonly filtersReported: boolean;
  readonly entries: readonly VerificationEntry[];
  readonly counts: Readonly<Record<VerificationState, number>>;
  readonly problems: readonly VerificationEntry[];
  readonly declaredTransitions: number;
  readonly declaredEffects: number;
}

export const VERIFICATION_LABEL: Readonly<Record<VerificationState, string>> = {
  verified: 'Verificado',
  unverified: 'Sin verificar',
  unsupported: 'No disponible',
  drift: 'Desfasaje',
};

const NO_MEASUREMENT =
  'El backend no respondió: el catálogo es local y no se midió contra FFmpeg.';

type Verdict = Pick<VerificationEntry, 'state' | 'reason'>;

function verifyTransition(
  id: string,
  measured: boolean,
  catalog: VisualCatalog,
  byId: Map<string, { readonly available: boolean }>,
): Verdict {
  if (!measured) return { state: 'unverified', reason: NO_MEASUREMENT };
  const spec = byId.get(id);
  if (!spec) {
    return {
      state: 'drift',
      reason:
        'La interfaz declara esta transición pero el catálogo medido del backend no la incluye (posible desfasaje de versión).',
    };
  }
  if (!spec.available) {
    return {
      state: 'unsupported',
      reason: catalog.ffmpegAvailable
        ? 'El backend midió esta transición como no disponible en este equipo.'
        : 'El backend no pudo resolver FFmpeg; la transición no se puede renderizar.',
    };
  }
  return {
    state: 'verified',
    reason: 'Declarada por la interfaz y confirmada por el catálogo medido del backend.',
  };
}

function verifyEffect(
  id: string,
  measured: boolean,
  catalog: VisualCatalog,
  byId: Map<string, { readonly available: boolean; readonly filters: readonly string[] }>,
  filtersReported: boolean,
  filterAvailable: (name: string) => boolean,
): Verdict {
  if (!measured) return { state: 'unverified', reason: NO_MEASUREMENT };
  const spec = byId.get(id);
  if (!spec) {
    return {
      state: 'drift',
      reason:
        'La interfaz declara este efecto pero el catálogo medido del backend no lo incluye (posible desfasaje de versión).',
    };
  }
  if (!spec.available) {
    return {
      state: 'unsupported',
      reason: 'El backend marcó el efecto como no disponible: faltan filtros de FFmpeg.',
    };
  }
  if (!filtersReported) {
    return {
      state: 'unverified',
      reason:
        'El backend no reportó inventario de filtros; no se pudo confirmar el soporte del efecto.',
    };
  }
  const missing = spec.filters.filter((name) => !filterAvailable(name));
  if (missing.length > 0) {
    return {
      state: 'unsupported',
      reason: `Falta el filtro de FFmpeg: ${missing.join(', ')}.`,
    };
  }
  return {
    state: 'verified',
    reason: 'Efecto y filtros confirmados por el catálogo medido del backend.',
  };
}

/**
 * Cruza la declaración de la UI con el catálogo medido. También reporta lo
 * que el backend conoce y la UI no declara: ese desfasaje es visible en vez
 * de quedar escondido detrás de un `available: true` optimista.
 */
export function verifyVisualCatalog(
  catalog: VisualCatalog,
  measured: boolean,
  declared: {
    readonly transitions: readonly DeclaredEntry[];
    readonly effects: readonly DeclaredEntry[];
  },
): CatalogVerification {
  const transitionById = new Map(catalog.transitions.map((item) => [item.id, item] as const));
  const effectById = new Map(catalog.effects.map((item) => [item.id, item] as const));
  const filterByName = new Map(catalog.filters.map((item) => [item.name, item] as const));
  const filtersReported = catalog.filters.length > 0;
  const filterAvailable = (name: string): boolean =>
    filterByName.get(name)?.available === true;

  const entries: VerificationEntry[] = [];
  const declaredTransitionIds = new Set(declared.transitions.map((item) => item.id));
  const declaredEffectIds = new Set(declared.effects.map((item) => item.id));

  for (const item of declared.transitions) {
    entries.push({
      ...item,
      kind: 'transition',
      ...verifyTransition(item.id, measured, catalog, transitionById),
    });
  }
  for (const item of declared.effects) {
    entries.push({
      ...item,
      kind: 'effect',
      ...verifyEffect(item.id, measured, catalog, effectById, filtersReported, filterAvailable),
    });
  }

  // Sólo cuando hay medición tiene sentido comparar en el otro sentido.
  if (measured) {
    for (const [id, spec] of transitionById) {
      if (declaredTransitionIds.has(id)) continue;
      entries.push({
        id,
        label: spec.label,
        kind: 'transition',
        state: 'drift',
        reason: 'El backend reporta esta transición pero la interfaz no la declara.',
      });
    }
    for (const [id, spec] of effectById) {
      if (declaredEffectIds.has(id)) continue;
      entries.push({
        id,
        label: spec.label,
        kind: 'effect',
        state: 'drift',
        reason: 'El backend reporta este efecto pero la interfaz no lo declara.',
      });
    }
  }

  const counts: Record<VerificationState, number> = {
    verified: 0,
    unverified: 0,
    unsupported: 0,
    drift: 0,
  };
  for (const entry of entries) counts[entry.state] += 1;

  return {
    measured,
    ffmpegAvailable: catalog.ffmpegAvailable,
    filtersReported,
    entries,
    counts,
    problems: entries.filter((entry) => entry.state !== 'verified'),
    declaredTransitions: declared.transitions.length,
    declaredEffects: declared.effects.length,
  };
}

export function transitionVerification(
  verification: CatalogVerification,
  id: string,
): VerificationEntry | undefined {
  return verification.entries.find(
    (entry) => entry.kind === 'transition' && entry.id === id,
  );
}

/** Una transición sólo se puede escribir en el proyecto si está verificada. */
export function canApplyTransition(
  verification: CatalogVerification,
  id: string,
): boolean {
  return transitionVerification(verification, id)?.state === 'verified';
}
