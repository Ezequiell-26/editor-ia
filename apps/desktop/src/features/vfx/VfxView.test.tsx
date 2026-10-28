// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { VfxView } from './VfxView';

const NOW = '2026-10-24T00:00:00.000Z';

afterEach(cleanup);

function renderView(withClip = true) {
  const base = ensureDelivery(createEmptyProject('VFX', NOW));
  const asset = readyAsset({ label: 'Toma VFX', kind: 'video' });
  const project = withClip
    ? addClipFromAsset(addAsset(base, asset), asset, { atFrame: 0, durationFrames: 150 })
        .project
    : base;
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'vfx.editoria.json',
          path: 'C:\tester\vfx.editoria.json',
          root: 'C:\tester',
        },
      }}
    >
      <VfxView onNavigate={vi.fn()} />
    </ProjectProvider>,
  );
  return { service, project };
}

describe('vista VFX', () => {
  it('muestra la cadena de nodos y crea un polígono de roto', () => {
    renderView();
    expect(screen.getByRole('heading', { name: /VFX y rotoscopía/i })).toBeTruthy();
    expect(screen.getByText('Chroma')).toBeTruthy();
    expect(screen.getByText('Roto')).toBeTruthy();
    expect(screen.getByText('Salida')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Crear polígono/i }));
    expect(screen.getAllByText(/8 vértices/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Seguir rostro/i })).toBeTruthy();
  });

  it('activa chroma con presets, derrame y vista de clave', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /^Pantalla verde$/i }));
    expect(screen.getByText('Color clave')).toBeTruthy();
    expect(screen.getByText(/Suavizado/i)).toBeTruthy();
    expect(screen.getByText(/Derrame/i)).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Vista de clave/i }));
    expect(screen.getByRole('button', { name: /Vista original/i })).toBeTruthy();
  });

  it('convierte el seguimiento facial en claves del polígono', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Crear polígono/i }));
    const track = screen.getByRole('button', { name: /Seguir rostro/i });
    expect(track.hasAttribute('disabled')).toBe(false);
    fireEvent.click(track);
    expect(await screen.findByText(/Seguimiento facial:/i)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/4 claves/i)).toBeTruthy());
  });

  it('sin clips visuales ofrece ir a Medios', () => {
    renderView(false);
    expect(screen.getByText(/No hay clips visuales/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ir a Medios/i })).toBeTruthy();
  });
});
