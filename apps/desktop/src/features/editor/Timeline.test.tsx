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
import {
  SHORTCUTS_STORAGE_KEY,
  loadShortcuts,
  saveShortcuts,
} from '../../state/shortcuts';
import { Timeline, waveformColumns, waveformPath } from './Timeline';

const NOW = '2026-10-20T00:00:00.000Z';
// Espejo de la geometría del header de pistas: el runtime lee el token
// --tl-track-head-w (160) y en jsdom sin CSS usa el mismo fallback 160.
const HEADER = 160;

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
    expect(document.documentElement.style.getPropertyValue('--timeline-height')).toBe('335px');
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
    expect(document.documentElement.style.getPropertyValue('--timeline-height')).toBe('335px');
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

describe('sincronía del cabezal', () => {
  it('usa el ancho medido de la cabecera, no el fallback', () => {
    const view = renderTimeline();
    const corner = view.container.querySelector('.timeline .ruler-corner');
    if (!(corner instanceof HTMLElement)) throw new Error('se esperaba la esquina de la regla');
    // La columna real mide 152 px; el token --tl-track-head-w no existe, así que
    // antes se usaba 160 y el frame quedaba 8 px corrido.
    Object.defineProperty(corner, 'offsetWidth', { value: 152, configurable: true });

    const readout = view.container.querySelector('.zoom-readout');
    const scale = Number.parseFloat(readout?.textContent ?? '2.4');
    const ruler = view.container.querySelector('.ruler-row');
    if (!(ruler instanceof HTMLElement)) throw new Error('se esperaba la regla');

    fireEvent.pointerDown(ruler, { clientX: 152 + 20 * scale, button: 0 });

    const grip = view.container.querySelector('.playhead-grip');
    expect(grip?.getAttribute('aria-valuenow')).toBe('20');
  });

  it('el clic sobre un clip lleva el cabezal al frame clickeado', () => {
    const view = renderTimeline();
    const clip = view.container.querySelector('.timeline-clip');
    if (!(clip instanceof HTMLElement)) throw new Error('se esperaba un clip');
    const readout = view.container.querySelector('.zoom-readout');
    const scale = Number.parseFloat(readout?.textContent ?? '2.4');
    // El clip arranca en el frame 0 y el carril empieza después de la cabecera.
    clip.getBoundingClientRect = () =>
      ({
        x: HEADER,
        y: 0,
        left: HEADER,
        top: 0,
        right: HEADER + 300 * scale,
        bottom: 40,
        width: 300 * scale,
        height: 40,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.pointerDown(clip, {
      button: 0,
      clientX: HEADER + 100 * scale,
      pointerId: 9,
    });

    // Sin el seek, el cabezal quedaba donde estaba y el clic se leía como
    // «el timeline no está sincronizado».
    const grip = view.container.querySelector('.playhead-grip');
    expect(grip?.getAttribute('aria-valuenow')).toBe('100');
  });

  it('el clic en la esquina de la regla no mueve el cabezal', () => {
    const view = renderTimeline();
    const readout = view.container.querySelector('.zoom-readout');
    const scale = Number.parseFloat(readout?.textContent ?? '2.4');
    const ruler = view.container.querySelector('.ruler-row');
    const corner = view.container.querySelector('.ruler-corner');
    if (!(ruler instanceof HTMLElement) || !(corner instanceof HTMLElement)) {
      throw new Error('se esperaban la regla y su esquina');
    }

    fireEvent.pointerDown(ruler, { clientX: HEADER + 60 * scale, button: 0 });
    const before = view.container
      .querySelector('.playhead-grip')
      ?.getAttribute('aria-valuenow');
    expect(before).toBe('60');

    fireEvent.pointerDown(corner, { clientX: 40, button: 0 });
    const after = view.container
      .querySelector('.playhead-grip')
      ?.getAttribute('aria-valuenow');
    expect(after).toBe('60');
  });
});

describe('onda del clip', () => {
  it('dibuja una envolvente cerrada y simétrica en un solo path', () => {
    const peaks = Array.from({ length: 40 }, (_, index) => (index % 4) / 4);
    const path = waveformPath(peaks, 20);
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    const points = path.slice(1, -1).split('L');
    // 20 columnas arriba + 20 abajo (espejadas).
    expect(points).toHaveLength(40);
    const y = points.map((pair) => Number(pair.split(',')[1]));
    const upper = y.slice(0, 20);
    const lower = y.slice(20).reverse();
    upper.forEach((value, index) => {
      expect(value + lower[index]!).toBeCloseTo(40, 2);
    });
  });

  it('no inventa onda sin datos', () => {
    expect(waveformPath([], 30)).toBe('');
    expect(waveformPath([1, 0.5], 0)).toBe('');
  });

  it('muestrea una columna cada 1,5 px con techo de 480', () => {
    expect(waveformColumns(0)).toBe(2);
    expect(waveformColumns(300)).toBe(200);
    expect(waveformColumns(10_000)).toBe(480);
  });
});

describe('Timeline · atajos reasignables desde Ajustes', () => {
  afterEach(() => {
    window.localStorage.removeItem(SHORTCUTS_STORAGE_KEY);
  });

  it('el marcador sigue el binding configurado, no la tecla fija', async () => {
    saveShortcuts({
      ...loadShortcuts(),
      'timeline.toggleMarker': 'Ctrl+Shift+M',
    });
    const { container } = renderTimeline();

    // La tecla original ya no dispara la acción.
    fireEvent.keyDown(window, { key: 'm' });
    expect(container.querySelectorAll('.timeline-marker')).toHaveLength(0);

    // El binding nuevo sí: Ctrl+Shift+M alterna el marcador en el playhead.
    fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(container.querySelectorAll('.timeline-marker').length).toBeGreaterThan(0);
    });
  });
});
