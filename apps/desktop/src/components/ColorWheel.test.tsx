// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorSwatch } from './ColorSwatch';
import { ColorWheel } from './ColorWheel';
import { hexToHsl, hslToHex } from '../state/theme-palette';

afterEach(() => {
  cleanup();
});

describe('hexToHsl', () => {
  it('convierte los primarios y los grises', () => {
    expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(hexToHsl('#00ff00')).toEqual({ h: 120, s: 1, l: 0.5 });
    expect(hexToHsl('#0000ff')).toEqual({ h: 240, s: 1, l: 0.5 });
    expect(hexToHsl('#808080')).toMatchObject({ h: 0, s: 0 });
  });

  it('es la inversa de hslToHex', () => {
    for (const hex of ['#ff2d55', '#0f766e', '#facc15', '#1f2937']) {
      const { h, s, l } = hexToHsl(hex);
      expect(hslToHex(h, s, l)).toBe(hex);
    }
  });

  it('acepta hex corto y valores inválidos', () => {
    expect(hexToHsl('#f00')).toEqual(hexToHsl('#ff0000'));
    expect(hexToHsl('nope')).toEqual({ h: 0, s: 0, l: 0 });
  });
});

describe('ColorWheel', () => {
  it('expone dos deslizadores: tono/saturación y luminosidad', () => {
    render(<ColorWheel value="#ff0000" onChange={() => undefined} label="Acento" />);
    const dial = screen.getByRole('slider', { name: 'Tono y saturación de Acento' });
    const bar = screen.getByRole('slider', { name: 'Luminosidad de Acento' });
    expect(dial.getAttribute('aria-valuetext')).toBe('#ff0000');
    expect(dial.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
  });

  it('las flechas mueven el tono y la saturación', () => {
    const onChange = vi.fn();
    render(<ColorWheel value="#ff0000" onChange={onChange} ariaLabel="Color" />);
    const dial = screen.getByRole('slider', { name: 'Color' });

    fireEvent.keyDown(dial, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(Math.round(hexToHsl(onChange.mock.calls[0]![0] as string).h)).toBe(2);

    fireEvent.keyDown(dial, { key: 'ArrowDown' });
    expect(hexToHsl(onChange.mock.calls[1]![0] as string).s).toBeLessThan(1);
  });

  it('la barra ajusta la luminosidad y avisa al confirmar', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <ColorWheel value="#ff0000" onChange={onChange} onCommit={onCommit} ariaLabel="Color" />,
    );
    const bar = screen.getByRole('slider', { name: 'Luminosidad' });
    fireEvent.keyDown(bar, { key: 'ArrowUp' });
    expect(hexToHsl(onChange.mock.calls[0]![0] as string).l).toBeCloseTo(0.52, 1);
    expect(onCommit).toHaveBeenCalled();
  });
});

describe('ColorSwatch', () => {
  it('abre la rueda en un diálogo y cierra con Escape', () => {
    render(<ColorSwatch label="Fondo" value="#123456" onChange={() => undefined} />);
    const trigger = screen.getByRole('button', { name: 'Color de Fondo' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const dialog = screen.getByRole('dialog', { name: 'Color de Fondo' });
    expect(dialog.querySelector('.color-wheel-dial')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Color de Fondo' })).toBeNull();
  });

  it('acepta un hex escrito a mano', () => {
    const onChange = vi.fn();
    render(<ColorSwatch label="Acento" value="#123456" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Color de Acento' }));
    const hex = screen.getByLabelText('Valor hex de Acento');
    fireEvent.change(hex, { target: { value: '#ff2d55' } });
    expect(onChange).toHaveBeenCalledWith('#ff2d55');
  });
});
