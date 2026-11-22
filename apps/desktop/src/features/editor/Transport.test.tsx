// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { createFakeService, readyAsset } from '../../test/fake-service';
import {
  addAsset,
  addClipFromAsset,
  ensureDelivery,
} from '../../state/project-actions';
import {
  loadEditorPreferences,
  resetEditorPreferences,
  updateEditorPreferences,
} from '../../state/editor-preferences';
import { Transport } from './Transport';

const NOW = '2026-11-08T00:00:00.000Z';

// jsdom no trae PointerEvent: sin el polyfill fireEvent.pointerDown/Move
// no construye el evento que el drag del slider escucha.
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

function projectWithClip(prepare?: (project: ProjectDocument) => ProjectDocument): ProjectDocument {
  const base = ensureDelivery(createEmptyProject('Slider', NOW));
  const asset = readyAsset();
  const created = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 300,
  }).project;
  return prepare ? prepare(created) : created;
}

/** Slider con geometría fija (300 px = 300 frames) para el scrub por puntero. */
function renderSlider() {
  const project = projectWithClip();
  const fps = project.video.frameRate.num / project.video.frameRate.den;
  render(
    <ProjectProvider service={createFakeService()} initial={{ project }}>
      <Transport />
    </ProjectProvider>,
  );
  const slider = screen.getByRole('slider', { name: 'Posición de reproducción' });
  slider.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 5,
      width: 300,
      height: 5,
      toJSON: () => ({}),
    }) as DOMRect;
  return { slider, fps };
}

function renderTransport() {
  const project = createEmptyProject('Loop', NOW);
  render(
    <ProjectProvider service={createFakeService()} initial={{ project }}>
      <Transport />
    </ProjectProvider>,
  );
}

function loopButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Bucle de reproducción' });
}

afterEach(() => {
  cleanup();
  resetEditorPreferences();
});

describe('Transport · botón Bucle', () => {
  it('refleja la preferencia persistida loopPlayback', () => {
    updateEditorPreferences({ loopPlayback: true });
    renderTransport();
    expect(loopButton().className).toContain('active');
    expect(loopButton().title).toBe('Bucle activado');
  });

  it('sin la preferencia el botón no aparece activo', () => {
    updateEditorPreferences({ loopPlayback: false });
    renderTransport();
    expect(loopButton().className).not.toContain('active');
    expect(loopButton().title).toBe('Activar bucle');
  });

  it('el click escribe la preferencia real que lee usePlayback', () => {
    updateEditorPreferences({ loopPlayback: false });
    renderTransport();
    fireEvent.click(loopButton());
    expect(loadEditorPreferences().loopPlayback).toBe(true);
    expect(loopButton().className).toContain('active');
    fireEvent.click(loopButton());
    expect(loadEditorPreferences().loopPlayback).toBe(false);
    expect(loopButton().className).not.toContain('active');
  });
});

describe('Transport · velocidad de reproducción', () => {
  it('el selector escribe la preferencia persistida playbackRate', () => {
    renderTransport();
    const select = screen.getByLabelText('Velocidad de reproducción');
    expect((select as HTMLSelectElement).value).toBe('1');
    fireEvent.change(select, { target: { value: '2' } });
    expect(loadEditorPreferences().playbackRate).toBe(2);
    expect((select as HTMLSelectElement).value).toBe('2');
    // Y la preferencia elegida es la que arranca el próximo transporte.
    cleanup();
    renderTransport();
    expect(
      (screen.getByLabelText('Velocidad de reproducción') as HTMLSelectElement).value,
    ).toBe('2');
  });
});

describe('Transport · slider de transporte', () => {
  it('tiene las teclas de slider completas: flechas, Home/End y PageUp/PageDown', () => {
    const { slider, fps } = renderSlider();
    const pageStep = Math.max(1, Math.round(fps * 5));

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuenow')).toBe('1');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider.getAttribute('aria-valuenow')).toBe('0');

    fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(slider.getAttribute('aria-valuenow')).toBe(String(pageStep));
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(slider.getAttribute('aria-valuenow')).toBe('0');

    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider.getAttribute('aria-valuenow')).toBe('300');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
  });

  it('arrastra de verdad: pointerdown + pointermove hacen scrub y pointerup lo suelta', () => {
    const { slider } = renderSlider();

    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 150 });
    expect(slider.getAttribute('aria-valuenow')).toBe('150');

    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 75 });
    expect(slider.getAttribute('aria-valuenow')).toBe('75');

    fireEvent.pointerUp(slider, { pointerId: 1 });
    // Soltado el botón, mover el puntero ya no scrubbea.
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 10 });
    expect(slider.getAttribute('aria-valuenow')).toBe('75');
  });
});

describe('Transport · sentido del shuttle', () => {
  it('en reversa el botón de play/pausa lo indica en título e icono', () => {
    function ShuttleBack() {
      const store = useProjectStore();
      return (
        <button
          type="button"
          onClick={() => {
            store.setPlaybackDirection(-1);
            store.setPlaying(true);
          }}
        >
          shuttle atras
        </button>
      );
    }
    const project = createEmptyProject('Reversa', NOW);
    render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <Transport />
        <ShuttleBack />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'shuttle atras' }));
    const play = screen.getByRole('button', { name: 'Pausar' });
    expect(play.title).toContain('hacia atrás');
    // El icono es playReverse (triángulo a la izquierda), no pause.
    expect(play.querySelector('svg path')?.getAttribute('d')).toContain('M16');
  });
});
