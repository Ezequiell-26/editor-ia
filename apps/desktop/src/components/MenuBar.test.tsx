// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider } from '../state/AppearanceProvider';
import { ProjectProvider } from '../state/project-store';
import { createFakeService } from '../test/fake-service';
import { MenuBar } from './MenuBar';

function renderMenuBar() {
  render(
    <AppearanceProvider>
      <ProjectProvider service={createFakeService()}>
        <MenuBar activeId="editor" onSelect={vi.fn()} />
      </ProjectProvider>
    </AppearanceProvider>,
  );
}

/** Abre un menú y ejecuta uno de sus ítems, como haría con teclado. */
function abrirModal(nombreMenu: string, nombreItem: string | RegExp): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: nombreMenu }));
  fireEvent.click(screen.getByRole('menuitem', { name: nombreItem }));
  return screen.getByRole('dialog');
}

describe('MenuBar · teclado del menubar', () => {
  it('roving tabindex: sólo el menú activo queda en el orden de Tab', () => {
    renderMenuBar();
    expect(screen.getByRole('button', { name: 'Archivo' }).tabIndex).toBe(0);
    expect(screen.getByRole('button', { name: 'Editar' }).tabIndex).toBe(-1);
    fireEvent.focus(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByRole('button', { name: 'Editar' }).tabIndex).toBe(0);
    expect(screen.getByRole('button', { name: 'Archivo' }).tabIndex).toBe(-1);
  });

  it('ArrowDown abre Archivo con el foco en su primer ítem y ArrowUp en el último', async () => {
    renderMenuBar();
    const archivo = screen.getByRole('button', { name: 'Archivo' });

    fireEvent.keyDown(archivo, { key: 'ArrowDown' });
    const primero = await screen.findByRole('menuitem', { name: /Pantalla de inicio/i });
    await waitFor(() => expect(document.activeElement).toBe(primero));
    expect(archivo.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(primero, { key: 'Escape' });
    expect(document.activeElement).toBe(archivo);

    fireEvent.keyDown(archivo, { key: 'ArrowUp' });
    const ultimo = await screen.findByRole('menuitem', { name: /Convertir medios/i });
    await waitFor(() => expect(document.activeElement).toBe(ultimo));
  });

  it('ArrowRight dentro del menú abre el hermano y enfoca su primer ítem habilitado', async () => {
    renderMenuBar();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Archivo' }), { key: 'ArrowDown' });
    const primero = await screen.findByRole('menuitem', { name: /Pantalla de inicio/i });
    await waitFor(() => expect(document.activeElement).toBe(primero));

    // Sin proyecto, todos los ítems de Editar están deshabilitados: el menú
    // abre y el foco vuelve a su disparador para no perder la navegación.
    fireEvent.keyDown(primero, { key: 'ArrowRight' });
    const editar = screen.getByRole('button', { name: 'Editar' });
    await waitFor(() => expect(editar.getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Archivo' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    await waitFor(() => expect(document.activeElement).toBe(editar));

    // Desde el disparador, ArrowRight sigue al hermano (Ver) y entra al
    // primer ítem habilitado.
    fireEvent.keyDown(editar, { key: 'ArrowRight' });
    const ver = await screen.findByRole('menu', { name: 'Ver' });
    const primeroVer = ver.querySelector<HTMLElement>('[role^="menuitem"]');
    await waitFor(() => expect(document.activeElement).toBe(primeroVer));
    expect(editar.getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape cierra el menú, vuelve al disparador y no propaga al atajo global', async () => {
    renderMenuBar();
    const archivo = screen.getByRole('button', { name: 'Archivo' });
    fireEvent.keyDown(archivo, { key: 'ArrowDown' });
    const primero = await screen.findByRole('menuitem', { name: /Pantalla de inicio/i });
    await waitFor(() => expect(document.activeElement).toBe(primero));

    const globalKeydown = vi.fn();
    window.addEventListener('keydown', globalKeydown);
    fireEvent.keyDown(primero, { key: 'Escape' });
    window.removeEventListener('keydown', globalKeydown);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(archivo);
    expect(globalKeydown).not.toHaveBeenCalled();
  });

  it('Tab cierra el menú y deja el foco en el disparador', async () => {
    renderMenuBar();
    const archivo = screen.getByRole('button', { name: 'Archivo' });
    fireEvent.keyDown(archivo, { key: 'ArrowDown' });
    const primero = await screen.findByRole('menuitem', { name: /Pantalla de inicio/i });
    await waitFor(() => expect(document.activeElement).toBe(primero));

    fireEvent.keyDown(primero, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(archivo);
  });

  it('los ítems con estado exponen aria-checked', () => {
    renderMenuBar();
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    const etiquetas = screen.getByRole('menuitemcheckbox', { name: 'Etiquetas del rail' });
    expect(etiquetas.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Barra de estado' }).getAttribute('aria-checked'),
    ).toBe('true');

    fireEvent.click(etiquetas);
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Etiquetas del rail' }).getAttribute('aria-checked'),
    ).toBe('true');
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('MenuBar · trampa de foco en los modales', () => {
  it('Atajos de teclado: enfoca el botón cerrar, el Tab no abandona el diálogo y Escape cierra', () => {
    renderMenuBar();
    abrirModal('Ayuda', /Atajos de teclado/);

    const cerrar = screen.getByRole('button', { name: 'Cerrar' });
    // El hook enfoca el primer control del panel; reemplaza el autoFocus previo.
    expect(document.activeElement).toBe(cerrar);

    // Es el único enfocable del modal: Tab cicla sobre el mismo botón.
    fireEvent.keyDown(cerrar, { key: 'Tab' });
    expect(document.activeElement).toBe(cerrar);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Acerca de Olyvia: el Tab cicla entre cerrar y abrir repositorio sin salir del diálogo', () => {
    renderMenuBar();
    abrirModal('Ayuda', /Acerca de Olyvia/);

    const cerrar = screen.getByRole('button', { name: 'Cerrar' });
    const repositorio = screen.getByRole('button', { name: /Abrir repositorio/ });
    expect(document.activeElement).toBe(cerrar);

    // Con Shift desde el primero salta al último (jsdom no navega el Tab
    // intermedio por su cuenta; el hook se encarga de los bordes).
    fireEvent.keyDown(cerrar, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(repositorio);

    // Desde el último vuelve al primero.
    fireEvent.keyDown(repositorio, { key: 'Tab' });
    expect(document.activeElement).toBe(cerrar);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
