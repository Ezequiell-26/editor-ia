// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BeforeAfterSlider } from './BeforeAfterSlider';

const BEFORE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const AFTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function renderSlider(overrides: Partial<Parameters<typeof BeforeAfterSlider>[0]> = {}) {
  const onPositionChange = vi.fn();
  render(
    <BeforeAfterSlider
      beforeUrl={BEFORE}
      afterUrl={AFTER}
      position={50}
      mode="slider"
      zoom={1}
      onPositionChange={onPositionChange}
      {...overrides}
    />,
  );
  return { onPositionChange };
}

/**
 * jsdom no implementa `PointerEvent`: `fireEvent.pointerDown` crea el evento
 * sin `clientX`. Se despacha un `MouseEvent` con el tipo de pointer, que es
 * lo mismo que escucha React.
 */
function firePointer(
  node: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
): void {
  fireEvent(
    node,
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX }),
  );
}

afterEach(cleanup);

describe('comparador antes/después', () => {
  it('mueve la línea al arrastrar sobre el escenario', () => {
    const { onPositionChange } = renderSlider();
    const stage = document.querySelector('.ba-stage') as HTMLDivElement;
    // jsdom no mide: getBoundingClientRect devuelve 0. Se simulă un rect.
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 200,
      left: 0,
      top: 0,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    firePointer(stage, 'pointerdown', 100);
    expect(onPositionChange).toHaveBeenCalledWith(25);

    firePointer(stage, 'pointermove', 300);
    expect(onPositionChange).toHaveBeenLastCalledWith(75);

    firePointer(stage, 'pointerup', 300);
    // Soltado el puntero, un movimiento más no cambia nada.
    firePointer(stage, 'pointermove', 50);
    expect(onPositionChange).toHaveBeenCalledTimes(2);
  });

  it('mueve la línea con el teclado y salta a los extremos', () => {
    const { onPositionChange } = renderSlider({ position: 50 });
    const handle = screen.getByRole('slider', { name: /línea de comparación/i });

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onPositionChange).toHaveBeenLastCalledWith(49);

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(onPositionChange).toHaveBeenLastCalledWith(60);

    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onPositionChange).toHaveBeenLastCalledWith(0);

    fireEvent.keyDown(handle, { key: 'End' });
    expect(onPositionChange).toHaveBeenLastCalledWith(100);

    // Tecla ajena: no hace nada.
    fireEvent.keyDown(handle, { key: 'a' });
    expect(onPositionChange).toHaveBeenCalledTimes(4);
  });

  it('en modo diferencia no dibuja línea ni manija', () => {
    renderSlider({ mode: 'difference' });
    expect(document.querySelector('.ba-line')).toBeNull();
    expect(screen.queryByRole('slider', { name: /línea de comparación/i })).toBeNull();
    // La capa posterior sigue estando, mezclada.
    expect(document.querySelector('.ba-after')).toBeTruthy();
  });

  it('expone el porcentaje en el atributo ARIA', () => {
    renderSlider({ position: 37.4 });
    const handle = screen.getByRole('slider', { name: /línea de comparación/i });
    expect(handle.getAttribute('aria-valuenow')).toBe('37');
    expect(handle.getAttribute('aria-valuetext')).toBe('37 % de la versión procesada');
  });
});
