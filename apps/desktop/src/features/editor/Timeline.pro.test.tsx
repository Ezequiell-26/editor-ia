// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import type { ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
} from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { loadEditorPreferences, updateEditorPreferences } from '../../state/editor-preferences';
import { Timeline } from './Timeline';

const NOW = '2026-11-03T00:00:00.000Z';

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

let latestProject: ProjectDocument | null = null;

function ProjectProbe(): null {
  const store = useProjectStore();
  latestProject = store.state.project;
  return null;
}

/** Dos clips de video en la misma pista: 0..120 y 200..320. */
function twoClipProject(): ProjectDocument {
  const asset = readyAsset({ label: 'Clip A' });
  let project = ensureDelivery(createEmptyProject('Pro', NOW));
  project = addAsset(project, asset);
  const first = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 120 });
  const second = addClipFromAsset(first.project, asset, {
    atFrame: 200,
    durationFrames: 120,
    trackId: first.trackId,
  });
  return second.project;
}

function renderTimeline(project: ProjectDocument) {
  const service = createFakeService();
  const opened = {
    project,
    label: 'pro.editoria.json',
    path: 'C:\\tester\\pro.editoria.json',
    root: 'C:\\tester',
  };
  latestProject = project;
  const view = render(
    <ProjectProvider service={service} initial={{ project, opened }}>
      <ProjectProbe />
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
  window.localStorage.clear();
});

describe('Timeline pro · fluidez y multi-selección', () => {
  it('el pointerup vuelca el último move pendiente (rAF coalescing) y commitea esa posición', async () => {
    const { container } = renderTimeline(twoClipProject());
    const clip = container.querySelector('.timeline-clip');
    if (!(clip instanceof HTMLElement)) throw new Error('se esperaba un clip');

    fireEvent.pointerDown(clip, { button: 0, clientX: 200, pointerId: 7 });
    // Tres moves en el mismo frame: sólo el último debe llegar al commit.
    fireEvent.pointerMove(window, { clientX: 220, pointerId: 7, buttons: 1 });
    fireEvent.pointerMove(window, { clientX: 235, pointerId: 7, buttons: 1 });
    fireEvent.pointerMove(window, { clientX: 248, pointerId: 7, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 248, pointerId: 7 });

    await waitFor(() => {
      const moved = latestProject?.timeline.clips
        .slice()
        .sort((a, b) => a.startFrame - b.startFrame)[0];
      // 48 px / 2.4 px por frame = 20 frames: el flush del último evento manda.
      expect(moved?.startFrame).toBe(20);
    });
  });

  it('Shift+clic suma clips a la selección y los resalta a todos', async () => {
    const { container } = renderTimeline(twoClipProject());
    const clips = () => container.querySelectorAll('.timeline-clip');
    const first = clips()[0] as HTMLElement;
    const second = clips()[1] as HTMLElement;

    fireEvent.pointerDown(first, { button: 0, clientX: 200, pointerId: 11 });
    fireEvent.pointerUp(window, { clientX: 200, pointerId: 11 });
    await waitFor(() => expect(container.querySelectorAll('.timeline-clip.selected')).toHaveLength(1));

    fireEvent.pointerDown(second, { button: 0, clientX: 700, pointerId: 12, shiftKey: true });
    fireEvent.pointerUp(window, { clientX: 700, pointerId: 12 });
    await waitFor(() => expect(container.querySelectorAll('.timeline-clip.selected')).toHaveLength(2));
  });

  it('arrastrar el grupo mueve todos los clips seleccionados', async () => {
    const { container } = renderTimeline(twoClipProject());
    const clips = () => container.querySelectorAll('.timeline-clip');
    const first = clips()[0] as HTMLElement;
    const second = clips()[1] as HTMLElement;

    fireEvent.pointerDown(first, { button: 0, clientX: 200, pointerId: 21 });
    fireEvent.pointerUp(window, { clientX: 200, pointerId: 21 });
    fireEvent.pointerDown(second, { button: 0, clientX: 700, pointerId: 22, shiftKey: true });
    fireEvent.pointerUp(window, { clientX: 700, pointerId: 22 });
    await waitFor(() => expect(container.querySelectorAll('.timeline-clip.selected')).toHaveLength(2));

    // Arrastra el clip primario 20 frames (2.4 px/frame → +48 px).
    fireEvent.pointerDown(second, { button: 0, clientX: 700, pointerId: 23 });
    fireEvent.pointerMove(window, { clientX: 748, pointerId: 23, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 748, pointerId: 23 });

    await waitFor(() => {
      const starts = (latestProject?.timeline.clips ?? [])
        .map((clip) => clip.startFrame)
        .sort((a, b) => a - b);
      expect(starts).toEqual([20, 220]);
    });
  });

  it('el toggle de ripple responde al botón y a Shift+R, y persiste en Ajustes→Editor', async () => {
    renderTimeline(twoClipProject());
    const toggle = screen.getByRole('button', { name: /Activar o desactivar edición ripple/i });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));
    expect(loadEditorPreferences().timelineRipple).toBe(true);

    fireEvent.keyDown(window, { key: 'R', shiftKey: true });
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'));
    expect(loadEditorPreferences().timelineRipple).toBe(false);
  });

  it('el toggle de ripple sigue las preferencias de Ajustes→Editor en vivo', async () => {
    renderTimeline(twoClipProject());
    const toggle = screen.getByRole('button', { name: /Activar o desactivar edición ripple/i });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    updateEditorPreferences({ timelineRipple: true });
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));
    updateEditorPreferences({ timelineRipple: false });
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'));
  });

  it('migra la clave histórica del toggle Ripple al abrir el timeline', async () => {
    window.localStorage.setItem('editoria.timeline-ripple.v1', '1');
    renderTimeline(twoClipProject());
    const toggle = screen.getByRole('button', { name: /Activar o desactivar edición ripple/i });
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));
    // Al interactuar, el valor pasa a las preferencias nuevas y la clave vieja
    // se descarta; el detalle fino de la migración está en editor-preferences.test.
    expect(loadEditorPreferences().timelineRipple).toBe(true);
  });

  it('sin layout medible (jsdom) renderiza todos los clips y no muestra el minimapa', () => {
    const { container } = renderTimeline(twoClipProject());
    expect(container.querySelectorAll('.timeline-clip')).toHaveLength(2);
    expect(container.querySelector('.timeline-overview')).toBeNull();
    // Contrato: cada clip conserva clase y atributo de accesibilidad.
    for (const clip of container.querySelectorAll('.timeline-clip')) {
      expect(clip.getAttribute('role')).toBe('button');
      expect(clip.getAttribute('aria-label')).toBeTruthy();
    }
  });
});
