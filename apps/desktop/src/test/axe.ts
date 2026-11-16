import axe from 'axe-core';

/**
 * Helper de auditoría axe-core para los tests jsdom.
 *
 * axe-core evalúa el DOM real; en jsdom varias reglas no pueden funcionar
 * porque el motor no calcula layout (getBoundingClientRect devuelve 0,
 * scrollWidth/scrollHeight son 0 y getComputedStyle no resuelve la cascada
 * completa de la app). Reglas deshabilitadas a propósito:
 *
 * - `color-contrast`: necesita contraste calculado con layout real. La
 *   cobertura AA existente vive en `e2e/theme.spec.ts` y
 *   `state/theme-palette.test.ts`; la auditoría visual queda para la spec
 *   de Playwright contra la app real.
 * - `scrollable-region-focusable` / `focus-order-semantics`: dependen del
 *   overflow real; en jsdom todo mide 0 y producirían falsos positivos.
 *
 * Todo lo demás (roles, nombres accesibles, landmarks, ARIA válido,
 * etiquetas de formulario, etc.) sí se evalúa sobre el DOM montado.
 */
const JSDOM_INCOMPATIBLE_RULES = [
  'color-contrast',
  'scrollable-region-focusable',
  'focus-order-semantics',
] as const;

export interface AxeNodeHit {
  readonly target: string;
  readonly html: string;
}

export interface AxeViolation {
  readonly id: string;
  readonly impact: axe.ImpactValue | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodes: readonly AxeNodeHit[];
}

export interface AxeAudit {
  readonly violations: readonly AxeViolation[];
  readonly incomplete: readonly AxeViolation[];
}

/** Corre axe sobre el contexto y devuelve violaciones + incompletas. */
export async function runAxe(
  context: Element | Document = document.body,
): Promise<AxeAudit> {
  // axe exige `lang` en <html>; el documento de vitest arranca sin él.
  if (!document.documentElement.lang) document.documentElement.lang = 'es';
  const results = await axe.run(context, {
    resultTypes: ['violations', 'incomplete'],
    rules: Object.fromEntries(
      JSDOM_INCOMPATIBLE_RULES.map((id) => [id, { enabled: false }]),
    ),
  });
  const map = (list: axe.Result[]): AxeViolation[] =>
    list.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        target: node.target.join(' '),
        html: node.html.slice(0, 200),
      })),
    }));
  return { violations: map(results.violations), incomplete: map(results.incomplete) };
}

/** Viola­ciones agrupadas por impacto, para reportes legibles en consola. */
export function formatViolations(violations: readonly AxeViolation[]): string {
  if (violations.length === 0) return '(sin violaciones)';
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 5)
        .map((node) => `      · ${node.target} :: ${node.html}`)
        .join('\n');
      const extra = violation.nodes.length > 5 ? `\n      … y ${violation.nodes.length - 5} más` : '';
      return `[${violation.impact ?? 'n/a'}] ${violation.id}: ${violation.help}\n${nodes}${extra}`;
    })
    .join('\n');
}
