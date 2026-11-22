// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { App } from '../App';
import { AppShell } from '../components/AppShell';
import { AppearanceProvider } from '../state/AppearanceProvider';
import { setAiOnly, useAiOnly } from '../state/ai-mode';
import { ProjectProvider } from '../state/project-store';
import { createFakeService } from '../test/fake-service';
import { AssistantDock } from '../features/assistant/AssistantDock';
import type { ViewId } from './navigation';

const NOW = '2026-10-20T00:00:00.000Z';

/** Réplica mínima del composition root: el dock llega inyectado a AppShell. */
function TestAssistantDock({ onSelect }: { readonly onSelect: (id: ViewId) => void }) {
  const aiOnly = useAiOnly();
  return <AssistantDock activeId="editor" onSelect={onSelect} docked={aiOnly} />;
}

function renderShell(onSelect = vi.fn()) {
  return {
    onSelect,
    ...render(
    <AppearanceProvider>
      <ProjectProvider
        service={createFakeService()}
        initial={{ project: createEmptyProject('Shell IA', NOW) }}
      >
        <AppShell
          activeId="editor"
          onSelect={onSelect}
          content={<div data-testid="contenido-editor" />}
          editorSurface
          flush
          onReturnToStart={vi.fn()}
          assistantDock={<TestAssistantDock onSelect={onSelect} />}
        />
      </ProjectProvider>
    </AppearanceProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  setAiOnly(false);
  window.localStorage.clear();
});

describe('Shell · superficie IA-only', () => {
  it('sin ai-only conserva el rail, el menú y los botones de edición', () => {
    const { container } = renderShell();
    expect(container.querySelector('.app-shell')?.className ?? '').not.toContain('ai-only');
    expect(container.querySelector('nav.sidebar')).not.toBeNull();
    expect(screen.getByLabelText('Exportar video')).toBeTruthy();
    expect(screen.getByLabelText('Abrir asistente Olyvia')).toBeTruthy();
  });

  it('con ai-only quedan el contenido del editor y el chat acoplado', () => {
    setAiOnly(true);
    const { container } = renderShell();
    expect(container.querySelector('.app-shell')?.className ?? '').toContain('ai-only');

    // Lo que se mantiene.
    expect(screen.getByTestId('contenido-editor')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Asistente Olyvia' })).toBeTruthy();
    expect(screen.getByLabelText('Mensaje para Olyvia')).toBeTruthy();

    // Controles manuales fuera de la pantalla.
    expect(container.querySelector('nav.sidebar')).toBeNull();
    expect(screen.queryByLabelText('Exportar video')).toBeNull();
    expect(screen.queryByLabelText('Mapa de herramientas')).toBeNull();
    expect(screen.queryByLabelText('Pantalla de inicio')).toBeNull();
    expect(screen.queryByLabelText('Abrir asistente Olyvia')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cerrar asistente' })).toBeNull();
  });

  it('con ai-only arranca con el editor visible, no con una pantalla de bienvenida', async () => {
    setAiOnly(true);
    const service = createFakeService();
    const createProject = vi.spyOn(service, 'createProject');
    render(<App service={service} />);
    await waitFor(() => expect(createProject).toHaveBeenCalled(), { timeout: 5_000 });
    await waitFor(() => {
      expect(document.querySelector('.preview-panel')).not.toBeNull();
      expect(document.querySelector('.timeline-panel')).not.toBeNull();
    }, { timeout: 5_000 });
    expect(document.querySelector('.ai-only-empty-stage')).toBeNull();
    expect(screen.getAllByText('Timeline vacía').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Start · reproducir video' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Asistente Olyvia' })).toBeTruthy();
  });
});
