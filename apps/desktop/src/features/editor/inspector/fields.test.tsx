// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberField } from './fields';

afterEach(cleanup);

function renderField(props?: Partial<Parameters<typeof NumberField>[0]>) {
  const onCommit = vi.fn();
  render(
    <NumberField label="Opacidad" value={10} step={2} min={0} max={20} onCommit={onCommit} {...props} />,
  );
  const input = screen.getByRole('spinbutton', { name: /Opacidad/i });
  return { input, onCommit };
}

describe('NumberField · stepper por teclado', () => {
  it('ArrowUp/ArrowDown mueven el valor por step y commitean', () => {
    const { input, onCommit } = renderField();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onCommit.mock.lastCall?.[0]).toBe(12);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onCommit.mock.lastCall?.[0]).toBe(8);
  });

  it('PageUp/PageDown saltan 10 pasos', () => {
    const { input, onCommit } = renderField({ max: 100 });
    fireEvent.keyDown(input, { key: 'PageUp' });
    expect(onCommit.mock.lastCall?.[0]).toBe(30);
    fireEvent.keyDown(input, { key: 'PageDown' });
    expect(onCommit.mock.lastCall?.[0]).toBe(10);
    fireEvent.keyDown(input, { key: 'PageDown' });
    expect(onCommit.mock.lastCall?.[0]).toBe(0);
  });

  it('respeta min/max al pisar el borde', () => {
    const { input, onCommit } = renderField({ value: 19 });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onCommit.mock.lastCall?.[0]).toBe(20);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onCommit.mock.lastCall?.[0]).toBe(20);
  });

  it('en disabled las flechas no commitean', () => {
    const { input, onCommit } = renderField({ disabled: true });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Enter sigue commiteando el borrador', () => {
    const { input, onCommit } = renderField();
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit.mock.lastCall?.[0]).toBe(7);
  });
});
