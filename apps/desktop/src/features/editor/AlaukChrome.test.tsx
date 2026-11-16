// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { AlaukFooter, AlaukTopBar } from './AlaukChrome';

afterEach(() => {
  cleanup();
  // El toggle de vista escribe en <html> y en localStorage: se limpia para
  // que ningún test herede el estado del anterior.
  delete document.documentElement.dataset.editorSkin;
  try {
    localStorage.removeItem('olyvia:editor-skin');
  } catch {
    // jsdom sin almacenamiento: no hay nada que limpiar.
  }
});

function renderChrome(
  onNavigate = vi.fn(),
  onOpenShortcuts?: () => void,
  onAutoEdit?: () => void,
  onOpenTools?: () => void,
) {
  render(
    <ProjectProvider service={createFakeService()} initial={{ project: createEmptyProject('0919') }}>
      <AlaukTopBar
        onNavigate={onNavigate}
        {...(onOpenShortcuts ? { onOpenShortcuts } : {})}
        {...(onAutoEdit ? { onAutoEdit } : {})}
        {...(onOpenTools ? { onOpenTools } : {})}
      />
      <AlaukFooter />
    </ProjectProvider>,
  );
  return { onNavigate, onOpenShortcuts, onAutoEdit, onOpenTools };
}

describe('chrome AlaukCut del editor único (P6)', () => {
  it('Projetos navega a la vista de projetos del shell', () => {
    const { onNavigate } = renderChrome();
    fireEvent.click(screen.getByRole('button', { name: /Projetos/i }));
    expect(onNavigate).toHaveBeenCalledWith('projects');
  });

  it('Atalhos y Edição automática ejecutan sus acciones reales', () => {
    const onShortcuts = vi.fn();
    const onAuto = vi.fn();
    renderChrome(vi.fn(), onShortcuts, onAuto);
    fireEvent.click(screen.getByRole('button', { name: /Atalhos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Edição automática/i }));
    expect(onShortcuts).toHaveBeenCalledTimes(1);
    expect(onAuto).toHaveBeenCalledTimes(1);
  });

  it('P8-b: Herramientas abre el mapa de herramientas del MISMO editor', () => {
    const onTools = vi.fn();
    renderChrome(vi.fn(), undefined, undefined, onTools);
    fireEvent.click(screen.getByRole('button', { name: 'Herramientas' }));
    expect(onTools).toHaveBeenCalledTimes(1);
  });

  it('Exportar dispara la solicitud de exportación del store', async () => {
    let storeRef: ReturnType<typeof useProjectStore> | null = null;
    function Probe() {
      storeRef = useProjectStore();
      return null;
    }
    render(
      <ProjectProvider service={createFakeService()} initial={{ project: createEmptyProject('0919') }}>
        <AlaukTopBar onNavigate={vi.fn()} />
        <Probe />
      </ProjectProvider>,
    );
    expect(storeRef!.state.exportRequested).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Exportar/i }));
    await waitFor(() => expect(storeRef!.state.exportRequested).toBe(true));
  });

  it('el pie muestra recuentos reales de materiales y clips', () => {
    renderChrome();
    expect(screen.getByText(/0 materiales · 0 clips/)).toBeTruthy();
  });

  it('el toggle de vista alterna la composición de referencia y el chrome completo', () => {
    renderChrome();
    const toFull = screen.getByRole('button', { name: /Mostrar todos los controles del editor/i });
    expect(toFull.getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.dataset.editorSkin).toBeUndefined();

    fireEvent.click(toFull);
    expect(document.documentElement.dataset.editorSkin).toBe('full');
    expect(localStorage.getItem('olyvia:editor-skin')).toBe('full');

    const toReference = screen.getByRole('button', { name: /Activar vista de referencia/i });
    expect(toReference.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toReference);
    expect(document.documentElement.dataset.editorSkin).toBeUndefined();
    expect(localStorage.getItem('olyvia:editor-skin')).toBe('reference');
  });
});
