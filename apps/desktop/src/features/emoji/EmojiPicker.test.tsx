// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMOJI_TOTAL, findEmoji } from './emoji-data';
import { EmojiPickerButton } from './EmojiPicker';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('selector de emojis', () => {
  it('incluye el set Unicode completo y busca por nombre', () => {
    expect(EMOJI_TOTAL).toBeGreaterThan(3_500);
    expect(findEmoji('rocket').some((entry) => entry.emoji === '🚀')).toBe(true);
    expect(findEmoji('grinning face').some((entry) => entry.emoji === '😀')).toBe(true);
  });

  it('inserta un emoji y lo guarda en recientes', () => {
    const onPick = vi.fn();
    render(<EmojiPickerButton onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /Insertar emoji/i }));
    const dialog = screen.getByRole('dialog', { name: /Selector de emojis/i });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Buscar emoji/i }), {
      target: { value: 'rocket' },
    });
    const rocket = within(dialog).getByRole('button', { name: /^(rocket|cohete)$/i });
    fireEvent.click(rocket);
    expect(onPick).toHaveBeenCalledWith('🚀');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Insertar emoji/i }));
    expect(screen.getByRole('button', { name: /Recientes/i })).toBeTruthy();
  });

  it('cambia entre estilo Android y abierto', () => {
    render(<EmojiPickerButton onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Insertar emoji/i }));
    const open = screen.getByRole('button', { name: /^Abierto$/i });
    fireEvent.click(open);
    expect(open.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Android$/i }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('cierra con Escape', () => {
    render(<EmojiPickerButton onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Insertar emoji/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
