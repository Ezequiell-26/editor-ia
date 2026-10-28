// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmojiPickerButton } from './EmojiPicker';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('selector de emojis · trampa de foco', () => {
  it('al abrir enfoca la búsqueda, el Tab no abandona el diálogo y Escape devuelve el foco al disparador', () => {
    const { getByRole } = render(<EmojiPickerButton onPick={vi.fn()} />);
    const disparador = getByRole('button', { name: /Insertar emoji/i });
    disparador.focus();
    fireEvent.click(disparador);

    const dialogo = screen.getByRole('dialog', { name: /Selector de emojis/i });
    const busqueda = within(dialogo).getByRole('textbox', { name: /Buscar emoji/i });
    // El hook enfoca el primer control del panel: la búsqueda.
    expect(document.activeElement).toBe(busqueda);

    // Con Shift desde la búsqueda (primera) salta al último control del
    // diálogo; jsdom no navega el Tab intermedio por su cuenta: el hook
    // maneja los bordes del ciclo.
    const botones = within(dialogo).getAllByRole('button');
    const ultimo = botones[botones.length - 1];
    if (!ultimo) throw new Error('el diálogo no listó controles');
    fireEvent.keyDown(busqueda, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(ultimo);

    // Desde el último, Tab vuelve al primero.
    fireEvent.keyDown(ultimo, { key: 'Tab' });
    expect(document.activeElement).toBe(busqueda);

    fireEvent.keyDown(busqueda, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(disparador);
  });

  it('al elegir un emoji cierra el diálogo y devuelve el foco al disparador', () => {
    const onPick = vi.fn();
    const { getByRole } = render(<EmojiPickerButton onPick={onPick} />);
    const disparador = getByRole('button', { name: /Insertar emoji/i });
    disparador.focus();
    fireEvent.click(disparador);

    const dialogo = screen.getByRole('dialog', { name: /Selector de emojis/i });
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Buscar emoji/i }), {
      target: { value: 'rocket' },
    });
    const rocket = within(dialogo).getByRole('button', { name: /^(rocket|cohete)$/i });
    fireEvent.click(rocket);

    expect(onPick).toHaveBeenCalledWith('🚀');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(disparador);
  });
});
