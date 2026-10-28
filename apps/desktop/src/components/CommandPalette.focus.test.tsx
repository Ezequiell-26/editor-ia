// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../app/commands';
import { CommandPalette } from './CommandPalette';

function comandos(accion = vi.fn()): Command[] {
  return [
    { id: 'file.save', label: 'Guardar proyecto', category: 'Archivo', action: accion },
    { id: 'nav.editor', label: 'Editor de video', category: 'Navegar', action: vi.fn() },
  ];
}

/** Página con un disparador que monta la paleta, como hace App con Ctrl+K. */
function Pagina({ onClose }: { readonly onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        abrir paleta
      </button>
      {open ? (
        <CommandPalette
          commands={comandos()}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

afterEach(() => cleanup());

describe('paleta de comandos · trampa de foco', () => {
  it('al abrir enfoca la búsqueda, el Tab cicla dentro del diálogo y Escape devuelve el foco al disparador', () => {
    const onClose = vi.fn();
    const utils = render(<Pagina onClose={onClose} />);
    const disparador = utils.getByRole('button', { name: 'abrir paleta' });
    disparador.focus();
    fireEvent.click(disparador);

    const dialogo = screen.getByRole('dialog', { name: 'Paleta de comandos' });
    const busqueda = screen.getByRole('textbox');
    // El hook enfoca el primer enfocable del panel: la búsqueda.
    expect(document.activeElement).toBe(busqueda);

    // Con Shift desde la búsqueda (primero) salta a la última opción; jsdom no
    // navega el Tab intermedio por su cuenta: el hook maneja los bordes.
    const opciones = screen.getAllByRole('option');
    fireEvent.keyDown(busqueda, { key: 'Tab', shiftKey: true });
    const ultima = opciones[opciones.length - 1];
    if (!ultima) throw new Error('la paleta no listó opciones');
    expect(document.activeElement).toBe(ultima);

    // Desde la última vuelve al buscador.
    fireEvent.keyDown(ultima, { key: 'Tab' });
    expect(document.activeElement).toBe(busqueda);

    fireEvent.keyDown(busqueda, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(disparador);
  });

  it('Enter sobre el buscador sigue ejecutando el comando seleccionado', async () => {
    const accion = vi.fn();
    render(<CommandPalette commands={comandos(accion)} onClose={vi.fn()} />);

    // La acción se difiere un tick para que el modal desaparezca primero.
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(accion).toHaveBeenCalledTimes(1);
    });
  });
});
