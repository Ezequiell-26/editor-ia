// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeedCurveEditor } from './SpeedCurveEditor';

afterEach(() => cleanup());

function renderEditor(overrides: Partial<Parameters<typeof SpeedCurveEditor>[0]> = {}) {
  const onApply = vi.fn();
  render(
    <SpeedCurveEditor
      sourceFrames={300}
      fps={30}
      onApply={onApply}
      {...overrides}
    />,
  );
  return { onApply };
}

describe('editor de curva de velocidad', () => {
  it('muestra la duración que sale de la media', () => {
    renderEditor();
    expect(screen.getByText(/1\.00× media · 300 frames · 10\.00 s/)).toBeTruthy();
  });

  it('aplica el preset Héroe con la duración recalculada', () => {
    const { onApply } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Héroe' }));
    expect(screen.getByText(/1\.25× media · 240 frames · 8\.00 s/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar curva' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const curve = onApply.mock.calls[0]![0];
    expect(curve.points).toHaveLength(2);
    expect(curve.points[0].speed).toBeCloseTo(0.5, 5);
    expect(curve.points[1].speed).toBeCloseTo(2, 5);
  });

  it('agrega, selecciona y quita puntos intermedios', () => {
    renderEditor();
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '+ Punto' }));
    expect(screen.getAllByRole('slider')).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('slider')[1]!);
    fireEvent.click(screen.getByRole('button', { name: '− Quitar' }));
    expect(screen.getAllByRole('slider')).toHaveLength(2);
  });

  it('ajusta la velocidad del punto con el teclado', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Punto' }));
    const middle = screen.getAllByRole('slider')[1]!;
    expect(middle.getAttribute('aria-valuenow')).toBe('1');
    fireEvent.keyDown(middle, { key: 'ArrowUp' });
    expect(middle.getAttribute('aria-valuenow')).toBe('1.05');
  });

  it('expone el flujo óptico y los fps objetivo', () => {
    renderEditor();
    const fps = screen.getByLabelText('FPS objetivo') as HTMLSelectElement;
    expect(fps.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/flujo óptico/i));
    expect(fps.disabled).toBe(false);
    fireEvent.change(fps, { target: { value: '120' } });
    expect(fps.value).toBe('120');
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar curva' }));
  });
});
