// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_APP_VERSION } from '../../app/version';
import { AppUpdaterModal } from './AppUpdaterModal';

/** Página con un disparador que monta el modal, como hace StartScreen. */
function Pagina({ onClose }: { readonly onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        abrir actualizaciones
      </button>
      <AppUpdaterModal
        isOpen={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    </>
  );
}

function abrirActualizaciones() {
  const onClose = vi.fn();
  const utils = render(<Pagina onClose={onClose} />);
  const disparador = utils.getByRole('button', { name: 'abrir actualizaciones' });
  disparador.focus();
  fireEvent.click(disparador);
  return { ...utils, disparador, onClose };
}

afterEach(() => {
  cleanup();
});

describe('modal de actualizaciones · estado real y foco', () => {
  it('muestra la versión instalada y que no hay canal configurado', () => {
    abrirActualizaciones();

    expect(
      screen.getByRole('heading', { name: 'Actualizaciones de Olyvia' }),
    ).toBeTruthy();
    expect(
      screen.getByText(`Versión instalada: v${CURRENT_APP_VERSION}`),
    ).toBeTruthy();
    expect(
      screen.getByText('Sin canal de actualizaciones configurado'),
    ).toBeTruthy();
    expect(screen.getByText(/no anuncia\s+actualizaciones que no existan/i)).toBeTruthy();
  });

  it('no ofrece canales, descarga ni auto-chequeo ficticios', () => {
    abrirActualizaciones();

    expect(screen.queryByRole('button', { name: /descargar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Beta/i })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/Nueva versión v0\.2\.0/)).toBeNull();
  });

  it('al abrir enfoca el botón cerrar y con Escape cierra devolviendo el foco al disparador', () => {
    const { disparador, onClose } = abrirActualizaciones();

    const cerrar = screen.getByRole('button', { name: 'Cerrar actualizaciones' });
    expect(document.activeElement).toBe(cerrar);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(disparador);
  });

  it('el Tab no abandona el diálogo: desde Aceptar vuelve al cerrar', () => {
    abrirActualizaciones();

    const aceptar = screen.getByRole('button', { name: 'Aceptar' });
    const cerrar = screen.getByRole('button', { name: 'Cerrar actualizaciones' });
    aceptar.focus();
    fireEvent.keyDown(aceptar, { key: 'Tab' });

    expect(document.activeElement).toBe(cerrar);
  });
});
