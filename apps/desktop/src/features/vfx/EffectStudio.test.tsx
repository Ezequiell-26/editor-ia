// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { EffectStack } from '@editor-ia/effect-kit';
import { EffectStudio } from './EffectStudio';

afterEach(cleanup);

function Harness() {
  const [stack, setStack] = useState<EffectStack>([]);
  return (
    <EffectStudio
      stack={stack}
      onChange={setStack}
      mediaEl={null}
      localFrame={0}
      frameRate={30}
      clipLabel="Toma de prueba"
    />
  );
}

function addEffect(name: RegExp) {
  const browser = screen.getByRole('region', { name: 'Catálogo de efectos' });
  const card = within(browser).getAllByRole('button', { name })[0];
  expect(card).toBeTruthy();
  if (card) fireEvent.click(card);
}

function stackRows(): HTMLElement[] {
  const stack = screen.getByRole('list', { name: 'Stack de efectos' });
  return within(stack).getAllByRole('listitem');
}

describe('estudio de efectos', () => {
  it('arranca vacío y suma un efecto desde el catálogo', () => {
    render(<Harness />);
    expect(screen.getByText(/no tiene efectos en el stack/i)).toBeTruthy();
    addEffect(/^Exposición/);
    expect(stackRows().some((row) => /Exposición/.test(row.textContent ?? ''))).toBe(true);
    expect(screen.queryByText(/no tiene efectos en el stack/i)).toBeNull();
  });

  it('expone los parámetros del efecto agregado', () => {
    render(<Harness />);
    addEffect(/^Exposición/);
    const slider = screen.getByRole('slider', { name: /Pasos/i });
    expect((slider as HTMLInputElement).value).toBe('0');
    fireEvent.change(slider, { target: { value: '1' } });
    expect(screen.getByText(/1\.000 EV/)).toBeTruthy();
  });

  it('keyframea un parámetro numérico desde el playhead', () => {
    render(<Harness />);
    addEffect(/^Exposición/);
    const diamond = screen.getByRole('button', {
      name: 'Clave de Pasos en el frame actual',
    });
    fireEvent.click(diamond);
    // La primera clave crea la pista con una compañera plana (mínimo 2).
    expect(diamond.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(diamond);
    expect(diamond.getAttribute('aria-pressed')).toBe('false');
    // Volver a clickear recrea la pista (quitó las dos claves).
    fireEvent.click(diamond);
    expect(diamond.getAttribute('aria-pressed')).toBe('true');
  });

  it('apaga, reordena y quita', () => {
    render(<Harness />);
    addEffect(/^Exposición/);
    addEffect(/^Contraste/);
    const toggles = screen.getAllByLabelText(/^Activar /);
    expect(toggles).toHaveLength(2);
    fireEvent.click(toggles[0] as HTMLElement);
    expect((toggles[0] as HTMLInputElement).checked).toBe(false);

    const upButtons = screen.getAllByLabelText('Subir');
    fireEvent.click(upButtons[1] as HTMLElement);
    expect(stackRows()[0]?.textContent).toMatch(/Contraste/);

    const removeButtons = screen.getAllByLabelText('Quitar');
    fireEvent.click(removeButtons[0] as HTMLElement);
    expect(screen.getAllByLabelText('Quitar')).toHaveLength(1);
  });

  it('busca en el catálogo sin acentos', () => {
    render(<Harness />);
    const search = screen.getByLabelText('Buscar efecto');
    fireEvent.change(search, { target: { value: 'glitch' } });
    const browser = screen.getByRole('region', { name: 'Catálogo de efectos' });
    expect(within(browser).getAllByRole('button').length).toBeGreaterThan(0);
    fireEvent.change(search, { target: { value: 'no-existe-nada' } });
    expect(screen.getByText(/Ningún efecto coincide/i)).toBeTruthy();
  });

  it('muestra el resumen de export del stack', () => {
    render(<Harness />);
    addEffect(/^Destello de lente/);
    expect(screen.getAllByText(/Sólo preview/i).length).toBeGreaterThan(0);
  });
});
