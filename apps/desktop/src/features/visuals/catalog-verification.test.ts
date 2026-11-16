import { describe, expect, it } from 'vitest';
import type { VisualCatalog } from '../../services/project-service';
import { FALLBACK_VISUAL_CATALOG } from './visuals';
import {
  canApplyTransition,
  transitionVerification,
  verifyVisualCatalog,
} from './catalog-verification';

const declared = {
  transitions: FALLBACK_VISUAL_CATALOG.transitions.map(({ id, label }) => ({ id, label })),
  effects: FALLBACK_VISUAL_CATALOG.effects.map(({ id, label }) => ({ id, label })),
};

function measured(overrides: Partial<VisualCatalog> = {}): VisualCatalog {
  return {
    ...FALLBACK_VISUAL_CATALOG,
    ffmpegAvailable: true,
    filters: [{ name: 'eq', label: 'EQ', available: true }],
    ...overrides,
  };
}

describe('Verificación de catálogo visual (declarar != verificar)', () => {
  it('sin medición del backend, ninguna opción se presenta como verificada', () => {
    const result = verifyVisualCatalog(FALLBACK_VISUAL_CATALOG, false, declared);

    expect(result.measured).toBe(false);
    expect(result.counts.verified).toBe(0);
    expect(result.counts.unverified).toBe(
      declared.transitions.length + declared.effects.length,
    );
    expect(result.problems).toHaveLength(result.entries.length);
    expect(canApplyTransition(result, 'dissolve')).toBe(false);
    expect(transitionVerification(result, 'dissolve')?.reason).toContain('no se midió');
  });

  it('con medición y filtros disponibles, las transiciones y efectos quedan verificados', () => {
    const result = verifyVisualCatalog(measured(), true, declared);

    expect(result.measured).toBe(true);
    expect(result.filtersReported).toBe(true);
    expect(result.counts.verified).toBe(result.entries.length);
    expect(result.problems).toHaveLength(0);
    expect(canApplyTransition(result, 'dissolve')).toBe(true);
    expect(transitionVerification(result, 'dissolve')?.state).toBe('verified');
    expect(
      result.entries.find((entry) => entry.kind === 'effect' && entry.id === 'brightness')
        ?.state,
    ).toBe('verified');
  });

  it('detecta desfasaje: la interfaz declara una transición que el backend no mide', () => {
    const catalog = measured({
      transitions: FALLBACK_VISUAL_CATALOG.transitions.filter((item) => item.id !== 'dissolve'),
    });
    const result = verifyVisualCatalog(catalog, true, declared);

    const entry = transitionVerification(result, 'dissolve');
    expect(entry?.state).toBe('drift');
    expect(entry?.reason).toContain('desfasaje');
    expect(canApplyTransition(result, 'dissolve')).toBe(false);
    expect(canApplyTransition(result, 'fade-black')).toBe(true);
  });

  it('marca como no disponible lo que el backend midió como unavailable', () => {
    const catalog = measured({
      ffmpegAvailable: false,
      transitions: FALLBACK_VISUAL_CATALOG.transitions.map((item) =>
        item.id === 'dissolve' ? { ...item, available: false } : item,
      ),
    });
    const result = verifyVisualCatalog(catalog, true, declared);

    expect(transitionVerification(result, 'dissolve')?.state).toBe('unsupported');
    expect(transitionVerification(result, 'dissolve')?.reason).toContain('FFmpeg');
    expect(canApplyTransition(result, 'dissolve')).toBe(false);
  });

  it('sin inventario de filtros, un efecto no se puede verificar aunque esté available', () => {
    const result = verifyVisualCatalog(measured({ filters: [] }), true, declared);

    expect(result.filtersReported).toBe(false);
    expect(
      result.entries.find((entry) => entry.kind === 'effect' && entry.id === 'brightness')
        ?.state,
    ).toBe('unverified');
    // Las transiciones no dependen del inventario de filtros.
    expect(transitionVerification(result, 'dissolve')?.state).toBe('verified');
  });

  it('un efecto cuyo filtro falta queda no disponible con el nombre del filtro', () => {
    const result = verifyVisualCatalog(
      measured({ filters: [{ name: 'eq', label: 'EQ', available: false }] }),
      true,
      declared,
    );

    const entry = result.entries.find(
      (item) => item.kind === 'effect' && item.id === 'brightness',
    );
    expect(entry?.state).toBe('unsupported');
    expect(entry?.reason).toContain('eq');
  });

  it('reporta también lo que el backend conoce y la interfaz no declara', () => {
    const extra = {
      ...FALLBACK_VISUAL_CATALOG.transitions[0]!,
      id: 'transicion-solo-backend',
      label: 'Sólo backend',
    };
    const result = verifyVisualCatalog(
      measured({ transitions: [...FALLBACK_VISUAL_CATALOG.transitions, extra] }),
      true,
      declared,
    );

    const entry = transitionVerification(result, extra.id);
    expect(entry?.state).toBe('drift');
    expect(entry?.reason).toContain('interfaz no la declara');
  });

  it('los conteos siempre suman el total de entradas', () => {
    const catalog = measured({
      transitions: FALLBACK_VISUAL_CATALOG.transitions.map((item) =>
        item.id === 'iris' ? { ...item, available: false } : item,
      ),
    });
    const result = verifyVisualCatalog(catalog, true, declared);

    const total = Object.values(result.counts).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(result.entries.length);
    expect(result.problems.length).toBe(result.entries.length - result.counts.verified);
  });
});
