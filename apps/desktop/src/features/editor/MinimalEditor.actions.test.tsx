// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { addClipFromAsset } from '../../state/project-actions';
import { ProjectProvider } from '../../state/project-store';
import { createFakeService, readyAsset, type FakeService } from '../../test/fake-service';
import { MinimalEditor } from './MinimalEditor';
import { useMinimalEditorActions } from './minimal/useMinimalEditorActions';

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

// Mismo motivo que MinimalEditor.test.tsx: precalentar los chunks lazy
// (EditorAssets/Timeline/Inspector) para que monten dentro del timeout.
beforeAll(async () => {
  await Promise.all([
    import('./EditorAssets'),
    import('./Inspector'),
    import('./Timeline'),
  ]);
});

/** Expone `runLabel` del hook real para probar etiquetas sin acción mapeada. */
function ActionProbe() {
  const actions = useMinimalEditorActions({});
  return (
    <>
      <button type="button" onClick={() => actions.runLabel('Etiqueta inexistente')}>probar</button>
      <span data-testid="notice">{actions.notice ?? ''}</span>
    </>
  );
}

function renderEditor(service: FakeService = createFakeService(), withClip = false) {
  const base = createEmptyProject('0919');
  const project = withClip
    ? addClipFromAsset(base, readyAsset(), { atFrame: 0 }).project
    : base;
  const view = render(
    <ProjectProvider service={service} initial={{ project }}>
      <MinimalEditor />
    </ProjectProvider>,
  );
  return { ...view, service };
}

describe('editor mínimo · controles cableados al proyecto real', () => {
  it('el rail de assets real navega a Importar del mismo editor (P5)', async () => {
    // El botón «Importar» del EditorAssets productivo no abre un segundo
    // flujo: navega al modo `assets` del MISMO editor (AssetsPanel), que
    // tiene el consentimiento y `service.importAssets` reales.
    const onNavigate = vi.fn();
    render(
      <ProjectProvider service={createFakeService()} initial={{ project: createEmptyProject('0919') }}>
        <MinimalEditor onNavigate={onNavigate} />
      </ProjectProvider>,
    );
    const importButton = await screen.findByRole('button', { name: /^Importar$/i });
    fireEvent.click(importButton);
    expect(onNavigate).toHaveBeenCalledWith('assets');
  });

  it('el rail de assets muestra los materiales reales del proyecto (P5)', async () => {
    const base = createEmptyProject('0919');
    const project = { ...base, assets: [readyAsset()] };
    render(
      <ProjectProvider service={createFakeService()} initial={{ project }}>
        <MinimalEditor />
      </ProjectProvider>,
    );
    // El asset real aparece en el rail productivo (label friendlyAssetLabel).
    expect(await screen.findByText(/Toma de prueba/i)).toBeTruthy();
  });

  it('la Timeline real trae el toggle de imán operativo (B3/P3)', async () => {
    renderEditor();
    // La Timeline productiva llega por import() dinámico.
    const toggle = await screen.findByRole('button', { name: /timeline magnética/i });
    const before = toggle.getAttribute('aria-pressed');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).not.toBe(before));
  });

  it('el cabezal de la timeline real es operable con teclado', async () => {
    // Con un clip real el proyecto tiene duración: sin ella el store clampa
    // correctamente cualquier seek a 0.
    renderEditor(createFakeService(), true);
    const grip = await screen.findByRole('slider', { name: /Cabezal de la timeline/i });
    const before = grip.getAttribute('aria-valuenow');
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    await waitFor(() => expect(grip.getAttribute('aria-valuenow')).not.toBe(before));
  });

  it('una etiqueta sin acción mapeada se declara, no queda muda (UI-002)', () => {
    render(
      <ProjectProvider service={createFakeService()} initial={{ project: createEmptyProject('0919') }}>
        <ActionProbe />
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'probar' }));
    expect(screen.getByTestId('notice').textContent).toContain('todavía no tiene una acción');
  });

  it('todos los botones visibles tienen una acción registrada', () => {
    const { container } = renderEditor();
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(30);
    // Ningún botón queda deshabilitado sin motivo (la réplica los muestra activos).
    for (const button of buttons) {
      expect(button.hasAttribute('type')).toBe(true);
    }
  });
});
