// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { EffectStack } from '@editor-ia/effect-kit';
import { AudioEffectStack } from './AudioEffectStack';

afterEach(cleanup);

function Harness() {
  const [stack, setStack] = useState<EffectStack>([]);
  return <AudioEffectStack stack={stack} onChange={setStack} clipLabel="Voz principal" />;
}

function addEffect(name: RegExp) {
  const browser = screen.getByRole('region', { name: 'Catálogo de efectos' });
  const card = within(browser).getAllByRole('button', { name })[0];
  expect(card).toBeTruthy();
  if (card) fireEvent.click(card);
}

describe('cadena de audio del clip', () => {
  it('sólo ofrece efectos de audio', () => {
    render(<Harness />);
    const browser = screen.getByRole('region', { name: 'Catálogo de efectos' });
    const names = within(browser)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    expect(names.some((name) => name.includes('Teléfono'))).toBe(true);
    expect(names.some((name) => name.includes('Exposición'))).toBe(false);
  });

  it('suma un efecto y muestra la cadena compilada', () => {
    render(<Harness />);
    addEffect(/^Teléfono/);
    const stack = screen.getByRole('list', { name: 'Stack de efectos' });
    expect(within(stack).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/Cadena de filtros \(1\)/)).toBeTruthy();
    expect(screen.getByText(/highpass=f=350/)).toBeTruthy();
  });

  it('declara la fidelidad del conjunto', () => {
    render(<Harness />);
    addEffect(/^Vinilo/);
    expect(screen.getAllByText(/Export aproximado/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no hay ruido de superficie real/i).length).toBeGreaterThan(0);
  });

  it('busca dentro del catálogo de audio', () => {
    render(<Harness />);
    const search = screen.getByLabelText('Buscar efecto');
    fireEvent.change(search, { target: { value: 'voz' } });
    const browser = screen.getByRole('region', { name: 'Catálogo de efectos' });
    const names = within(browser)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    expect(names.some((name) => name.includes('Voz grave'))).toBe(true);
    expect(names.some((name) => name.includes('Eco'))).toBe(false);
  });
});
