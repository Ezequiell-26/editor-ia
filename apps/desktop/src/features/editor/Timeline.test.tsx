// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
} from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { Timeline } from './Timeline';

const NOW = '2026-10-20T00:00:00.000Z';
const HEADER = 168;

if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, 'PointerEvent', {
    value: PointerEventPolyfill,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'PointerEvent', {
    value: PointerEventPolyfill,
    configurable: true,
  });
}

function renderTimeline() {
  const base = ensureDelivery(createEmptyProject('Timeline', NOW));
  const asset = readyAsset();
  const project = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 300,
  }).project;
  const service = createFakeService();
  const opened = {
    project,
    label: 'timeline.editoria.json',
    path: 'C:\\tester\\timeline.editoria.json',
    root: 'C:\\tester',
  };
  const view = render(
    <ProjectProvider service={service} initial={{ project, opened }}>
      <Timeline />
    </ProjectProvider>,
  );
  const surface = view.container.querySelector('.timeline-surface');
  if (!(surface instanceof HTMLElement)) throw new Error('se esperaba la superficie de la timeline');
  surface.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 2000,
      bottom: 500,
      width: 2000,
      height: 500,
      toJSON: () => ({}),
    }) as DOMRect;
  return view;
}

afterEach(() => {
  cleanup();
});

