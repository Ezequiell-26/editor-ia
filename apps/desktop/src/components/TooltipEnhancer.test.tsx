// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipEnhancer } from './TooltipEnhancer';

afterEach(() => {
  cleanup();
  document.querySelectorAll('.tooltip-flip').forEach((n) => n.classList.remove('tooltip-flip'));
});

function mount() {
  return render(
    <div>
      <TooltipEnhancer />
      <button type="button" title="Guardar proyecto" data-testid="btn">
        Guardar
      </button>
      <span data-tooltip="Ya estilado" title="Titulo nativo" data-testid="both">
        ambos
      </span>
      <em data-testid="plain">sin tooltip</em>
    </div>,
  );
}

describe('TooltipEnhancer', () => {
  it('convierte title en data-tooltip al hover y lo restaura al salir', () => {
    const { getByTestId } = mount();
    const btn = getByTestId('btn');

    fireEvent.mouseOver(btn);
    expect(btn.getAttribute('data-tooltip')).toBe('Guardar proyecto');
    expect(btn.hasAttribute('title')).toBe(false);

    fireEvent.mouseOut(btn, { relatedTarget: document.body });
    expect(btn.getAttribute('title')).toBe('Guardar proyecto');
    expect(btn.hasAttribute('data-tooltip')).toBe(false);
  });

  it('conserva un data-tooltip preexistente y sólo retira el title', () => {
    const { getByTestId } = mount();
    const both = getByTestId('both');

    fireEvent.mouseOver(both);
    expect(both.getAttribute('data-tooltip')).toBe('Ya estilado');
    expect(both.hasAttribute('title')).toBe(false);

    fireEvent.mouseOut(both, { relatedTarget: document.body });
    expect(both.getAttribute('title')).toBe('Titulo nativo');
    expect(both.getAttribute('data-tooltip')).toBe('Ya estilado');
  });

  it('no toca elementos sin title ni data-tooltip', () => {
    const { getByTestId } = mount();
    const plain = getByTestId('plain');
    fireEvent.mouseOver(plain);
    expect(plain.hasAttribute('data-tooltip')).toBe(false);
    expect(plain.hasAttribute('title')).toBe(false);
  });

  it('agrega .tooltip-flip cuando el elemento está cerca del borde inferior', () => {
    const { getByTestId } = mount();
    const btn = getByTestId('btn');
    vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({
      bottom: window.innerHeight - 10,
      top: window.innerHeight - 40,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.mouseOver(btn);
    expect(btn.classList.contains('tooltip-flip')).toBe(true);

    fireEvent.mouseOut(btn, { relatedTarget: document.body });
    expect(btn.classList.contains('tooltip-flip')).toBe(false);
  });

  it('no flipa elementos dentro de .sidebar ni con clase .tooltip', () => {
    render(
      <div>
        <TooltipEnhancer />
        <div className="sidebar">
          <button type="button" title="Item sidebar" data-testid="side">
            s
          </button>
        </div>
        <button type="button" className="tooltip" title="Tooltip propio" data-testid="own">
          t
        </button>
      </div>,
    );
    const side = document.querySelector('[data-testid="side"]') as HTMLElement;
    const own = document.querySelector('[data-testid="own"]') as HTMLElement;
    for (const el of [side, own]) {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        bottom: window.innerHeight - 5,
        top: window.innerHeight - 30,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
      fireEvent.mouseOver(el);
      expect(el.classList.contains('tooltip-flip')).toBe(false);
      fireEvent.mouseOut(el, { relatedTarget: document.body });
    }
  });
});
