// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, type ProjectDocument } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { setAiMode, setAiOnly } from '../../state/ai-mode';
import { EditorWorkspace } from './EditorWorkspace';

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

function renderWorkspace() {
  return render(
    <ProjectProvider
      service={createFakeService()}
      initial={{ project: createEmptyProject('Modo IA', '2026-10-20T00:00:00.000Z') }}
    >
      <EditorWorkspace onNavigate={vi.fn()} />
    </ProjectProvider>,
  );
}

afterEach(() => {
  cleanup();
  setAiOnly(false);
  setAiMode(false);
  window.localStorage.clear();
});

describe('EditorWorkspace · modo IA', () => {
  it('sin el modo, la pantalla de edición muestra biblioteca e inspector', () => {
    const { container } = renderWorkspace();
    expect(container.querySelector('.editor-grid')?.className ?? '').not.toContain('ai-mode');
    // Los paneles llegan por lazy: el fallback ya reserva su landmark.
    expect(container.querySelector('.asset-rail')).not.toBeNull();
    expect(container.querySelector('.inspector')).not.toBeNull();
    expect(container.querySelector('.preview-panel')).not.toBeNull();
    expect(container.querySelector('.timeline-panel')).not.toBeNull();
    expect(container.querySelector('.ia-coluna')).toBeNull();
  });

  it('con el modo IA quedan preview, timeline y la columna del asistente', () => {
    setAiMode(true);
    const { container } = renderWorkspace();
    const grid = container.querySelector('.editor-grid');
    expect(grid?.className ?? '').toContain('ai-mode');

    // Lo que se mantiene: la pantalla de edición y el chat lateral.
    expect(container.querySelector('.preview-panel')).not.toBeNull();
    expect(container.querySelector('.timeline-panel')).not.toBeNull();
    expect(container.querySelector('.ia-coluna')).not.toBeNull();
    expect(container.querySelector('.ia-col-corpo')).not.toBeNull();

    // Lo que se oculta: biblioteca, inspector y el divisor manual.
    expect(container.querySelector('.asset-rail')).toBeNull();
    expect(container.querySelector('.inspector')).toBeNull();
    expect(container.querySelector('.editor-splitter:not(.editor-splitter-ia)')).toBeNull();
  });

  it('con ai-only el chat está acoplado y no hay pestañas ni controles manuales', () => {
    setAiOnly(true);
    const { container } = renderWorkspace();
    expect(container.querySelector('.editor-grid')?.className ?? '').toContain('ai-mode');
    expect(container.querySelector('.preview-panel')).not.toBeNull();
    expect(container.querySelector('.timeline-panel')).not.toBeNull();
    expect(container.querySelector('.ia-col-corpo')).not.toBeNull();

    expect(container.querySelector('[role="tablist"][aria-label="Modos de edición"]')).toBeNull();
    expect(container.querySelector('.ia-col-hint')).toBeNull();
    expect(container.querySelector('.ia-col-toggle')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeNull();
  });

  it('sin proyecto, ai-only ofrece el chat en vez de botones para abrir proyecto', () => {
    setAiOnly(true);
    const { container } = render(
      <ProjectProvider service={createFakeService()}>
        <EditorWorkspace onNavigate={vi.fn()} />
      </ProjectProvider>,
    );
    expect(container.querySelector('[data-ai-only="true"]')).not.toBeNull();
    expect(container.querySelector('.ia-col-corpo')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Abrir proyecto/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Nuevo proyecto/ })).toBeNull();
  });

  it('muestra Start sobre el cuadro de video cuando hay clips para revisar', () => {
    setAiOnly(true);
    const base = ensureDelivery(
      createEmptyProject('Start IA', '2026-10-20T00:00:00.000Z'),
    );
    const asset = readyAsset();
    const project = addClipFromAsset(addAsset(base, asset), asset, {
      atFrame: 0,
      durationFrames: 120,
    }).project as ProjectDocument;
    render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <EditorWorkspace onNavigate={vi.fn()} />
      </ProjectProvider>,
    );
    expect(screen.getByRole('button', { name: 'Start · reproducir video' })).toBeTruthy();
  });

  it('al apagar el modo se restaura la pantalla completa', async () => {
    setAiMode(true);
    const { container } = renderWorkspace();
    expect(container.querySelector('.asset-rail')).toBeNull();

    setAiMode(false);
    // El store notifica y el workspace re-renderiza con los paneles.
    await waitFor(() => {
      expect(container.querySelector('.asset-rail')).not.toBeNull();
      expect(container.querySelector('.inspector')).not.toBeNull();
      expect(container.querySelector('.editor-grid')?.className ?? '').not.toContain('ai-mode');
    });
  });
});
