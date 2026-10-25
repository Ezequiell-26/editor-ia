// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDialogFocus } from './useDialogFocus';

interface DialogoProps {
  readonly onClose: () => void;
  readonly conEnfocables?: boolean;
}

/** Diálogo con tres botones (o sólo texto, para el caso sin enfocables). */
function Dialogo({ onClose, conEnfocables = true }: DialogoProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus({ containerRef: panelRef, onClose });
  return (
    <div ref={panelRef} role="dialog" aria-label="diálogo de prueba">
      {conEnfocables ? (
        <>
          <button type="button">primero</button>
          <button type="button">medio</button>
          <button type="button">último</button>
        </>
      ) : (
        <p>sólo texto, sin controles</p>
      )}
    </div>
  );
}

/** Página con un disparador que monta el diálogo, como hace App con Settings. */
function Pagina({ onClose, conEnfocables = true }: DialogoProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        abrir
      </button>
      {open ? (
        <Dialogo
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          conEnfocables={conEnfocables}
        />
      ) : null}
    </>
  );
}

/** Diálogo siempre montado que devuelve null al cerrar, como ExportDialog. */
function DialogoConOpen({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus({ containerRef: panelRef, onClose, active: open });
  if (!open) return null;
  return (
    <div ref={panelRef} role="dialog" aria-label="diálogo con open">
      <button type="button">primero</button>
      <button type="button">último</button>
    </div>
  );
}

function abrirDialogo(onClose: () => void, conEnfocables = true) {
  const utils = render(<Pagina onClose={onClose} conEnfocables={conEnfocables} />);
  const disparador = utils.getByRole('button', { name: 'abrir' });
  disparador.focus();
  fireEvent.click(disparador);
  return { ...utils, disparador };
}

afterEach(() => cleanup());

describe('useDialogFocus', () => {
  it('al abrir enfoca el primer enfocable y al cerrar con Escape devuelve el foco al disparador', () => {
    const onClose = vi.fn();
    const { disparador } = abrirDialogo(onClose);

    const primero = screen.getByRole('button', { name: 'primero' });
    expect(document.activeElement).toBe(primero);

    fireEvent.keyDown(primero, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(disparador);
  });

  it('cicla el Tab: desde el último vuelve al primero y con Shift desde el primero salta al último', () => {
    abrirDialogo(vi.fn());
    const primero = screen.getByRole('button', { name: 'primero' });
    const ultimo = screen.getByRole('button', { name: 'último' });

    ultimo.focus();
    fireEvent.keyDown(ultimo, { key: 'Tab' });
    expect(document.activeElement).toBe(primero);

    fireEvent.keyDown(primero, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(ultimo);
  });

  it('recupera el foco si se escapó del diálogo', () => {
    const { disparador } = abrirDialogo(vi.fn());

    // Simula un foco que se movió fuera del diálogo (p. ej. un click en el fondo).
    disparador.focus();
    fireEvent.keyDown(disparador, { key: 'Tab' });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'primero' }));
  });

  it('no cierra con Escape cuando el foco está fuera del diálogo (otro overlay lo maneja)', () => {
    const onClose = vi.fn();
    const { disparador } = abrirDialogo(onClose);

    disparador.focus();
    fireEvent.keyDown(disparador, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('con un contenedor sin enfocables, el foco recae en el propio diálogo y Escape sigue cerrando', () => {
    const onClose = vi.fn();
    const { disparador } = abrirDialogo(onClose, false);

    const dialogo = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialogo);

    // Tab con el foco en el panel vacío no lo abandona.
    fireEvent.keyDown(dialogo, { key: 'Tab' });
    expect(document.activeElement).toBe(dialogo);

    fireEvent.keyDown(dialogo, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(disparador);
  });

  it('con active=false no captura nada hasta que el diálogo se abre (patrón ExportDialog)', () => {
    const onClose = vi.fn();
    const { rerender } = render(<DialogoConOpen open={false} onClose={onClose} />);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    rerender(<DialogoConOpen open onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'primero' }));

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
