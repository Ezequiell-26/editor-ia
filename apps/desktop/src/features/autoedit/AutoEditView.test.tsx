// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { AutoEditView } from './AutoEditView';

const NOW = '2026-10-27T00:00:00.000Z';

afterEach(cleanup);

function renderView(withVideo = true) {
  const base = ensureDelivery(createEmptyProject('Auto', NOW));
  const project = withVideo ? addAsset(base, readyAsset({ kind: 'video' })) : base;
  const onNavigate = vi.fn();
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'auto.editoria.json',
          path: 'C:\\tester\\auto.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <AutoEditView onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { onNavigate, service };
}

describe('editor automático', () => {
  it('analiza el video y crea tres variantes sin IA', async () => {
    renderView();
    expect(screen.getByRole('heading', { name: /Editor automático/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Analizar video/i }));
    expect(await screen.findByText('Pulso rápido')).toBeTruthy();
    expect(screen.getByText('Historia')).toBeTruthy();
    expect(screen.getByText('Impacto')).toBeTruthy();
    expect(screen.getAllByText(/escenas/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sin LLM/i).length).toBeGreaterThan(0);
  });

  it('aplica una variante a la timeline y navega al editor', async () => {
    const { onNavigate } = renderView();
    fireEvent.click(screen.getByRole('button', { name: /Analizar video/i }));
    await screen.findByText('Pulso rápido');
    const apply = screen.getAllByRole('button', { name: /Reemplazar timeline/i })[0]!;
    fireEvent.click(apply);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('editor'));
  });

  it('importa un SRT y lo usa para subtitular las variantes', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Analizar video/i }));
    await screen.findByText('Pulso rápido');
    fireEvent.click(screen.getByRole('button', { name: /Importar SRT\/VTT/i }));
    expect(await screen.findByText(/1 subtítulos cargados/i)).toBeTruthy();
    expect(screen.getAllByText(/1 subtítulo/i).length).toBeGreaterThan(0);
  });

  it('sin videos ofrece ir a Medios', () => {
    renderView(false);
    expect(screen.getByText(/No hay videos listos/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ir a Medios/i })).toBeTruthy();
  });
});
