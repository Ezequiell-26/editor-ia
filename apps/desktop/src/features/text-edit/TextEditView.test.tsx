// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@editor-ia/project-schema';
import { ProjectProvider } from '../../state/project-store';
import { addAsset, ensureDelivery } from '../../state/project-actions';
import { createFakeService, readyAsset } from '../../test/fake-service';
import { TextEditView } from './TextEditView';

const NOW = '2026-10-24T00:00:00.000Z';

afterEach(cleanup);

function renderView(onNavigate = vi.fn()) {
  const asset = readyAsset({ label: 'Entrevista' });
  const project = addAsset(ensureDelivery(createEmptyProject('Texto', NOW)), asset);
  const service = createFakeService();
  render(
    <ProjectProvider
      service={service}
      initial={{
        project,
        opened: {
          project,
          label: 'texto.editoria.json',
          path: 'C:\\tester\\texto.editoria.json',
          root: 'C:\\tester',
        },
      }}
    >
      <TextEditView onNavigate={onNavigate} />
    </ProjectProvider>,
  );
  return { onNavigate, service };
}

describe('vista de edición por texto', () => {
  it('transcribe el video y crea el corte desde los segmentos elegidos', async () => {
    const { onNavigate, service } = renderView();
    expect(screen.getByRole('heading', { name: /Editá el video desde el texto/i })).toBeTruthy();
    expect(service.calls.create).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: /Transcribir/i }));
    expect(await screen.findByRole('heading', { name: /segmentos · idioma/i })).toBeTruthy();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(1);
    fireEvent.click(checkboxes[1] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: /Crear corte por texto/i }));

    expect(onNavigate).toHaveBeenCalledWith('editor');
  });

  it('sin video listo explica cómo importarlo', () => {
    const service = createFakeService();
    const project = ensureDelivery(createEmptyProject('Sin medios', NOW));
    render(
      <ProjectProvider
        service={service}
        initial={{
          project,
          opened: {
            project,
            label: 'vacio.editoria.json',
            path: 'C:\\tester\\vacio.editoria.json',
            root: 'C:\\tester',
          },
        }}
      >
        <TextEditView onNavigate={() => {}} />
      </ProjectProvider>,
    );
    expect(screen.getByRole('heading', { name: /No hay videos listos/i })).toBeTruthy();
  });
});
