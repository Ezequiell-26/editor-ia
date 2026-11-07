// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionField } from './OptionField';

afterEach(cleanup);

function setup(overrides: Partial<{ value: number; min: number; max: number }> = {}) {
  const onCommit = vi.fn();
  const props = {
    label: 'Umbral',
    value: overrides.value ?? -45,
    min: overrides.min ?? -80,
    max: overrides.max ?? 0,
    step: 1,
    onCommit,
  };
  render(<OptionField {...props} />);
  return { onCommit, input: screen.getByRole('spinbutton', { name: 'Umbral' }) as HTMLInputElement };
}

describe('OptionField · contrato de confirmación', () => {
  it('no confirma mientras se escribe, sólo al perder foco', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '-30' } });
    expect(input.value).toBe('-30');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(-30);
  });

  it('confirma con Enter y acota el valor al rango [min, max]', () => {
    const { onCommit, input } = setup({ max: 0 });
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it('conserva el contrato heredado: vaciar el campo confirma 0 (Number("") === 0)', () => {
    // Es el comportamiento de las dos implementaciones originales. Se fija
    // aquí como regresión documentada: cambiarlo es una decisión de UX
    // separada, no parte de la extracción a primitiva compartida.
    const { onCommit, input } = setup({ value: -45 });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it('sincroniza el borrador cuando cambia el valor externo', () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <OptionField label="Umbral" value={-45} min={-80} max={0} step={1} onCommit={onCommit} />,
    );
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('-45');
    rerender(<OptionField label="Umbral" value={-20} min={-80} max={0} step={1} onCommit={onCommit} />);
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('-20');
  });
});
