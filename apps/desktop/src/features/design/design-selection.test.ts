// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESIGN_APPLIED_EVENT,
  DESIGN_SELECTION_KEY,
  applyDesignSystem,
  loadDesignSelection,
} from './design-selection';

const entry = {
  id: 'aurora',
  name: 'Aurora',
  canvas: { accent: '#ff385c', accentOn: '#ffffff', bg: '#ffffff', fg: '#222222' },
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('selección de diseño', () => {
  it('guarda la paleta y anuncia el cambio', () => {
    const listener = vi.fn();
    window.addEventListener(DESIGN_APPLIED_EVENT, listener);
    const selection = applyDesignSystem(entry, () => '2026-10-29T12:00:00.000Z');
    expect(selection).toEqual({
      id: 'aurora',
      name: 'Aurora',
      accent: '#ff385c',
      accentOn: '#ffffff',
      bg: '#ffffff',
      fg: '#222222',
      appliedAt: '2026-10-29T12:00:00.000Z',
    });
    expect(loadDesignSelection()).toEqual(selection);
    expect(JSON.parse(window.localStorage.getItem(DESIGN_SELECTION_KEY) ?? '{}')).toMatchObject({
      id: 'aurora',
      accent: '#ff385c',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toMatchObject({ id: 'aurora' });
    window.removeEventListener(DESIGN_APPLIED_EVENT, listener);
  });

  it('ignora un acento que el canvas no puede usar', () => {
    const selection = applyDesignSystem({
      ...entry,
      canvas: { ...entry.canvas, accent: 'color-mix(in oklab, red, black)' },
    });
    expect(selection).toBeNull();
    expect(loadDesignSelection()).toBeNull();
  });

  it('descarta selecciones viejas o corruptas', () => {
    window.localStorage.setItem(DESIGN_SELECTION_KEY, '{no-json');
    expect(loadDesignSelection()).toBeNull();
    window.localStorage.setItem(
      DESIGN_SELECTION_KEY,
      JSON.stringify({ id: 'x', name: 'X', accent: 'azul' }),
    );
    expect(loadDesignSelection()).toBeNull();
  });
});
