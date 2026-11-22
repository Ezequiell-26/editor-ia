// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider, useProjectStore } from '../../state/project-store';
import { createFakeService } from '../../test/fake-service';
import { AlaukFooter, AlaukTopBar } from './AlaukChrome';
import { setAiMode, setAiOnly } from '../../state/ai-mode';

afterEach(() => {
  cleanup();
  // El toggle de vista escribe en <html> y en localStorage: se limpia para
  // que ningún test herede el estado del anterior.
  delete document.documentElement.dataset.editorSkin;
  try {
    localStorage.removeItem('olyvia:editor-skin');
    localStorage.removeItem('editoria.ai-mode.v1');
    localStorage.removeItem('editoria.ai-only.v1');
  } catch {
    // jsdom sin almacenamiento: no hay nada que limpiar.
  }
  setAiOnly(false);
  setAiMode(false);
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
  it('Proyectos navega a la vista de proyectos del shell', () => {
    const { onNavigate } = renderChrome();
    fireEvent.click(screen.getByRole('button', { name: /Proyectos/i }));
    expect(onNavigate).toHaveBeenCalledWith('projects');
  });

  it('Atajos y Edición automática ejecutan sus acciones reales', () => {
    const onShortcuts = vi.fn();
    const onAuto = vi.fn();
    renderChrome(vi.fn(), onShortcuts, onAuto);
    fireEvent.click(screen.getByRole('button', { name: /Atajos/i }));
    fireEvent.click(screen.getByRole('button', { name: /Edición automática/i }));
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

  it('el estado de guardado vive una sola vez: en el pie, no duplicado en la topbar', () => {
    let storeRef: ReturnType<typeof useProjectStore> | null = null;
    function Probe() {
      storeRef = useProjectStore();
      return null;
    }
    const { container } = render(
      <ProjectProvider service={createFakeService()} initial={{ project: createEmptyProject('0919') }}>
        <AlaukTopBar onNavigate={vi.fn()} />
        <AlaukFooter />
        <Probe />
      </ProjectProvider>,
    );
    act(() => {
      storeRef!.update((doc) => ({ ...doc, name: `${doc.name} editado` }));
    });
    // dirty: el pie informa «Cambios sin guardar» y la topbar no lo repite.
    expect(screen.getByText('Cambios sin guardar')).toBeTruthy();
    expect(container.querySelector('.alauk-topbar .alauk-save-state')).toBeNull();
    expect(container.querySelector('.alauk-footer .alauk-footer-save')).not.toBeNull();
  });

  it('el pie muestra recuentos reales de materiales y clips', () => {
    renderChrome();
    expect(screen.getByText(/0 materiales · 0 clips/)).toBeTruthy();
  });

  it('el toggle Modo IA alterna la vista persistida con aria-pressed', () => {
    renderChrome();
    const toggle = screen.getByRole('button', { name: /activar modo ia/i });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: /desactivar modo ia/i }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(localStorage.getItem('editoria.ai-mode.v1')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: /desactivar modo ia/i }));
    expect(
      screen.getByRole('button', { name: /activar modo ia/i }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(localStorage.getItem('editoria.ai-mode.v1')).toBe('0');
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

  it('en ai-only muestra herramientas no edición en la barra visible del editor', () => {
    setAiOnly(true);
    const { onNavigate } = renderChrome();
    const button = screen.getByRole('button', { name: 'Herramientas' });
    expect(button).toBeTruthy();
    // La barra global se oculta en modo inmersivo: el botón vive acá.
    expect(button.closest('.alauk-topbar')).not.toBeNull();

    fireEvent.click(button);
    expect(screen.getByRole('menu', { name: 'Herramientas de Olyvia' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Descargar/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Comprimir/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Laboratorio/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^Texto/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Multicámara/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Mezcla/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^VFX/ })).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: /^Descargar/ }));
    expect(onNavigate).toHaveBeenCalledWith('download');
  });
});
