// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLOR_PRESETS, ColorField, normalizeHexColor } from './ColorField';

afterEach(() => cleanup());

function renderField(onChange = vi.fn(), disabled = false): ReturnType<typeof render> {
  return render(
    <ColorField
      id="motion-demo-accent"
      label="Acento"
      value="#7dd3c0"
      onChange={onChange}
      disabled={disabled}
    />,
  );
}

function openPicker(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: /Acento\. Color actual/i }));
  return screen.getByRole('dialog', { name: /Selector de color para Acento/i });
}

describe('ColorField', () => {
  it('abre y cierra el popover con el trigger y con un click fuera', () => {
    renderField();
    expect(screen.queryByRole('dialog')).toBeNull();

    const dialog = openPicker();
    expect(dialog.querySelector('.react-colorful')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Acento\. Color actual/i }).getAttribute('aria-expanded')).toBe(
      'true',
    );

    // Click fuera del campo: cierra sin emitir cambios.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();

    openPicker();
    // Segundo click en el trigger también cierra.
    fireEvent.click(screen.getByRole('button', { name: /Acento\. Color actual/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('muestra los presets de marca y emite el hex al elegir uno', () => {
    const onChange = vi.fn();
    renderField(onChange);
    const dialog = openPicker();
    const group = within(dialog).getByRole('group', { name: /Colores de marca para Acento/i });
    expect(within(group).getAllByRole('button')).toHaveLength(COLOR_PRESETS.length);
    expect(COLOR_PRESETS.length).toBeGreaterThanOrEqual(6);

    fireEvent.click(within(group).getByRole('button', { name: /Acento: usar #f97316/i }));
    expect(onChange).toHaveBeenCalledWith('#f97316');
    // El popover sigue abierto para afinar el color.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('valida el hex y no emite valores inválidos', () => {
    const onChange = vi.fn();
    renderField(onChange);
    openPicker();
    const input = screen.getByLabelText(/Valor hex para Acento/i) as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: '#12zz34' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(input, { target: { value: '#3B82F6' } });
    expect(onChange).toHaveBeenCalledWith('#3b82f6');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(normalizeHexColor('3b82f6')).toBe('#3b82f6');
    expect(normalizeHexColor('#12345')).toBeNull();
  });

  it('cierra con Escape y devuelve el foco al trigger', () => {
    renderField();
    openPicker();
    const input = screen.getByLabelText(/Valor hex para Acento/i);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Acento\. Color actual/i }),
    );
  });

  it('deshabilitado muestra el color actual pero no abre el popover', () => {
    renderField(vi.fn(), true);
    const trigger = screen.getByRole('button', { name: /Acento\. Color actual/i });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('group', { name: /Colores de marca/i })).toBeNull();
  });
});
