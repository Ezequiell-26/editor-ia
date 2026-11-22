// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { setAiMode } from '../../state/ai-mode';
import { Timeline } from './Timeline';

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
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, configurable: true });
  Object.defineProperty(globalThis, 'PointerEvent', { value: PointerEventPolyfill, configurable: true });
}

function renderTimeline() {
  const base = ensureDelivery(createEmptyProject('Timeline IA', '2026-10-20T00:00:00.000Z'));
  const asset = readyAsset();
  const project = addClipFromAsset(addAsset(base, asset), asset, {
    atFrame: 0,
    durationFrames: 300,
  }).project as ProjectDocument;
  const service = createFakeService();
  const opened = {
    project,
    label: 'timeline.editoria.json',
    path: 'C:\\tester\\timeline.editoria.json',
    root: 'C:\\tester',
  };
  return render(
    <ProjectProvider service={service} initial={{ project, opened }}>
      <Timeline />
    </ProjectProvider>,
  );
}

afterEach(() => {
  cleanup();
  setAiMode(false);
  window.localStorage.clear();
});

describe('Timeline · modo IA', () => {
  it('con el modo apagado la toolbar manual está completa', () => {
    renderTimeline();
    expect(screen.getByRole('button', { name: 'Dividir en playhead' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agregar pista' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Más herramientas' })).toBeTruthy();
    expect(screen.getByLabelText('Filtrar clips por color')).toBeTruthy();
  });

  it('con el modo IA queda sólo lo esencial: zoom, duración y los clips', async () => {
    setAiMode(true);
    const { container } = renderTimeline();

    // Lo que se mantiene: zoom (esencial para revisar) y la duración.
    expect(screen.getByRole('button', { name: 'Alejar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Acercar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajustar zoom a la duración' })).toBeTruthy();
    expect(container.querySelector('.timeline-duration')).not.toBeNull();

    // Herramientas manuales ocultas: selector, edición, pistas, filtros,
    // overflow y la barra rápida.
    for (const name of [
      'Dividir en playhead',
      'Agregar pista',
      'Más herramientas',
      'Borrar clip',
      'Copiar clip seleccionado',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByLabelText('Filtrar clips por color')).toBeNull();
    expect(screen.queryByLabelText('Buscar clips por nombre')).toBeNull();
    expect(container.querySelector('.quick-tools-bar, [class*="quick-tools"]')).toBeNull();

    // La pantalla de edición sigue: la timeline con sus clips y pistas.
    expect(container.querySelector('.timeline-surface')).not.toBeNull();
    await waitFor(() => {
      expect(container.querySelector('.timeline-clip')).not.toBeNull();
    });
  });
});
