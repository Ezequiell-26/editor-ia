// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PolygonEditor } from './PolygonEditor';
import type { MotionPoint } from './templates';

const INITIAL: MotionPoint[] = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.5, y: 0.9 },
];

afterEach(() => {
  cleanup();
});

// jsdom no implementa PointerEvent: fireEvent.pointer* crea un Event sin
// clientX/clientY y el editor recibe NaN. Un MouseEvent con el type
// 'pointer*' burbujea igual y React lee las coordenadas del nativeEvent.
function pointerEvent(type: string, init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

describe('PolygonEditor', () => {
  it('dibuja el polígono con los puntos actuales', () => {
    render(<PolygonEditor value={INITIAL} onChange={() => {}} />);
    const svg = screen.getByRole('img', { name: /editor de puntos/i });
    expect(svg.querySelector('polygon')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /vértice/i })).toHaveLength(3);
  });

  it('el clic en el fondo agrega un vértice normalizado', () => {
    const onChange = vi.fn();
    render(<PolygonEditor value={INITIAL} onChange={onChange} />);
    const svg = screen.getByRole('img', { name: /editor de puntos/i });
    // jsdom reporta getBoundingClientRect en 0 → coordenadas = clientX/Y.
    fireEvent.click(svg, { clientX: 0.25, clientY: 0.75 });
    expect(onChange).toHaveBeenCalledWith([...INITIAL, { x: 0.25, y: 0.75 }]);
  });

  it('el doble clic sobre un vértice lo quita (mínimo 3)', () => {
    const onChange = vi.fn();
    const four = [...INITIAL, { x: 0.5, y: 0.5 }];
    render(<PolygonEditor value={four} onChange={onChange} />);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Vértice 4 de la forma' }));
    expect(onChange).toHaveBeenCalledWith(INITIAL);
  });

  it('con 3 puntos el doble clic no quita más', () => {
    const onChange = vi.fn();
    render(<PolygonEditor value={INITIAL} onChange={onChange} />);
    const first = screen.getAllByRole('button', { name: /vértice/i })[0];
    expect(first).toBeDefined();
    fireEvent.doubleClick(first as Element);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('arrastrar un vértice lo mueve', () => {
    const onChange = vi.fn();
    render(<PolygonEditor value={INITIAL} onChange={onChange} />);
    const vertex = screen.getByRole('button', { name: 'Vértice 1 de la forma' });
    fireEvent(vertex, pointerEvent('pointerdown', { clientX: 0.1, clientY: 0.1 }));
    fireEvent(vertex, pointerEvent('pointermove', { clientX: 0.4, clientY: 0.6 }));
    expect(onChange).toHaveBeenCalledWith([
      { x: 0.4, y: 0.6 },
      INITIAL[1],
      INITIAL[2],
    ]);
    fireEvent(vertex, pointerEvent('pointerup'));
  });

  it('deshabilitado no edita', () => {
    const onChange = vi.fn();
    render(<PolygonEditor value={INITIAL} onChange={onChange} disabled />);
    const svg = screen.getByRole('img', { name: /editor de puntos/i });
    fireEvent.click(svg, { clientX: 0.5, clientY: 0.5 });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/personalizada/i)).toBeTruthy();
  });

  it('tolera valores que no son puntos válidos', () => {
    render(<PolygonEditor value={[{ x: 2, y: -1 }, 'basura', null]} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /vértice/i })).toBeNull();
  });
});
