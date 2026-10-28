// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { App } from './App';
import { createFakeService, readyAsset } from './test/fake-service';
import {
  addAsset,
  addClipFromAsset,
  addTrack,
  ensureDelivery,
} from './state/project-actions';

const NOW = '2026-10-20T00:00:00.000Z';

/**
 * Fase 2 de accesibilidad, extremo a extremo sobre la app real:
 *  - Space sobre un control enfocado activa el control y no la reproducción;
 *  - mover y recortar el clip seleccionado con flechas + modificadores.
 */

function renderEditorConClip(opciones: { readonly conPistaV2?: boolean } = {}) {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const service = createFakeService();
  const base = ensureDelivery(createEmptyProject('Obra teclado', NOW));
  const asset = readyAsset();
  let seeded = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 60,
  }).project;
  if (opciones.conPistaV2) {
    seeded = addTrack(seeded, 'video', 'V2').project;
  }
  const seededOpened = {
    project: seeded,
    label: 'teclado.editoria.json',
    path: 'C:\\tmp\\teclado.editoria.json',
    root: 'C:\\tmp',
  };
  service.createProject = async () => seededOpened;
  service.current = seededOpened;
  render(<App service={service} />);
  return service;
}

async function abrirEditor(): Promise<void> {
  fireEvent.click(
    within(screen.getByRole('navigation', { name: /vistas/i })).getByRole('button', {
      name: 'Proyectos',
    }),
  );
  const input = within(screen.getByRole('main')).getByRole('textbox', { name: /nombre/i });
  fireEvent.change(input, { target: { value: 'Obra teclado' } });
  fireEvent.click(screen.getByRole('button', { name: /Crear y elegir ubicación/i }));
  await waitFor(
    () => {
      expect(screen.getByRole('main').textContent).toContain('Timeline 01');
      // Los clips viven en el chunk lazy de la timeline.
      expect(document.querySelector('.timeline-surface')).toBeTruthy();
    },
    { timeout: 5000 },
  );
}

function clipVideo(): HTMLElement {
  const clip = document.querySelector('.timeline-clip.kind-video');
  if (!(clip instanceof HTMLElement)) throw new Error('se esperaba un clip de video');
  return clip;
}

function seleccionarClip(): void {
  fireEvent.keyDown(clipVideo(), { key: 'Enter' });
}

function ventanaDelClip(): string {
  return clipVideo().querySelector('.clip-window')?.textContent ?? '';
}

async function esperarAriaLabel(fragmento: RegExp): Promise<void> {
  await waitFor(() => expect(clipVideo().getAttribute('aria-label')).toMatch(fragmento));
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('teclado de la timeline sobre la app', () => {
  it('Space sobre un botón enfocado no roba la activación ni reproduce', async () => {
    renderEditorConClip();
    await abrirEditor();
    const boton = screen.getByRole('button', { name: 'Bucle de reproducción' });
    boton.focus();
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    boton.dispatchEvent(event);
    // Sin el arreglo, el despacho global prevenía este keydown y el click de
    // activación del botón (que ocurre en keyup) nunca se dispararía.
    expect(event.defaultPrevented).toBe(false);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reproducir' })).toBeTruthy(),
    );
  });

  it('Space sobre un clip enfocado lo selecciona y no reproduce', async () => {
    renderEditorConClip();
    await abrirEditor();
    const clip = clipVideo();
    clip.focus();
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    clip.dispatchEvent(event);
    await waitFor(() => expect(clipVideo().className).toContain('selected'));
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeTruthy();
  });

  it('Space con el foco fuera de los controles reproduce y pausa', async () => {
    renderEditorConClip();
    await abrirEditor();
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pausar' })).toBeTruthy());
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reproducir' })).toBeTruthy());
  });

  it('Alt+flechas mueven el clip seleccionado de a 1 frame', async () => {
    renderEditorConClip();
    await abrirEditor();
    seleccionarClip();
    await esperarAriaLabel(/desde 0:00:00:00/);
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    await esperarAriaLabel(/desde 0:00:00:01/);
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    await esperarAriaLabel(/desde 0:00:00:00/);
  });

  it('Alt+Shift+flecha mueve el clip seleccionado de a 1 segundo', async () => {
    renderEditorConClip();
    await abrirEditor();
    seleccionarClip();
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true, shiftKey: true });
    await esperarAriaLabel(/desde 0:00:01:00/);
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true, shiftKey: true });
    await esperarAriaLabel(/desde 0:00:00:00/);
  });

  it('Ctrl+Alt+flechas recortan el borde de entrada y actualizan la ventana in/out', async () => {
    renderEditorConClip();
    await abrirEditor();
    seleccionarClip();
    expect(ventanaDelClip()).toContain('in 0');
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true, ctrlKey: true });
    await waitFor(() => expect(ventanaDelClip()).toContain('in 1'));
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true, ctrlKey: true });
    await waitFor(() => expect(ventanaDelClip()).toContain('in 0'));
  });

  it('Ctrl+Alt+Shift+flechas recortan el borde de salida', async () => {
    renderEditorConClip();
    await abrirEditor();
    seleccionarClip();
    expect(ventanaDelClip()).toContain('out 60');
    fireEvent.keyDown(window, {
      key: 'ArrowLeft',
      altKey: true,
      ctrlKey: true,
      shiftKey: true,
    });
    await waitFor(() => expect(ventanaDelClip()).toContain('out 59'));
    fireEvent.keyDown(window, {
      key: 'ArrowRight',
      altKey: true,
      ctrlKey: true,
      shiftKey: true,
    });
    await waitFor(() => expect(ventanaDelClip()).toContain('out 60'));
  });

  it('Alt+flecha vertical lleva el clip a la pista compatible y lo trae de vuelta', async () => {
    renderEditorConClip({ conPistaV2: true });
    await abrirEditor();
    seleccionarClip();
    await esperarAriaLabel(/ en V1,/);
    fireEvent.keyDown(window, { key: 'ArrowUp', altKey: true });
    await esperarAriaLabel(/ en V2,/);
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    await esperarAriaLabel(/ en V1,/);
  });

  it('las flechas sin Alt siguen moviendo el playhead como siempre', async () => {
    renderEditorConClip();
    await abrirEditor();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(document.querySelector('.playhead-grip')?.getAttribute('aria-valuenow')).toBe('1'),
    );
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() =>
      expect(document.querySelector('.playhead-grip')?.getAttribute('aria-valuenow')).toBe('0'),
    );
  });
});
