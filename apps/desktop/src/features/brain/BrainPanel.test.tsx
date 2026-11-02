// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, addClipFromAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { BrainPanel } from './BrainPanel';

const NOW = '2026-11-01T00:00:00.000Z';

afterEach(cleanup);

function renderPanel() {
  const base = ensureDelivery(createEmptyProject('Cerebro QA', NOW));
  const asset = readyAsset({ label: 'Toma larga' });
  let project = addAsset(base, asset);
  project = addClipFromAsset(project, asset, { atFrame: 0, durationFrames: 240 }).project;
  project = addClipFromAsset(project, asset, { atFrame: 300, durationFrames: 60 }).project;
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'cerebro.editoria.json',
          path: 'C:\\tester\\cerebro.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <BrainPanel />
    </ProjectProvider>,
  );
  return { service, project };
}

describe('panel del cerebro', () => {
  it('muestra la salud, las métricas y las propuestas', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: /Cerebro de edición/i })).toBeTruthy();
    expect(screen.getByText('/100')).toBeTruthy();
    expect(screen.getAllByText(/Plano medio/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Huecos/i).length).toBeGreaterThan(0);
    // En formato short el plano de 8 s supera el máximo y se propone partirlo.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'short' } });
    expect(screen.getByText(/Cerrar .* de hueco/i)).toBeTruthy();
    expect(screen.getByText(/Partir «/i)).toBeTruthy();
  });

  it('aplica lo seguro y el hueco desaparece del plan', () => {
    renderPanel();
    const apply = screen.getByRole('button', { name: /Aplicar lo seguro/i });
    expect(apply.textContent).toMatch(/\(\d+\)/);
    fireEvent.click(apply);
    expect(screen.queryByText(/Cerrar .* de hueco/i)).toBeNull();
    expect(screen.getAllByText(/aplicada/i).length).toBeGreaterThan(0);
  });

  it('descartar una propuesta la saca de la lista sin tocar la timeline', () => {
    renderPanel();
    const before = screen.getAllByRole('listitem').length;
    const dismiss = screen.getAllByRole('button', { name: /Descartar/i })[0];
    fireEvent.click(dismiss as HTMLElement);
    expect(screen.getAllByRole('listitem').length).toBe(before - 1);
  });

  it('cambia el perfil según el formato elegido', () => {
    renderPanel();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'tutorial' } });
    expect(screen.getAllByText(/Tutorial/).length).toBeGreaterThan(0);
    expect(screen.getByText(/plano medio objetivo 6 s/i)).toBeTruthy();
  });

  it('avisa cuando no hay audio para medir el pulso', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Detectar beats/i }));
    expect(await screen.findByText(/No hay audio en el proyecto/i)).toBeTruthy();
  });

  it('marca como manual la propuesta que necesita intervención', () => {
    renderPanel();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'short' } });
    expect(screen.getAllByText(/Requiere tu intervención/i).length).toBeGreaterThan(0);
  });
});