describe('Timeline · mezcla de pistas', () => {
  it('activa y apaga solo desde el encabezado', () => {
    renderTimeline();
    const solo = screen.getByRole('button', { name: /Solo V1/i });
    expect(solo.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(solo);
    expect(solo.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Timeline · arrastre del cabezal', () => {
  it('el carril del ruler ocupa la superficie y no queda sin ancho', () => {
    const { container } = renderTimeline();
    const lane = container.querySelector('.ruler-lane');
    if (!(lane instanceof HTMLElement)) throw new Error('se esperaba el carril del ruler');
    expect(lane.style.width).not.toBe('');
    expect(parseFloat(lane.style.width)).toBeGreaterThan(500);
  });

  it('arrastra el cabezal de forma continua desde el ruler', async () => {
    const { container } = renderTimeline();
    const lane = container.querySelector('.ruler-lane');
    if (!(lane instanceof HTMLElement)) throw new Error('se esperaba el carril del ruler');

    fireEvent.pointerDown(lane, { button: 0, clientX: HEADER + 120, pointerId: 1 });
    await waitFor(() => {
      const line = container.querySelector('.playhead-line');
      expect((line as HTMLElement).style.left).toBe(`${HEADER + 50 * 2.4}px`);
    });

    for (const frame of [80, 120, 160, 200]) {
      fireEvent.pointerMove(window, {
        clientX: HEADER + frame * 2.4,
        pointerId: 1,
        buttons: 1,
      });
      await waitFor(() => {
        const line = container.querySelector('.playhead-line');
        expect((line as HTMLElement).style.left).toBe(`${HEADER + frame * 2.4}px`);
      });
    }

    fireEvent.pointerUp(window, { clientX: HEADER + 200 * 2.4, pointerId: 1 });
  });

  it('mantiene el arrastre de un clip aunque el mouse siga moviéndose', async () => {
    const { container } = renderTimeline();
    const clip = container.querySelector('.timeline-clip');
    if (!(clip instanceof HTMLElement)) throw new Error('se esperaba un clip');

    fireEvent.pointerDown(clip, { button: 0, clientX: 200, pointerId: 3 });
    for (const [clientX, left] of [
      [440, 240],
      [560, 360],
      [680, 480],
    ] as const) {
      fireEvent.pointerMove(window, { clientX, pointerId: 3, buttons: 1 });
      await waitFor(() => expect(clip.style.left).toBe(`${left}px`));
    }
    fireEvent.pointerUp(window, { clientX: 680, pointerId: 3 });
    await waitFor(() => expect(clip.style.left).toBe('480px'));
  });

  it('permite mover el cabezal con el mouse y el teclado', async () => {
    const { container } = renderTimeline();
    const grip = container.querySelector('.playhead-grip');
    if (!(grip instanceof HTMLElement)) throw new Error('se esperaba el cabezal');

    expect(grip.getAttribute('role')).toBe('slider');
    expect(grip.getAttribute('aria-valuenow')).toBe('0');

    fireEvent.pointerDown(grip, { button: 0, clientX: HEADER + 240, pointerId: 2 });
    await waitFor(() => expect(grip.getAttribute('aria-valuenow')).toBe('100'));
    fireEvent.pointerMove(window, {
      clientX: HEADER + 360,
      pointerId: 2,
      buttons: 1,
    });
    await waitFor(() => expect(grip.getAttribute('aria-valuenow')).toBe('150'));
    fireEvent.pointerUp(window, { clientX: HEADER + 360, pointerId: 2 });

    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    await waitFor(() => expect(grip.getAttribute('aria-valuenow')).toBe('151'));
    fireEvent.keyDown(grip, { key: 'Home' });
    await waitFor(() => expect(grip.getAttribute('aria-valuenow')).toBe('0'));
  });
});

describe('Timeline · paneo y zoom con mouse', () => {
  it('la herramienta mano mueve la vista sin cambiar el playhead', async () => {
    const { container } = renderTimeline();
    const scroll = container.querySelector('.timeline-scroll');
    if (!(scroll instanceof HTMLElement)) throw new Error('se esperaba el contenedor');
    scroll.scrollLeft = 300;
    scroll.scrollTop = 40;
    fireEvent.click(screen.getByRole('button', { name: /Mover la vista con el mouse/i }));
    fireEvent.pointerDown(scroll, {
      button: 0,
      clientX: 500,
      clientY: 200,
      pointerId: 21,
    });
    fireEvent.pointerMove(scroll, {
      clientX: 430,
      clientY: 180,
      pointerId: 21,
      buttons: 1,
    });
    await waitFor(() => {
      expect(scroll.scrollLeft).toBe(370);
      expect(scroll.scrollTop).toBe(60);
    });
    const grip = container.querySelector('.playhead-grip');
    expect(grip?.getAttribute('aria-valuenow')).toBe('0');
    fireEvent.pointerUp(scroll, { clientX: 430, clientY: 180, pointerId: 21 });
  });

  it('el botón central panea aunque la herramienta mano esté apagada', () => {
    const { container } = renderTimeline();
    const scroll = container.querySelector('.timeline-scroll');
    if (!(scroll instanceof HTMLElement)) throw new Error('se esperaba el contenedor');
    scroll.scrollLeft = 120;
    fireEvent.pointerDown(scroll, {
      button: 1,
      clientX: 300,
      clientY: 100,
      pointerId: 22,
    });
    fireEvent.pointerMove(scroll, {
      clientX: 240,
      clientY: 100,
      pointerId: 22,
      buttons: 4,
    });
    expect(scroll.scrollLeft).toBe(180);
    fireEvent.pointerUp(scroll, { clientX: 240, clientY: 100, pointerId: 22 });
  });

  it('Shift+rueda desplaza en horizontal y Ctrl+rueda acerca', async () => {
    const { container } = renderTimeline();
    const scroll = container.querySelector('.timeline-scroll');
    if (!(scroll instanceof HTMLElement)) throw new Error('se esperaba el contenedor');
    scroll.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1200,
        bottom: 400,
        width: 1200,
        height: 400,
        toJSON: () => ({}),
      }) as DOMRect;
    scroll.scrollLeft = 0;
    fireEvent.wheel(scroll, { deltaY: 120, shiftKey: true });
    expect(scroll.scrollLeft).toBe(120);

    fireEvent.wheel(scroll, { deltaY: -100, ctrlKey: true, clientX: 300 });
    await waitFor(() => expect(container.textContent).toContain('2.78 px/frame'));
  });
});

describe('alto de la timeline', () => {
  it('se puede achicar con el teclado y queda recordado', () => {
    renderTimeline();
    const handle = screen.getByRole('separator', { name: /alto de la timeline/i });
    expect(document.documentElement.style.getPropertyValue('--timeline-height')).toBe('280px');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(document.documentElement.style.getPropertyValue('--timeline-height')).toBe('140px');
    expect(window.localStorage.getItem('editoria.timeline-height.v1')).toBe('140');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(document.documentElement.style.getPropertyValue('--timeline-height')).toBe('164px');
  });

  it('el doble clic vuelve al alto por defecto', () => {
    renderTimeline();
    const handle = screen.getByRole('separator', { name: /alto de la timeline/i });
    fireEvent.keyDown(handle, { key: 'End' });
    expect(document.documentElement.style.getPropertyValue('--timeline-height')).toBe('720px');
    fireEvent.doubleClick(handle);
    expect(document.documentElement.style.getPropertyValue('--timeline-height')).toBe('280px');
  });
});

describe('alto y plegado por pista', () => {
  it('colapsa y expande una pista, y lo recuerda', () => {
    renderTimeline();
    const collapse = screen.getAllByRole('button', { name: /^Colapsar / })[0]!;
    fireEvent.click(collapse);
    const row = document.querySelector('.timeline-row.collapsed');
    expect(row).toBeTruthy();
    expect((row as HTMLElement).style.height).toBe('28px');
    const stored = JSON.parse(window.localStorage.getItem('editoria.track-collapsed.v1') ?? '[]');
    expect(stored.length).toBe(1);
    const expand = screen.getAllByRole('button', { name: /^Expandir / })[0]!;
    fireEvent.click(expand);
    expect(document.querySelector('.timeline-row.collapsed')).toBeNull();
  });

  it('cambia el alto de una pista arrastrando su asa', () => {
    renderTimeline();
    const handle = screen.getAllByRole('separator', { name: /^Alto de la pista / })[0]!;
    const row = handle.closest('.timeline-row') as HTMLElement;
    const before = Number.parseInt(row.style.height || '48', 10);
    fireEvent.pointerDown(handle, { clientY: 100 });
    fireEvent.pointerMove(window, { clientY: 130 });
    fireEvent.pointerUp(window);
    expect(Number.parseInt(row.style.height || '0', 10)).toBe(before + 30);
    expect(window.localStorage.getItem('editoria.track-heights.v1')).toContain('"');
  });
});
