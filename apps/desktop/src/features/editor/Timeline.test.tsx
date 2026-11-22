// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  applyTransitionToCuts,
  ensureDelivery,
  trimClip,
  updateClip,
} from '../../state/project-actions';
import { addMarker } from '../../state/markers';
import { createFakeService, readyAsset } from '../../test/fake-service';
import {
  SHORTCUTS_STORAGE_KEY,
  loadShortcuts,
  saveShortcuts,
} from '../../state/shortcuts';
import { Timeline, waveformBarsPath, waveformColumns, waveformMarkersPath, waveformPath } from './Timeline';

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

let latestState: ReturnType<typeof useProjectStore>['state'] | null = null;

function StoreProbe(): null {
  const store = useProjectStore();
  useEffect(() => {
    latestState = store.state;
  }, [store.state]);
  return null;
}

/** Selecciona el primer clip al montar (las acciones de inspector/menú la exigen). */
function SelectFirstClipOnMount(): null {
  const store = useProjectStore();
  useEffect(() => {
    const clip = store.state.project?.timeline.clips[0];
    if (clip) store.setSelection({ kind: 'clip', id: clip.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderTimeline(
  prepare?: (project: ProjectDocument) => ProjectDocument,
  timelineProps?: ComponentProps<typeof Timeline>,
  extra?: ReactNode,
) {
  const base = ensureDelivery(createEmptyProject('Timeline', NOW));
  const asset = readyAsset();
  const created = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 300,
  }).project;
  const project = prepare ? prepare(created) : created;
  const service = createFakeService();
  const opened = {
    project,
    label: 'timeline.editoria.json',
    path: 'C:\\tester\\timeline.editoria.json',
    root: 'C:\\tester',
  };
  latestState = null;
  const view = render(
    <ProjectProvider service={service} initial={{ project, opened }}>
      <Timeline {...timelineProps} />
      <StoreProbe />
      {extra}
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
  return { ...view, service };
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

  it('estilo CapCut dibuja barras ancladas a la base', () => {
    const peaks = Array.from({ length: 40 }, (_, index) => (index % 4) / 4);
    const path = waveformBarsPath(peaks, 20);
    expect(path.startsWith('M')).toBe(true);
    const bars = path.split('M').filter(Boolean);
    expect(bars).toHaveLength(20);
    // Toda barra nace en la base (y=39) y sube según el pico.
    for (const bar of bars) {
      expect(bar).toContain(',39');
      expect(bar.endsWith('Z')).toBe(true);
    }
    // Un pico mayor produce una barra más alta (menor y superior).
    const tops = bars.map((bar) => {
      const v = /V([\d.]+)/.exec(bar);
      return v ? Number(v[1]) : Number.NaN;
    });
    expect(Math.min(...tops)).toBeLessThan(36);
    expect(waveformBarsPath([], 30)).toBe('');
    expect(waveformBarsPath([1, 0.5], 0)).toBe('');
  });

  it('marca puntas calientes y clipeadas sólo en sus columnas', () => {
    // 1.25 = caliente, 1.5 = clipeado (codificación de encodeWavePeak).
    const peaks = [0.5, 0.5, 1.25, 1.5, 0.5, 0.5];
    const hot = waveformMarkersPath(peaks, 6, 'hot', 'capcut');
    const clip = waveformMarkersPath(peaks, 6, 'clip', 'capcut');
    expect(hot).not.toBe('');
    expect(clip).not.toBe('');
    // El hot no incluye la columna clipeada (1.5 >= WAVE_CLIP_MIN).
    const hotColumns = hot.split('M').filter(Boolean);
    const clipColumns = clip.split('M').filter(Boolean);
    expect(hotColumns).toHaveLength(1);
    expect(clipColumns).toHaveLength(1);
    // Sin marcadores no hay overlay.
    expect(waveformMarkersPath([0.5, 0.4, 0.3], 3, 'hot', 'davinci')).toBe('');
    expect(waveformMarkersPath([], 4, 'clip', 'davinci')).toBe('');
    // Estilo envelope: cada columna marcada dibuja dos rectángulos de punta.
    const env = waveformMarkersPath(peaks, 6, 'clip', 'davinci');
    expect(env.split('M').filter(Boolean)).toHaveLength(2);
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

describe('Timeline · marca de transición', () => {
  it('dibuja la transición de entrada y pinta el color del dip', () => {
    const base = ensureDelivery(createEmptyProject('Timeline', NOW));
    const asset = readyAsset();
    let project = addAsset(base, asset);
    for (const at of [0, 300]) {
      project = addClipFromAsset(project, asset, {
        atFrame: at,
        durationFrames: 300,
      }).project;
    }
    project = applyTransitionToCuts(project, {
      type: 'dip-color',
      frames: 24,
      color: '#2244aa',
    }).project;
    const service = createFakeService();
    const opened = {
      project,
      label: 'timeline.editoria.json',
      path: 'C:\tester\timeline.editoria.json',
      root: 'C:\tester',
    };
    const view = render(
      <ProjectProvider service={service} initial={{ project, opened }}>
        <Timeline />
      </ProjectProvider>,
    );
    const marker = view.container.querySelector('.clip-transition.transition-dip-color');
    expect(marker).not.toBeNull();
    expect((marker as HTMLElement).style.backgroundColor).toBe('rgb(34, 68, 170)');
    expect(marker?.getAttribute('aria-label')).toContain('Fundido a color');
    expect(marker?.getAttribute('aria-label')).toContain('24 frames');
  });
});

describe('Timeline · spy de clip (espiada_midia)', () => {
  it('muestra el frame del asset bajo el cursor al hacer hover en un clip de video', async () => {
    const { container, service } = renderTimeline();
    const spy = vi.spyOn(service, 'mediaThumbnail');
    const clip = container.querySelector('.timeline-clip');
    expect(clip).not.toBeNull();

    fireEvent.mouseMove(clip as HTMLElement, { clientX: 300, clientY: 120 });
    // El debounce del spy es 140 ms; la miniatura llega async.
    await waitFor(
      () => {
        const box = container.querySelector('.clip-spy');
        expect(box).not.toBeNull();
        expect((box as HTMLElement).style.display).toBe('block');
        expect(box?.querySelector('img')?.getAttribute('src')).toContain('data:image');
      },
      { timeout: 2000 },
    );
    expect(spy).toHaveBeenCalledWith('media/toma.mp4', false, expect.any(Number));

    // Al salir del clip la ventanita se oculta.
    fireEvent.mouseLeave(clip as HTMLElement);
    await waitFor(() => {
      const box = container.querySelector('.clip-spy') as HTMLElement;
      expect(box.style.display).toBe('none');
    });
  });
});

describe('Timeline · skim', () => {
  it('el hover mueve el playhead y al salir restaura el frame real', async () => {
    const { container } = renderTimeline();
    const scroll = container.querySelector('.timeline-scroll');
    const toggle = container.querySelector('.skim-toggle');
    if (!(scroll instanceof HTMLElement)) throw new Error('se esperaba la timeline');
    if (!(toggle instanceof HTMLElement)) throw new Error('se esperaba el botón skim');

    // Sin skim activo el hover no mueve el playhead.
    fireEvent.mouseMove(scroll, { clientX: HEADER + 120 * 2.4 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const grip = container.querySelector('.playhead-grip');
    expect(grip?.getAttribute('aria-valuenow')).toBe('0');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    // Hover: el playhead salta al frame bajo el mouse (rAF + waitFor).
    fireEvent.mouseMove(scroll, { clientX: HEADER + 120 * 2.4 });
    await waitFor(() => expect(grip?.getAttribute('aria-valuenow')).toBe('120'));

    // Salir del área restaura el frame real (0).
    fireEvent.mouseLeave(scroll);
    await waitFor(() => expect(grip?.getAttribute('aria-valuenow')).toBe('0'));
  });
});

describe('Timeline · menú contextual · efectos de sonido', () => {
  it('monta el SFX elegido al inicio del clip', async () => {
    const { container, service } = renderTimeline();
    const clip = container.querySelector('.timeline-clip');
    if (!(clip instanceof HTMLElement)) throw new Error('se esperaba un clip');

    service.sfxLibrary = async () => [
      {
        id: 'pop',
        file: 'pop.wav',
        label: 'Pop',
        description: 'click seco',
        durationSeconds: 0.4,
        path: 'C:/sfx/pop.wav',
      },
    ];
    service.importMediaPaths = async (input) => ({
      assets: input.paths.map((path, index) =>
        readyAsset({
          id: crypto.randomUUID(),
          kind: 'audio',
          label: 'Pop',
          source: { type: 'local', path: `media/sfx-${index}.wav` },
          media: { sampleRate: 48000, channels: 2, durationFrames: 300 },
          rights: {
            license: { id: 'user-declared', commercialUse: 'allowed' },
            provenance: {
              origin: 'user-imported',
              acquiredAt: NOW,
              provider: 'sfx',
            },
          },
        }),
      ),
      warnings: [],
    });

    fireEvent.contextMenu(clip, { clientX: 200, clientY: 100 });
    const openSfx = await screen.findByRole('menuitem', { name: /Efecto de sonido/i });
    fireEvent.click(openSfx);

    const addButton = await screen.findByRole('menuitem', { name: /Pop/i });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(container.querySelectorAll('.timeline-clip').length).toBe(2);
    });
  });
});

describe('Timeline · keyframes: navegación y creación', () => {
  function withTransformKeyframes(project: ProjectDocument): ProjectDocument {
    const clip = project.timeline.clips[0]!;
    return updateClip(project, clip.id, {
      transform: {
        keyframes: [
          { frame: 0, scale: 1 },
          { frame: 60, scale: 1.2 },
          { frame: 150, scale: 1 },
        ],
      },
    });
  }

  function selectClip(container: HTMLElement): void {
    const clip = container.querySelector('.timeline-clip');
    if (!(clip instanceof HTMLElement)) throw new Error('se esperaba un clip');
    fireEvent.pointerDown(clip, { button: 0, clientX: 200, pointerId: 7 });
  }

  it('las flechas ‹ › saltan entre los keyframes del clip seleccionado', () => {
    const view = renderTimeline(withTransformKeyframes);
    selectClip(view.container);
    const grip = view.container.querySelector('.playhead-grip');
    const next = screen.getByRole('button', { name: 'Keyframe siguiente' });
    const previous = screen.getByRole('button', { name: 'Keyframe anterior' });

    expect(next.hasAttribute('disabled')).toBe(false);
    fireEvent.click(next);
    expect(grip?.getAttribute('aria-valuenow')).toBe('60');
    fireEvent.click(next);
    expect(grip?.getAttribute('aria-valuenow')).toBe('150');
    fireEvent.click(previous);
    expect(grip?.getAttribute('aria-valuenow')).toBe('60');
  });

  it('sin keyframes las flechas quedan deshabilitadas', () => {
    const view = renderTimeline();
    selectClip(view.container);
    expect(
      screen.getByRole('button', { name: 'Keyframe anterior' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Keyframe siguiente' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('dibuja un diamante por keyframe sólo en el clip seleccionado', () => {
    const view = renderTimeline(withTransformKeyframes);
    expect(view.container.querySelectorAll('.timeline-keyframe-mark').length).toBe(0);
    selectClip(view.container);
    expect(view.container.querySelectorAll('.timeline-keyframe-mark').length).toBe(3);
  });

  it('el diamante agrega y quita el keyframe de transformación en el playhead', () => {
    const view = renderTimeline();
    selectClip(view.container);

    const add = screen.getByRole('button', {
      name: 'Agregar keyframe de transformación en el playhead',
    });
    expect(add.hasAttribute('disabled')).toBe(false);
    fireEvent.click(add);

    // Tras crear la clave, el mismo botón pasa a ofrecer quitarla.
    const remove = screen.getByRole('button', {
      name: 'Quitar keyframe de transformación en el playhead',
    });
    expect(remove.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(remove);
    expect(
      screen.getByRole('button', {
        name: 'Agregar keyframe de transformación en el playhead',
      }),
    ).toBeTruthy();
  });
});

describe('Timeline · navegación por marcadores', () => {
  function withMarkers(project: ProjectDocument): ProjectDocument {
    const first = addMarker(project, 60, { label: 'Entrada' }).project;
    return addMarker(first, 180, { label: 'Cierre' }).project;
  }

  it('las flechas saltan al marcador anterior y siguiente', () => {
    const view = renderTimeline(withMarkers);
    const grip = view.container.querySelector('.playhead-grip');
    const next = screen.getByRole('button', { name: 'Marcador siguiente' });
    const previous = screen.getByRole('button', { name: 'Marcador anterior' });

    expect(next.hasAttribute('disabled')).toBe(false);
    fireEvent.click(next);
    expect(grip?.getAttribute('aria-valuenow')).toBe('60');
    fireEvent.click(next);
    expect(grip?.getAttribute('aria-valuenow')).toBe('180');
    expect(
      screen.getByRole('button', { name: 'Marcador siguiente' }).hasAttribute('disabled'),
    ).toBe(true);

    fireEvent.click(previous);
    expect(grip?.getAttribute('aria-valuenow')).toBe('60');
  });

  it('sin marcadores las flechas quedan deshabilitadas', () => {
    renderTimeline();
    expect(
      screen.getByRole('button', { name: 'Marcador anterior' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Marcador siguiente' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('arrastra un marcador sobre la regla y mueve su frame', () => {
    const view = renderTimeline(withMarkers);
    const marker = view.container.querySelector('.timeline-marker');
    if (!(marker instanceof HTMLElement)) throw new Error('sin marcador en la regla');
    const before = marker.style.left;

    fireEvent.pointerDown(marker, { button: 0, clientX: 100, pointerId: 4 });
    fireEvent.pointerMove(marker, { clientX: 148, pointerId: 4 });
    fireEvent.pointerUp(marker, { pointerId: 4 });

    const after = view.container.querySelector('.timeline-marker');
    if (!(after instanceof HTMLElement)) throw new Error('sin marcador tras el arrastre');
    expect(after.style.left).not.toBe(before);
  });

  it('arrastra el fin de un marcador de rango', () => {
    const view = renderTimeline(
      (project) => addMarker(project, 60, { label: 'Rango', endFrame: 180 }).project,
    );
    const handle = view.container.querySelector('.timeline-marker-range-handle');
    if (!(handle instanceof HTMLElement)) throw new Error('sin handle de fin');
    const before = handle.style.left;

    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 5 });
    fireEvent.pointerMove(handle, { clientX: 140, pointerId: 5 });
    fireEvent.pointerUp(handle, { pointerId: 5 });

    const after = view.container.querySelector('.timeline-marker-range-handle');
    if (!(after instanceof HTMLElement)) throw new Error('sin handle tras el arrastre');
    expect(after.style.left).not.toBe(before);
  });
});

describe('Timeline · herramientas slip/slide/roll', () => {
  // Espejo de `preferences.defaultZoom` (2.4 px/frame) usado por la suite.
  const PX = 2.4;

  /** El clip base ocupa los 300 frames del asset: lo partimos en tres clips
   *  contiguos de 100 frames con ventanas de origen corridas, que es lo que
   *  slide y roll necesitan (vecinos contiguos con margen de material). */
  function threeContiguousClips(project: ProjectDocument): ProjectDocument {
    const clipId = project.timeline.clips[0]?.id;
    if (!clipId) return project;
    const trimmed = trimClip(project, clipId, 'end', 100);
    let next = trimmed ?? project;
    const asset = next.assets.find((item) => item.kind === 'video');
    if (!asset) return next;
    next = addClipFromAsset(next, asset, {
      atFrame: 100,
      durationFrames: 100,
      inFrame: 100,
      outFrame: 200,
    }).project;
    return addClipFromAsset(next, asset, {
      atFrame: 200,
      durationFrames: 100,
      inFrame: 200,
      outFrame: 300,
    }).project;
  }

  function clipAtLeft(container: HTMLElement, leftPx: number): HTMLElement {
    const found = [...container.querySelectorAll<HTMLElement>('.timeline-clip')].find(
      (element) => Math.abs(parseFloat(element.style.left) - leftPx) < 0.01,
    );
    if (!found) throw new Error(`no hay clip con left=${leftPx}`);
    return found;
  }

  it('slip (Y) desliza la ventana de origen sin mover el clip', async () => {
    const { container } = renderTimeline((project) => {
      const id = project.timeline.clips[0]?.id;
      return id ? trimClip(project, id, 'end', 200) ?? project : project;
    });
    const clip = container.querySelector('.timeline-clip');
    if (!(clip instanceof HTMLElement)) throw new Error('se esperaba un clip');

    fireEvent.keyDown(window, { key: 'y' });
    fireEvent.pointerDown(clip, { button: 0, clientX: 200, pointerId: 11 });
    fireEvent.pointerMove(window, { clientX: 320, pointerId: 11, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 320, pointerId: 11 });

    // +50 frames de origen (200→250 dentro del asset de 300), clip quieto.
    await waitFor(() => {
      expect(container.querySelector('.clip-window')?.textContent).toContain('in 50');
      expect(container.querySelector('.clip-window')?.textContent).toContain('out 250');
    });
    expect(clip.style.left).toBe('0px');
  });

  it('slide (T) desliza el clip medio y absorbe la diferencia en los vecinos', async () => {
    const { container } = renderTimeline(threeContiguousClips);
    const middle = clipAtLeft(container, 100 * PX);

    fireEvent.keyDown(window, { key: 't' });
    fireEvent.pointerDown(middle, { button: 0, clientX: 250, pointerId: 12 });
    fireEvent.pointerMove(window, { clientX: 274, pointerId: 12, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 274, pointerId: 12 });

    // +10 frames: el clip pasa de start=100 a start=110; el anterior estira
    // su salida a 110 y el posterior entra en 210 con 90 frames.
    await waitFor(() => {
      expect(clipAtLeft(container, 110 * PX).style.left).toBe(`${110 * PX}px`);
    });
    const windows = [...container.querySelectorAll('.clip-window')].map(
      (element) => element.textContent,
    );
    expect(windows.some((text) => text?.includes('out 110'))).toBe(true);
    expect(windows.some((text) => text?.includes('in 210'))).toBe(true);
  });

  it('roll (N) acerca al borde izquierdo y rueda el corte de entrada', async () => {
    const { container } = renderTimeline(threeContiguousClips);
    // Borde izquierdo del clip del medio: frame 100 → 240 px; el clic a 245 px
    // cae a 5 px del corte (dentro de la zona de agarre).
    const middle = clipAtLeft(container, 100 * PX);

    fireEvent.keyDown(window, { key: 'n' });
    fireEvent.pointerDown(middle, { button: 0, clientX: 245, pointerId: 13 });
    fireEvent.pointerMove(window, { clientX: 264, pointerId: 13, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 264, pointerId: 13 });

    // +8 frames en el corte: el clip pasa a start=108 con ventana 108–200.
    await waitFor(() => {
      const moved = clipAtLeft(container, 108 * PX);
      expect(moved.querySelector('.clip-window')?.textContent).toContain('in 108');
    });
  });
});

describe('Timeline · menú «Más herramientas» y acciones de clip', () => {
  it('separa el audio del clip de video desde el menú contextual', async () => {
    const { container } = renderTimeline();
    const clip = container.querySelector('.timeline-clip');
    if (!(clip instanceof HTMLElement)) throw new Error('se esperaba un clip');

    fireEvent.contextMenu(clip, { clientX: 200, clientY: 100 });
    const separate = await screen.findByRole('menuitem', { name: /Separar audio/i });
    expect((separate as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(separate);

    await waitFor(() => {
      expect(container.querySelectorAll('.timeline-clip').length).toBe(2);
    });
    await waitFor(() => {
      expect(latestState?.notice).toContain('Audio separado');
    });
  });

  it('agrupa el clip en un compuesto desde el menú contextual', async () => {
    const { container } = renderTimeline();
    const clip = container.querySelector('.timeline-clip');
    if (!(clip instanceof HTMLElement)) throw new Error('se esperaba un clip');

    fireEvent.contextMenu(clip, { clientX: 200, clientY: 100 });
    const compound = await screen.findByRole('menuitem', { name: /Crear clip compuesto/i });
    fireEvent.click(compound);

    await waitFor(() => {
      expect(latestState?.project?.timeline.clips[0]?.kind).toBe('compound');
    });
    expect(latestState?.notice).toContain('Compuesto creado');
  });

  it('«Detección de silencio» abre la pestaña Audio del inspector', async () => {
    const onRequestInspectorTab = vi.fn();
    renderTimeline(
      undefined,
      { onRequestInspectorTab },
      <SelectFirstClipOnMount />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Más herramientas' }));
    const item = await screen.findByRole('menuitem', { name: /Detección de silencio/i });
    expect((item as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(item);

    expect(onRequestInspectorTab).toHaveBeenCalledWith('audio', undefined);
  });

  it('«Detección de ritmo» abre la subpestaña Ritmo del inspector', async () => {
    const onRequestInspectorTab = vi.fn();
    renderTimeline(
      undefined,
      { onRequestInspectorTab },
      <SelectFirstClipOnMount />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Más herramientas' }));
    const item = await screen.findByRole('menuitem', { name: /Detección de ritmo/i });
    fireEvent.click(item);

    expect(onRequestInspectorTab).toHaveBeenCalledWith('audio', 'custom');
  });

  it('«Edición por texto» navega a la vista Texto', async () => {
    const onNavigate = vi.fn();
    renderTimeline(undefined, { onNavigate });

    fireEvent.click(screen.getByRole('button', { name: 'Más herramientas' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Edición por texto/i }));

    expect(onNavigate).toHaveBeenCalledWith('text-edit');
  });

  it('«Sugerencias de edición inteligente» cambia al modo Cerebro', async () => {
    const onSwitchEditorMode = vi.fn();
    const { container } = renderTimeline(
      undefined,
      { onSwitchEditorMode },
    );
    const clip = container.querySelector('.timeline-clip');
    if (!(clip instanceof HTMLElement)) throw new Error('se esperaba un clip');

    fireEvent.contextMenu(clip, { clientX: 200, clientY: 100 });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Sugerencias de edición inteligente/i }),
    );

    expect(onSwitchEditorMode).toHaveBeenCalledWith('brain');
  });

  it('«Traducción con IA» navega a Localización', async () => {
    const onNavigate = vi.fn();
    const { container } = renderTimeline(undefined, { onNavigate });
    const clip = container.querySelector('.timeline-clip');
    if (!(clip instanceof HTMLElement)) throw new Error('se esperaba un clip');

    fireEvent.contextMenu(clip, { clientX: 200, clientY: 100 });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Traducción con IA/i }));

    expect(onNavigate).toHaveBeenCalledWith('localization');
  });

  it('ya no lista herramientas sin implementación como pendientes', async () => {
    renderTimeline();

    fireEvent.click(screen.getByRole('button', { name: 'Más herramientas' }));
    await screen.findByRole('menuitem', { name: /Edición por texto/i });
    for (const gone of [
      'Imagen a video',
      'Extensión con IA',
      'Extensión de audio',
      'Editar Dispositivos',
      'Eliminador de objetos con IA',
    ]) {
      expect(screen.queryByRole('menuitem', { name: gone })).toBeNull();
    }
    expect(screen.queryByText('Pendiente')).toBeNull();
  });
});
